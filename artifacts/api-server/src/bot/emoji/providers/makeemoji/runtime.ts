// ─────────────────────────────────────────────────────────────────────────────
// Playwright runtime.
//
// Playwright is an OPTIONAL dependency: the bot must start and serve every other
// command on a host where it isn't installed, or where no Chromium binary
// exists. So it is never imported statically — this module loads it on demand
// and turns "not installed" into an ordinary unavailable-provider reason rather
// than a module-resolution crash at boot.
//
// Browser builds also drift: a Playwright upgrade expects a newer Chromium
// revision than the one already on the host, which is a confusing failure to
// debug from the raw error. `MAKEEMOJI_CHROMIUM_PATH` pins an existing binary.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, LaunchOptions } from "playwright";
import { logger } from "../../../../lib/logger.js";
import { EmojiError } from "../../utils/errors.js";

/** Point at a Chromium binary already on the host. */
const ENV_EXECUTABLE = "MAKEEMOJI_CHROMIUM_PATH";
/** Set to "0"/"false" to watch the automation in a headed browser while debugging. */
const ENV_HEADLESS = "MAKEEMOJI_HEADLESS";

type PlaywrightModule = typeof import("playwright");

let cached: PlaywrightModule | null | undefined;

/** Load Playwright, or null when it isn't installed. */
export async function loadPlaywright(): Promise<PlaywrightModule | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await import("playwright");
  } catch {
    cached = null;
  }
  return cached;
}

/** Why the browser stack can't run, or null when it can. */
export async function browserProblem(): Promise<string | null> {
  const pw = await loadPlaywright();
  if (!pw) {
    return "playwright is not installed — run `pnpm add playwright && npx playwright install chromium`";
  }
  return null;
}

export function launchOptions(): LaunchOptions {
  const executablePath = process.env[ENV_EXECUTABLE]?.trim();
  const headless = !/^(0|false|no)$/i.test(process.env[ENV_HEADLESS]?.trim() ?? "");

  return {
    headless,
    ...(executablePath ? { executablePath } : {}),
    args: [
      // Containers (Replit, Docker) usually lack the shared memory and user
      // namespaces Chromium's sandbox expects. Without these it fails to start
      // with an error that says nothing useful about the real cause.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
}

/**
 * Find an installed Chromium under PLAYWRIGHT_BROWSERS_PATH.
 *
 * Playwright pins an exact browser revision, so upgrading the package leaves it
 * looking for a build the host doesn't have — even though a perfectly usable
 * Chromium is sitting right beside it. Rather than fail with "Executable
 * doesn't exist at …/chromium-1234", find what IS installed and use that.
 */
function findInstalledChromium(): string | null {
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"]?.trim();
  if (!root || !existsSync(root)) return null;

  try {
    const candidates = readdirSync(root)
      .filter(name => name.startsWith("chromium"))
      // Highest build number first, so the newest install wins.
      .sort()
      .reverse();

    for (const dir of candidates) {
      for (const relative of [
        "chrome-linux/chrome",
        "chrome-linux/headless_shell",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-win/chrome.exe",
      ]) {
        const path = join(root, dir, relative);
        if (existsSync(path)) return path;
      }
    }
  } catch { /* an unreadable browsers dir is just "not found" */ }

  return null;
}

/** Launch a browser, converting startup failures into a user-safe error. */
export async function launchBrowser(): Promise<Browser> {
  const pw = await loadPlaywright();
  if (!pw) {
    throw new EmojiError(
      "provider_unavailable",
      "The emoji generator isn't set up on this host right now.",
    );
  }

  try {
    return await pw.chromium.launch(launchOptions());
  } catch (err) {
    const message = (err as Error).message ?? "";

    // Retry once against whatever Chromium is actually installed. Only for the
    // missing-executable case, and only when no explicit path was configured —
    // an operator's own MAKEEMOJI_CHROMIUM_PATH is never second-guessed.
    if (/Executable doesn't exist/i.test(message) && !process.env[ENV_EXECUTABLE]) {
      const executablePath = findInstalledChromium();
      if (executablePath) {
        logger.warn(
          { executablePath },
          "Playwright's pinned Chromium is missing; using the installed build instead",
        );
        try {
          return await pw.chromium.launch({ ...launchOptions(), executablePath });
        } catch (retryErr) {
          logger.error({ err: (retryErr as Error).message }, "chromium failed to launch");
        }
      }
    }

    logger.error({ err: message.split("\n")[0] }, "chromium failed to launch");
    throw new EmojiError(
      "browser_failed",
      "The emoji generator couldn't start. An admin has been notified.",
    );
  }
}

/**
 * Shim for esbuild's `keepNames` helper.
 *
 * `page.evaluate` works by stringifying our function and running the source in
 * the browser. Both tsx (dev/CLI) and esbuild (the bot bundle) rewrite nested
 * functions to call a `__name` helper they emit alongside — but only the
 * function body crosses into the page, not the helper, so every evaluate throws
 * `ReferenceError: __name is not defined` there.
 *
 * Defining a no-op `__name` in the page before any script runs makes the
 * rewritten code work unchanged. This is not a test-only concern: it is exactly
 * how the browser provider fails in production, and the failure never appears
 * under vitest because its transform does not rewrite names.
 */
const KEEP_NAMES_SHIM = `
  if (typeof globalThis.__name !== "function") {
    Object.defineProperty(globalThis, "__name", {
      value: (fn) => fn, writable: true, configurable: true,
    });
  }
`;

/**
 * A context that looks like an ordinary desktop browser.
 *
 * Not to evade anything — MakeEmoji's editor is a normal public page — but
 * because a default automation context has no viewport size or user-agent that
 * a responsive layout expects, and can render a mobile variant with entirely
 * different controls than the ones discovery recorded.
 */
export async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  // Runs before any page script, on every document in this context.
  await context.addInitScript(KEEP_NAMES_SHIM);
  return context;
}
