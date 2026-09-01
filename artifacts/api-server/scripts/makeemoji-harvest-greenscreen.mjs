#!/usr/bin/env node
/**
 * Sweep harvest: scroll the MakeEmoji style grid top→bottom, click every
 * enabled style card we don't already have, save the auto-download.
 *
 *   node ./scripts/makeemoji-harvest-greenscreen.mjs --sweep
 *   node ./scripts/makeemoji-harvest-greenscreen.mjs --sweep --passes=3
 */
import { chromium } from "playwright";
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync,
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

const PASSES = Math.max(1, Number(arg("passes", "4")) || 4);

function existingIds() {
  if (!existsSync(RAW)) return new Set();
  return new Set(
    readdirSync(RAW)
      .filter(f => /\.(gif|png|webp|jpe?g)$/i.test(f))
      .map(f => f.replace(/\.(gif|png|webp|jpe?g)$/i, "")),
  );
}

function detectExt(buf) {
  if (buf.subarray(0, 3).toString() === "GIF") return "gif";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  return null;
}

function loadMeta() {
  return existsSync(META) ? JSON.parse(readFileSync(META, "utf8")) : { items: {} };
}

async function dismiss(page) {
  for (const sel of ['button:has-text("Accept")', 'button:has-text("Got it")', '[aria-label="Close"]']) {
    try { await page.locator(sel).first().click({ timeout: 500 }); } catch { /* */ }
  }
}

async function clearSearch(page) {
  try {
    const search = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    if (await search.count()) {
      await search.fill("");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  } catch { /* */ }
}

/** List currently mounted style buttons with enabled state. */
async function visibleStyles(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-tag^=\"gen_btn_\"]")) {
      const tag = el.getAttribute("data-tag") || "";
      const id = tag.replace(/^gen_btn_/, "");
      const btn = el.closest("button") || (el.tagName === "BUTTON" ? el : null) || el;
      const disabled = Boolean(
        (btn instanceof HTMLButtonElement && btn.disabled)
        || btn.getAttribute?.("aria-disabled") === "true",
      );
      out.push({ id, tag, disabled });
    }
    return out;
  });
}

async function clickDownload(page, tag) {
  const loc = page.locator(`[data-tag="${tag}"]`).first();
  if (!(await loc.count())) return { ok: false, error: "missing" };

  const disabled = await loc.evaluate((el) => {
    const btn = el.closest("button") || el;
    return Boolean(
      (btn instanceof HTMLButtonElement && btn.disabled)
      || btn.getAttribute("aria-disabled") === "true",
    );
  });
  if (disabled) return { ok: false, error: "disabled" };

  await loc.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(80);

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  try {
    await loc.click({ timeout: 3000, force: true });
  } catch (err) {
    return { ok: false, error: `click:${String(err?.message || err).slice(0, 80)}` };
  }
  const download = await downloadPromise;
  if (!download) return { ok: false, error: "no-download" };
  return { ok: true, download };
}

async function saveDownload(download, styleId) {
  const tmp = join(RAW, `._tmp_${styleId}`);
  await download.saveAs(tmp);
  const buf = readFileSync(tmp);
  const ext = detectExt(buf);
  if (!ext || buf.length < 80) {
    try { renameSync(tmp, join(RAW, `${styleId}.bad`)); } catch { /* */ }
    return { ok: false, error: "bad-bytes", bytes: buf.length };
  }
  const dest = join(RAW, `${styleId}.${ext}`);
  renameSync(tmp, dest);
  return {
    ok: true,
    bytes: buf.length,
    ext,
    sha256_16: createHash("sha256").update(buf).digest("hex").slice(0, 16),
    file: `greenscreen/raw/${styleId}.${ext}`,
  };
}

async function scrollStep(page, px = 500) {
  await page.evaluate((dy) => {
    window.scrollBy(0, dy);
    for (const el of document.querySelectorAll("*")) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 80) {
        el.scrollTop = Math.min(el.scrollTop + dy, el.scrollHeight);
      }
    }
  }, px);
}

async function sweepPass(page, meta, have, pass) {
  console.log(`\n=== sweep pass ${pass} (have ${have.size}) ===`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await clearSearch(page);
  await page.waitForTimeout(400);

  let stableEmpty = 0;
  let clicksThisPass = 0;
  const attempted = new Set();

  for (let step = 0; step < 400; step++) {
    const visible = await visibleStyles(page);
    const candidates = visible.filter(v => !v.disabled && !have.has(v.id) && !attempted.has(v.id));

    if (candidates.length === 0) {
      await scrollStep(page, 450);
      await page.waitForTimeout(150);
      const after = await visibleStyles(page);
      const fresh = after.filter(v => !v.disabled && !have.has(v.id) && !attempted.has(v.id));
      if (fresh.length === 0) {
        stableEmpty++;
        if (stableEmpty >= 12) break;
        continue;
      }
      stableEmpty = 0;
      candidates.push(...fresh);
    } else {
      stableEmpty = 0;
    }

    for (const c of candidates) {
      attempted.add(c.id);
      process.stdout.write(`pass${pass} ${c.id}… `);
      const clicked = await clickDownload(page, c.tag);
      if (!clicked.ok) {
        console.log(`SKIP ${clicked.error}`);
        meta.items[c.id] = { ok: false, error: clicked.error };
        continue;
      }
      const saved = await saveDownload(clicked.download, c.id);
      meta.items[c.id] = saved;
      if (saved.ok) {
        have.add(c.id);
        clicksThisPass++;
        console.log(`OK ${saved.ext} ${saved.bytes}B`);
      } else {
        console.log(`SKIP ${saved.error}`);
      }
      await page.waitForTimeout(200);
    }

    if (step % 20 === 0) {
      writeFileSync(META, JSON.stringify(meta, null, 2));
      console.log(`  … pass${pass} step=${step} have=${have.size} clicks=${clicksThisPass}`);
    }

    // Progress the grid after handling current viewport
    await scrollStep(page, 350);
    await page.waitForTimeout(120);
  }

  writeFileSync(META, JSON.stringify(meta, null, 2));
  return clicksThisPass;
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  if (!existsSync(GREEN)) {
    throw new Error(`Missing green subject ${GREEN}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2000);
  await dismiss(page);
  await page.locator('input[type="file"]').first().setInputFiles(GREEN);
  await page.waitForTimeout(2500);
  console.log("green uploaded");

  const meta = loadMeta();
  meta.startedAt = meta.startedAt || new Date().toISOString();
  meta.items = meta.items || {};
  const have = existingIds();

  let totalNew = 0;
  for (let p = 1; p <= PASSES; p++) {
    const n = await sweepPass(page, meta, have, p);
    totalNew += n;
    console.log(`pass ${p} added ${n}; total have ${have.size}`);
    if (n === 0 && p >= 2) break;
    // re-upload green between passes in case editor state drifted
    try {
      await page.locator('input[type="file"]').first().setInputFiles(GREEN);
      await page.waitForTimeout(1000);
    } catch { /* */ }
  }

  // Also try any catalog IDs still missing via direct scroll-hunt (no search)
  let catalogIds = [];
  if (existsSync(CATALOG)) {
    catalogIds = JSON.parse(readFileSync(CATALOG, "utf8")).styles.map(s => s.id);
  }
  const missing = catalogIds.filter(id => !have.has(id));
  console.log(`\nDirect hunt for ${missing.length} still missing…`);

  let hunted = 0;
  for (const id of missing) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await clearSearch(page);
    const found = await page.evaluate(async (want) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 80; i++) {
        const el = document.querySelector(`[data-tag="gen_btn_${want}"]`);
        if (el) {
          const btn = el.closest("button") || el;
          const disabled = (btn instanceof HTMLButtonElement && btn.disabled)
            || btn.getAttribute("aria-disabled") === "true";
          if (disabled) return "disabled";
          el.scrollIntoView({ block: "center" });
          return "found";
        }
        window.scrollBy(0, 700);
        for (const node of document.querySelectorAll("*")) {
          const st = getComputedStyle(node);
          if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 80) {
            node.scrollTop = Math.min(node.scrollTop + 700, node.scrollHeight);
          }
        }
        await sleep(60);
      }
      return "missing";
    }, id);

    if (found !== "found") {
      meta.items[id] = { ok: false, error: found === "disabled" ? "disabled" : "not-found" };
      continue;
    }

    process.stdout.write(`hunt ${id}… `);
    const clicked = await clickDownload(page, `gen_btn_${id}`);
    if (!clicked.ok) {
      console.log(`SKIP ${clicked.error}`);
      meta.items[id] = { ok: false, error: clicked.error };
      continue;
    }
    const saved = await saveDownload(clicked.download, id);
    meta.items[id] = saved;
    if (saved.ok) {
      have.add(id);
      hunted++;
      console.log(`OK ${saved.ext} ${saved.bytes}B`);
    } else {
      console.log(`SKIP ${saved.error}`);
    }
    if (hunted % 10 === 0) writeFileSync(META, JSON.stringify(meta, null, 2));
    await page.waitForTimeout(180);
  }

  meta.finishedAt = new Date().toISOString();
  meta.lastRun = { mode: "sweep", passes: PASSES, newFromSweep: totalNew, hunted, have: have.size };
  writeFileSync(META, JSON.stringify(meta, null, 2));
  console.log(`\nDONE have=${have.size} (+sweep ${totalNew}, +hunt ${hunted})`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
