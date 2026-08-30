// ─────────────────────────────────────────────────────────────────────────────
// Browser path.
//
// Drives MakeEmoji's own editor in headless Chromium: upload the image, set the
// controls, trigger generation, take the finished file. Slower than a direct
// request, but it is the path that works when generation happens inside the page
// — which, for an emoji editor, is the likely case.
//
// Every selector and option value comes from the discovery manifest. Nothing
// here knows what MakeEmoji's DOM looks like, so a redesign of the site is fixed
// by re-running discovery rather than by editing this file.
//
// Reliability rules this file follows, because it runs on a Discord bot:
//   • one browser per generation, always closed in `finally` — a leaked Chromium
//     is ~100 MB that never comes back
//   • every wait is bounded; nothing blocks forever on a selector that changed
//   • a missing selector is `site_changed`, not a crash, so the user gets a
//     clean message and an operator gets a log line naming the selector
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Download, Page } from "playwright";
import { logger } from "../../../../lib/logger.js";
import { EmojiError } from "../../utils/errors.js";
import type { GenerateOptions, GenerateResult } from "../../types.js";
import { launchBrowser, newContext } from "./runtime.js";
import { resolveValue } from "./manifest.js";
import type { ControlSpec, Manifest, OptionKey } from "./types.js";
import { recordNetwork } from "./discovery/recorder.js";
import { writeDebugTrace } from "./debug.js";
import type { BrowserWindow, DomElement, DomMedia } from "./discovery/dom-types.js";

/** Budget for one whole generation, browser launch included. */
const GENERATE_TIMEOUT_MS = 60_000;
/** Budget for any single page interaction. */
const STEP_TIMEOUT_MS = 15_000;
/** How long to wait for the editor to produce a result after the trigger. */
const RESULT_TIMEOUT_MS = 25_000;

/** Why the browser path can't run against this manifest, or null when it can. */
export function browserPathProblem(manifest: Manifest | null): string | null {
  if (!manifest) return "no manifest loaded";
  if (!manifest.browser.fileInputSelector) {
    return "manifest has no file-input selector — re-run discovery";
  }
  return null;
}

/** Apply one option to its control, using whatever kind of control it is. */
async function applyControl(
  page: Page, key: OptionKey, spec: ControlSpec, value: string,
): Promise<void> {
  switch (spec.kind) {
    case "select":
      await page.selectOption(spec.selector, value, { timeout: STEP_TIMEOUT_MS });
      return;
    case "radio":
      await page.click(`${spec.selector}[value="${value}"]`, { timeout: STEP_TIMEOUT_MS });
      return;
    case "button": {
      const attribute = spec.valueAttribute ?? "data-value";
      await page.click(`[${attribute}="${value}"]`, { timeout: STEP_TIMEOUT_MS });
      return;
    }
    case "range":
    case "text":
      await page.fill(spec.selector, value, { timeout: STEP_TIMEOUT_MS });
      return;
    case "checkbox":
      await page.setChecked(spec.selector, value !== "false" && value !== "0", {
        timeout: STEP_TIMEOUT_MS,
      });
      return;
    default:
      logger.warn({ key, kind: spec.kind }, "unhandled MakeEmoji control kind");
  }
}

/** Set every option the manifest knows how to drive. */
async function applyOptions(
  page: Page, manifest: Manifest, options: GenerateOptions,
): Promise<string[]> {
  const applied: string[] = [];

  const wanted: [OptionKey, string | undefined][] = [
    // Platform first: on most editors it is a preset that rewrites size and
    // format, so applying it later would silently undo explicit choices.
    ["platform", options.platform],
    ["animation", options.animation],
    ["speed", options.speed],
    ["direction", options.direction],
    ["size", options.size === undefined ? undefined : String(options.size)],
    ["color", options.color],
    ["format", options.format],
    ["quality", options.quality],
  ];

  for (const [key, raw] of wanted) {
    if (raw === undefined) continue;
    const spec = manifest.controls[key];
    if (!spec) continue;

    // Free-text controls (a colour hex, a numeric size) accept a value that was
    // never in an enumerated list, so fall back to the raw value for those.
    const resolved = resolveValue(manifest, key, raw)
      ?? (spec.kind === "text" || spec.kind === "range" ? raw : null);
    if (resolved === null) continue;

    try {
      await applyControl(page, key, spec, resolved);
      applied.push(`${key}=${resolved}`);
    } catch {
      // One control that has moved shouldn't sink the whole generation — the
      // rest of the settings still apply and the site's default covers this one.
      logger.warn({ key, selector: spec.selector }, "MakeEmoji control could not be set");
    }
  }

  return applied;
}

/** Read the current preview's bytes from inside the page. */
async function readPreviewBytes(page: Page, src: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (url: string) => {
    const w = globalThis as unknown as BrowserWindow;
    const response = await w.fetch(url);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new w.FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("preview blob unreadable"));
      reader.readAsDataURL(blob);
    });
  }, src);
  return Buffer.from(base64, "base64");
}

/** The newest generated-looking media source in the page, if any. */
async function findPreviewSrc(page: Page, resultSelector: string | null): Promise<string | null> {
  return page.evaluate((selector: string | null) => {
    const w = globalThis as unknown as BrowserWindow;
    const nodes = Array.from(
      w.document.querySelectorAll(selector ?? "img, video, source") as ArrayLike<DomElement>,
    );
    const sources = nodes
      .map(el => (el as DomMedia).src || el.getAttribute("src") || "")
      .filter(src =>
        src.startsWith("blob:") || src.startsWith("data:") ||
        /\.(gif|webp|png)(\?|$)/i.test(src));
    // The result is appended after the source thumbnail, so the newest wins.
    return sources[sources.length - 1] ?? null;
  }, resultSelector);
}

export async function generateViaBrowser(
  manifest: Manifest, options: GenerateOptions,
): Promise<GenerateResult> {
  const problem = browserPathProblem(manifest);
  if (problem) {
    logger.error({ problem }, "MakeEmoji browser path is not configured");
    throw new EmojiError("provider_unavailable", "The emoji generator isn't set up yet.");
  }

  const started = Date.now();
  const deadline = started + GENERATE_TIMEOUT_MS;
  const remaining = () => Math.max(1000, deadline - Date.now());

  const tempDir = mkdtempSync(join(tmpdir(), "makeemoji-"));
  const browser = await launchBrowser();
  let context: BrowserContext | undefined;

  try {
    context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);

    // Only recorded when explicitly asked for: the trace is large, and even
    // redacted it describes exactly what the bot sent.
    const recorder = options.debug ? recordNetwork(page) : null;

    await page.goto(manifest.siteUrl, { waitUntil: "domcontentloaded", timeout: remaining() });

    // Cookie banners and interstitials intercept the very clicks we need.
    for (const selector of manifest.browser.dismissSelectors) {
      await page.click(selector, { timeout: 3000 }).catch(() => {});
    }

    if (manifest.browser.readySelector) {
      await page.waitForSelector(manifest.browser.readySelector, { timeout: remaining() })
        .catch(() => { throw new EmojiError("site_changed", "The emoji service looks different than expected."); });
    }

    const fileInput = manifest.browser.fileInputSelector!;
    await page.setInputFiles(fileInput, {
      name: "source.png", mimeType: "image/png", buffer: options.image,
    }).catch(() => {
      logger.error({ fileInput }, "MakeEmoji file input not found — manifest is stale");
      throw new EmojiError("site_changed", "The emoji service looks different than expected.");
    });

    const applied = await applyOptions(page, manifest, options);
    logger.debug({ applied }, "MakeEmoji options applied");

    // Some editors render live on change and have no trigger at all; a missing
    // generate selector is therefore normal, not an error.
    if (manifest.browser.generateSelector) {
      await page.click(manifest.browser.generateSelector, { timeout: remaining() }).catch(() => {
        logger.warn({ selector: manifest.browser.generateSelector }, "MakeEmoji generate control not clickable");
      });
    }

    // ── retrieve the finished file ─────────────────────────────────────────
    let buffer: Buffer | null = null;
    let sourceUrl: string | undefined;

    if (manifest.browser.downloadSelector) {
      // A real download gives the exact bytes the site intends to hand over.
      const downloadPromise: Promise<Download> = page.waitForEvent("download", {
        timeout: Math.min(RESULT_TIMEOUT_MS, remaining()),
      });
      await page.click(manifest.browser.downloadSelector, { timeout: remaining() }).catch(() => {});
      const download = await downloadPromise.catch(() => null);
      if (download) {
        const path = join(tempDir, "result.bin");
        await download.saveAs(path);
        const { readFileSync } = await import("node:fs");
        buffer = readFileSync(path);
        sourceUrl = safeOrigin(download.url());
      }
    }

    if (!buffer) {
      // Fall back to the preview. Poll rather than wait once: generation
      // finishes asynchronously and the element may already exist but still be
      // showing the previous frame.
      const until = Math.min(Date.now() + RESULT_TIMEOUT_MS, deadline);
      while (Date.now() < until) {
        const src = await findPreviewSrc(page, manifest.browser.resultSelector);
        if (src) {
          buffer = await readPreviewBytes(page, src).catch(() => null);
          if (buffer?.length) {
            sourceUrl = src.startsWith("data:") || src.startsWith("blob:") ? undefined : src;
            break;
          }
        }
        await page.waitForTimeout(750);
      }
    }

    if (recorder) {
      recorder.stop();
      writeDebugTrace("generate", recorder.exchanges, recorder.websockets);
    }

    if (!buffer?.length) {
      logger.warn({ site: manifest.siteUrl }, "MakeEmoji produced no result");
      throw new EmojiError("generation_failed", "The emoji service didn't produce a file. Please try again.");
    }

    return {
      buffer,
      format: options.format,
      bytes: buffer.length,
      providerId: "makeemoji-browser",
      durationMs: Date.now() - started,
      ...(sourceUrl ? { sourceUrl } : {}),
      cached: false,
    };
  } catch (err) {
    if (err instanceof EmojiError) throw err;
    const message = (err as Error).message ?? "";
    if (/Timeout|timeout/.test(message)) {
      throw new EmojiError("timeout", "The emoji service took too long. Please try again.");
    }
    logger.error({ err: message.split("\n")[0] }, "MakeEmoji browser generation failed");
    throw new EmojiError("browser_failed", "The emoji generator hit a problem. Please try again.");
  } finally {
    // Closed in every path: a leaked context or browser is a permanent memory
    // cost on a long-running bot, and the temp dir holds the downloaded file.
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Origin + path only — download URLs routinely carry signed query parameters.
 *
 * A `blob:` URL parses oddly (its "pathname" is the whole inner URL) and names
 * nothing outside the page, so it is reported as absent rather than as a
 * mangled address.
 */
function safeOrigin(raw: string): string | undefined {
  if (raw.startsWith("blob:") || raw.startsWith("data:")) return undefined;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}
