import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discover } from "../providers/makeemoji/discovery/discover.js";
import { generateViaBrowser } from "../providers/makeemoji/browser.js";
import { apiProblem } from "../providers/makeemoji/api.js";
import { makeEmojiProvider } from "../providers/makeemoji/client.js";
import { localProvider } from "../providers/local/provider.js";
import { resolveProvider, providerReport } from "../providers/index.js";
import {
  manifestProblem, reloadManifest, resolveValue, setManifestForTesting, valuesFor,
} from "../providers/makeemoji/manifest.js";
import type { Manifest } from "../providers/makeemoji/types.js";
import { EmojiError } from "../utils/errors.js";
import { clearCache } from "../cache/index.js";
import { startFixtureSite, type FixtureSite } from "./fixtures/server.js";
import { testImage } from "./fixtures.js";

const EMPTY_BROWSER = {
  readySelector: null, fileInputSelector: null, generateSelector: null,
  resultSelector: null, downloadSelector: null, dismissSelectors: [],
};

function manifestOf(patch: Partial<Manifest>): Manifest {
  return {
    verified: false, discoveredAt: null, siteUrl: "https://x.test/", notes: "",
    controls: {}, browser: EMPTY_BROWSER, api: null, ...patch,
  } as Manifest;
}

describe("manifest gating", () => {
  beforeEach(() => clearCache());

  it("refuses an unverified manifest rather than guessing", async () => {
    setManifestForTesting(null, "no manifest loaded");
    expect((await makeEmojiProvider.status()).available).toBe(false);

    await expect(makeEmojiProvider.generate({
      image: Buffer.from([1]), animation: "shake", format: "gif",
    })).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("names what is missing", () => {
    expect(manifestProblem(null)).toMatch(/no manifest/i);
    expect(manifestProblem(manifestOf({}))).toMatch(/unverified/i);
  });

  it("treats a verified-but-empty manifest as unusable", () => {
    // Verified alone is not enough: with no file input and no API there is
    // still nothing we could actually drive.
    expect(manifestProblem(manifestOf({ verified: true })))
      .toMatch(/neither a usable API endpoint nor a file-input/i);
  });

  it("ships a verified live MakeEmoji manifest discovered against makeemoji.com", () => {
    setManifestForTesting(null);
    const loaded = reloadManifest();
    expect(loaded.manifest?.verified).toBe(true);
    expect(loaded.manifest?.api).toBeNull();
    expect(loaded.manifest?.browser.fileInputSelector).toBeTruthy();
    expect(loaded.manifest?.controls.animation?.values.length).toBeGreaterThan(0);
  });
});

describe("api path gating", () => {
  it("is unavailable until an endpoint is confirmed from real traffic", () => {
    expect(apiProblem(null)).toMatch(/no generation endpoint/i);
  });

  it("declines an endpoint that needed a browser session", () => {
    // Fabricating the missing credential is not an option, so it falls back
    // to driving the real editor instead.
    const manifest = manifestOf({
      verified: true,
      browser: { ...EMPTY_BROWSER, fileInputSelector: "#f" },
      api: {
        url: "https://x.test/api/generate", method: "POST", kind: "multipart",
        fieldMap: {}, staticFields: {}, headers: {}, resultPath: null,
        requiresBrowserSession: true,
      },
    });
    expect(apiProblem(manifest)).toMatch(/browser-established session/i);
  });
});

describe("value resolution", () => {
  const manifest = manifestOf({
    verified: true,
    controls: {
      animation: {
        selector: "#a", kind: "select",
        values: [{ value: "shake", label: "Shake" }, { value: "spin", label: "Spin" }],
      },
    },
    browser: { ...EMPTY_BROWSER, fileInputSelector: "#f" },
  });

  it("matches on value or label, case-insensitively", () => {
    expect(resolveValue(manifest, "animation", "shake")).toBe("shake");
    expect(resolveValue(manifest, "animation", "SHAKE")).toBe("shake");
    expect(resolveValue(manifest, "animation", "Spin")).toBe("spin");
  });

  it("returns null for values the site does not offer", () => {
    expect(resolveValue(manifest, "animation", "moonwalk")).toBeNull();
  });

  it("lists the available values", () => {
    expect(valuesFor(manifest, "animation")).toEqual(["shake", "spin"]);
    expect(valuesFor(manifest, "speed")).toEqual([]);
  });
});

describe("local fallback provider", () => {
  beforeEach(() => { delete process.env["EMOJI_ALLOW_LOCAL_FALLBACK"]; });
  afterAll(() => { delete process.env["EMOJI_ALLOW_LOCAL_FALLBACK"]; });

  it("is disabled unless explicitly enabled", async () => {
    expect((await localProvider.status()).available).toBe(false);
    await expect(localProvider.generate({
      image: Buffer.from([1]), animation: "shake", format: "gif",
    })).rejects.toBeInstanceOf(EmojiError);
  });

  it("refuses WebP, which it cannot produce", async () => {
    process.env["EMOJI_ALLOW_LOCAL_FALLBACK"] = "1";
    await expect(localProvider.generate({
      image: await testImage(), animation: "shake", format: "webp",
    })).rejects.toMatchObject({ code: "unsupported_format" });
  });

  it("renders when enabled", async () => {
    process.env["EMOJI_ALLOW_LOCAL_FALLBACK"] = "1";
    const result = await localProvider.generate({
      image: await testImage(), animation: "shake", format: "gif", size: 128,
    });
    expect(result.providerId).toBe("local");
    expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
  }, 30_000);
});

describe("provider resolution", () => {
  beforeEach(() => {
    setManifestForTesting(null, "no manifest loaded");
    delete process.env["EMOJI_ALLOW_LOCAL_FALLBACK"];
  });
  afterAll(() => { delete process.env["EMOJI_ALLOW_LOCAL_FALLBACK"]; });

  it("fails cleanly when nothing is available", async () => {
    await expect(resolveProvider()).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("does not fall back to local rendering unless an operator allows it", async () => {
    // A silent substitution would hand the user different output while
    // implying it came from MakeEmoji.
    const report = await providerReport();
    expect(report.find(r => r.id === "local")?.status.available).toBe(false);
  });

  it("uses the local fallback only once explicitly enabled", async () => {
    process.env["EMOJI_ALLOW_LOCAL_FALLBACK"] = "1";
    expect((await resolveProvider()).id).toBe("local");
  });
});

describe("browser provider against a fixture editor", () => {
  let site: FixtureSite;
  let manifest: Manifest;

  beforeAll(async () => {
    site = await startFixtureSite();
    // Build the manifest exactly as production would: by running discovery.
    const outcome = await discover({
      siteUrl: site.url,
      outputDir: mkdtempSync(join(tmpdir(), "provider-")),
      testImage: await testImage(128),
      stepTimeoutMs: 15_000,
    });
    manifest = outcome.manifest;
  }, 180_000);

  afterAll(async () => { await site?.close(); });

  it("produced a verified manifest to drive", () => {
    expect(manifest.verified).toBe(true);
  });

  it("uploads, applies options and retrieves the generated bytes", async () => {
    const result = await generateViaBrowser(manifest, {
      image: await testImage(128),
      animation: "spin", speed: "fast", direction: "left", size: 64, format: "gif",
    });

    expect(result.providerId).toBe("makeemoji-browser");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
    expect(result.cached).toBe(false);
  }, 120_000);

  it("reports a stale manifest as site_changed rather than crashing", async () => {
    const stale: Manifest = {
      ...manifest,
      browser: { ...manifest.browser, fileInputSelector: "#definitely-not-here" },
    };
    await expect(generateViaBrowser(stale, {
      image: await testImage(128), animation: "spin", format: "gif",
    })).rejects.toMatchObject({ code: "site_changed" });
  }, 120_000);
});
