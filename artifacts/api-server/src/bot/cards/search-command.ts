import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";
import { getAllCards, getUserCollection } from "../db.js";

const RARITY_EMOJI: Record<string, string> = {
  common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡", mythic: "🔴",
};
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

// Free-text roster search with rarity/type/ownership filters. Fills the gap the
// category-only /catalog leaves — find a card by name fragment across the whole
// roster and see at a glance whether you own it.
export async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const query = (interaction.options.getString("query") ?? "").trim();
  const rarity = interaction.options.getString("rarity");
  const type = interaction.options.getString("type")?.trim().toLowerCase();
  const ownedFilter = interaction.options.getString("owned"); // owned | missing | null

  if (!query && !rarity && !type) {
    await interaction.editReply("🔎 Give me something to search — a `query` (name), a `rarity`, or a `type`.");
    return;
  }

  const [cards, collection] = await Promise.all([
    getAllCards(guildId),
    getUserCollection(guildId, userId),
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
    await interaction.editReply("🔎 No cards matched your search. Try a shorter query or fewer filters.");
    return;
  }

  const shown = results.slice(0, MAX_RESULTS);
  const lines = shown.map(c => {
    const owned = ownedMap.get(c.id) ?? 0;
    const mark = owned > 0 ? `✅ ×${owned}` : "❌";
    const badges = `${c.isLimitedEdition ? " 💎" : ""}${c.isEventExclusive ? " 🎆" : ""}`;
    return `${RARITY_EMOJI[c.rarity] ?? "•"} **${c.name}**${badges} — ${mark}`;
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

  await interaction.editReply({ embeds: [embed] });
}
