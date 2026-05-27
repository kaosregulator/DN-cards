import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  listSetsV2, getSetByName, getCardsInSet, getActiveSet,
  getUserCollection,
} from "../db.js";
import { RARITY_EMOJI, type Rarity } from "../cards-data.js";

const RARITY_ORDER: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];

export async function handleSetsUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // /sets is read-only and public-safe. The user.ts dispatcher already deferred.
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand(true);

  // ── /sets list ───────────────────────────────────────────────────────────
  if (sub === "list") {
    const sets = await listSetsV2();
    const active = await getActiveSet(guildId);
    if (sets.length === 0) {
      await interaction.editReply("📭 No card sets defined yet. Ask an admin to create one with `/setadmin create`.");
      return;
    }
    const lines = sets
      .sort((a, b) => b.cardCount - a.cardCount || a.set.name.localeCompare(b.set.name))
      .map(s => {
        const star = active?.id === s.set.id ? "  ✦ active" : "";
        return `• \`${s.set.name}\` — **${s.cardCount}** cards${star}`;
      });
    const embed = new EmbedBuilder()
      .setTitle("📚 Card Sets")
      .setColor(0x5865f2)
      .setDescription(lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n_+${lines.length - 40} more_` : ""))
      .setFooter({ text: active ? `Active set drives random spawns: ${active.name}` : "No active set — random spawns disabled" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /sets active ─────────────────────────────────────────────────────────
  if (sub === "active") {
    const active = await getActiveSet(guildId);
    if (!active) {
      await interaction.editReply("⚠️ No active set selected — random spawns are currently **disabled** on this server.");
      return;
    }
    const cards = await getCardsInSet(active.id);
    const droppable = cards.filter(c => c.droppable && !c.isArchived).length;
    await interaction.editReply(
      `✦ Active set: \`${active.name}\` — **${cards.length}** cards (**${droppable}** droppable). ` +
      `Use \`/sets view name:${active.name}\` to see the full list.`,
    );
    return;
  }

  // ── /sets view name:<set> ────────────────────────────────────────────────
  if (sub === "view") {
    const setName = interaction.options.getString("name", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const cards = await getCardsInSet(set.id);
    const active = await getActiveSet(guildId);
    const isActive = active?.id === set.id;
    const grouped: Partial<Record<Rarity, string[]>> = {};
    for (const c of cards) {
      const r = c.rarity as Rarity;
      (grouped[r] ??= []).push(c.name);
    }
    const fields = RARITY_ORDER
      .filter(r => grouped[r] && grouped[r]!.length > 0)
      .map(r => {
        const list = grouped[r]!.sort();
        const value = list.slice(0, 40).join(", ") + (list.length > 40 ? ` (+${list.length - 40} more)` : "");
        return { name: `${RARITY_EMOJI[r]} ${r} (${list.length})`, value: value.slice(0, 1024) };
      });
    const embed = new EmbedBuilder()
      .setTitle(`📦 ${set.name}${isActive ? "  ✦ active" : ""}`)
      .setColor(isActive ? 0x57f287 : 0x5865f2)
      .setDescription((set.description ? `${set.description}\n\n` : "") + `**${cards.length}** cards`)
      .addFields(fields.length > 0 ? fields : [{ name: "Empty", value: "No cards in this set yet." }]);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /sets progress [user] ────────────────────────────────────────────────
  if (sub === "progress") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const sets = await listSetsV2();
    if (sets.length === 0) {
      await interaction.editReply("📭 No card sets defined yet.");
      return;
    }
    const owned = await getUserCollection(guildId, target.id);
    const ownedIds = new Set(owned.map(c => c.id));
    const active = await getActiveSet(guildId);
    const rows = await Promise.all(
      sets.map(async ({ set, cardCount }) => {
        if (cardCount === 0) return { name: set.name, owned: 0, total: 0, isActive: active?.id === set.id };
        const cards = await getCardsInSet(set.id);
        const ownedInSet = cards.filter(c => ownedIds.has(c.id)).length;
        return { name: set.name, owned: ownedInSet, total: cards.length, isActive: active?.id === set.id };
      }),
    );
    const lines = rows
      .sort((a, b) => (b.total === 0 ? 0 : b.owned / b.total) - (a.total === 0 ? 0 : a.owned / a.total))
      .map(r => {
        const pct = r.total === 0 ? 0 : Math.round((r.owned / r.total) * 100);
        const star = r.isActive ? "  ✦" : "";
        const complete = r.total > 0 && r.owned === r.total ? "  🏆" : "";
        return `• \`${r.name}\` — **${r.owned}/${r.total}** (${pct}%)${star}${complete}`;
      });
    const embed = new EmbedBuilder()
      .setTitle(`📊 Set Progress · ${target.username}`)
      .setColor(0x5865f2)
      .setDescription(lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n_+${lines.length - 40} more_` : ""));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await interaction.editReply(`❌ Unknown subcommand: \`${sub}\`.`);
}
