// ─────────────────────────────────────────────────────────────────────────────
// Unified /top — one command, canvas render, category dropdown.
//
// Combines the three server leaderboards (Collector · Battle · Raid) behind a
// single StringSelect (mirrors the Bob leaderboard's dropdown pattern). Each
// category normalizes to rows of {userId, primary, secondary}; buildTopMessage
// resolves Discord avatars/names and hands them to the canvas renderer.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder,
  type Client,
} from "discord.js";
import { getLeaderboard, getTopPackOpeners } from "../db.js";
import { getCollectorRank } from "../cards-data.js";
import { getBattleLeaderboard, rankTitle } from "../battle/leaderboard-engine.js";
import { getRaidLeaderboard } from "../battle/db.js";
import { renderLeaderboard, LEADERBOARD_FILE, type LbRenderRow } from "./leaderboard-canvas.js";
import { logger } from "../../lib/logger.js";

export type LbCategory = "collector" | "battle" | "raid";

export const LB_CATEGORIES: { value: LbCategory; label: string; emoji: string; accent: number }[] = [
  { value: "collector", label: "Collector — Net Worth", emoji: "💎", accent: 0x74b9ff },
  { value: "battle",    label: "Battle — Ranked",       emoji: "⚔️", accent: 0xe74c3c },
  { value: "raid",      label: "Raid — Campaign",        emoji: "🐉", accent: 0xf1c40f },
];

export function isLbCategory(v: string | null | undefined): v is LbCategory {
  return v === "collector" || v === "battle" || v === "raid";
}

interface LbEntry { userId: string; primary: string; secondary: string; }
interface LbData { title: string; subtitle: string; accent: number; entries: LbEntry[]; }

async function getLeaderboardData(guildId: string, category: LbCategory): Promise<LbData> {
  const meta = LB_CATEGORIES.find(c => c.value === category)!;
  if (category === "battle") {
    const rows = await getBattleLeaderboard(guildId, "rank", 10);
    return {
      title: "Battle Leaderboard", subtitle: "Ranked · by rank points", accent: meta.accent,
      entries: rows.map(p => ({
        userId: p.userId,
        primary: p.rankPoints.toLocaleString(),
        secondary: `${rankTitle(p.rankPoints).name} · ${p.wins}W/${p.losses}L · ${p.currentStreak} streak`,
      })),
    };
  }
  if (category === "raid") {
    const rows = await getRaidLeaderboard(guildId, 10);
    return {
      title: "Raid Leaderboard", subtitle: "Campaign · by raids won", accent: meta.accent,
      entries: rows.map(p => ({
        userId: p.userId,
        primary: `${p.raidsWon.toLocaleString()} won`,
        secondary: `${p.soloRaidsWon} solo · ${p.raidsSurvived} survived · ${p.raidDamageDealt.toLocaleString()} dmg`,
      })),
    };
  }
  // collector
  const [byWorth, packs] = await Promise.all([
    getLeaderboard(guildId, "worth", 10),
    getTopPackOpeners(guildId, 10),
  ]);
  const packByUser = new Map(packs.map(p => [p.userId, p.packsOpened]));
  return {
    title: "Collector Leaderboard", subtitle: "by total collection net worth", accent: meta.accent,
    entries: byWorth.map(r => ({
      userId: r.userId,
      primary: r.netWorth.toLocaleString(),
      secondary: `${getCollectorRank(r.uniqueCards).name} · ${r.totalCards} cards` +
        (packByUser.get(r.userId) ? ` · ${packByUser.get(r.userId)} packs` : ""),
    })),
  };
}

// Resolve a Discord display name + avatar for each entry (best-effort; falls
// back to a generic name/avatar so one failed fetch never blanks the board).
async function resolveRows(client: Client, entries: LbEntry[]): Promise<LbRenderRow[]> {
  return Promise.all(entries.map(async (e, i) => {
    let name = `Player`, avatarUrl: string | null = null;
    try {
      const u = await client.users.fetch(e.userId);
      name = u.username;
      avatarUrl = u.displayAvatarURL({ extension: "png", size: 128 });
    } catch { /* left as fallback */ }
    return { rank: i + 1, name, avatarUrl, primary: e.primary, secondary: e.secondary };
  }));
}

function categorySelect(current: LbCategory): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("top:cat").setPlaceholder("🏆 Switch leaderboard…")
      .addOptions(LB_CATEGORIES.map(c => ({
        label: c.label, value: c.value, emoji: c.emoji, default: c.value === current,
      }))),
  );
}

// Build the full /top message (canvas + dropdown) for a category. Used by the
// command and the dropdown handler. Falls back to a text embed if the canvas
// can't render.
export async function buildTopMessage(client: Client, guildId: string, category: LbCategory) {
  const data = await getLeaderboardData(guildId, category);
  const rows = await resolveRows(client, data.entries);
  const components = [categorySelect(category)];

  const img = await renderLeaderboard({
    title: data.title, subtitle: data.subtitle, accent: data.accent, rows,
  }).catch(() => null);

  if (img) {
    const embed = new EmbedBuilder().setColor(data.accent).setImage(`attachment://${LEADERBOARD_FILE}`);
    return { embeds: [embed], files: [new AttachmentBuilder(img, { name: LEADERBOARD_FILE })], components };
  }
  // Text fallback.
  const lines = rows.length
    ? rows.map(r => `**#${r.rank}** ${r.name} — **${r.primary}** · ${r.secondary}`).join("\n")
    : "_No entries yet._";
  const embed = new EmbedBuilder().setColor(data.accent).setTitle(`🏆 ${data.title}`)
    .setDescription(`${data.subtitle}\n\n${lines}`.slice(0, 4000));
  return { embeds: [embed], files: [], components };
}

// Dropdown handler (customId "top:cat").
export async function handleTopSelect(interaction: import("discord.js").StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const category = interaction.values[0];
  if (!isLbCategory(category)) { await interaction.deferUpdate().catch(() => {}); return; }
  await interaction.deferUpdate().catch(() => {});
  try {
    const msg = await buildTopMessage(interaction.client, interaction.guild.id, category);
    await interaction.editReply(msg).catch(() => {});
  } catch (err) {
    logger.debug({ err }, "top select re-render failed");
  }
}
