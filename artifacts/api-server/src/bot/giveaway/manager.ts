// Giveaway manager — owns the live giveaway MESSAGE and every button on it.
//
// Like the co-op raid system, one channel message carries the whole giveaway:
// it updates in place while entrants join, then the SAME message is edited into
// a winner announcement with Claim buttons when it ends. All button traffic
// (progress / details / claim) is namespaced `giveaway:*` and routed here.

import {
  EmbedBuilder, MessageFlags,
  type ButtonInteraction, type Client, type TextBasedChannel, type Message,
} from "discord.js";
import type { Giveaway, GiveawayWinner } from "@workspace/db";
import {
  getGiveaway, updateGiveaway, countEntrants, listWinners, addWinners,
  getWinner, updateWinner, pastWinnerIds,
} from "./db.js";
import {
  buildGiveawayEmbed, buildGiveawayComponents, buildEndedEmbed, buildWinnerComponents,
  formatRequirementProgress, formatPrizeList, DIFFICULTY_META,
} from "./embeds.js";
import { userStanding, selectWinners, invalidateActiveCache } from "./engine.js";
import { grantPrizes } from "./prizes.js";
import { getBotClient } from "../client-holder.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

// ── Message posting / refresh ────────────────────────────────────────────────
// Post the live giveaway message into its channel and persist the ids.
export async function postGiveawayMessage(g: Giveaway, client: Client): Promise<Giveaway> {
  if (!g.channelId) return g;
  const channel = await fetchSendable(client, g.channelId);
  if (!channel) { logger.warn({ giveawayId: g.id }, "giveaway channel not sendable"); return g; }
  const stats = await countEntrants(g.id);
  const embed = await buildGiveawayEmbed(g, stats);
  const msg = await channel.send({ embeds: [embed], components: buildGiveawayComponents(g) });
  const updated = await updateGiveaway(g.id, { messageId: msg.id });
  return updated ?? g;
}

// Re-render the live embed on the existing message (best-effort).
export async function refreshGiveawayMessage(g: Giveaway, client?: Client): Promise<void> {
  const c = client ?? getBotClient();
  if (!c || !g.channelId || !g.messageId) return;
  try {
    const msg = await fetchMessage(c, g.channelId, g.messageId);
    if (!msg) return;
    if (g.status === "active") {
      const stats = await countEntrants(g.id);
      await msg.edit({ embeds: [await buildGiveawayEmbed(g, stats)], components: buildGiveawayComponents(g) });
    } else {
      const winners = await listWinners(g.id);
      await msg.edit({ embeds: [await buildEndedEmbed(g, winners)], components: buildWinnerComponents(g, winners) });
    }
  } catch (err) {
    logger.debug({ err, giveawayId: g.id }, "refreshGiveawayMessage failed");
  }
}

// ── Ending + winner selection ────────────────────────────────────────────────
// Close a giveaway: pick winners, persist them with claim deadlines, rewrite the
// message into the winner announcement, and notify (channel / DM per settings).
export async function endGiveaway(
  g: Giveaway, client: Client, opts: { manual?: boolean } = {},
): Promise<GiveawayWinner[]> {
  if (g.status !== "active") return listWinners(g.id);
  await updateGiveaway(g.id, { status: "ended", endedAt: new Date() });
  invalidateActiveCache(g.guildId);

  const winnerIds = await selectWinners(g, g.winnerCount);
  const deadline = g.claimTimerMinutes > 0
    ? new Date(Date.now() + g.claimTimerMinutes * 60_000)
    : null;
  const winners = await addWinners(winnerIds.map(userId => ({
    giveawayId: g.id, guildId: g.guildId, userId,
    claimStatus: "pending" as const, claimDeadline: deadline, prizes: g.prizes,
  })));

  const fresh = (await getGiveaway(g.id)) ?? g;
  await refreshGiveawayMessage(fresh, client);
  await announceWinners(fresh, winners, client, opts.manual ?? false);
  return winners;
}

async function announceWinners(g: Giveaway, winners: GiveawayWinner[], client: Client, manual: boolean): Promise<void> {
  if (winners.length === 0) return;
  const mode = g.announceMode;
  const mention = winners.map(w => `<@${w.userId}>`).join(", ");
  const text = `🎉 Congratulations ${mention}! You won **${g.title}**` +
    (g.claimTimerMinutes > 0 ? ` — click **Claim Prize** on the giveaway message within ${humanMinutes(g.claimTimerMinutes)}.` : `!`);

  if ((mode === "channel" || mode === "both") && g.channelId) {
    const channel = await fetchSendable(client, g.channelId);
    if (channel) await channel.send({ content: text }).catch(() => {});
  }
  if (mode === "dm" || mode === "both") {
    for (const w of winners) {
      try {
        const user = await client.users.fetch(w.userId);
        await user.send(
          `🎉 You won **${g.title}**!\n\n${formatPrizeList(g.prizes)}\n\n` +
          (g.claimTimerMinutes > 0
            ? `Head to the giveaway message and click **Claim Prize** within ${humanMinutes(g.claimTimerMinutes)}.`
            : `Head to the giveaway message and click **Claim Prize**.`),
        );
      } catch { /* DMs closed — channel announce covers it */ }
    }
  }
  void manual;
}

// ── Reroll ───────────────────────────────────────────────────────────────────
// Replace a vacated winner slot with a fresh draw, excluding everyone already
// picked. Used by /giveawayadmin reroll and by the auto-expiry sweeper.
export async function rerollWinner(
  g: Giveaway, oldWinner: GiveawayWinner, client: Client, reason: "expired" | "manual",
): Promise<GiveawayWinner | null> {
  await updateWinner(oldWinner.id, { claimStatus: reason === "expired" ? "expired" : "rerolled" });
  const exclude = await pastWinnerIds(g.id);
  const [pick] = await selectWinners(g, 1, exclude);
  if (!pick) {
    await refreshGiveawayMessage(g, client);
    return null;
  }
  const deadline = g.claimTimerMinutes > 0 ? new Date(Date.now() + g.claimTimerMinutes * 60_000) : null;
  const [winner] = await addWinners([{
    giveawayId: g.id, guildId: g.guildId, userId: pick,
    claimStatus: "pending" as const, claimDeadline: deadline, prizes: g.prizes,
  }]);
  await refreshGiveawayMessage(g, client);
  if (winner && g.channelId) {
    const channel = await fetchSendable(client, g.channelId);
    if (channel) await channel.send({ content: `🔁 Reroll! <@${winner.userId}> is the new winner of **${g.title}** — click **Claim Prize** to collect.` }).catch(() => {});
  }
  return winner ?? null;
}

// ── Button router ────────────────────────────────────────────────────────────
export async function handleGiveawayComponent(interaction: ButtonInteraction): Promise<void> {
  const [, action, idStr] = interaction.customId.split(":");
  const id = Number(idStr);
  const g = await getGiveaway(id);
  if (!g) { await interaction.reply({ content: "⌛ This giveaway no longer exists.", ...EPHEMERAL }).catch(() => {}); return; }

  switch (action) {
    case "progress": return handleProgress(interaction, g);
    case "info": return handleInfo(interaction, g);
    case "enter": return handleEnter(interaction, g);
    case "claim": return handleClaim(interaction, g);
    default:
      await interaction.reply({ content: "Unknown giveaway action.", ...EPHEMERAL }).catch(() => {});
  }
}

// Explicit entry for open (no-requirement) giveaways.
async function handleEnter(interaction: ButtonInteraction, g: Giveaway): Promise<void> {
  if (g.status !== "active") { await interaction.reply({ content: "This giveaway has already ended.", ...EPHEMERAL }); return; }
  const { getEntry, ensureEntry } = await import("./db.js");
  const existing = await getEntry(g.id, interaction.user.id);
  if (existing) { await interaction.reply({ content: "✅ You're already entered — good luck!", ...EPHEMERAL }); return; }
  await ensureEntry(g.id, g.guildId, interaction.user.id);
  await interaction.reply({ content: `🎟️ You're in! You've entered **${g.title}**. Winners are drawn when it ends.`, ...EPHEMERAL });
  const fresh = (await getGiveaway(g.id)) ?? g;
  await refreshGiveawayMessage(fresh);
}

async function handleProgress(interaction: ButtonInteraction, g: Giveaway): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  const s = await userStanding(g, interaction.user.id);
  const lines = g.requirements.length
    ? g.requirements.map(r => formatRequirementProgress(r, s.progress)).join("\n\n")
    : "*This giveaway has no requirements — everyone's entered!*";
  const embed = new EmbedBuilder()
    .setTitle(`📊 Your progress — ${g.title}`)
    .setColor(DIFFICULTY_META[g.difficulty].color)
    .setDescription(lines)
    .addFields(
      { name: "🎟️ Entries", value: `${s.entries}`, inline: true },
      { name: g.winnerMode === "completion" ? "✅ Qualified" : "Status", value: g.winnerMode === "completion" ? (s.completed ? "Yes — you qualify!" : "Not yet") : (s.completed ? "All requirements done" : "In progress"), inline: true },
    )
    .setFooter({ text: g.winnerMode === "entry" ? "More activity = more entries = better odds." : "Finish every requirement to qualify." });
  await interaction.editReply({ embeds: [embed] });
}

async function handleInfo(interaction: ButtonInteraction, g: Giveaway): Promise<void> {
  const ends = g.endsAt ? `<t:${Math.floor(g.endsAt.getTime() / 1000)}:F> (<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>)` : "—";
  const reqs = g.requirements.length
    ? g.requirements.map(r => `${r.emoji ?? "•"} ${r.label}`).join("\n")
    : "None — open to everyone.";
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${g.title}`)
    .setColor(DIFFICULTY_META[g.difficulty].color)
    .setDescription(
      `${g.description ? g.description + "\n\n" : ""}` +
      `**🎁 Prizes**\n${formatPrizeList(g.prizes)}\n\n` +
      `**📋 Requirements**\n${reqs}\n\n` +
      `**🏆 Winners:** ${g.winnerCount} · **Mode:** ${g.winnerMode === "entry" ? "Entry-based" : "Completion"}\n` +
      `**⏳ Ends:** ${ends}`,
    )
    .setFooter({ text: `${DIFFICULTY_META[g.difficulty].emoji} ${DIFFICULTY_META[g.difficulty].label} difficulty` });
  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}

async function handleClaim(interaction: ButtonInteraction, g: Giveaway): Promise<void> {
  await interaction.deferReply(EPHEMERAL);
  const winners = await listWinners(g.id);
  const mine = winners.find(w => w.userId === interaction.user.id && w.claimStatus === "pending");
  if (!mine) {
    const already = winners.find(w => w.userId === interaction.user.id && w.claimStatus === "claimed");
    await interaction.editReply(already
      ? "✅ You've already claimed your prize for this giveaway."
      : "This prize isn't yours to claim — only selected winners can claim, and each claim is one-time.");
    return;
  }
  if (mine.claimDeadline && mine.claimDeadline.getTime() < Date.now()) {
    await interaction.editReply("⌛ Your claim window has expired. The prize will be rerolled to another player.");
    return;
  }
  if (!interaction.guild) { await interaction.editReply("Claims must be made in the server."); return; }

  const result = await grantPrizes(interaction.guild, interaction.user.id, mine.prizes.length ? mine.prizes : g.prizes);
  await updateWinner(mine.id, { claimStatus: "claimed", claimedAt: new Date() });
  const fresh = (await getGiveaway(g.id)) ?? g;
  await refreshGiveawayMessage(fresh);

  const parts: string[] = ["🎁 **Prize claimed!**"];
  if (result.granted.length) parts.push(`\n**Added to your account:**\n${result.granted.map(l => `• ${l}`).join("\n")}`);
  if (result.manual.length) parts.push(`\n**An admin will hand off:**\n${result.manual.map(l => `• ${l}`).join("\n")}\nA moderator has been notified.`);
  await interaction.editReply(parts.join("\n"));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function humanMinutes(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? "" : "s"}`;
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? "" : "s"}`;
  return `${min} minute${min === 1 ? "" : "s"}`;
}

async function fetchSendable(client: Client, channelId: string): Promise<(TextBasedChannel & { send: Function }) | null> {
  try {
    const ch = client.channels.cache.get(channelId) ?? await client.channels.fetch(channelId);
    if (ch && "send" in ch && ch.isTextBased()) return ch as TextBasedChannel & { send: Function };
  } catch { /* ignore */ }
  return null;
}

async function fetchMessage(client: Client, channelId: string, messageId: string): Promise<Message | null> {
  try {
    const ch = client.channels.cache.get(channelId) ?? await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) return await (ch as any).messages.fetch(messageId);
  } catch { /* ignore */ }
  return null;
}
