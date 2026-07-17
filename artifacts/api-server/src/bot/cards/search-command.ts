import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  getAllCards, getUserCollection, getRarityContext, getOrCreateGuildSettings,
  getRarityDisplayOverrides, getCardDisplayRarity,
} from "../db.js";
import { fuzzyRank } from "../search/fuse-service.js";
import { getStarRanks } from "./stars.js";
const MAX_RESULTS = 25;

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
    // Shared fuzzy service: literal/acronym hits first, then typo-tolerant Fuse
    // matches. Uses the cache-free ranker since `results` is a filtered subset.
    results = fuzzyRank(results, query, c => c.name);
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
