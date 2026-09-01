#!/usr/bin/env node
/**
 * Use MakeEmoji's own "Download All as ZIP" after uploading a green subject
 * and scrolling the full style grid so every card has loaded.
 *
 *   pnpm --filter @workspace/api-server exec node ./scripts/makeemoji-download-all-zip.mjs
 */
import { chromium } from "playwright";
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const OUT_DIR = join(REPO, "artifacts/emoji-offline/greenscreen");
const ZIP_PATH = join(OUT_DIR, "makeemoji-all-green.zip");
const GREEN = process.env.GREEN_PNG || "/tmp/me687/green_512.png";
const SITE = "https://makeemoji.com/";
const DOWNLOAD_DIR = "/tmp/me687/zip-dl";

async function dismiss(page) {
  for (const sel of [
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("I understand")',
    '[aria-label="Close"]',
  ]) {
    try { await page.locator(sel).first().click({ timeout: 800 }); } catch { /* */ }
  }
}

async function scrollWholePage(page) {
  console.log("scrolling full page to load all styles…");
  let last = 0;
  let stable = 0;
  let maxSeen = 0;

  for (let i = 0; i < 350; i++) {
    const stats = await page.evaluate(() => {
      window.scrollBy(0, 700);
      for (const el of document.querySelectorAll("*")) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 80) {
          el.scrollTop = Math.min(el.scrollTop + 700, el.scrollHeight);
        }
      }
      const tags = document.querySelectorAll("[data-tag^=\"gen_btn_\"]").length;
      const imgs = document.querySelectorAll("img").length;
      const text = document.body?.innerText || "";
      const m = text.match(/(\d+)\s*styles/i);
      return {
        tags,
        imgs,
        label: m ? m[1] : null,
        scrollY: window.scrollY,
        height: document.body?.scrollHeight || 0,
      };
    });
    maxSeen = Math.max(maxSeen, stats.tags);
    if (i % 25 === 0) {
      console.log(`  scroll ${i}: tags=${stats.tags} maxTags=${maxSeen} imgs=${stats.imgs} label=${stats.label} y=${stats.scrollY}/${stats.height}`);
    }
    // Wait for network-ish settle on thumbs
    await page.waitForTimeout(220);
    if (stats.scrollY + 900 >= stats.height - 40) {
      // at bottom — linger so lazy thumbs finish
      await page.waitForTimeout(800);
      if (stats.tags === last) {
        stable++;
        if (stable >= 8) break;
      } else {
        stable = 0;
        last = stats.tags;
      }
    } else {
      stable = 0;
      last = stats.tags;
    }
  }

  // One more bottom linger
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);
  console.log("scroll complete, max visible tags during pass:", maxSeen);
}

async function main() {
  if (!existsSync(GREEN)) throw new Error(`Green PNG missing: ${GREEN}`);
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // Track prerendered loads as a proxy for "all loaded"
  const loadedStyles = new Set();
  page.on("response", (res) => {
    const url = res.url();
    const m = url.match(/\/prerendered\/default-cat(?:-preview)?\/([^/?#]+)\./i);
    if (m && m[1] !== "default-cat") loadedStyles.add(m[1]);
  });

  console.log("open", SITE);
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(2500);
  await dismiss(page);

  console.log("upload green screen", GREEN);
  await page.locator('input[type="file"]').first().setInputFiles(GREEN);
  await page.waitForTimeout(3500);

  // Confirm upload stuck (preview appears)
  const uploaded = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")].map(i => i.src || "");
    return imgs.some(s => s.startsWith("blob:") || /object|preview|upload/i.test(s));
  });
  console.log("upload likely ok:", uploaded, "loadedStyles so far", loadedStyles.size);

  await scrollWholePage(page);
  console.log("unique prerendered styles observed:", loadedStyles.size);

  // Scroll back near Download All controls (often near bottom of grid / footer of style section)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Find Download All as ZIP button
  const candidates = [
    'button:has-text("Download All as ZIP")',
    'button:has-text("Download All")',
    'a:has-text("Download All as ZIP")',
    'text=Download All as ZIP',
    'text=/Download All.*ZIP/i',
  ];

  let downloadBtn = null;
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      downloadBtn = loc;
      console.log("found button via", sel);
      break;
    }
  }

  if (!downloadBtn) {
    // Dump helpful text snippets for debugging
    const snippet = await page.evaluate(() => {
      const t = document.body.innerText || "";
      const idx = t.toLowerCase().indexOf("download");
      return idx >= 0 ? t.slice(Math.max(0, idx - 80), idx + 200) : t.slice(-500);
    });
    console.log("Download button not found. Context:\n", snippet);
    // Screenshot
    await page.screenshot({ path: "/opt/cursor/artifacts/zip_button_missing.png", fullPage: false });
    throw new Error("Could not find Download All as ZIP");
  }

  await downloadBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  console.log("clicking Download All as ZIP (may take a while)…");
  const downloadPromise = page.waitForEvent("download", { timeout: 600_000 });
  await downloadBtn.click({ timeout: 10_000 });
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  console.log("download started:", suggested);

  const tmp = join(DOWNLOAD_DIR, suggested || "all.zip");
  await download.saveAs(tmp);
  copyFileSync(tmp, ZIP_PATH);
  const bytes = readFileSync(ZIP_PATH).length;
  console.log(`saved ${ZIP_PATH} (${bytes} bytes)`);

  writeFileSync(join(OUT_DIR, "zip-download-meta.json"), JSON.stringify({
    at: new Date().toISOString(),
    zip: "greenscreen/makeemoji-all-green.zip",
    bytes,
    suggestedFilename: suggested,
    prerenderedObserved: loadedStyles.size,
    green: GREEN,
  }, null, 2));

  await browser.close();
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
