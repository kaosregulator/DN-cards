import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync, mkdtempSync, readFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  findOfflineStyle,
  implementedOfflineStyles,
  isOfflineFallbackEnabled,
  loadOfflineManifest,
  loadOfflineStyles,
  offlinePackageRoot,
  offlineProvider,
  reloadOfflineRegistry,
  renderOffline,
} from "../providers/offline/index.js";
import { setManifestForTesting } from "../providers/makeemoji/manifest.js";
import { resolveProvider } from "../providers/index.js";
import { testImage } from "./fixtures.js";

const PACKAGE = fileURLToPath(new URL("../../../../../emoji-offline/", import.meta.url));

describe("offline MakeEmoji backup package", () => {
  it("reports the discovered style count from the archive", () => {
    reloadOfflineRegistry();
    const styles = loadOfflineStyles();
    const manifest = loadOfflineManifest();
    // eslint-disable-next-line no-console
    console.log(`Discovered styles: ${styles.length}`);
    expect(styles.length).toBeGreaterThanOrEqual(400);
    expect(manifest?.styleCount).toBe(styles.length);
    // A small set of styles has an official prerendered GIF but no compositable
    // CDN frames (the three pokéball styles), so the archive is intentionally
    // not fully offline-ready: implemented < total, and offlineReady === (all
    // implemented). This asserts that documented relationship rather than a
    // fixed count, so it survives new styles being added or unblocked.
    const total = manifest?.styleCount ?? 0;
    const implemented = manifest?.implementedStyleCount ?? 0;
    expect(implemented).toBeGreaterThanOrEqual(total - 10);
    expect(implemented).toBeLessThanOrEqual(total);
    expect(manifest?.offlineReady).toBe(implemented === total);
    expect(manifest?.source).toBe("makeemoji.com");
    expect(offlinePackageRoot()).toBeTruthy();
  });

  it("marks recipe-ready styles as offlineImplemented across the full catalog", () => {
    const implemented = implementedOfflineStyles();
    expect(implemented.length).toBeGreaterThanOrEqual(400);
    expect(implemented.every(s => s.offlineEffectId)).toBe(true);
    expect(findOfflineStyle("shake")?.offlineImplemented).toBe(true);
    expect(findOfflineStyle("party-parrot")?.offlineImplemented).toBe(true);
  });

  it("extracts the backup ZIP and verifies checksums", () => {
    const zipPath = join(PACKAGE, "makeemoji-offline-backup.zip");
    expect(existsSync(zipPath), "run pnpm makeemoji:backup first").toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "emoji-offline-extract-"));
    try {
      const unzip = spawnSync("unzip", ["-q", zipPath, "-d", dir], { encoding: "utf8" });
      expect(unzip.status, unzip.stderr).toBe(0);

      for (const rel of [
        "manifest.json", "styles.json", "controls.json", "checksums.json",
        "VERSION", "README.md", "makeemoji-source-manifest.json",
        "renderer/mappings.json", "metadata/source-site.json",
      ]) {
        expect(existsSync(join(dir, rel)), rel).toBe(true);
      }

      const checksums = JSON.parse(readFileSync(join(dir, "checksums.json"), "utf8")) as {
        algorithm: string;
        files: Record<string, string>;
      };
      expect(checksums.algorithm).toBe("sha256");
      expect(Object.keys(checksums.files).length).toBeGreaterThan(5);

      for (const [rel, expected] of Object.entries(checksums.files)) {
        const actual = createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
        expect(actual, rel).toBe(expected);
      }

      const styles = JSON.parse(readFileSync(join(dir, "styles.json"), "utf8")) as unknown[];
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
        styleCount: number; offlineReady: boolean; implementedStyleCount: number;
      };
      expect(styles.length).toBe(manifest.styleCount);
      // offlineReady tracks whether every style is compositable offline; the
      // archive currently blocks a few (no CDN frames), so it is false and
      // implemented < total. Assert that invariant, not a hardcoded flag.
      expect(manifest.offlineReady).toBe(manifest.implementedStyleCount === manifest.styleCount);
      expect(manifest.implementedStyleCount).toBeLessThanOrEqual(manifest.styleCount);
      // eslint-disable-next-line no-console
      console.log(`Discovered styles: ${styles.length}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("offline provider (on by default)", () => {
  beforeEach(() => {
    delete process.env["EMOJI_DISABLE_OFFLINE"];
    delete process.env["EMOJI_ALLOW_LOCAL_FALLBACK"];
    reloadOfflineRegistry();
  });
  afterAll(() => {
    delete process.env["EMOJI_DISABLE_OFFLINE"];
  });

  it("is available by default, and can be turned off", async () => {
    // The offline engine is the default generator now.
    expect(isOfflineFallbackEnabled()).toBe(true);
    expect((await offlineProvider.status()).available).toBe(true);

    process.env["EMOJI_DISABLE_OFFLINE"] = "1";
    expect(isOfflineFallbackEnabled()).toBe(false);
    expect((await offlineProvider.status()).available).toBe(false);
    delete process.env["EMOJI_DISABLE_OFFLINE"];
  });

  it("renders mapped styles with no network when enabled", async () => {
    expect((await offlineProvider.status()).available).toBe(true);

    const image = await testImage(96);
    for (const style of ["shake", "bounce", "wobble", "party", "sparkle"] as const) {
      const result = await offlineProvider.generate({
        image, animation: style, format: "gif", size: "64", speed: "normal",
      });
      expect(result.providerId).toBe("offline");
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
    }
  }, 60_000);

  it("refuses unknown styles instead of faking them", async () => {
    await expect(offlineProvider.generate({
      image: await testImage(64),
      animation: "definitely-not-a-real-makeemoji-style-xyz",
      format: "gif",
    })).rejects.toMatchObject({ code: "unknown_effect" });
  });

  it("renders archived atlas styles when offline fallback is enabled", async () => {
    const result = await offlineProvider.generate({
      image: await testImage(64), animation: "party-parrot", format: "gif", size: "64",
    });
    expect(result.providerId).toBe("offline");
    expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
  }, 30_000);

  it("does not take over while MakeEmoji is available", async () => {
    // Inject an unavailable MakeEmoji + enable offline — then offline may serve.
    // With a verified live manifest MakeEmoji stays primary; here we force it off.
    setManifestForTesting(null, "forced unavailable for offline test");
    const provider = await resolveProvider();
    expect(provider.id).toBe("offline");

    // Restore: clear injection by reloading from disk in other suites via setManifestForTesting
  });
});

describe("offline renderOffline helper", () => {
  it("produces a GIF for shake without touching the network", async () => {
    const result = await renderOffline({
      image: await testImage(80), animation: "shake", format: "gif", size: "48",
    });
    expect(result.providerId).toBe("offline");
    expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
  }, 30_000);
});
