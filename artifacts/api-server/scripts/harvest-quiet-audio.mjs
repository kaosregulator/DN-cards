#!/usr/bin/env node
/**
 * Harvest curated Quiet Room source audio via Openverse media URLs.
 *
 * Usage (from artifacts/api-server):
 *   node ./scripts/harvest-quiet-audio.mjs
 *
 * Downloads CC0 preview MP3s listed in the sources manifest into
 * quiet-audio/sources/… and writes quiet-audio/SOURCES.md.
 */
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const sourcesRoot = path.join(pkgRoot, "quiet-audio", "sources");
const UA = "DN-Cards-QuietRoom/1.1 (harvest; quiet-mode audio)";

/** Keep in sync with src/bot/quiet/audio/sources.ts */
const ASSETS = [
  { id: "src-rain-window-01", file: "rain/rain-on-roof-window.mp3", mediaUrl: "https://cdn.freesound.org/previews/103/103652_591891-hq.mp3", title: "Rain on Roof & Window", creator: "palegolas", openverseId: "0b4d6414-c481-4fd9-a282-cca7c245e386", landing: "https://freesound.org/people/palegolas/sounds/103652", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-rain-roof-01", file: "rain/rain-on-polycarbonate.mp3", mediaUrl: "https://cdn.freesound.org/previews/204/204338_2945960-hq.mp3", title: "Rain on Roof", creator: "dwareing", openverseId: "a902c2fd-6057-4050-830a-7f7b20f44882", landing: "https://freesound.org/people/dwareing/sounds/204338", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-rain-gentle-01", file: "rain/gentle-rain.mp3", mediaUrl: "https://cdn.freesound.org/previews/501/501243_8644110-hq.mp3", title: "Gentle Rain", creator: "shelbyshark", openverseId: "4c1804e9-6944-48b4-b3d5-8e641ec0f265", landing: "https://freesound.org/people/shelbyshark/sounds/501243", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-rain-storm-01", file: "rain/rain-strong-thunder.mp3", mediaUrl: "https://cdn.freesound.org/previews/157/157486_2366774-hq.mp3", title: "Soft Storm Rain", creator: "loopbasedmusic", openverseId: "8708d33a-9c64-4111-a7d8-0acb64c983e6", landing: "https://freesound.org/people/loopbasedmusic/sounds/157486", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-rain-woodland-01", file: "rain/light-rain-woodland.mp3", mediaUrl: "https://cdn.freesound.org/previews/695/695571_5392691-hq.mp3", title: "Night Rain (Woodland)", creator: "thinkingfish", openverseId: "d17d6090-87bb-4147-8417-d9055922da0a", landing: "https://freesound.org/people/thinkingfish/sounds/695571", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-ocean-zen-01", file: "ocean/zen-ocean-waves.mp3", mediaUrl: "https://cdn.freesound.org/previews/456/456899_9518146-hq.mp3", title: "Calm Ocean Waves", creator: "INNORECORDS", openverseId: "b09fd453-95ae-4604-aab2-3b7c5cfb6b95", landing: "https://freesound.org/people/INNORECORDS/sounds/456899", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-ocean-big-01", file: "ocean/big-waves.mp3", mediaUrl: "https://cdn.freesound.org/previews/426/426075_3380363-hq.mp3", title: "Slow Waves", creator: "chris_dagorne", openverseId: "01522247-b53f-44e2-92c6-ec620def6485", landing: "https://freesound.org/people/chris_dagorne/sounds/426075", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-ocean-by-sea-01", file: "ocean/by-the-sea.mp3", mediaUrl: "https://cdn.freesound.org/previews/404/404696_7583126-hq.mp3", title: "Distant Beach", creator: "OSFX", openverseId: "873d8c72-3846-4de3-8df0-81db190f988c", landing: "https://freesound.org/people/OSFX/sounds/404696", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-stream-01", file: "stream/stream-close.mp3", mediaUrl: "https://cdn.freesound.org/previews/433/433589_5618682-hq.mp3", title: "Quiet Stream", creator: "jackthemurray", openverseId: "8a9d7bbb-86d7-4992-8766-ac0b3cb3e53a", landing: "https://freesound.org/people/jackthemurray/sounds/433589", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-river-01", file: "stream/small-river.mp3", mediaUrl: "https://cdn.freesound.org/previews/459/459406_627541-hq.mp3", title: "Small River", creator: "Pfannkuchn", openverseId: "210ac469-3163-477f-a79d-ea8c846a2fed", landing: "https://freesound.org/people/Pfannkuchn/sounds/459406", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-fire-01", file: "fireplace/crackling-fireplace.mp3", mediaUrl: "https://cdn.freesound.org/previews/563/563766_6253486-hq.mp3", title: "Fireplace", creator: "florianreichelt", openverseId: "914bb44e-4396-42e3-b369-b8d5ac5b793c", landing: "https://freesound.org/people/florianreichelt/sounds/563766", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-fire-stove-01", file: "fireplace/stove-fire.mp3", mediaUrl: "https://cdn.freesound.org/previews/532/532191_9735871-hq.mp3", title: "Cabin Fire", creator: "mcmikai", openverseId: "077dfa8d-3541-4b63-967b-86e7bb8bc56c", landing: "https://freesound.org/people/mcmikai/sounds/532191", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-forest-night-01", file: "forest/forest-night-crickets.mp3", mediaUrl: "https://cdn.freesound.org/previews/328/328293_1661766-hq.mp3", title: "Night Forest", creator: "felix.blume", openverseId: "951e6c56-5952-40ee-b652-bdc74e83374f", landing: "https://freesound.org/people/felix.blume/sounds/328293", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-woods-01", file: "forest/woods-birds-wind.mp3", mediaUrl: "https://cdn.freesound.org/previews/665/665156_1661766-hq.mp3", title: "Forest Air", creator: "felix.blume", openverseId: "eddd4878-7d54-4e61-a0e8-7d776b7e1d36", landing: "https://freesound.org/people/felix.blume/sounds/665156", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-night-insects-01", file: "night/night-insects.mp3", mediaUrl: "https://cdn.freesound.org/previews/319/319941_989468-hq.mp3", title: "Night Sounds", creator: "The_Sound_Side", openverseId: "9e265dd8-00d7-43f8-a3cc-37d63e3dea58", landing: "https://freesound.org/people/The_Sound_Side/sounds/319941", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-night-quiet-01", file: "night/city-night-quiet.mp3", mediaUrl: "https://cdn.freesound.org/previews/197/197211_167260-hq.mp3", title: "Quiet Night", creator: "ragamuffin", openverseId: "cc72ea8f-aa5e-416b-b7c1-956f25fecfda", landing: "https://freesound.org/people/ragamuffin/sounds/197211", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-thunder-01", file: "thunder/distant-thunder.mp3", mediaUrl: "https://cdn.freesound.org/previews/107/107518_43834-hq.mp3", title: "Distant Thunder", creator: "sagetyrtle", openverseId: "585e4db4-954b-4f46-9d3b-e71b27e43831", landing: "https://freesound.org/people/sagetyrtle/sounds/107518", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-wind-beach-01", file: "wind/wind-on-beach.mp3", mediaUrl: "https://cdn.freesound.org/previews/130/130692_1483235-hq.mp3", title: "Soft Wind", creator: "BrandonNyte", openverseId: "d39bff41-6124-4cef-8d33-57d32ab9a819", landing: "https://freesound.org/people/BrandonNyte/sounds/130692", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-music-pad-01", file: "music/angelic-pad-loop.mp3", mediaUrl: "https://cdn.freesound.org/previews/242/242773_3946286-hq.mp3", title: "Soft Ambient Pad", creator: "PhonZz", openverseId: "68e950c0-a4e0-47b8-a337-a7453e4a2c5f", landing: "https://freesound.org/people/PhonZz/sounds/242773", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-music-dunes-01", file: "music/dunes-ambient.mp3", mediaUrl: "https://cdn.freesound.org/previews/447/447511_7038073-hq.mp3", title: "Atmospheric Dunes", creator: "Andrewkn", openverseId: "0ce95b3a-c0a6-4cf7-b54b-907eae9f6a47", landing: "https://freesound.org/people/Andrewkn/sounds/447511", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-music-space-01", file: "music/ambient-space-texture.mp3", mediaUrl: "https://cdn.freesound.org/previews/474/474864_7038073-hq.mp3", title: "Calm Synth Texture", creator: "Andrewkn", openverseId: "20502270-b305-450f-927f-1bc502814064", landing: "https://freesound.org/people/Andrewkn/sounds/474864", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "src-music-meditate-01", file: "music/meditate-calm-scape.mp3", mediaUrl: "https://cdn.freesound.org/previews/580/580073_2282212-hq.mp3", title: "Meditation Scape", creator: "szegvari", openverseId: "7024ddfc-77f0-4ba9-b103-854bcea07127", landing: "https://freesound.org/people/szegvari/sounds/580073", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  const force = process.argv.includes("--force");
  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const a of ASSETS) {
    const dest = path.join(sourcesRoot, a.file);
    if (!force && await exists(dest)) {
      console.log(`skip  ${a.id}`);
      skip++;
      continue;
    }
    try {
      process.stdout.write(`get   ${a.id} … `);
      await download(a.mediaUrl, dest);
      console.log("ok");
      ok++;
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      console.log(`FAIL ${err.message || err}`);
      fail++;
    }
  }

  const md = [
    "# Quiet Room curated sources",
    "",
    "All clips below were discovered with the **Openverse** audio search API",
    "(`license=cc0`) and verified as **CC0 1.0** before harvest.",
    "",
    "- Openverse search algorithm: https://docs.openverse.org/api/reference/search_algorithm.html",
    "- Openverse API: https://api.openverse.org/v1/audio/",
    "",
    "| id | title | creator | Openverse id | landing | license |",
    "|----|-------|---------|--------------|---------|---------|",
    ...ASSETS.map(a =>
      `| \`${a.id}\` | ${a.title} | ${a.creator} | \`${a.openverseId}\` | ${a.landing} | [CC0 1.0](${a.licenseUrl}) |`,
    ),
    "",
    "CC0 allows redistribution, commercial use, and modification without attribution,",
    "though we keep attribution for provenance.",
    "",
    `Harvested: ${new Date().toISOString()}`,
    "",
  ].join("\n");
  await writeFile(path.join(pkgRoot, "quiet-audio", "SOURCES.md"), md, "utf8");
  console.log(`\nDone. downloaded=${ok} skipped=${skip} failed=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
