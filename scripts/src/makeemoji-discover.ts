#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// MakeEmoji discovery CLI.
//
// Run this from a machine that can actually reach makeemoji.com — your laptop,
// the Replit container, or the bot's own server. It drives the real editor in a
// real browser, records what happens, and writes a manifest the bot reads.
//
//   pnpm makeemoji:discover
//   pnpm makeemoji:discover -- --headed --out ./investigation
//
// Nothing about the site is assumed: every selector, option value and endpoint
// in the output came from this run. The report names anything it could not
// establish so you know what still needs a human eye.
// ─────────────────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  discover, DEFAULT_OUTPUT_DIR, DEFAULT_SITE_URL,
} from "../../artifacts/api-server/src/bot/emoji/providers/makeemoji/discovery/discover.js";

/** Where the bot reads its manifest from. */
const MANIFEST_TARGET =
  "artifacts/api-server/src/bot/emoji/providers/makeemoji/manifest.json";

interface Args {
  site: string;
  out: string;
  headed: boolean;
  install: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    site: DEFAULT_SITE_URL,
    out: DEFAULT_OUTPUT_DIR,
    headed: false,
    install: false,
    timeoutMs: 20_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--site" && argv[i + 1]) args.site = argv[++i]!;
    else if (arg === "--out" && argv[i + 1]) args.out = argv[++i]!;
    else if (arg === "--timeout" && argv[i + 1]) args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`
MakeEmoji discovery

  pnpm makeemoji:discover [-- options]

Options
  --site <url>      Editor URL to investigate       (default: ${DEFAULT_SITE_URL})
  --out <dir>       Where to write the artefacts    (default: ${DEFAULT_OUTPUT_DIR})
  --timeout <ms>    Per-step budget                 (default: 20000)
  --headed          Show the browser (useful when a step fails)
  --install         Copy the produced manifest into the bot on success

Environment
  MAKEEMOJI_CHROMIUM_PATH   Path to a Chromium binary, if Playwright's own is missing

Prerequisites
  pnpm add -w playwright && npx playwright install chromium
`.trim());
      process.exit(0);
    }
  }

  return args;
}

/**
 * A deliberately asymmetric, off-centre test image.
 *
 * Symmetric test art hides exactly the bugs that matter: an editor that rotates,
 * flips or crops looks identical on a centred circle.
 */
async function buildTestImage(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="none"/>
    <circle cx="236" cy="225" r="174" fill="#2f7fe4"/>
    <rect x="118" y="353" width="282" height="67" rx="26" fill="#e04f2f"/>
    <circle cx="184" cy="184" r="41" fill="#ffffff"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.headed) process.env["MAKEEMOJI_HEADLESS"] = "0";

  console.log(`\n▶ investigating ${args.site}`);
  console.log(`  artefacts → ${resolve(args.out)}\n`);

  const outcome = await discover({
    siteUrl: args.site,
    outputDir: args.out,
    testImage: await buildTestImage(),
    stepTimeoutMs: args.timeoutMs,
    onProgress: message => console.log(`  · ${message}`),
  });

  // ── summary ───────────────────────────────────────────────────────────────
  console.log("\n── results ──");
  for (const step of outcome.steps) {
    console.log(`  ${step.ok ? "✅" : "❌"} ${step.step}${step.ok ? "" : ` — ${step.detail}`}`);
  }

  const reachable = outcome.reachability.some(r => r.ok);
  console.log(`\n  reachable        ${reachable ? "yes" : "NO"}`);
  console.log(`  processing       ${outcome.verdict}`);
  console.log(`  animations found ${outcome.manifest.controls.animation?.values.length ?? 0}`);
  console.log(`  result retrieved ${outcome.result.obtained ? `${outcome.result.bytes} bytes via ${outcome.result.via}` : "no"}`);
  console.log(`  manifest         ${outcome.manifest.verified ? "VERIFIED" : "not verified"}`);

  if (!reachable) {
    console.log(
      "\n⚠️  This host could not reach the site, so nothing was learned about MakeEmoji itself.\n" +
      "   Run this again from a machine with outbound access (your laptop, Replit, or the bot server).",
    );
  }

  console.log(`\n📄 read ${join(args.out, "report.md")} for the full findings.`);

  // ── install ───────────────────────────────────────────────────────────────
  const produced = join(args.out, "manifest.json");
  if (args.install) {
    if (!outcome.manifest.verified) {
      console.log("\n✋ Not installing: the manifest is unverified. Fix the gaps named in the report first.");
      process.exitCode = 1;
      return;
    }
    if (!existsSync(produced)) {
      console.log("\n✋ Not installing: no manifest was produced.");
      process.exitCode = 1;
      return;
    }
    copyFileSync(produced, MANIFEST_TARGET);
    console.log(`\n✅ Installed → ${MANIFEST_TARGET}`);
    console.log("   Commit it and restart the bot; /emoji will start using MakeEmoji.");
  } else if (outcome.manifest.verified) {
    console.log(
      `\n✅ Manifest looks usable. Install it with:\n` +
      `   cp ${produced} ${MANIFEST_TARGET}\n` +
      `   (or re-run with --install)`,
    );
  } else {
    console.log(
      "\n✋ The manifest is not usable yet. The report's “Next actions” lists what is missing;\n" +
      "   most gaps can be filled by hand from the control inventory it prints.",
    );
    process.exitCode = 1;
  }

  // Surface the confirmed-endpoint question explicitly — it decides whether the
  // bot can skip Chromium entirely.
  const bodyRequests = outcome.candidates.filter(c => c.method !== "GET" && c.postData);
  if (bodyRequests.length > 0) {
    console.log(
      `\n🔎 ${bodyRequests.length} request(s) carried a body and may be a generation endpoint.\n` +
      "   If one of them is, fill the manifest's \"api\" block to skip the browser entirely.\n" +
      "   See “Generation flow” in the report.",
    );
  }

  if (existsSync(produced)) {
    const manifest = JSON.parse(readFileSync(produced, "utf8")) as { notes?: string };
    if (manifest.notes) console.log(`\n📝 ${manifest.notes}`);
  }
}

main().catch((err: unknown) => {
  console.error("\n❌ discovery failed:", err instanceof Error ? err.message : err);
  console.error(
    "\nIf this is a Chromium problem, install it with `npx playwright install chromium`,\n" +
    "or point MAKEEMOJI_CHROMIUM_PATH at an existing binary.",
  );
  process.exit(1);
});
