// ─────────────────────────────────────────────────────────────────────────────
// MakeEmoji discovery.
//
// Drives the real editor in a real browser and writes down what actually
// happened, so the provider can be built from evidence instead of assumptions.
//
// It answers, in order:
//   1. Is the site reachable at all from this host, by plain HTTP and by browser?
//   2. What controls does the editor have, and what values do they accept?
//   3. Do the bundles show a backend pipeline, or in-browser encoding?
//   4. When an image is uploaded and generation triggered, which request — if
//      any — produces the output?
//   5. Where does the finished file come from: a download, a blob, a URL?
//
// The run produces a manifest the provider reads, plus a human report. If a step
// fails, the run keeps going and records the failure: a partial manifest with an
// honest report beats no information at all.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Download, Page } from "playwright";
import { launchBrowser, newContext } from "../runtime.js";
import { OPTION_KEYS, type ControlSpec, type Manifest, type OptionKey } from "../types.js";
import { analyzeBundle, classifyProcessing, type BundleReport } from "./bundles.js";
import { inspectPage, mapControlToOption, type PageInventory } from "./inspect.js";
import { isBinaryContentType, recordNetwork, type RecordedExchange } from "./recorder.js";
import { buildReport, verdictFor } from "./report.js";
import type { BrowserWindow, DomElement, DomMedia } from "./dom-types.js";

export const DEFAULT_SITE_URL = "https://makeemoji.com/";
export const DEFAULT_OUTPUT_DIR = "makeemoji-investigation";

export interface DiscoverOptions {
  siteUrl?: string;
  outputDir?: string;
  /** PNG bytes uploaded to the editor. */
  testImage: Buffer;
  /** Per-step budget. The whole run is roughly 6× this. */
  stepTimeoutMs?: number;
  /** Called with progress messages so a CLI can narrate the run. */
  onProgress?: (message: string) => void;
}

export interface ReachabilityProbe {
  method: "node-fetch" | "browser";
  ok: boolean;
  status: number | null;
  detail: string;
}

export interface DiscoveryOutcome {
  siteUrl: string;
  startedAt: string;
  reachability: ReachabilityProbe[];
  inventory: PageInventory | null;
  inventoryAfterUpload: PageInventory | null;
  bundles: BundleReport[];
  processing: ReturnType<typeof classifyProcessing> | null;
  /** Where processing happens, combining bundle analysis with observed behaviour. */
  verdict: string;
  exchanges: RecordedExchange[];
  websockets: string[];
  /** Requests that plausibly produced the output. */
  candidates: RecordedExchange[];
  /** How the finished file was obtained, when it was. */
  result: {
    obtained: boolean;
    via: "download" | "preview-src" | "binary-response" | null;
    url: string | null;
    bytes: number;
    contentType: string | null;
  };
  manifest: Manifest;
  steps: { step: string; ok: boolean; detail: string }[];
}

const STEP_TIMEOUT_MS = 20_000;

/** Probe the site with a plain Node fetch — is this a network problem or a site problem? */
async function probeFetch(url: string): Promise<ReachabilityProbe> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return {
      method: "node-fetch",
      ok: res.ok,
      status: res.status,
      detail: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return {
      method: "node-fetch",
      ok: false,
      status: null,
      detail: `${(err as Error).message} — if this says CONNECT/403/EGRESS, this host cannot reach the site; run from one that can.`,
    };
  }
}

/**
 * Requests that could have produced the emoji.
 *
 * Deliberately generous: it is far better to over-report and let a human read
 * the shortlist than to filter out the one request that mattered.
 */
function shortlistCandidates(exchanges: RecordedExchange[]): RecordedExchange[] {
  const INTERESTING_PATH = /(api|upload|generate|render|process|convert|export|emoji|gif|webp|job|task|create|encode)/i;

  return exchanges.filter(x => {
    if (x.resourceType === "document" || x.resourceType === "stylesheet") return false;
    if (x.resourceType === "font") return false;

    // A body-carrying request is always worth a look — that is how an image gets
    // sent somewhere.
    if (x.method !== "GET" && x.postData) return true;
    if (x.method !== "GET" && x.method !== "HEAD") return true;
    // A binary response that isn't a page asset may be the generated file.
    if (x.binary && x.resourceType !== "image") return true;
    if (x.resourceType === "xhr" || x.resourceType === "fetch") return true;
    return INTERESTING_PATH.test(x.url);
  });
}

/** Map the discovered inventory onto our option keys. */
function buildControls(inventory: PageInventory): Partial<Record<OptionKey, ControlSpec>> {
  const controls: Partial<Record<OptionKey, ControlSpec>> = {};

  for (const control of inventory.controls) {
    const key = mapControlToOption(control.label);
    if (!key) continue;

    const spec: ControlSpec = {
      selector: control.selector,
      kind: control.kind,
      ...(control.valueAttribute ? { valueAttribute: control.valueAttribute } : {}),
      values: control.values,
    };

    // Several controls can map to the same key (a "size" slider and a "size"
    // select). Prefer whichever offers real choices — that is the one a caller
    // can actually drive from an option value.
    const existing = controls[key];
    if (!existing || existing.values.length < spec.values.length) controls[key] = spec;
  }

  return controls;
}

/** Best guess at which action button starts generation, and which downloads. */
function pickActionSelectors(inventory: PageInventory): {
  generate: string | null; download: string | null;
} {
  const find = (pattern: RegExp) =>
    inventory.actionButtons.find(b => pattern.test(b.text))?.selector ?? null;
  return {
    generate: find(/(generate|create|make|render|apply|convert)/i),
    download: find(/(download|save|export)/i),
  };
}

async function step<T>(
  outcome: DiscoveryOutcome, name: string, run: () => Promise<T>,
): Promise<T | null> {
  try {
    const value = await run();
    outcome.steps.push({ step: name, ok: true, detail: "ok" });
    return value;
  } catch (err) {
    outcome.steps.push({ step: name, ok: false, detail: (err as Error).message.split("\n")[0]! });
    return null;
  }
}

export async function discover(options: DiscoverOptions): Promise<DiscoveryOutcome> {
  const siteUrl = options.siteUrl ?? DEFAULT_SITE_URL;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const timeout = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  const say = options.onProgress ?? (() => {});

  const outcome: DiscoveryOutcome = {
    siteUrl,
    startedAt: new Date().toISOString(),
    reachability: [],
    inventory: null,
    inventoryAfterUpload: null,
    bundles: [],
    processing: null,
    verdict: "inconclusive",
    exchanges: [],
    websockets: [],
    candidates: [],
    result: { obtained: false, via: null, url: null, bytes: 0, contentType: null },
    manifest: {
      verified: false,
      discoveredAt: new Date().toISOString(),
      siteUrl,
      notes: "",
      controls: {},
      browser: {
        readySelector: null, fileInputSelector: null, generateSelector: null,
        resultSelector: null, downloadSelector: null, dismissSelectors: [],
      },
      api: null,
    },
    steps: [],
  };

  mkdirSync(join(outputDir, "responses"), { recursive: true });

  say("probing reachability with a plain HTTP request…");
  outcome.reachability.push(await probeFetch(siteUrl));

  let browser: Browser | null = null;
  let resultBuffer: Buffer | null = null;

  try {
    browser = await launchBrowser();
    const context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const recorder = recordNetwork(page);

    say(`opening ${siteUrl}…`);
    const navigated = await step(outcome, "navigate", async () => {
      const response = await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout });
      outcome.reachability.push({
        method: "browser",
        ok: Boolean(response?.ok()),
        status: response?.status() ?? null,
        detail: response ? `HTTP ${response.status()}` : "no response",
      });
      // Editors hydrate after load; give client-side rendering a moment before
      // inventorying, or the inventory records an empty shell.
      await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
      return true;
    });

    if (navigated) {
      say("inventorying page controls…");
      outcome.inventory = await step(outcome, "inspect", () => inspectPage(page));

      say("analysing JavaScript bundles…");
      await step(outcome, "bundles", async () => {
        const fetchText = async (url: string) => {
          const res = await context.request.get(url, { timeout });
          return { status: res.status(), body: await res.text() };
        };
        const scripts = (outcome.inventory?.scripts ?? []).slice(0, 25);
        for (const url of scripts) {
          outcome.bundles.push(await analyzeBundle(url, fetchText));
        }
        outcome.processing = classifyProcessing(outcome.bundles);
        return true;
      });

      say("uploading the test image…");
      const uploaded = await step(outcome, "upload", async () => {
        const selector = outcome.inventory?.fileInputs[0];
        if (!selector) throw new Error("no <input type=file> found on the page");
        await page.setInputFiles(selector, {
          name: "test.png", mimeType: "image/png", buffer: options.testImage,
        });
        await page.waitForTimeout(2500);
        return selector;
      });

      if (uploaded) {
        say("re-inventorying after upload…");
        outcome.inventoryAfterUpload = await step(outcome, "inspect-after-upload", () => inspectPage(page));
      }

      say("triggering generation…");
      await step(outcome, "generate", async () => {
        const source = outcome.inventoryAfterUpload ?? outcome.inventory;
        if (!source) throw new Error("no inventory to pick a generate control from");
        const { generate } = pickActionSelectors(source);
        if (!generate) throw new Error("no generate-looking control found (the editor may render live)");
        await page.click(generate, { timeout });
        await page.waitForTimeout(3000);
        return true;
      });

      say("retrieving the generated file…");
      await step(outcome, "retrieve", async () => {
        const source = outcome.inventoryAfterUpload ?? outcome.inventory;
        const { download } = source ? pickActionSelectors(source) : { download: null };

        // Preferred: a real download, which gives the exact bytes the site
        // intends the user to receive.
        if (download) {
          const downloadPromise: Promise<Download> = page.waitForEvent("download", { timeout });
          await page.click(download, { timeout }).catch(() => {});
          const dl = await downloadPromise;
          const stream = await dl.createReadStream();
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk as Buffer);
          resultBuffer = Buffer.concat(chunks);
          outcome.result = {
            obtained: true, via: "download", url: redactedDownloadUrl(dl),
            bytes: resultBuffer.length, contentType: null,
          };
          return true;
        }

        // Otherwise scrape whatever the preview is showing. The last matching
        // element wins: the generated result is appended after the source
        // thumbnail, so taking the newest avoids returning the input back.
        const previewSrc = await page.evaluate(() => {
          const w = globalThis as unknown as BrowserWindow;
          const found = Array.from(
            w.document.querySelectorAll("img, video, source") as ArrayLike<DomElement>,
          )
            .map(el => (el as DomMedia).src || el.getAttribute("src") || "")
            .filter(src =>
              src.startsWith("blob:") || src.startsWith("data:") ||
              /\.(gif|webp|png)(\?|$)/i.test(src));
          return found[found.length - 1] ?? null;
        });
        if (!previewSrc) throw new Error("no preview image/blob found after generating");

        resultBuffer = await readPreview(page, previewSrc);
        outcome.result = {
          obtained: true, via: "preview-src",
          url: previewSrc.startsWith("data:") ? "(data: uri)" : previewSrc,
          bytes: resultBuffer.length, contentType: null,
        };
        return true;
      });
    }

    recorder.stop();
    outcome.exchanges = recorder.exchanges;
    outcome.websockets = recorder.websockets;
    outcome.candidates = shortlistCandidates(recorder.exchanges);

    await context.close();
  } finally {
    // A leaked Chromium on a bot host is a slow resource leak, so the browser is
    // closed even when discovery fails partway.
    await browser?.close().catch(() => {});
  }

  // ── assemble the manifest ─────────────────────────────────────────────────
  const inventory = outcome.inventoryAfterUpload ?? outcome.inventory;
  if (inventory) {
    const actions = pickActionSelectors(inventory);
    outcome.manifest.controls = buildControls(inventory);
    outcome.manifest.browser = {
      readySelector: inventory.fileInputs[0] ?? null,
      fileInputSelector: inventory.fileInputs[0] ?? null,
      generateSelector: actions.generate,
      resultSelector: null,
      downloadSelector: actions.download,
      dismissSelectors: [],
    };
  }

  // The verdict that accounts for what the run actually observed, not just the
  // bundle signatures — so the CLI summary, the manifest notes and the report
  // all state the same conclusion.
  outcome.verdict = verdictFor(
    outcome,
    outcome.candidates.filter(x => x.method !== "GET" && x.postData !== null),
  ).verdict;

  // `verified` is the gate the provider checks, so it is set ONLY when the run
  // proved the two things a generation actually needs: somewhere to put the
  // image, and a vocabulary of animations to choose from.
  const hasFileInput = outcome.manifest.browser.fileInputSelector !== null;
  const hasAnimations = (outcome.manifest.controls.animation?.values.length ?? 0) > 0;
  outcome.manifest.verified = hasFileInput && hasAnimations;
  outcome.manifest.notes = [
    `Discovered ${outcome.startedAt}.`,
    `Processing verdict: ${outcome.verdict}.`,
    `Result obtained: ${outcome.result.obtained ? outcome.result.via : "no"}.`,
    hasFileInput ? "" : "NO FILE INPUT FOUND — browser provider cannot run.",
    hasAnimations ? "" : "NO ANIMATION VALUES FOUND — check the report's control inventory and fill controls.animation by hand.",
    "api stays null until a generation request is confirmed from the recorded traffic; see report.md.",
  ].filter(Boolean).join(" ");

  // ── write the artefacts ───────────────────────────────────────────────────
  writeFileSync(join(outputDir, "network.json"), JSON.stringify(
    { siteUrl, startedAt: outcome.startedAt, websockets: outcome.websockets, exchanges: outcome.exchanges },
    null, 2,
  ));
  writeFileSync(join(outputDir, "relevant-requests.json"), JSON.stringify(outcome.candidates, null, 2));
  writeFileSync(join(outputDir, "inventory.json"), JSON.stringify(
    { before: outcome.inventory, afterUpload: outcome.inventoryAfterUpload }, null, 2,
  ));
  writeFileSync(join(outputDir, "bundles.json"), JSON.stringify(outcome.bundles, null, 2));
  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(outcome.manifest, null, 2));
  if (resultBuffer) {
    writeFileSync(join(outputDir, "responses", `result${extensionFor(outcome.result.contentType)}`), resultBuffer);
  }
  writeFileSync(join(outputDir, "report.md"), buildReport(outcome));

  say(`wrote ${outputDir}/report.md`);
  return outcome;
}

/**
 * A safe, readable label for a download's source.
 *
 * A `blob:` URL parses oddly — its "pathname" is the whole inner URL — so
 * concatenating origin and pathname produced a doubled, nonsense string. Blob
 * and data URLs carry no useful origin anyway, so they are named as what they
 * are; ordinary URLs are trimmed to origin + path because download links
 * routinely carry signed query parameters.
 */
function redactedDownloadUrl(download: Download): string {
  return describeDownloadUrl(download.url());
}

function describeDownloadUrl(raw: string): string {
  if (raw.startsWith("blob:")) return "(in-page blob)";
  if (raw.startsWith("data:")) return "(data: uri)";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "(unknown)";
  }
}

function extensionFor(contentType: string | null): string {
  if (!contentType) return ".bin";
  if (/gif/i.test(contentType)) return ".gif";
  if (/webp/i.test(contentType)) return ".webp";
  if (/png/i.test(contentType)) return ".png";
  return ".bin";
}

/**
 * Read a preview's bytes, whether it is a blob:, data: or ordinary URL.
 *
 * The read happens INSIDE the page: a `blob:` URL is scoped to its document and
 * means nothing to Node, so fetching it here is the only way to get the bytes.
 */
async function readPreview(page: Page, src: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (url: string) => {
    const w = globalThis as unknown as BrowserWindow;
    const response = await w.fetch(url);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new w.FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("could not read the preview blob"));
      reader.readAsDataURL(blob);
    });
  }, src);
  return Buffer.from(base64, "base64");
}

export { OPTION_KEYS, isBinaryContentType };
