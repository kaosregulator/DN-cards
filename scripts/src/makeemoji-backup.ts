#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Rebuild the MakeEmoji offline backup package + ZIP.
//
//   pnpm makeemoji:backup
//
// Reads the verified MakeEmoji provider manifest (when present), refreshes
// styles/controls/manifest under artifacts/emoji-offline/, writes SHA-256
// checksums, and packs makeemoji-offline-backup.zip.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = join(REPO, "artifacts/emoji-offline");
const MAKEEMOJI_MANIFEST = join(
  REPO, "artifacts/api-server/src/bot/emoji/providers/makeemoji/manifest.json",
);
const ZIP_NAME = "makeemoji-offline-backup.zip";
const VERSION = "1.0.0";

const IMPLEMENTED: Record<string, string> = {
  shake: "shake",
  bounce: "bounce",
  wobble: "wobble",
  flip: "flip",
  glitch: "glitch",
  pulse: "pulse",
  zoom: "zoom",
  heartbeat: "heartbeat",
  squish: "squish",
  sparkle: "sparkle",
  party: "party",
};

interface ManifestControl {
  kind: string;
  selector: string;
  valueAttribute?: string;
  values: { value: string; label?: string }[];
}

interface MakeEmojiManifest {
  verified: boolean;
  discoveredAt: string | null;
  siteUrl: string;
  notes: string;
  browser: Record<string, unknown>;
  api: unknown;
  controls: Record<string, ManifestControl>;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === ZIP_NAME || name === "checksums.json") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walkFiles(path, base));
    else if (st.isFile()) out.push(relative(base, path).replace(/\\/g, "/"));
  }
  return out.sort();
}

function main(): void {
  mkdirSync(join(OUT, "metadata"), { recursive: true });
  mkdirSync(join(OUT, "renderer"), { recursive: true });
  mkdirSync(join(OUT, "assets"), { recursive: true });

  if (!existsSync(MAKEEMOJI_MANIFEST)) {
    throw new Error(`MakeEmoji manifest missing: ${MAKEEMOJI_MANIFEST}`);
  }

  const src = JSON.parse(readFileSync(MAKEEMOJI_MANIFEST, "utf8")) as MakeEmojiManifest;
  const anim = src.controls.animation?.values ?? [];
  if (anim.length === 0) {
    throw new Error("MakeEmoji manifest has no animation values — cannot build backup");
  }

  const styles = anim.map(v => {
    const id = v.label ?? v.value.replace(/^gen_btn_/, "");
    return {
      id,
      name: id,
      tag: v.value,
      dataTag: v.value,
      category: "classic",
      offlineImplemented: id in IMPLEMENTED,
      offlineEffectId: IMPLEMENTED[id] ?? null,
      source: "makeemoji.com discovery",
    };
  });

  const implementedStyleCount = styles.filter(s => s.offlineImplemented).length;

  const controls: Record<string, unknown> = {};
  for (const [key, control] of Object.entries(src.controls)) {
    if (key === "animation") continue;
    controls[key] = {
      kind: control.kind,
      selector: control.selector,
      valueAttribute: control.valueAttribute,
      values: control.values,
    };
  }

  const offlineManifest = {
    source: "makeemoji.com",
    discoveredAt: src.discoveredAt,
    styleCount: styles.length,
    implementedStyleCount,
    version: VERSION,
    offlineReady: false,
    primaryProvider: "makeemoji-browser",
    notes:
      "Archive of MakeEmoji discovery data for a future offline engine. " +
      "offlineReady is false until the offline generator covers styles independently. " +
      "A partial mapping to the local procedural renderer exists for exact-name overlaps only.",
    browser: src.browser,
    siteUrl: src.siteUrl,
    api: null,
  };

  const sourceSnapshot = {
    verified: src.verified,
    discoveredAt: src.discoveredAt,
    siteUrl: src.siteUrl,
    notes: src.notes,
    browser: src.browser,
    api: src.api,
    controls: Object.fromEntries(
      Object.entries(src.controls).map(([k, v]) => [
        k,
        {
          kind: v.kind,
          selector: v.selector,
          valueAttribute: v.valueAttribute,
          valueCount: v.values.length,
          values: k === "animation" ? null : v.values,
        },
      ]),
    ),
  };

  const mappings = {
    version: VERSION,
    description:
      "Exact-name MakeEmoji style → local procedural effect. Only listed styles are offline-capable today.",
    mappings: Object.entries(IMPLEMENTED)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([styleId, localEffectId]) => ({
        styleId, localEffectId, fidelity: "approximate-procedural",
      })),
  };

  writeFileSync(join(OUT, "VERSION"), `${VERSION}\n`);
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(offlineManifest, null, 2) + "\n");
  writeFileSync(join(OUT, "styles.json"), JSON.stringify(styles, null, 2) + "\n");
  writeFileSync(join(OUT, "controls.json"), JSON.stringify(controls, null, 2) + "\n");
  writeFileSync(
    join(OUT, "makeemoji-source-manifest.json"),
    JSON.stringify(sourceSnapshot, null, 2) + "\n",
  );
  writeFileSync(join(OUT, "renderer/mappings.json"), JSON.stringify(mappings, null, 2) + "\n");
  writeFileSync(
    join(OUT, "metadata/source-site.json"),
    JSON.stringify({
      source: "https://makeemoji.com/",
      discoveredAt: src.discoveredAt,
      archivedAt: new Date().toISOString(),
      styleCount: styles.length,
      manifestVersion: VERSION,
      processing: "client-side",
    }, null, 2) + "\n",
  );

  // Ensure docs exist (do not overwrite hand-written README if present — only
  // create stubs when missing so re-runs stay non-destructive for prose).
  for (const [rel, body] of [
    ["assets/.gitkeep", ""],
  ] as const) {
    const path = join(OUT, rel);
    if (!existsSync(path)) writeFileSync(path, body);
  }

  const files = walkFiles(OUT);
  const checksums: Record<string, string> = {};
  for (const rel of files) {
    checksums[rel] = sha256(readFileSync(join(OUT, rel)));
  }
  writeFileSync(
    join(OUT, "checksums.json"),
    JSON.stringify({ algorithm: "sha256", version: VERSION, files: checksums }, null, 2) + "\n",
  );

  const zipPath = join(OUT, ZIP_NAME);
  rmSync(zipPath, { force: true });
  // Pack contents (not the parent folder name) so extraction is predictable.
  const listed = [...files, "checksums.json"];
  const zip = spawnSync("zip", ["-q", "-X", ZIP_NAME, ...listed], {
    cwd: OUT, encoding: "utf8",
  });
  if (zip.status !== 0) {
    throw new Error(`zip failed: ${zip.stderr || zip.stdout || zip.error}`);
  }

  // Also copy a machine-readable style count sidecar used by tests.
  writeFileSync(
    join(OUT, "metadata/style-count.txt"),
    `Discovered styles: ${styles.length}\n`,
  );
  // Refresh checksum to include style-count.txt — rebuild checksums + zip once more.
  const files2 = walkFiles(OUT);
  const checksums2: Record<string, string> = {};
  for (const rel of files2) checksums2[rel] = sha256(readFileSync(join(OUT, rel)));
  writeFileSync(
    join(OUT, "checksums.json"),
    JSON.stringify({ algorithm: "sha256", version: VERSION, files: checksums2 }, null, 2) + "\n",
  );
  rmSync(zipPath, { force: true });
  const listed2 = [...files2, "checksums.json"];
  const zip2 = spawnSync("zip", ["-q", "-X", ZIP_NAME, ...listed2], {
    cwd: OUT, encoding: "utf8",
  });
  if (zip2.status !== 0) {
    throw new Error(`zip failed: ${zip2.stderr || zip2.stdout || zip2.error}`);
  }

  console.log(`Discovered styles: ${styles.length}`);
  console.log(`Offline-implemented (partial): ${implementedStyleCount}`);
  console.log(`Wrote ${zipPath}`);
  console.log(`offlineReady: false`);
}

main();
