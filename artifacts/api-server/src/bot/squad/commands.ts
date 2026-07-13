import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { db, squadMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  getUserSquad, getSquadByName, createSquad, joinSquad, leaveSquad,
  disbandSquad, getSquadMembers, getSquadStats, getSquadLeaderboard,
} from "./db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function tag(squad: { name: string; tag: string | null }): string {
  return squad.tag ? `[${squad.tag}] ${squad.name}` : squad.name;
}

// ─────────────────────────────────────────────────────────────────────────────
// Param-based core actions — one implementation per squad action, reused by the
// /squad slash command AND the Squad Hub. No interaction dependency.
// ─────────────────────────────────────────────────────────────────────────────

export async function createSquadAction(
  guildId: string, userId: string,
  args: { name: string; tag: string | null; description: string | null },
): Promise<string> {
  const name = args.name.trim().slice(0, 40);
  const tagOpt = args.tag?.trim().slice(0, 6) || null;
  const description = args.description?.trim().slice(0, 200) || null;
  if (name.length < 2) return "❌ Squad name must be at least 2 characters.";
  const res = await createSquad({ guildId, name, ownerId: userId, tag: tagOpt, description });
  if (!res.ok) {
    return res.reason === "name_taken"
      ? `❌ A squad called **${name}** already exists here.`
      : "❌ You're already in a squad. Leave it first before founding a new one.";
  }
  return `🎖️ Squad **${tag(res.squad)}** founded — you're the leader! Others can join it from the Squad Hub.`;
}

export async function joinSquadAction(guildId: string, userId: string, name: string): Promise<string> {
  const squad = await getSquadByName(guildId, name);
  if (!squad) return `❌ No squad called "**${name}**".`;
  const result = await joinSquad(guildId, squad.id, userId);
  if (result === "already_in_squad") return "❌ You're already in a squad. Leave it first.";
  return `✅ You joined **${tag(squad)}**!`;
}

export async function leaveSquadAction(guildId: string, userId: string): Promise<string> {
  const mine = await getUserSquad(guildId, userId);
  if (!mine) return "❌ You're not in a squad.";
  const members = await getSquadMembers(mine.squad.id);
  if (mine.role === "leader" && members.length > 1) {
    const heir = members.find(m => m.userId !== userId);
    if (heir) {
      await db.update(squadMembersTable).set({ role: "leader" })
        .where(and(eq(squadMembersTable.guildId, guildId), eq(squadMembersTable.userId, heir.userId)));
      await leaveSquad(guildId, userId);
      return `👋 You left **${tag(mine.squad)}**. Leadership passed to <@${heir.userId}>.`;
    }
  }
  if (mine.role === "leader" && members.length === 1) {
    await disbandSquad(mine.squad.id);
    return `👋 You left and **${tag(mine.squad)}** was disbanded (you were the last member).`;
  }
  await leaveSquad(guildId, userId);
  return `👋 You left **${tag(mine.squad)}**.`;
}

export async function disbandSquadAction(guildId: string, userId: string): Promise<string> {
  const mine = await getUserSquad(guildId, userId);
  if (!mine) return "❌ You're not in a squad.";
  if (mine.role !== "leader") return "❌ Only the squad leader can disband it. Use Leave instead.";
  await disbandSquad(mine.squad.id);
  return `💥 Squad **${tag(mine.squad)}** disbanded.`;
}

// Squad info embed — for a named squad, or the caller's own if name omitted.
export async function buildSquadInfoEmbed(
  guildId: string, userId: string, nameOpt?: string | null,
): Promise<EmbedBuilder | { error: string }> {
  const squad = nameOpt
    ? await getSquadByName(guildId, nameOpt)
    : (await getUserSquad(guildId, userId))?.squad ?? null;
  if (!squad) {
    return { error: nameOpt ? `❌ No squad called "**${nameOpt}**".` : "❌ You're not in a squad. Create one or join one from the Squad Hub." };
  }
  const [stats, members] = await Promise.all([getSquadStats(squad.id), getSquadMembers(squad.id)]);
  const roster = members.map(m => `${m.role === "leader" ? "👑" : "•"} <@${m.userId}>`).join("\n") || "—";
  return new EmbedBuilder()
    .setTitle(`🎖️ ${tag(squad)}`)
    .setColor(0x2c3e50)
    .setDescription(squad.description ? `*${squad.description}*` : "*A squad of collectors.*")
    .addFields(
      { name: "🏅 Squad Score", value: `**${stats.score.toLocaleString()}**`, inline: true },
      { name: "👥 Members", value: `${stats.memberCount}`, inline: true },
      { name: "💰 Collection Value", value: `💠 ${stats.collectionValue.toLocaleString()}`, inline: true },
      { name: "🃏 Cards Held", value: stats.totalCards.toLocaleString(), inline: true },
      { name: "💠 Shards", value: stats.shards.toLocaleString(), inline: true },
      { name: "📦 Packs Opened", value: stats.packsOpened.toLocaleString(), inline: true },
      { name: "⚔️ Battles W/L", value: `${stats.wins} / ${stats.losses}`, inline: true },
      { name: "🔥 Cards Burned", value: stats.cardsBurned.toLocaleString(), inline: true },
      { name: "​", value: "​", inline: true },
      { name: "Roster", value: roster.slice(0, 1024), inline: false },
    )
    .setFooter({ text: "Squad Score = collection value + wins×200 + burns×5" });
}

export async function buildSquadListEmbed(guildId: string): Promise<EmbedBuilder | null> {
  const board = await getSquadLeaderboard(guildId);
  if (board.length === 0) return null;
  const medals = ["🥇", "🥈", "🥉"];
  const lines = board.map((r, i) =>
    `${medals[i] ?? `**${i + 1}.**`} **${tag(r.squad)}** — 🏅 ${r.score.toLocaleString()} · 👥 ${r.memberCount} · ⚔️ ${r.wins}W`);
  return new EmbedBuilder()
    .setTitle("🏆 Squad Leaderboard")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: "Rank by Squad Score" });
}

// List squads for pickers (join select). Reuses the leaderboard query.
export async function squadChoices(guildId: string): Promise<{ name: string; label: string; members: number }[]> {
  const board = await getSquadLeaderboard(guildId);
  return board.map(r => ({ name: r.squad.name, label: tag(r.squad).slice(0, 100), members: r.memberCount }));
}

// ── create ───────────────────────────────────────────────────────────────────
async function handleCreate(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await createSquadAction(guildId, interaction.user.id, {
    name: interaction.options.getString("name", true),
    tag: interaction.options.getString("tag"),
    description: interaction.options.getString("description"),
  }));
}

// ── join ─────────────────────────────────────────────────────────────────────
async function handleJoin(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await joinSquadAction(guildId, interaction.user.id, interaction.options.getString("name", true)));
}

// ── leave ────────────────────────────────────────────────────────────────────
async function handleLeave(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await leaveSquadAction(guildId, interaction.user.id));
}

// ── disband ──────────────────────────────────────────────────────────────────
async function handleDisband(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.editReply(await disbandSquadAction(guildId, interaction.user.id));
}

// ── info ─────────────────────────────────────────────────────────────────────
async function handleInfo(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const res = await buildSquadInfoEmbed(guildId, interaction.user.id, interaction.options.getString("name"));
  if ("error" in res) { await interaction.editReply(res.error); return; }
  await interaction.editReply({ embeds: [res] });
}

// ── list (leaderboard) ───────────────────────────────────────────────────────
async function handleList(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const embed = await buildSquadListEmbed(guildId);
  if (!embed) { await interaction.editReply("🏳️ No squads yet. Found the first from the Squad Hub!"); return; }
  await interaction.editReply({ embeds: [embed] });
}

// ── Router ───────────────────────────────────────────────────────────────────
export async function handleSquadCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Squads only work in a server.", ...EPHEMERAL }); return; }
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply(EPHEMERAL);
  switch (sub) {
    case "create": return handleCreate(interaction, guildId);
    case "join": return handleJoin(interaction, guildId);
    case "leave": return handleLeave(interaction, guildId);
    case "disband": return handleDisband(interaction, guildId);
    case "info": return handleInfo(interaction, guildId);
    case "list": return handleList(interaction, guildId);
    default: await interaction.editReply("Unknown squad action.");
  }
}
