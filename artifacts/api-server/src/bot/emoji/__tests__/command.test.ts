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
  name: string; description: string; options?: CommandOption[];
};

describe("/emoji definition", () => {
  it("is option-free — the flow lives in the dashboard, not the slash surface", () => {
    // Every setting moved into the interactive dashboard, so the command itself
    // carries no options: `/emoji` just opens the flow.
    expect(command().options ?? []).toEqual([]);
  });

  it("is named and described for discovery", () => {
    expect(command().name).toBe("emoji");
    expect(command().description.length).toBeGreaterThan(0);
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
