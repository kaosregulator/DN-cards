// Bob stats + leaderboards.

import {
  ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder,
} from "discord.js";
import { getBobProfile, getBobLeaderboard, luckPct, xpIntoLevel, activeCurse, type BobBoard } from "./db.js";
import { bobEmbed, coins } from "./ui.js";
import type { BobForm } from "./persona.js";
import type { BobProfile } from "@workspace/db";

function bar(into: number, need: number, width = 12): string {
  const filled = Math.round((into / need) * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

export async function buildStatsEmbed(guildId: string, userId: string, form: BobForm, username: string): Promise<EmbedBuilder> {
  const p = await getBobProfile(guildId, userId);
  const { into, need } = xpIntoLevel(p.xp);
  const curse = activeCurse(p);
  const embed = bobEmbed(form, `${username}'s Bob Stats`,
    `${coins(p.coins)} · **Level ${p.level}**  ${bar(into, need)}  ${into}/${need} XP` +
    (p.currentTitle ? `\n🏷️ ${p.currentTitle}` : "") +
    (curse ? `\n🌀 Cursed: ${curse}` : ""))
    .addFields(
      { name: "🎮 Games", value: `Played **${p.gamesPlayed}**\nWon **${p.wins}** · Lost **${p.losses}**\nLuck **${luckPct(p)}%**`, inline: true },
      { name: "🎲 Roulette", value: `Streak **${p.rouletteStreak}**\nBest **${p.bestRouletteStreak}**\nJackpots **${p.jackpots}**`, inline: true },
      { name: "🔥 Social", value: `Roasts **${p.roastsGiven}**\nInteractions **${p.interactions}**\nGambled **${p.coinsGambled.toLocaleString()}**`, inline: true },
      { name: "🏆 Records", value: `Biggest win **${coins(p.biggestWin)}**\nTasks done **${p.tasksCompleted}** · Quests **${p.questsCompleted}**`, inline: false },
    );
  return embed;
}

const BOARD_META: Record<BobBoard, { label: string; emoji: string; value: (p: BobProfile) => string }> = {
  coins: { label: "Richest", emoji: "🪙", value: p => coins(p.coins) },
  wins: { label: "Most Wins", emoji: "🏆", value: p => `${p.wins} wins` },
  streak: { label: "Best Roulette Streak", emoji: "🎲", value: p => `${p.bestRouletteStreak} streak` },
  interactions: { label: "Most Bob Interactions", emoji: "💬", value: p => `${p.interactions}` },
  gambled: { label: "Biggest Gamblers", emoji: "🎰", value: p => `${p.coinsGambled.toLocaleString()} gambled` },
  jackpots: { label: "Jackpot Kings", emoji: "💎", value: p => `${p.jackpots} jackpots` },
  level: { label: "Highest Level", emoji: "📈", value: p => `Level ${p.level}` },
};

const MEDALS = ["🥇", "🥈", "🥉"];

export async function buildLeaderboardEmbed(guildId: string, board: BobBoard, form: BobForm): Promise<EmbedBuilder> {
  const rows = await getBobLeaderboard(guildId, board, 10);
  const meta = BOARD_META[board];
  const body = rows.length
    ? rows.map((p, i) => `${MEDALS[i] ?? `\`#${i + 1}\``} <@${p.userId}> — **${meta.value(p)}**`).join("\n")
    : "*No one has played with Bob yet. Be the first.*";
  return bobEmbed(form, `Leaderboard — ${meta.emoji} ${meta.label}`, body);
}

export function leaderboardSelect(current: BobBoard): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder().setCustomId("bob:board:select").setPlaceholder("📊 Switch leaderboard…")
    .addOptions((Object.keys(BOARD_META) as BobBoard[]).map(b => ({
      label: BOARD_META[b].label, value: b, emoji: BOARD_META[b].emoji, default: b === current,
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
