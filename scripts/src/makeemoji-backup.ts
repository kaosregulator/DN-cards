#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Rebuild the MakeEmoji offline backup package + ZIP.
//
//   pnpm makeemoji:backup
//
// Reads the verified MakeEmoji provider manifest (when present), refreshes
// styles/controls/manifest under artifacts/emoji-offline/, preserves recipes +
// archived assets, writes SHA-256 checksums, and packs makeemoji-offline-backup.zip.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
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
const VERSION = "2.1.0";

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

interface Recipe {
  id: string;
  slug: string;
  tag: string;
  family: string;
  primitive: string | null;
  offlineReady?: boolean;
  params?: Record<string, unknown>;
  fidelity?: string | null;
  notes?: string[];
  assets?: Record<string, string>;
  preview?: unknown;
  directionSuffix?: string | null;
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

function loadExistingRecipes(): Map<string, Recipe> {
  const path = join(OUT, "recipes", "recipes.json");
  const map = new Map<string, Recipe>();
  if (!existsSync(path)) return map;
  try {
    const recipes = JSON.parse(readFileSync(path, "utf8")) as Recipe[];
    for (const r of recipes) map.set(r.id, r);
  } catch { /* ignore */ }
  return map;
}

function main(): void {
  mkdirSync(join(OUT, "metadata"), { recursive: true });
  mkdirSync(join(OUT, "renderer"), { recursive: true });
  mkdirSync(join(OUT, "assets"), { recursive: true });
  mkdirSync(join(OUT, "assets", "overlays"), { recursive: true });
  mkdirSync(join(OUT, "recipes"), { recursive: true });

  if (!existsSync(MAKEEMOJI_MANIFEST)) {
    throw new Error(`MakeEmoji manifest missing: ${MAKEEMOJI_MANIFEST}`);
  }

  const src = JSON.parse(readFileSync(MAKEEMOJI_MANIFEST, "utf8")) as MakeEmojiManifest;
  const anim = src.controls.animation?.values ?? [];
  if (anim.length === 0) {
    throw new Error("MakeEmoji manifest has no animation values — cannot build backup");
  }

  const existing = loadExistingRecipes();

  const styles = anim.map(v => {
    const id = v.label ?? v.value.replace(/^gen_btn_/, "");
    const recipe = existing.get(id);
    const ready = Boolean(recipe?.offlineReady && recipe.primitive);
    return {
      id,
      name: id,
      tag: v.value,
      dataTag: v.value,
      category: "classic",
      offlineImplemented: ready,
      offlineEffectId: ready ? recipe!.primitive : null,
      offlineFamily: recipe?.family ?? null,
      source: "makeemoji.com discovery",
    };
  });

  const implementedStyleCount = styles.filter(s => s.offlineImplemented).length;
  const packageOfflineReady = implementedStyleCount >= styles.length && styles.length > 0;

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
    offlineReady: packageOfflineReady,
    primaryProvider: "makeemoji-browser",
    notes: packageOfflineReady
      ? `Offline engine: ${implementedStyleCount}/${styles.length} styles independently renderable ` +
        "(transform/overlay/atlas/frames/passthrough) after render verification. " +
        "MakeEmoji remains primary. Enable with EMOJI_ALLOW_OFFLINE_FALLBACK=1."
      : `Partial offline engine: ${implementedStyleCount}/${styles.length} styles independently ` +
        "renderable after verification. Remaining styles need recipes/assets. " +
        "MakeEmoji remains primary. Enable with EMOJI_ALLOW_OFFLINE_FALLBACK=1.",
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

  const readyMappings = styles
    .filter(s => s.offlineImplemented && s.offlineEffectId)
    .map(s => {
      const recipe = existing.get(s.id);
      return {
        styleId: s.id,
        family: recipe?.family ?? s.offlineFamily ?? "transform",
        primitive: s.offlineEffectId,
        fidelity: recipe?.fidelity ?? "approximate-procedural",
      };
    });

  const mappings = {
    version: VERSION,
    description:
      "MakeEmoji style → offline recipe primitive. Only offlineReady styles render.",
    count: readyMappings.length,
    mappings: readyMappings,
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
      implementedStyleCount,
    }, null, 2) + "\n",
  );
  writeFileSync(
    join(OUT, "metadata/style-count.txt"),
    `Discovered styles: ${styles.length}\nImplemented offline: ${implementedStyleCount}\n`,
  );

  for (const [rel, body] of [
    ["assets/.gitkeep", ""],
    ["assets/overlays/.gitkeep", ""],
  ] as const) {
    const path = join(OUT, rel);
    if (!existsSync(path)) writeFileSync(path, body);
  }

  // Preserve recipes.json if present (authored by the offline engine workflow).
  if (!existsSync(join(OUT, "recipes", "recipes.json")) && existing.size === 0) {
    writeFileSync(join(OUT, "recipes", "recipes.json"), "[]\n");
  }

  const files = walkFiles(OUT);
  const checksums: Record<string, string> = {};
  for (const rel of files) checksums[rel] = sha256(readFileSync(join(OUT, rel)));
  writeFileSync(
    join(OUT, "checksums.json"),
    JSON.stringify({ algorithm: "sha256", version: VERSION, files: checksums }, null, 2) + "\n",
  );

  const zipPath = join(OUT, ZIP_NAME);
  rmSync(zipPath, { force: true });
  const listed = [...files, "checksums.json"];
  const zip = spawnSync("zip", ["-q", "-X", ZIP_NAME, ...listed], {
    cwd: OUT, encoding: "utf8",
  });
  if (zip.status !== 0) {
    throw new Error(`zip failed: ${zip.stderr || zip.stdout || zip.error}`);
  }

  console.log(`Discovered styles: ${styles.length}`);
  console.log(`Offline-implemented: ${implementedStyleCount}`);
  console.log(`Wrote ${zipPath}`);
  console.log(`offlineReady: ${packageOfflineReady} (package-level; per-style flags in recipes/styles)`);
}

main();
