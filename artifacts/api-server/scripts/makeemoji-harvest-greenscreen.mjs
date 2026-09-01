#!/usr/bin/env node
/**
 * Harvest MakeEmoji styles the green-screen way:
 *   1. Upload a solid green subject to makeemoji.com
 *   2. Click each style card → site auto-downloads the result GIF
 *   3. Save the GIF under artifacts/emoji-offline/greenscreen/raw/
 *
 * Later, build-emoji-layers.mjs chroma-keys the green into a transparent
 * slot + front layer — same idea as the old /emojimoji green-screen packs.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/api-server exec node ./scripts/makeemoji-harvest-greenscreen.mjs
 *   pnpm --filter @workspace/api-server exec node ./scripts/makeemoji-harvest-greenscreen.mjs --limit=48
 *   pnpm --filter @workspace/api-server exec node ./scripts/makeemoji-harvest-greenscreen.mjs --ids=pet,party-blob,pokeball-go
 */
import { chromium } from "playwright";
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const OUT = join(REPO, "artifacts/emoji-offline");
const RAW = join(OUT, "greenscreen", "raw");
const META = join(OUT, "greenscreen", "harvest-meta.json");
const CATALOG = join(OUT, "catalog-live.json");
const GREEN = "/tmp/me687/green_512.png";
const SITE = "https://makeemoji.com/";

function arg(name, fallback = null) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function has(name) {
  return process.argv.includes(`--${name}`);
}

const LIMIT = Number(arg("limit", "0")) || 0;
const ONLY = (arg("ids", "") || "").split(",").map(s => s.trim()).filter(Boolean);

async function scrapeCatalog(page) {
  const seen = new Map();
  page.on("response", (res) => {
    const url = res.url();
    const m = url.match(/\/prerendered\/default-cat(?:-preview)?\/([^/?#]+)\.(webp|gif|png)/i);
    if (m && m[1] !== "default-cat") seen.set(m[1], url);
  });

  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);
  for (const sel of ['button:has-text("Accept")', 'button:has-text("Got it")', '[aria-label="Close"]']) {
    try { await page.locator(sel).first().click({ timeout: 800 }); } catch { /* */ }
  }

  for (let i = 0; i < 220; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, 700);
      for (const el of document.querySelectorAll("*")) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 80) {
          el.scrollTop = Math.min(el.scrollTop + 700, el.scrollHeight);
        }
      }
    });
    await page.waitForTimeout(160);
    if (i % 40 === 0) console.log(`  catalog scroll ${i} → ${seen.size}`);
  }

  // Restore top for editing
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const styles = [...seen.entries()]
    .map(([id, url]) => ({ id, tag: `gen_btn_${id}`, previewUrl: url }))
    .sort((a, b) => a.id.localeCompare(b.id));

  writeFileSync(CATALOG, JSON.stringify({
    harvestedAt: new Date().toISOString(),
    site: SITE,
    count: styles.length,
    note: "IDs observed from prerendered preview assets while scrolling the main Editor style grid. Page label may show a higher count (e.g. 687) if directional/super-animation variants are counted separately.",
    styles,
  }, null, 2));
  console.log(`catalog: ${styles.length} styles → ${CATALOG}`);
  return styles;
}

async function uploadGreen(page) {
  if (!existsSync(GREEN)) {
    throw new Error(`Green subject missing: ${GREEN}`);
  }
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(GREEN);
  await page.waitForTimeout(2500);
  console.log("uploaded green subject");
}

async function clickStyleAndDownload(page, styleId) {
  const tag = `gen_btn_${styleId}`;
  // Ensure the card is in the virtualized DOM: search/filter if available
  let clicked = false;

  // Try data-tag button first
  const byTag = page.locator(`[data-tag="${tag}"]`).first();
  if (await byTag.count()) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }).catch(() => null),
      byTag.click({ timeout: 5000 }),
    ]);
    if (download) return download;
    clicked = true;
  }

  // Fallback: text :styleId:
  if (!clicked) {
    const byText = page.getByText(`:${styleId}:`, { exact: true }).first();
    if (await byText.count()) {
      // Scroll into view via search box if present
      try {
        const search = page.getByPlaceholder(/search/i).first();
        if (await search.count()) {
          await search.fill(styleId);
          await page.waitForTimeout(600);
        }
      } catch { /* */ }
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20_000 }).catch(() => null),
        byText.click({ timeout: 5000 }),
      ]);
      if (download) return download;
    }
  }

  // Last resort: evaluate click after scrolling catalog until found
  const found = await page.evaluate(async (want) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 60; i++) {
      const el = document.querySelector(`[data-tag="gen_btn_${want}"]`);
      if (el) { el.scrollIntoView({ block: "center" }); return true; }
      window.scrollBy(0, 800);
      await sleep(120);
    }
    return false;
  }, styleId);

  if (found) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }).catch(() => null),
      page.locator(`[data-tag="${tag}"]`).first().click({ timeout: 5000 }),
    ]);
    if (download) return download;
  }
  return null;
}

async function main() {
  mkdirSync(RAW, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  let styles = await scrapeCatalog(page);
  if (ONLY.length) {
    styles = styles.filter(s => ONLY.includes(s.id));
  }
  // Prefer site order: none/pet first if present, else alpha. For limit batches,
  // take from a curated first-page list when limit set and no --ids.
  const FIRST_PAGE = [
    "none", "pet", "party-parrot", "parrot", "parrot-hat", "parrot-hold",
    "party-blob", "sad-blob", "jammies", "nyan-cat", "thing-cat", "nyan",
    "lightspeed-jump", "lightsaber", "shake", "party", "peepo", "peepo-sit",
    "peepo-stop", "peepo-shy", "peepo-want", "peepo-love", "enter", "exit",
    "pokeball-go", "pokeball-capture", "pokeball-almost", "pokeball-emerge",
    "deal-with-it", "bounce", "spin", "jam", "panic", "nyan",
  ];
  if (LIMIT > 0 && !ONLY.length) {
    const prefer = FIRST_PAGE.map(id => styles.find(s => s.id === id)).filter(Boolean);
    const rest = styles.filter(s => !FIRST_PAGE.includes(s.id));
    styles = [...prefer, ...rest].slice(0, LIMIT);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await uploadGreen(page);

  const meta = existsSync(META) ? JSON.parse(readFileSync(META, "utf8")) : { items: {} };
  meta.startedAt = meta.startedAt || new Date().toISOString();
  meta.greenSubject = GREEN;

  let ok = 0, fail = 0;
  for (const style of styles) {
    const dest = join(RAW, `${style.id}.gif`);
    if (existsSync(dest) && !has("force")) {
      console.log(`skip ${style.id} (exists)`);
      ok++;
      continue;
    }
    process.stdout.write(`harvest ${style.id}… `);
    try {
      const download = await clickStyleAndDownload(page, style.id);
      if (!download) {
        console.log("NO DOWNLOAD");
        fail++;
        meta.items[style.id] = { ok: false, error: "no-download" };
        continue;
      }
      const tmp = await download.path();
      if (!tmp) {
        // saveAs required
        await download.saveAs(dest);
      } else {
        copyFileSync(tmp, dest);
      }
      const buf = readFileSync(dest);
      if (buf.length < 100 || buf.subarray(0, 3).toString() !== "GIF") {
        console.log("NOT GIF", buf.length);
        fail++;
        meta.items[style.id] = { ok: false, error: "not-gif", bytes: buf.length };
        continue;
      }
      const sha = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      meta.items[style.id] = {
        ok: true,
        bytes: buf.length,
        sha256_16: sha,
        file: `greenscreen/raw/${style.id}.gif`,
        suggestedFilename: download.suggestedFilename(),
      };
      console.log(`OK ${buf.length}B`);
      ok++;
    } catch (err) {
      console.log("ERR", err?.message || err);
      fail++;
      meta.items[style.id] = { ok: false, error: String(err?.message || err) };
    }
    // gentle pacing
    await page.waitForTimeout(400);
  }

  meta.finishedAt = new Date().toISOString();
  meta.ok = ok;
  meta.fail = fail;
  writeFileSync(META, JSON.stringify(meta, null, 2));
  console.log(`\nDone ok=${ok} fail=${fail}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
