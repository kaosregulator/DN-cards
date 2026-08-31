import { describe, expect, it } from "vitest";
import { buildEmojiCommandJson } from "../commands/definition.js";
import { isManifestOption, suggestFor, defaultAnimation, MANIFEST_OPTIONS } from "../commands/options.js";
import { setManifestForTesting } from "../providers/makeemoji/manifest.js";
import type { Manifest } from "../providers/makeemoji/types.js";

interface CommandOption {
  name: string;
  autocomplete?: boolean;
  choices?: { value: string }[];
}

const command = () => buildEmojiCommandJson() as unknown as {
  name: string; options?: CommandOption[];
};

describe("/emoji definition", () => {
  it("exposes the MakeEmoji settings", () => {
    expect(command().options?.map(o => o.name)).toEqual([
      "image", "user", "url", "server",
      "animation", "speed", "direction", "size", "color", "quality", "platform",
      "format",
    ]);
  });

  it("offers all four image targets", () => {
    // Upload, a member's avatar, a URL, and the server's own icon.
    const names = command().options?.map(o => o.name) ?? [];
    for (const target of ["image", "user", "url", "server"]) {
      expect(names, target).toContain(target);
    }
  });

  it("makes every MakeEmoji setting autocomplete, not a fixed choice list", () => {
    // Fixed choices are baked in at registration time, which would mean shipping
    // a vocabulary we invented. Autocomplete reads the manifest at type time.
    const options = command().options ?? [];
    for (const name of MANIFEST_OPTIONS) {
      const option = options.find(o => o.name === name);
      expect(option?.autocomplete, name).toBe(true);
      expect(option?.choices ?? [], name).toEqual([]);
    }
  });

  it("keeps format as a fixed choice — it is our contract, not the site's", () => {
    const format = command().options?.find(o => o.name === "format");
    expect(format?.autocomplete).toBeFalsy();
    expect(format?.choices?.map(c => c.value)).toEqual(["gif", "webp", "apng"]);
  });
});

describe("option suggestions", () => {
  it("recognises the manifest-driven option names", () => {
    expect(isManifestOption("animation")).toBe(true);
    expect(isManifestOption("format")).toBe(false);
    expect(isManifestOption("nonsense")).toBe(false);
  });

  it("says discovery is needed instead of listing invented values", () => {
    setManifestForTesting(null, "no manifest");
    const suggestions = suggestFor("animation", "");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.name).toMatch(/not set up/i);
    // Discord rejects a choice with an empty value, which silently discarded the
    // whole response — so the hint carries a sentinel the command filters out.
    expect(suggestions[0]!.value).not.toBe("");
    expect(suggestions[0]!.value.length).toBeGreaterThan(0);
    expect(defaultAnimation()).toBeNull();
  });

  it("offers exactly what the manifest lists, filtered by what was typed", () => {
    setManifestForTesting({
      verified: true, discoveredAt: null, siteUrl: "https://x.test/", notes: "",
      controls: {
        animation: {
          selector: "#a", kind: "select",
          values: [
            { value: "shake", label: "Shake" },
            { value: "spin", label: "Spin" },
            { value: "bounce", label: "Bounce" },
          ],
        },
      },
      browser: {
        readySelector: null, fileInputSelector: "#f", generateSelector: null,
        resultSelector: null, downloadSelector: null, dismissSelectors: [],
      },
      api: null,
    } as Manifest);

    expect(suggestFor("animation", "").map(c => c.value)).toEqual(["shake", "spin", "bounce"]);
    expect(suggestFor("animation", "sp").map(c => c.value)).toEqual(["spin"]);
    // Label matching too, since that is what the user sees on the site.
    expect(suggestFor("animation", "Bounce").map(c => c.value)).toEqual(["bounce"]);
    expect(defaultAnimation()).toBe("shake");

    setManifestForTesting(null);
  });

  it("passes free-text controls straight through", () => {
    setManifestForTesting({
      verified: true, discoveredAt: null, siteUrl: "https://x.test/", notes: "",
      controls: { color: { selector: "#c", kind: "text", values: [] } },
      browser: {
        readySelector: null, fileInputSelector: "#f", generateSelector: null,
        resultSelector: null, downloadSelector: null, dismissSelectors: [],
      },
      api: null,
    } as Manifest);

    // A colour hex was never in an enumerated list, so blocking it would be wrong.
    expect(suggestFor("color", "#ff0000").map(c => c.value)).toEqual(["#ff0000"]);
    setManifestForTesting(null);
  });
});
