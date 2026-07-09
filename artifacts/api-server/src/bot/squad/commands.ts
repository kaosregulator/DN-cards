import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { db, squadMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  getUserSquad, getSquadByName, createSquad, joinSquad, leaveSquad,
  disbandSquad, getSquadMembers, getSquadStats, getSquadLeaderboard,
} from "./db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

function tag(squad: { name: string; tag: string | null }): string {
  return squad.tag ? `[${squad.tag}] ${squad.name}` : squad.name;
}

// ── create ───────────────────────────────────────────────────────────────────
async function handleCreate(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const name = interaction.options.getString("name", true).trim().slice(0, 40);
  const tagOpt = interaction.options.getString("tag")?.trim().slice(0, 6) ?? null;
  const description = interaction.options.getString("description")?.trim().slice(0, 200) ?? null;
  if (name.length < 2) { await interaction.editReply("❌ Squad name must be at least 2 characters."); return; }

  const res = await createSquad({ guildId, name, ownerId: interaction.user.id, tag: tagOpt, description });
  if (!res.ok) {
    await interaction.editReply(res.reason === "name_taken"
      ? `❌ A squad called **${name}** already exists here.`
      : "❌ You're already in a squad. Leave it first with `/squad leave`.");
    return;
  }
  await interaction.editReply(`🎖️ Squad **${tag(res.squad)}** founded — you're the leader! Others join with \`/squad join name:${res.squad.name}\`.`);
}

// ── join ─────────────────────────────────────────────────────────────────────
async function handleJoin(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const name = interaction.options.getString("name", true);
  const squad = await getSquadByName(guildId, name);
  if (!squad) { await interaction.editReply(`❌ No squad called "**${name}**". See \`/squad list\`.`); return; }
  const result = await joinSquad(guildId, squad.id, interaction.user.id);
  if (result === "already_in_squad") {
    await interaction.editReply("❌ You're already in a squad. Leave it first with `/squad leave`.");
    return;
  }
  await interaction.editReply(`✅ You joined **${tag(squad)}**! See your squad with \`/squad info\`.`);
}

// ── leave ────────────────────────────────────────────────────────────────────
async function handleLeave(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const userId = interaction.user.id;
  const mine = await getUserSquad(guildId, userId);
  if (!mine) { await interaction.editReply("❌ You're not in a squad."); return; }

  const members = await getSquadMembers(mine.squad.id);
  if (mine.role === "leader" && members.length > 1) {
    // Promote the next-oldest member to leader, then leave.
    const heir = members.find(m => m.userId !== userId);
    if (heir) {
      await db.update(squadMembersTable).set({ role: "leader" })
        .where(and(eq(squadMembersTable.guildId, guildId), eq(squadMembersTable.userId, heir.userId)));
      await leaveSquad(guildId, userId);
      await interaction.editReply(`👋 You left **${tag(mine.squad)}**. Leadership passed to <@${heir.userId}>.`);
      return;
    }
  }
  if (mine.role === "leader" && members.length === 1) {
    await disbandSquad(mine.squad.id);
    await interaction.editReply(`👋 You left and **${tag(mine.squad)}** was disbanded (you were the last member).`);
    return;
  }
  await leaveSquad(guildId, userId);
  await interaction.editReply(`👋 You left **${tag(mine.squad)}**.`);
}

// ── disband ──────────────────────────────────────────────────────────────────
async function handleDisband(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const mine = await getUserSquad(guildId, interaction.user.id);
  if (!mine) { await interaction.editReply("❌ You're not in a squad."); return; }
  if (mine.role !== "leader") { await interaction.editReply("❌ Only the squad leader can disband it. Use `/squad leave` instead."); return; }
  await disbandSquad(mine.squad.id);
  await interaction.editReply(`💥 Squad **${tag(mine.squad)}** disbanded.`);
}

// ── info ─────────────────────────────────────────────────────────────────────
async function handleInfo(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const nameOpt = interaction.options.getString("name");
  const squad = nameOpt
    ? await getSquadByName(guildId, nameOpt)
    : (await getUserSquad(guildId, interaction.user.id))?.squad ?? null;
  if (!squad) {
    await interaction.editReply(nameOpt ? `❌ No squad called "**${nameOpt}**".` : "❌ You're not in a squad. Create one with `/squad create` or join with `/squad join`.");
    return;
  }
  const [stats, members] = await Promise.all([getSquadStats(squad.id), getSquadMembers(squad.id)]);
  const roster = members.map(m => `${m.role === "leader" ? "👑" : "•"} <@${m.userId}>`).join("\n") || "—";

  const embed = new EmbedBuilder()
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
  await interaction.editReply({ embeds: [embed] });
}

// ── list (leaderboard) ───────────────────────────────────────────────────────
async function handleList(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const board = await getSquadLeaderboard(guildId);
  if (board.length === 0) {
    await interaction.editReply("🏳️ No squads yet. Found the first with `/squad create name:<name>`!");
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const lines = board.map((r, i) =>
    `${medals[i] ?? `**${i + 1}.**`} **${tag(r.squad)}** — 🏅 ${r.score.toLocaleString()} · 👥 ${r.memberCount} · ⚔️ ${r.wins}W`);
  const embed = new EmbedBuilder()
    .setTitle("🏆 Squad Leaderboard")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: "Rank by Squad Score · /squad info name:<squad> for details" });
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
