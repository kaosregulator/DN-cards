import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { getAllCards, getUserCollection } from "../db.js";

const RARITY_EMOJI: Record<string, string> = {
  common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡", mythic: "🔴",
};
const MAX_RESULTS = 25;

// Free-text roster search with rarity/type/ownership filters. Fills the gap the
// category-only /catalog leaves — find a card by name fragment across the whole
// roster and see at a glance whether you own it.
export async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const query = (interaction.options.getString("query") ?? "").trim().toLowerCase();
  const rarity = interaction.options.getString("rarity");
  const type = interaction.options.getString("type")?.trim().toLowerCase();
  const ownedFilter = interaction.options.getString("owned"); // owned | missing | null

  if (!query && !rarity && !type) {
    await interaction.editReply("🔎 Give me something to search — a `query` (name), a `rarity`, or a `type`.");
    return;
  }

  const [cards, collection] = await Promise.all([
    getAllCards(),
    getUserCollection(guildId, userId),
  ]);
  const ownedMap = new Map<number, number>();
  for (const c of collection) ownedMap.set(c.cardId, c.count + c.shinyCount);

  let results = cards.filter(c => !c.isArchived);
  if (query) results = results.filter(c => c.name.toLowerCase().includes(query));
  if (rarity) results = results.filter(c => (c.rarity as string) === rarity);
  if (type) results = results.filter(c => (c.cardType ?? "").toLowerCase() === type);
  if (ownedFilter === "owned") results = results.filter(c => (ownedMap.get(c.id) ?? 0) > 0);
  if (ownedFilter === "missing") results = results.filter(c => (ownedMap.get(c.id) ?? 0) === 0);

  results.sort((a, b) => a.name.localeCompare(b.name));
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
