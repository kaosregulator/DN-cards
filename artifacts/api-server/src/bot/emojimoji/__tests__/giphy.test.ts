import { describe, expect, it } from "vitest";
import { buildSearchUrl, clampLimit, parseGiphySearch } from "../giphy.js";

describe("giphy client (pure)", () => {
  it("clamps limits into 1..10", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(50)).toBe(10);
    expect(clampLimit(NaN)).toBe(5);
  });

  it("builds a search URL with the key, query, limit and rating", () => {
    const url = new URL(buildSearchUrl("KEY123", "cat vibes", { limit: 8 }));
    expect(url.origin + url.pathname).toBe("https://api.giphy.com/v1/gifs/search");
    expect(url.searchParams.get("api_key")).toBe("KEY123");
    expect(url.searchParams.get("q")).toBe("cat vibes");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.get("rating")).toBe("pg-13");
  });

  it("scopes green-screen searches to keyable content", () => {
    const url = new URL(buildSearchUrl("K", "confetti", { greenScreen: true }));
    expect(url.searchParams.get("q")).toBe("confetti green screen");
  });

  it("parses a search body into gif descriptors, skipping entries without an original", () => {
    const body = {
      data: [
        {
          id: "abc", title: "Party ",
          url: "https://giphy.com/gifs/abc",
          images: {
            original: { url: "https://media.giphy.com/abc/orig.gif", width: "480", height: "270" },
            fixed_width: { url: "https://media.giphy.com/abc/fw.gif" },
          },
        },
        { id: "no-original", title: "broken", images: { fixed_width: { url: "x" } } },
        { title: "no-id", images: { original: { url: "y" } } },
      ],
    };
    const gifs = parseGiphySearch(body);
    expect(gifs).toHaveLength(1);
    expect(gifs[0]).toMatchObject({
      id: "abc",
      title: "Party",
      previewUrl: "https://media.giphy.com/abc/fw.gif",
      originalUrl: "https://media.giphy.com/abc/orig.gif",
      sourceUrl: "https://giphy.com/gifs/abc",
      width: 480,
      height: 270,
    });
  });

  it("returns [] for a malformed body", () => {
    expect(parseGiphySearch(null)).toEqual([]);
    expect(parseGiphySearch({})).toEqual([]);
    expect(parseGiphySearch({ data: "nope" })).toEqual([]);
  });
});
