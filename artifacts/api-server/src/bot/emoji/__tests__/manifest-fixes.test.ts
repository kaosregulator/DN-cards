import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reloadManifest, resolveValue, setManifestForTesting } from "../providers/makeemoji/manifest.js";
import { defaultAnimation } from "../commands/options.js";
import { FORMATS, extensionFor, parseSize } from "../utils/options.js";
import { Manifest } from "../providers/makeemoji/types.js";

/** The manifest actually committed for production use. */
function liveManifest(): Manifest {
  const path = fileURLToPath(
    new URL("../providers/makeemoji/manifest.json", import.meta.url),
  );
  return Manifest.parse(JSON.parse(readFileSync(path, "utf8"))) as Manifest;
}

describe("decorated option values", () => {
  // MakeEmoji decorates its own option text — sizes read "⬜ 64px", directions
  // "➡️ Right". Passing these through Number() produced NaN and the setting was
  // silently dropped while the UI claimed it had applied.
  const manifest = liveManifest();

  it("resolves a plain size against the decorated value", () => {
    expect(resolveValue(manifest, "size", "64")).toBe("⬜ 64px");
    expect(resolveValue(manifest, "size", "128")).toBe("⬜ 128px");
  });

  it("resolves the decorated value against itself", () => {
    expect(resolveValue(manifest, "size", "⬜ 64px")).toBe("⬜ 64px");
  });

  it("resolves a plain direction against the decorated value", () => {
    expect(resolveValue(manifest, "direction", "right")).toBe("➡️ Right");
    expect(resolveValue(manifest, "direction", "Left")).toBe("⬅️ Left");
  });

  it("still refuses a value the site does not offer", () => {
    expect(resolveValue(manifest, "size", "999")).toBeNull();
    expect(resolveValue(manifest, "direction", "sideways")).toBeNull();
  });

  it("reads a size out of a decorated string", () => {
    expect(parseSize("⬜ 64px")).toBe(64);
  });
});

describe("format vocabulary", () => {
  const manifest = liveManifest();

  it("offers only formats the site actually supports", () => {
    for (const format of FORMATS) {
      expect(resolveValue(manifest, "format", format), format).not.toBeNull();
    }
  });

  it("does not offer plain PNG, which MakeEmoji has no output for", () => {
    expect((FORMATS as readonly string[]).includes("png")).toBe(false);
    expect(resolveValue(manifest, "format", "png")).toBeNull();
  });

  it("serves APNG with a .png extension so Discord renders it", () => {
    expect(extensionFor("apng")).toBe("png");
    expect(extensionFor("gif")).toBe("gif");
    expect(extensionFor("webp")).toBe("webp");
  });
});

describe("default animation", () => {
  it("never defaults to the no-op style", () => {
    // MakeEmoji's list opens with "none", the editor's clear-style entry. Taking
    // the first value made a bare /emoji return the image unchanged.
    setManifestForTesting(liveManifest());
    const chosen = defaultAnimation();
    expect(chosen).not.toBeNull();
    expect(chosen).not.toBe("gen_btn_none");
    expect(chosen).toBe("gen_btn_shake");
    setManifestForTesting(null);
  });

  it("falls through to the first usable style when no preference matches", () => {
    setManifestForTesting({
      verified: true, discoveredAt: null, siteUrl: "https://x.test/", notes: "",
      controls: {
        animation: {
          selector: "#a", kind: "button",
          values: [
            { value: "gen_btn_none", label: "none" },
            { value: "gen_btn_wobble", label: "wobble" },
          ],
        },
      },
      browser: {
        readySelector: null, fileInputSelector: "#f", generateSelector: null,
        resultSelector: null, downloadSelector: null, dismissSelectors: [],
      },
      api: null,
    } as Manifest);

    expect(defaultAnimation()).toBe("gen_btn_wobble");
    setManifestForTesting(null);
  });

  it("returns null when nothing has been discovered", () => {
    setManifestForTesting(null, "no manifest");
    expect(defaultAnimation()).toBeNull();
  });
});

describe("committed manifest", () => {
  it("is verified and loads through the normal path", () => {
    setManifestForTesting(null);
    const loaded = reloadManifest();
    expect(loaded.problem).toBeNull();
    expect(loaded.manifest?.verified).toBe(true);
    expect(loaded.manifest?.controls.animation?.values.length).toBeGreaterThan(0);
  });
});
