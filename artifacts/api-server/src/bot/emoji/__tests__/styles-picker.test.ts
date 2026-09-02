import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isFavorite, listFavorites, toggleFavorite,
  resetFavoritesForTesting, setFavoritesPathForTesting,
} from "../commands/favorites.js";
import {
  previewSlug, guessStylePreviewUrl, clearPreviewCache, setPreviewCacheForTesting,
} from "../commands/previews.js";
import {
  allStyles, pageStyles, ensureStyleFocus, STYLES_PAGE_SIZE,
  filteredStyles, totalStylePages, buildStyleSearchModal,
} from "../commands/styles-picker.js";
import { createSession } from "../commands/session.js";
import { buildControls, buildUploadModal, parseCid, cid } from "../commands/ui.js";
import { setManifestForTesting } from "../providers/makeemoji/manifest.js";
import type { Manifest } from "../providers/makeemoji/types.js";

function testManifest(animations: { value: string; label: string }[]): Manifest {
  return {
    verified: true, discoveredAt: null, siteUrl: "https://x.test/", notes: "",
    controls: {
      animation: { selector: "#a", kind: "select", values: animations },
      speed: {
        selector: "#s", kind: "select",
        values: [{ value: "normal", label: "Normal" }],
      },
    },
    browser: {
      readySelector: null, fileInputSelector: "#f", generateSelector: null,
      resultSelector: null, downloadSelector: null, dismissSelectors: [],
    },
    api: null,
  } as Manifest;
}

describe("previewSlug", () => {
  it("strips direction suffixes used by MakeEmoji labels", () => {
    expect(previewSlug("orbit-three:➡️")).toBe("orbit-three");
    expect(previewSlug("party-parrot")).toBe("party-parrot");
    expect(previewSlug("nyan:➡️")).toBe("nyan");
  });
});

describe("guessStylePreviewUrl", () => {
  afterEach(() => clearPreviewCache());

  it("points at the MakeEmoji default-cat CDN", () => {
    expect(guessStylePreviewUrl("pet")).toContain(
      "assets.makeemoji.com/prerendered/default-cat-preview/pet.gif",
    );
    expect(guessStylePreviewUrl("none")).toContain("none.webp");
  });

  it("honours a cached probe result", () => {
    setPreviewCacheForTesting("pepe", "https://example.test/pepe.webp");
    expect(guessStylePreviewUrl("pepe")).toBe("https://example.test/pepe.webp");
  });
});

describe("favorites store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "emoji-favs-"));
    setFavoritesPathForTesting(join(dir, "favorites.json"));
  });

  afterEach(() => {
    resetFavoritesForTesting();
    rmSync(dir, { recursive: true, force: true });
  });

  it("toggles per user and remembers order", () => {
    expect(toggleFavorite("u1", "gen_btn_pet")).toBe(true);
    expect(toggleFavorite("u1", "gen_btn_spin")).toBe(true);
    expect(listFavorites("u1")).toEqual(["gen_btn_spin", "gen_btn_pet"]);
    expect(isFavorite("u1", "gen_btn_pet")).toBe(true);
    expect(isFavorite("u2", "gen_btn_pet")).toBe(false);

    expect(toggleFavorite("u1", "gen_btn_pet")).toBe(false);
    expect(listFavorites("u1")).toEqual(["gen_btn_spin"]);
  });

  it("persists across reload", () => {
    toggleFavorite("u1", "gen_btn_bounce");
    // Force re-read from disk.
    setFavoritesPathForTesting(join(dir, "favorites.json"));
    expect(listFavorites("u1")).toEqual(["gen_btn_bounce"]);
  });
});

describe("style browser paging", () => {
  beforeEach(() => {
    const animations = Array.from({ length: 55 }, (_, i) => ({
      value: `gen_btn_style-${i}`,
      label: `style-${i}`,
    }));
    setManifestForTesting(testManifest(animations));
    resetFavoritesForTesting();
    setFavoritesPathForTesting(join(mkdtempSync(join(tmpdir(), "emoji-favs-")), "f.json"));
  });

  afterEach(() => {
    setManifestForTesting(null);
    resetFavoritesForTesting();
  });

  it("pages through the full catalog instead of truncating at 25", () => {
    expect(allStyles()).toHaveLength(55);
    const { token: _t, session } = createSession({
      image: Buffer.from([1]),
      ownerId: "u1",
      sourceLabel: "t",
      animation: "gen_btn_style-0",
      format: "gif",
    });

    const first = pageStyles(session, "u1");
    expect(first.total).toBe(55);
    expect(first.pages).toBe(Math.ceil(55 / STYLES_PAGE_SIZE));
    expect(first.rows).toHaveLength(STYLES_PAGE_SIZE);

    const lastPage = Math.ceil(55 / STYLES_PAGE_SIZE) - 1;
    session.stylePage = lastPage;
    const last = pageStyles(session, "u1");
    expect(last.page).toBe(lastPage);
    expect(last.rows.length).toBe(55 - STYLES_PAGE_SIZE * lastPage);
  });

  it("exposes the filtered catalog and total page count for jumps", () => {
    const { session } = createSession({
      image: Buffer.from([1]), ownerId: "u1", sourceLabel: "t",
      animation: "gen_btn_style-0", format: "gif",
    });
    expect(filteredStyles(session, "u1")).toHaveLength(55);
    expect(totalStylePages(session, "u1")).toBe(Math.ceil(55 / STYLES_PAGE_SIZE));

    // pageStyles clamps an out-of-range jump target to the last real page.
    session.stylePage = 999;
    const clamped = pageStyles(session, "u1");
    expect(clamped.page).toBe(totalStylePages(session, "u1") - 1);
  });

  it("search modal offers both a name query and a page-jump field", () => {
    const modal = buildStyleSearchModal("tok", "", 7, 2) as unknown as {
      components: { components: { data: { custom_id?: string } }[] }[];
    };
    const ids = modal.components.flatMap(r => r.components.map(c => c.data.custom_id));
    expect(ids).toContain("query");
    expect(ids).toContain("page");
  });

  it("filters by search and favorites", () => {
    const { session } = createSession({
      image: Buffer.from([1]),
      ownerId: "u1",
      sourceLabel: "t",
      animation: "gen_btn_style-0",
      format: "gif",
    });

    session.styleQuery = "style-1";
    const searched = pageStyles(session, "u1");
    expect(searched.total).toBeGreaterThan(0);
    // Exact / substring hits come first — style-1 itself must lead.
    expect(searched.rows[0]?.label).toBe("style-1");

    toggleFavorite("u1", "gen_btn_style-7");
    toggleFavorite("u1", "gen_btn_style-3");
    session.styleQuery = "";
    session.styleFilter = "favorites";
    const favs = pageStyles(session, "u1");
    expect(favs.rows.map(r => r.value)).toEqual(["gen_btn_style-3", "gen_btn_style-7"]);
  });

  it("keeps focus on the applied style when opening the browser", () => {
    // Opening the browser focuses the applied animation (see the `styles`
    // handler: stylePage 0, styleFocus = animation). Assert that focus is
    // honoured, independent of the browser's alphabetical style ordering.
    const { session } = createSession({
      image: Buffer.from([1]),
      ownerId: "u1",
      sourceLabel: "t",
      animation: "gen_btn_style-22",
      format: "gif",
      styleFocus: "gen_btn_style-22",
      stylePage: 0,
    });
    expect(ensureStyleFocus(session, "u1")).toBe("gen_btn_style-22");
  });

  it("falls back to the applied style when it is on the current page", () => {
    // With no explicit focus, the applied animation is used when it is visible
    // on the page. style-0 sorts first, so page 0 always contains it.
    const { session } = createSession({
      image: Buffer.from([1]),
      ownerId: "u1",
      sourceLabel: "t",
      animation: "gen_btn_style-0",
      format: "gif",
      styleFocus: null,
      stylePage: 0,
    });
    expect(ensureStyleFocus(session, "u1")).toBe("gen_btn_style-0");
  });
});

describe("control panel styles entry", () => {
  beforeEach(() => {
    setManifestForTesting(testManifest([
      { value: "gen_btn_pet", label: "pet" },
      { value: "gen_btn_spin", label: "spin" },
    ]));
  });

  afterEach(() => setManifestForTesting(null));

  it("exposes Browse styles and Upload image on the control panel", () => {
    const { session, token } = createSession({
      image: Buffer.from([1]),
      ownerId: "u1",
      sourceLabel: "t",
      animation: "gen_btn_pet",
      format: "gif",
    });
    const rows = buildControls(session, token);
    const flat = rows.flatMap(r => r.components.map(c => (c as { data: { custom_id?: string; label?: string } }).data));
    const stylesBtn = flat.find(c => c.custom_id === cid("styles", token));
    expect(stylesBtn?.label).toMatch(/Browse styles — pet/);
    expect(flat.some(c => c.custom_id === cid("upload", token))).toBe(true);
    expect(flat.some(c => c.custom_id === cid("set_animation", token))).toBe(false);
  });

  it("builds an upload modal with Discord file upload", () => {
    const modal = buildUploadModal("tok123");
    const json = modal.toJSON() as {
      custom_id: string;
      components: { component?: { custom_id?: string; type?: number } }[];
    };
    expect(json.custom_id).toBe(cid("upload_modal", "tok123"));
    expect(json.components[0]?.component?.custom_id).toBe("image");
    expect(json.components[0]?.component?.type).toBe(19); // FileUpload
  });

  it("still parses namespaced customIds", () => {
    expect(parseCid(cid("styles_pick", "abc"))).toEqual({ action: "styles_pick", token: "abc" });
  });
});
