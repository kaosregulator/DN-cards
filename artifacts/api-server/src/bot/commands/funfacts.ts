// Fun Facts — lightweight trivia pulled from the Military Tycoon Fandom wiki.
//
// Kept intentionally SEPARATE from the value calculator (mttvalues.ts) and the
// battle system: this is a standalone, read-only novelty command with its own
// cache. It never touches cards, currency, or battle state.
//
// Pages on the wiki are template-driven infoboxes (vehicle stats, equipment
// effects) rather than prose, so a "fun fact" is built by pulling a handful of
// random pages and formatting whichever infobox fields are present into a
// short sentence. Pages with no usable infobox are skipped.

import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { logger } from "../../lib/logger.js";

const WIKI_API = "https://military-tycoon.fandom.com/api.php";
const WIKI_BASE = "https://military-tycoon.fandom.com/wiki/";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — refresh the fact pool periodically
const FETCH_TIMEOUT_MS = 8_000;

interface FunFact {
  title: string;
  text: string;
  url: string;
}

let cache: FunFact[] = [];
let cacheExpiresAt = 0;
let refreshInFlight: Promise<void> | null = null;

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`wiki fetch failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Strips the light wiki markup found inside infobox values so they read as
// plain text: [[Link|Label]] → Label, [[Link]] → Link, {{Template|x}} → x,
// multi-line/bulleted values (each line optionally starting with "*") → a
// single comma-joined line.
function cleanValue(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]*\|([^}|]+)\}\}/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .split("\n")
    .map(line => line.replace(/^\s*\*+\s*/, "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
}

// Wiki editors mark unfinished vehicle stats as "Unknown"/"TBA"/"?"/"None" —
// treat those as absent rather than surfacing them in a fun fact.
function isUsable(value: string | undefined): value is string {
  if (!value) return false;
  return !/^(unknown|tba|\?|none|n\/a|-)$/i.test(value.trim());
}

function parseInfobox(wikitext: string): Record<string, string> | null {
  const match = wikitext.match(/\{\{([\s\S]*)\}\}\s*$/);
  const body = match ? match[1] : wikitext;
  if (!body.includes("|")) return null;

  const fields: Record<string, string> = {};
  // Split on "|Key=" boundaries at the start of a field (not inside a value).
  const parts = body.split(/\n?\|(?=[A-Za-z_?][\w?]*=)/g);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = cleanValue(part.slice(eq + 1));
    if (key && value) fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

function buildFactText(title: string, f: Record<string, string>): string | null {
  const vehicleClass = f.vehicle_class || f.Aerial_Ground_Water;
  const speed = f.max_speed || f.Speed;
  const health = f.max_health || f.Amount_of_health_it_has;
  const damage = f.max_damage || f.Amount_of_damage_it_deals;
  const weapon = f.weapon_type || f.weapon_on_the_vehicle;

  if (isUsable(vehicleClass) && (isUsable(speed) || isUsable(health) || isUsable(damage))) {
    const bits: string[] = [];
    if (isUsable(speed)) bits.push(`a top speed of **${speed}**`);
    if (isUsable(health)) bits.push(`up to **${health}** HP`);
    if (isUsable(damage)) bits.push(`up to **${damage}** damage`);
    const weaponBit = isUsable(weapon) ? ` armed with a **${weapon}**` : "";
    return `**${title}** is a ${vehicleClass}${weaponBit} with ${bits.join(" and ")}.`;
  }

  const equipType = f.type;
  const effect = f.effect;
  if (isUsable(equipType) && isUsable(effect)) {
    return `**${title}** is a **${equipType}** item — effect: ${effect}.`;
  }

  const cost = f.cost;
  if (isUsable(cost)) {
    return `**${title}** can be obtained for: ${cost}.`;
  }

  return null;
}

async function refreshCache(): Promise<void> {
  try {
    const randomJson = await fetchJson(`${WIKI_API}?action=query&list=random&rnnamespace=0&rnlimit=20&format=json`);
    const titles: string[] = (randomJson?.query?.random ?? []).map((r: any) => r.title).filter(Boolean);

    const facts: FunFact[] = [];
    for (const title of titles) {
      if (facts.length >= 10) break;
      try {
        const contentJson = await fetchJson(
          `${WIKI_API}?action=query&titles=${encodeURIComponent(title)}&prop=revisions&rvprop=content&rvslots=main&rvsection=0&format=json`,
        );
        const pages = contentJson?.query?.pages ?? {};
        const page = Object.values(pages)[0] as any;
        const wikitext: string | undefined = page?.revisions?.[0]?.slots?.main?.["*"];
        if (!wikitext) continue;
        const fields = parseInfobox(wikitext);
        if (!fields) continue;
        const text = buildFactText(title, fields);
        if (!text) continue;
        facts.push({ title, text, url: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, "_"))}` });
      } catch { /* skip this title, try the next */ }
    }

    if (facts.length > 0) {
      cache = facts;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    }
  } catch (err) {
    logger.error({ err }, "Failed to refresh wiki fun-fact cache");
  }
}

async function getFacts(): Promise<FunFact[]> {
  if (cache.length > 0 && Date.now() < cacheExpiresAt) return cache;
  if (!refreshInFlight) {
    refreshInFlight = refreshCache().finally(() => { refreshInFlight = null; });
  }
  await refreshInFlight;
  return cache;
}

// ── /funfact ──────────────────────────────────────────────────────────────
export async function handleFunFact(interaction: ChatInputCommandInteraction): Promise<void> {
  const facts = await getFacts();
  if (facts.length === 0) {
    await interaction.editReply("❌ Couldn't pull a fun fact from the wiki right now — try again in a bit.");
    return;
  }
  const fact = facts[Math.floor(Math.random() * facts.length)]!;
  const embed = new EmbedBuilder()
    .setTitle("📚 Military Tycoon Fun Fact")
    .setColor(0x3498db)
    .setDescription(fact.text)
    .setFooter({ text: "Source: Military Tycoon Wiki (Fandom)" })
    .setURL(fact.url);
  await interaction.editReply({ embeds: [embed] });
}
