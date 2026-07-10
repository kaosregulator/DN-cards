// Giveaway embeds + components. Reuses the DN Cards embed/button design
// language (raid-style live-updating messages, the shared progress `bar`, and
// Discord's native <t:unix:…> timestamps so every viewer sees the end time in
// THEIR OWN timezone with no stored preference).

import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import type {
  Giveaway, GiveawayRequirement, GiveawayPrize, GiveawayDifficulty, GiveawayWinner,
} from "@workspace/db";
import { bar } from "../battle/embeds.js";
import { getCardById } from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { overallProgressPct } from "./engine.js";

export const DIFFICULTY_META: Record<GiveawayDifficulty, { emoji: string; label: string; color: number }> = {
  easy: { emoji: "🟢", label: "Easy", color: 0x2ecc71 },
  medium: { emoji: "🔵", label: "Medium", color: 0x3498db },
  hard: { emoji: "🟠", label: "Hard", color: 0xe67e22 },
  legendary: { emoji: "🟡", label: "Legendary", color: 0xf1c40f },
};

const REQ_EMOJI: Record<string, string> = {
  catch: "🎯", burn: "🔥", pack_open: "📦", battle_win: "⚔️", battle_played: "🛡️",
  raid_join: "🐉", raid_damage: "💥", echo_use: "🔊", message: "💬",
};

const PRIZE_EMOJI: Record<string, string> = {
  cards: "🃏", pack: "📦", shards: "💠", nitro: "🚀", role: "🎭", custom: "🎁",
};

export function prizeEmoji(p: GiveawayPrize): string {
  return p.emoji ?? PRIZE_EMOJI[p.type] ?? "🎁";
}

export function reqEmoji(r: GiveawayRequirement): string {
  return r.emoji ?? REQ_EMOJI[r.type] ?? "•";
}

export function formatPrize(p: GiveawayPrize): string {
  return `${prizeEmoji(p)} ${p.label}`;
}

export function formatPrizeList(prizes: GiveawayPrize[]): string {
  if (prizes.length === 0) return "*No prizes configured yet.*";
  return prizes.map(p => `• ${formatPrize(p)}`).join("\n");
}

export function formatRequirement(r: GiveawayRequirement): string {
  const entryNote = r.entriesPerUnit
    ? ` *(+${r.entriesPerUnit}🎟️ each)*`
    : r.entriesOnComplete ? ` *(+${r.entriesOnComplete}🎟️)*` : "";
  return `${reqEmoji(r)} ${r.label}${entryNote}`;
}

// One requirement line WITH the viewer's progress bar (for /giveaway progress).
export function formatRequirementProgress(r: GiveawayRequirement, progress: Record<string, number>): string {
  const have = Math.min(progress[r.key] ?? 0, r.goal);
  const done = have >= r.goal;
  const head = `${done ? "✅" : reqEmoji(r)} **${r.label}**`;
  return `${head}\n${bar(have, r.goal, 12)} ${have}/${r.goal}`;
}

// Resolve the image to show: a custom giveaway image ALWAYS wins (so editing
// giveaway visuals never touches card data); otherwise a lone card prize lends
// its existing artwork automatically. Never requires a URL from the admin.
export async function resolveGiveawayImage(g: Giveaway): Promise<string | null> {
  if (g.imageUrl) return toAbsoluteImageUrl(g.imageUrl) ?? g.imageUrl;
  const cardPrizes = g.prizes.filter(p => p.type === "cards" && p.cardId);
  if (cardPrizes.length === 1 && cardPrizes[0]!.cardId) {
    const card = await getCardById(cardPrizes[0]!.cardId!);
    if (card?.imageUrl) return toAbsoluteImageUrl(card.imageUrl);
  }
  return null;
}

export interface GiveawayStats { entrants: number; totalEntries: number }

// The main, live-updating giveaway embed (edited in place as entrants join).
export async function buildGiveawayEmbed(g: Giveaway, stats: GiveawayStats): Promise<EmbedBuilder> {
  const d = DIFFICULTY_META[g.difficulty];
  const ends = g.endsAt ? Math.floor(g.endsAt.getTime() / 1000) : null;
  const modeLine = g.winnerMode === "completion"
    ? "Complete **every** requirement to qualify."
    : "Earn 🎟️ entries through activity — more activity, more chances.";

  const lines: string[] = [];
  if (g.description) lines.push(g.description + "\n");
  lines.push(`**🎁 Prize${g.prizes.length > 1 ? "s" : ""}**\n${formatPrizeList(g.prizes)}`);
  if (g.requirements.length > 0) {
    lines.push(`\n**📋 Requirements**\n${g.requirements.map(formatRequirement).join("\n")}`);
  }
  lines.push(`\n${modeLine}`);
  if (ends) lines.push(`\n**⏳ Ends:** <t:${ends}:R>  ·  <t:${ends}:f>`);

  const embed = new EmbedBuilder()
    .setTitle(`🎉 GIVEAWAY — ${g.title}`)
    .setColor(d.color)
    .setDescription(lines.join("\n"))
    .addFields(
      { name: "🏆 Winners", value: `${g.winnerCount}`, inline: true },
      { name: "👥 Entrants", value: `${stats.entrants}`, inline: true },
      { name: g.winnerMode === "entry" ? "🎟️ Total Entries" : "🎯 Mode", value: g.winnerMode === "entry" ? `${stats.totalEntries}` : "Completion", inline: true },
    )
    .setFooter({ text: `${d.emoji} ${d.label} · Giveaway #${g.id} · Track your progress below` });

  const img = await resolveGiveawayImage(g);
  if (img) embed.setImage(img);
  return embed;
}

export function buildGiveawayComponents(g: Giveaway): ActionRowBuilder<ButtonBuilder>[] {
  // Requirement-based giveaways enter you automatically through activity, so the
  // primary button tracks progress. Open (no-requirement) giveaways need an
  // explicit Enter button since there's no activity to measure.
  const primary = g.requirements.length > 0
    ? new ButtonBuilder().setCustomId(`giveaway:progress:${g.id}`).setLabel("My Progress").setEmoji("📊").setStyle(ButtonStyle.Primary)
    : new ButtonBuilder().setCustomId(`giveaway:enter:${g.id}`).setLabel("Enter Giveaway").setEmoji("🎟️").setStyle(ButtonStyle.Success);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    primary,
    new ButtonBuilder().setCustomId(`giveaway:info:${g.id}`).setLabel("Details").setEmoji("📋").setStyle(ButtonStyle.Secondary),
  )];
}

// The ended / winner-announcement embed — REPLACES the live embed on the SAME
// message (raid-style), then Claim buttons pop up beneath it.
export async function buildEndedEmbed(g: Giveaway, winners: GiveawayWinner[]): Promise<EmbedBuilder> {
  const d = DIFFICULTY_META[g.difficulty];
  const winnerLines = winners.length
    ? winners.map(w => `🏆 <@${w.userId}> — ${claimBadge(w)}`).join("\n")
    : "*No eligible entrants — nobody met the requirements.*";

  const embed = new EmbedBuilder()
    .setTitle(`🎊 GIVEAWAY ENDED — ${g.title}`)
    .setColor(winners.length ? 0xf1c40f : 0x95a5a6)
    .setDescription(
      `**🎁 Prize${g.prizes.length > 1 ? "s" : ""}**\n${formatPrizeList(g.prizes)}\n\n` +
      `**🏆 Winner${winners.length === 1 ? "" : "s"}**\n${winnerLines}` +
      (winners.length ? `\n\nWinners: click **Claim Prize** below to collect.` : ""),
    )
    .setFooter({ text: `${d.emoji} ${d.label} · Giveaway #${g.id}` });

  const img = await resolveGiveawayImage(g);
  if (img) embed.setImage(img);
  return embed;
}

function claimBadge(w: GiveawayWinner): string {
  switch (w.claimStatus) {
    case "claimed": return "✅ claimed";
    case "expired": return "⌛ unclaimed (rerolled)";
    case "rerolled": return "🔁 rerolled";
    default:
      return w.claimDeadline
        ? `🎁 claim by <t:${Math.floor(w.claimDeadline.getTime() / 1000)}:R>`
        : "🎁 unclaimed";
  }
}

export function buildWinnerComponents(g: Giveaway, winners: GiveawayWinner[]): ActionRowBuilder<ButtonBuilder>[] {
  const anyClaimable = winners.some(w => w.claimStatus === "pending");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:claim:${g.id}`).setLabel("Claim Prize").setEmoji("🎁")
      .setStyle(ButtonStyle.Success).setDisabled(!anyClaimable),
  );
  return [row];
}
