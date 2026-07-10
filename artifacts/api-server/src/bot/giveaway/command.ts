// User giveaway commands:
//   /giveaways            → all active giveaways with prize, live countdown,
//                           requirements, and the caller's progress + entries.
//   /giveaway progress     → detailed per-requirement progress (all active, or
//                           one by id).
//
// Times use Discord's <t:unix:…> tags so each player sees them in their own
// timezone automatically — no stored preference required.

import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { getActiveGiveaways, getGiveaway, countEntrants } from "./db.js";
import { userStanding, overallProgressPct } from "./engine.js";
import {
  formatRequirement, formatRequirementProgress, DIFFICULTY_META,
} from "./embeds.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

// /giveaways — the overview board.
export async function handleGiveawaysCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply(EPHEMERAL);
  const active = await getActiveGiveaways(interaction.guild.id);
  if (active.length === 0) {
    await interaction.editReply("🎉 There are no active giveaways right now. Check back soon!");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎉 Active Giveaways")
    .setColor(0xf1c40f)
    .setFooter({ text: "Use the 📊 My Progress button on a giveaway, or /giveaway progress" });

  for (const g of active.slice(0, 8)) {
    const [stats, standing] = await Promise.all([
      countEntrants(g.id),
      userStanding(g, interaction.user.id),
    ]);
    const d = DIFFICULTY_META[g.difficulty];
    const ends = g.endsAt ? `<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>` : "—";
    const pct = overallProgressPct(g.requirements, standing.progress);
    const reqLine = g.requirements.length
      ? g.requirements.map(formatRequirement).join("\n")
      : "Open to everyone!";
    const yourLine = g.winnerMode === "completion"
      ? (standing.completed ? "✅ You qualify!" : `🚧 ${pct}% complete`)
      : `🎟️ ${standing.entries} entries · ${pct}% of goals`;
    embed.addFields({
      name: `${d.emoji} ${g.title}  (#${g.id})`,
      value:
        `**🎁 Prize:** ${g.prizes.map(p => p.label).join(", ") || "—"}\n` +
        `**📋 Requirements:**\n${reqLine}\n` +
        `**🏆 Winners:** ${g.winnerCount} · **Ends:** ${ends} · 👥 ${stats.entrants}\n` +
        `**Your standing:** ${yourLine}`,
      inline: false,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

// /giveaway progress [id]
export async function handleGiveawayUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub !== "progress") { await interaction.reply({ content: "Unknown subcommand.", ...EPHEMERAL }); return; }
  if (!interaction.guild) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply(EPHEMERAL);

  const idOpt = interaction.options.getInteger("id");
  let giveaways = idOpt
    ? [await getGiveaway(idOpt)].filter((g): g is NonNullable<typeof g> => !!g && g.guildId === interaction.guild!.id)
    : await getActiveGiveaways(interaction.guild.id);

  if (giveaways.length === 0) {
    await interaction.editReply(idOpt ? "No giveaway with that id in this server." : "There are no active giveaways right now.");
    return;
  }
  giveaways = giveaways.slice(0, 5);

  const embed = new EmbedBuilder()
    .setTitle("📊 Your Giveaway Progress")
    .setColor(0x3498db);

  for (const g of giveaways) {
    const s = await userStanding(g, interaction.user.id);
    const body = g.requirements.length
      ? g.requirements.map(r => formatRequirementProgress(r, s.progress)).join("\n\n")
      : "*Open to everyone — you're entered!*";
    const status = g.winnerMode === "completion"
      ? (s.completed ? "✅ Qualified" : "🚧 Not yet qualified")
      : `🎟️ ${s.entries} entries`;
    embed.addFields({ name: `${DIFFICULTY_META[g.difficulty].emoji} ${g.title} (#${g.id}) — ${status}`, value: body.slice(0, 1024), inline: false });
  }
  embed.setFooter({ text: "Completed requirements show ✅ · keep going for more entries!" });
  await interaction.editReply({ embeds: [embed] });
}
