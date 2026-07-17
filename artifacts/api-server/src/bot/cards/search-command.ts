import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";
import {
  getAllCards, getUserCollection, getRarityContext, getOrCreateGuildSettings,
  getRarityDisplayOverrides, getCardDisplayRarity,
} from "../db.js";
import { getStarRanks } from "./stars.js";
const MAX_RESULTS = 25;

// Fuse.js search options tuned for card names: tolerate typos, allow acronym
// matches (e.g. "M1" → "M1 Abrams"), and surface close substring hits first.
const FUSE_OPTIONS: IFuseOptions<{ name: string }> = {
  keys: ["name"],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 1,
  useExtendedSearch: true,
};

/** Acronym for a card name, e.g. "M1 Abrams" → "MA". */
function acronym(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase())
    .join("");
}

export interface SearchOpts {
  query?: string | null;
  rarity?: string | null;
  type?: string | null;
  owned?: string | null; // "owned" | "missing" | null
}

// Free-text roster search with rarity/type/ownership filters. Fills the gap the
// category-only /catalog leaves — find a card by name fragment across the whole
// roster and see at a glance whether you own it.
export async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const result = await buildSearchEmbed(interaction.guild.id, interaction.user.id, {
    query: interaction.options.getString("query"),
    rarity: interaction.options.getString("rarity"),
    type: interaction.options.getString("type"),
    owned: interaction.options.getString("owned"),
  });
  await interaction.editReply(typeof result === "string" ? result : { embeds: [result] });
}

// Reusable search → returns an embed of results, or a plain string message for
// the empty/no-input/no-match cases. Shared by the /search command and the
// User-Hub Search section (which passes only a query).
export async function buildSearchEmbed(
  guildId: string, userId: string, opts: SearchOpts,
): Promise<EmbedBuilder | string> {
  const query = (opts.query ?? "").trim();
  const rarity = opts.rarity ?? null;
  const type = opts.type?.trim().toLowerCase() || null;
  const ownedFilter = opts.owned ?? null; // owned | missing | null

  if (!query && !rarity && !type) {
    return "🔎 Give me something to search — a name query, a rarity, or a type.";
  }

  const [cards, collection, rarityCtx, settings, displayMap, starRanks] = await Promise.all([
    getAllCards(guildId),
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getStarRanks(guildId, userId),
  ]);
  const ownedMap = new Map<number, number>();
  for (const c of collection) ownedMap.set(c.cardId, c.count + c.shinyCount);

  let results = cards.filter(c => !c.isArchived);
  if (rarity) results = results.filter(c => (c.rarity as string) === rarity);
  if (type) results = results.filter(c => (c.cardType ?? "").toLowerCase() === type);
  if (ownedFilter === "owned") results = results.filter(c => (ownedMap.get(c.id) ?? 0) > 0);
  if (ownedFilter === "missing") results = results.filter(c => (ownedMap.get(c.id) ?? 0) === 0);

  if (query) {
    const qLower = query.toLowerCase();
    const fuse = new Fuse(results.map(c => ({ name: c.name, card: c })), {
      ...FUSE_OPTIONS,
      keys: ["name"],
      getFn: (obj, key) => key === "name" ? obj.name : "",
    });

    // 1. exact / acronym literal matches get top priority
    const acronymMatches = new Set<number>();
    const exactMatches = results.filter(c => {
      if (c.name.toLowerCase().includes(qLower)) return true;
      if (acronym(c.name).toLowerCase().includes(qLower)) {
        acronymMatches.add(c.id);
        return true;
      }
      return false;
    });

    // 2. fuse fills in fuzzy / typo-tolerant results beyond the exact set
    const fuseHits = fuse.search(query).map(r => r.item.card);
    const seen = new Set(exactMatches.map(c => c.id));
    const merged: typeof results = [...exactMatches];
    for (const c of fuseHits) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }

    // Sort: exact prefix first, then acronym matches, then by fuse score (already in fuse order)
    merged.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aExact = aName.includes(qLower);
      const bExact = bName.includes(qLower);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      const aAcronym = acronymMatches.has(a.id);
      const bAcronym = acronymMatches.has(b.id);
      if (aAcronym && !bAcronym) return -1;
      if (!aAcronym && bAcronym) return 1;
      return a.name.localeCompare(b.name);
    });
    results = merged;
  } else {
    results.sort((a, b) => a.name.localeCompare(b.name));
  }

  const total = results.length;
  if (total === 0) {
    return "🔎 No cards matched your search. Try a shorter query or fewer filters.";
  }

  const shown = results.slice(0, MAX_RESULTS);
  const lines = shown.map(c => {
    const owned = ownedMap.get(c.id) ?? 0;
    const mark = owned > 0 ? `✅ ×${owned}` : "❌";
    const badges = `${c.isLimitedEdition ? " 💎" : ""}${c.isEventExclusive ? " 🎆" : ""}`;
    // Emoji resolves through /rarity (custom tiers + built-in overrides).
    const emoji = getCardDisplayRarity(c, rarityCtx, settings, displayMap).emoji || "•";
    const star = starRanks.get(c.id) ?? 0;
    const starTag = star > 0 ? ` ${"★".repeat(star)}` : "";
    return `${emoji} **${c.name}**${badges}${starTag} — ${mark}`;
  });

  const filters: string[] = [];
  if (query) filters.push(`name~"${query}"`);
  if (rarity) filters.push(rarity);
  if (type) filters.push(type);
  if (ownedFilter) filters.push(ownedFilter);

  const embed = new EmbedBuilder()
    .setTitle(`🔎 Search — ${total} result${total === 1 ? "" : "s"}`)
    .setColor(0x3498db)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: `${filters.join(" · ")}${total > MAX_RESULTS ? ` · showing first ${MAX_RESULTS}` : ""} · ✅ owned  ❌ missing` });

  return embed;
}
