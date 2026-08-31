import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateEmoji } from "../generate.js";
import { clearCache } from "../cache/index.js";
import { providerReport, resolveProvider } from "../providers/index.js";
import { browserProblem, resolveChromiumPath } from "../providers/makeemoji/runtime.js";
import { failureKind } from "../utils/errors.js";
import { reloadManifest, setManifestForTesting } from "../providers/makeemoji/manifest.js";
import { testImage } from "./fixtures.js";

/** Run `fn` with env vars temporarily replaced. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("/emoji end-to-end: the production failure path", () => {
  beforeEach(() => { clearCache(); reloadManifest(); });
  afterEach(() => {
    clearCache();
    delete process.env["EMOJI_DISABLE_OFFLINE"];
    setManifestForTesting(null);
  });

  it("no longer fails when the browser is missing — the offline engine serves", async () => {
    // The production bug was: deployments build in a fresh container with no
    // Chromium, so provider selection failed before any launch. Now the offline
    // engine is the default and needs no browser, so a missing one is a
    // non-event: /emoji still works.
    const empty = mkdtempSync(`${tmpdir()}/no-browser-`);
    await withEnv(
      { PLAYWRIGHT_BROWSERS_PATH: empty, HOME: empty, MAKEEMOJI_CHROMIUM_PATH: undefined },
      async () => {
        expect(await resolveChromiumPath()).toBeNull();
        // MakeEmoji still reports honestly that it has no browser…
        const report = await providerReport();
        expect(report.find(p => p.id === "makeemoji")?.status.available).toBe(false);
        // …but resolution succeeds anyway, on the offline engine.
        expect((await resolveProvider()).id).toBe("offline");
      },
    );
  }, 60_000);

  it("generates a real emoji with no browser present", async () => {
    // The user-facing outcome: an emoji comes back, with no error and no
    // "admin has been notified".
    const empty = mkdtempSync(`${tmpdir()}/no-browser-2-`);
    await withEnv(
      { PLAYWRIGHT_BROWSERS_PATH: empty, HOME: empty, MAKEEMOJI_CHROMIUM_PATH: undefined },
      async () => {
        const result = await generateEmoji({
          image: await testImage(96), animation: "gen_btn_shake", format: "gif", size: "64",
        });
        expect(result.bytes).toBeGreaterThan(0);
        expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
        expect(result.providerId).toBe("offline");

        // A repeat is served from cache rather than regenerated.
        const again = await generateEmoji({
          image: await testImage(96), animation: "gen_btn_shake", format: "gif", size: "64",
        });
        expect(again.cached).toBe(true);
      },
    );
  }, 120_000);

  it("reports a healthy browser when one is installed here", async () => {
    // Guards the resolution logic itself: this host has Chromium, so the
    // provider must not claim otherwise.
    expect(await browserProblem()).toBeNull();
  }, 30_000);
});
