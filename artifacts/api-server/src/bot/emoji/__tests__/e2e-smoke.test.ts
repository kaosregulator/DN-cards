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
    delete process.env["EMOJI_ALLOW_OFFLINE_FALLBACK"];
    setManifestForTesting(null);
  });

  it("reproduces the deployed failure: browser missing means no provider", async () => {
    // The exact production bug. `playwright install` had run in the Replit
    // workspace, but deployments build in a fresh container, so the deployed bot
    // had the package and no browser. Provider selection failed before any
    // launch, and the user saw a generic "not available".
    const empty = mkdtempSync(`${tmpdir()}/no-browser-`);
    await withEnv(
      { PLAYWRIGHT_BROWSERS_PATH: empty, HOME: empty, MAKEEMOJI_CHROMIUM_PATH: undefined },
      async () => {
        expect(await resolveChromiumPath()).toBeNull();

        const report = await providerReport();
        const makeemoji = report.find(p => p.id === "makeemoji");
        expect(makeemoji?.status.available).toBe(false);
        // The reason has to name the fix — this is what an operator reads.
        expect(
          makeemoji?.status.available === false ? makeemoji.status.reason : "",
        ).toMatch(/emoji:install-browser/);

        await expect(resolveProvider()).rejects.toMatchObject({
          code: "provider_unavailable",
        });
      },
    );
  }, 60_000);

  it("classifies a missing browser as setup, not something to retry", async () => {
    // Telling a user to try again when the server has no browser wastes their
    // time; the old message did exactly that.
    const empty = mkdtempSync(`${tmpdir()}/no-browser-2-`);
    await withEnv(
      { PLAYWRIGHT_BROWSERS_PATH: empty, HOME: empty, MAKEEMOJI_CHROMIUM_PATH: undefined },
      async () => {
        const err = await generateEmoji({
          image: await testImage(64), animation: "gen_btn_shake", format: "gif",
        }).catch((e: unknown) => e);

        expect(failureKind(err)).toBe("setup");
        // And it must not claim someone was notified, because nothing notifies.
        expect((err as Error).message).not.toMatch(/admin has been notified/i);
        expect((err as Error).message).toMatch(/emoji:install-browser|redeploy/i);
      },
    );
  }, 60_000);

  it("still produces an emoji when the browser is missing but a fallback is on", async () => {
    // The operator's escape hatch from the exact production outage: MakeEmoji
    // cannot run, but /emoji keeps working instead of erroring. Removing the
    // browser is also what makes this assertable without network access.
    const empty = mkdtempSync(`${tmpdir()}/no-browser-3-`);
    process.env["EMOJI_ALLOW_OFFLINE_FALLBACK"] = "1";

    await withEnv(
      { PLAYWRIGHT_BROWSERS_PATH: empty, HOME: empty, MAKEEMOJI_CHROMIUM_PATH: undefined },
      async () => {
        expect((await resolveProvider()).id).toBe("offline");

        const result = await generateEmoji({
          image: await testImage(96), animation: "gen_btn_shake", format: "gif", size: "64",
        });

        expect(result.bytes).toBeGreaterThan(0);
        expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
        expect(result.cached).toBe(false);
        // Labelled, so a user can tell this did not come from MakeEmoji.
        expect(result.providerId).toBe("offline");

        // An identical request is served from cache rather than regenerated.
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
