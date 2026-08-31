import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { browserProblem, resolveChromiumPath } from "../providers/makeemoji/runtime.js";

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

describe("browser detection", () => {
  it("finds the Chromium installed on this host", async () => {
    expect(await resolveChromiumPath()).not.toBeNull();
    expect(await browserProblem()).toBeNull();
  });

  it("prefers a full Chromium build over the headless shell", async () => {
    // The shell cannot run headed, which MAKEEMOJI_HEADLESS=0 needs.
    const path = await resolveChromiumPath();
    expect(path).not.toContain("headless_shell");
  });

  it("reports missing Chromium instead of claiming to be available", async () => {
    // This is the production failure: the package imports fine, so status()
    // used to say "available" while every generation died at launch.
    const empty = mkdtempSync(`${tmpdir()}/no-browsers-`);
    await withEnv(
      { PLAYWRIGHT_BROWSERS_PATH: empty, HOME: empty, MAKEEMOJI_CHROMIUM_PATH: undefined },
      async () => {
        expect(await resolveChromiumPath()).toBeNull();
        const problem = await browserProblem();
        expect(problem).not.toBeNull();
        // The message has to name the fix — an operator reads this in the logs
        // and on the admin endpoint.
        expect(problem).toMatch(/emoji:install-browser/);
      },
    );
  });

  it("finds a browser cached under the project, not the home directory", async () => {
    // Replit installs to `<workspace>/.cache/ms-playwright` while HOME points
    // elsewhere. A home-only search found nothing even though the browser was
    // sitting in the workspace, so /emoji reported itself unavailable.
    const workspace = mkdtempSync(`${tmpdir()}/workspace-`);
    const elsewhere = mkdtempSync(`${tmpdir()}/home-`);
    const dir = join(workspace, ".cache", "ms-playwright", "chromium-1234", "chrome-linux64");
    mkdirSync(dir, { recursive: true });
    const binary = join(dir, "chrome");
    writeFileSync(binary, "");

    const cwd = process.cwd();
    process.chdir(workspace);
    try {
      await withEnv(
        { PLAYWRIGHT_BROWSERS_PATH: undefined, HOME: elsewhere, MAKEEMOJI_CHROMIUM_PATH: undefined },
        async () => {
          expect(await resolveChromiumPath()).toBe(binary);
          expect(await browserProblem()).toBeNull();
        },
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it("prefers the newest build numerically, not lexicographically", async () => {
    // A lexicographic sort ranks chromium-999 above chromium-1194.
    const workspace = mkdtempSync(`${tmpdir()}/builds-`);
    const elsewhere = mkdtempSync(`${tmpdir()}/home2-`);
    for (const build of ["chromium-999", "chromium-1194"]) {
      const dir = join(workspace, ".cache", "ms-playwright", build, "chrome-linux64");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "chrome"), "");
    }

    const cwd = process.cwd();
    process.chdir(workspace);
    try {
      await withEnv(
        { PLAYWRIGHT_BROWSERS_PATH: undefined, HOME: elsewhere, MAKEEMOJI_CHROMIUM_PATH: undefined },
        async () => {
          expect(await resolveChromiumPath()).toContain("chromium-1194");
        },
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it("reports a configured path that does not exist", async () => {
    await withEnv({ MAKEEMOJI_CHROMIUM_PATH: "/nope/chrome" }, async () => {
      expect(await resolveChromiumPath()).toBeNull();
      expect(await browserProblem()).toMatch(/MAKEEMOJI_CHROMIUM_PATH/);
    });
  });
});
