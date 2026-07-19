// ─────────────────────────────────────────────────────────────────────────────
// Recycle Card Generator — interactive /recycle hub (Card Progression Hub).
//
// Three actions per selected card:
//   ♻️  Recycle  — converts all spendable dupes into Scrap (⚙️) currency.
//   🌟  Fuse All — consumes all spendable dupes as XP, leveling the card.
//   ⬆️  Ascend   — only at Level 100 & star < 5; resets level, bumps star.
//
// Reuses the existing animation engine, card reveal rendering, and star helpers.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction, ModalSubmitInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder,
  ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import {
  getCanvas, hexToRgba, roundRectPath, drawGradientBackground, type Ctx, type CanvasMod, type FrameCtx,
  lerp, easeInOutCubic, easeOutBack, clamp01,
  encodeAnimation,
} from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawRarityBadge, drawTextWithShadow,
  drawTitle, fitText, getRarityEffectColor, TITLE_FONT,
} from "../animations/effects.js";
import { drawSparks, drawEmbers, drawExplosion } from "../animations/particles.js";
import { queueRender } from "../animations/render-queue.js";
import { renderCardReveal } from "../animations/reveal.js";
import type { RenderCard } from "../battle/image/render.js";
import {
  getAllCardsCached, getOrCreateGuildSettings, getRarityContext, getRarityDisplayOverrides,
  getCardDisplayRarity, getUserCollection, getCardById, getActiveSet, getCardsInSet,
  getOrCreateCurrency, addScrap, getScrap,
} from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import {
  recycleForScrap, fuseCard, ascendCard, scrapValueForCard, fuseXpPerCopy,
  starRankString, MAX_STAR, getCardProgressBatch, mergeAllRecycle,
  spendScrapForXp, scrapToXpRate, getRecycleSettings, type RecycleSettings,
} from "./stars.js";
import { getCardProgress, levelProgress, levelFromXp, MAX_LEVEL } from "./leveling.js";
import type { Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const HUB_CANVAS = { width: 1000, height: 540 } as const;
const CARD_CANVAS = { width: 520, height: 660 } as const;
const RECYCLE_MORPH_FILE = "recycle-morph.gif";
const RECYCLE_HUB_FILE = "recycle-hub.png";
const RECYCLE_CARD_FILE = "recycle-card.png";
const RECYCLE_ANIM_FILE = "recycle-anim.gif";

// Minimum duplicates required to recycle/fuse.
const MIN_DUPLICATES = 1; // any dupe (count > 1) is now eligible

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface RecycleCardEntry {
  cardId: number;
  name: string;
  rarity: Rarity;
  rarityLabel: string;
  rarityColor: number | null;
  cardType: string | null;
  imageUrl: string | null;
  count: number;
  worthValue: number;
  star: number;
  level: number;
  xp: number;
}

// ── Data helpers ─────────────────────────────────────────────────────────────

async function getActiveSetCardIds(guildId: string): Promise<Set<number> | null> {
  const set = await getActiveSet(guildId);
  if (!set) return null;
  const cards = await getCardsInSet(set.id, guildId);
  return new Set(cards.map(c => c.id));
}

async function loadRecycleCandidates(guildId: string, userId: string, limit = 5): Promise<RecycleCardEntry[]> {
  const [collection, ctx, settings, displayMap, progressMap, activeIds] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getCardProgressBatch(guildId, userId),
    getActiveSetCardIds(guildId),
  ]);
  const withDisplay = collection.map(c => ({ ...c, display: getCardDisplayRarity(c, ctx, settings, displayMap) }));
  const eligible = withDisplay
    .filter(c => c.count > 1 && (activeIds === null || activeIds.has(c.id)))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
  return eligible.map(c => {
    const prog = progressMap.get(c.id);
    return {
      cardId: c.id,
      name: c.name,
      rarity: c.rarity as Rarity,
      rarityLabel: c.display.label,
      rarityColor: c.display.color,
      cardType: c.cardType,
      imageUrl: c.imageUrl,
      count: c.count,
      worthValue: c.worthValue,
      star: prog?.starRank ?? 0,
      level: prog?.level ?? 1,
      xp: prog?.xp ?? 0,
    };
  });
}

async function loadUserRecycleCards(guildId: string, userId: string, limit = 25): Promise<RecycleCardEntry[]> {
  const [collection, ctx, settings, displayMap, progressMap, activeIds] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getCardProgressBatch(guildId, userId),
    getActiveSetCardIds(guildId),
  ]);
  const owned = collection
    .filter(c => c.count > 0 && (activeIds === null || activeIds.has(c.id)))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return owned.slice(0, limit).map(c => {
    const display = getCardDisplayRarity(c, ctx, settings, displayMap);
    const prog = progressMap.get(c.id);
    return {
      cardId: c.id,
      name: c.name,
      rarity: c.rarity as Rarity,
      rarityLabel: display.label,
      rarityColor: display.color,
      cardType: c.cardType,
      imageUrl: c.imageUrl,
      count: c.count,
      worthValue: c.worthValue,
      star: prog?.starRank ?? 0,
      level: prog?.level ?? 1,
      xp: prog?.xp ?? 0,
    };
  });
}

function cardSelectMenu(cards: RecycleCardEntry[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = cards.map(c => ({
    label: `${starRankString(c.star)} ${c.name}`.slice(0, 100),
    description: `Lv ${c.level} · ×${c.count} copies`.slice(0, 100),
    value: String(c.cardId),
  }));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("recycle:search")
      .setPlaceholder("🔍 Pick a card to view…")
      .setOptions(options.length ? options : [{ label: "No cards", value: "__none__", description: "Collection empty" }])
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(options.length === 0),
  );
}

async function loadSingleRecycleCard(guildId: string, userId: string, cardId: number): Promise<RecycleCardEntry | null> {
  const [collection, ctx, settings, displayMap, progress, activeIds] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getCardProgress(guildId, userId, cardId).catch(() => null),
    getActiveSetCardIds(guildId),
  ]);
  const row = collection.find(c => c.id === cardId);
  if (!row || (activeIds !== null && !activeIds.has(cardId))) return null;
  const display = getCardDisplayRarity(row, ctx, settings, displayMap);
  return {
    cardId: row.id,
    name: row.name,
    rarity: row.rarity as Rarity,
    rarityLabel: display.label,
    rarityColor: display.color,
    cardType: row.cardType,
    imageUrl: row.imageUrl,
    count: row.count,
    worthValue: row.worthValue,
    star: progress?.starRank ?? 0,
    level: progress?.level ?? 1,
    xp: progress?.xp ?? 0,
  };
}

// ── Canvas helpers ───────────────────────────────────────────────────────────

async function cardToRenderCard(entry: RecycleCardEntry): Promise<RenderCard> {
  return {
    name: entry.name,
    rarity: entry.rarity,
    rarityLabel: entry.rarityLabel,
    rarityColor: entry.rarityColor,
    cardId: entry.cardId,
    cardType: entry.cardType,
    artUrl: toAbsoluteImageUrl(entry.imageUrl),
  };
}

/** Draw a simple 5-pointed star polygon centered at (cx,cy). */
function starPath(ctx: Ctx, cx: number, cy: number, outerR: number, innerR: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Draw a horizontal XP progress bar. */
function drawXpBar(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  into: number, needed: number,
  color: number,
): void {
  const pct = needed > 0 ? Math.min(1, into / needed) : 1;
  ctx.save();
  // Track
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fill();
  // Fill
  if (pct > 0) {
    ctx.fillStyle = hexToRgba(color, 0.9);
    roundRectPath(ctx, x, y, Math.max(h, w * pct), h, h / 2);
    ctx.fill();
  }
  // Border
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.stroke();
  ctx.restore();
}

// ── Hub canvas: top duplicate cards ─────────────────────────────────────────

export async function renderRecycleHubCanvas(
  guildId: string, userId: string, cards: RecycleCardEntry[],
): Promise<{ buffer: Buffer; color: number } | null> {
  return queueRender("recycle-hub", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const { width, height } = HUB_CANVAS;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const accent = 0x2ecc71;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(accent, 0.35)],
        [0.55, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      drawTitle(ctx, "♻️ CARD PROGRESSION HUB", width / 2, 44, "#ffffff", 34);
      drawTextWithShadow(ctx, "Recycle · Fuse · Ascend your duplicate cards", width / 2, 78, "#aab0c0", 18);

      const shown = cards.slice(0, 5);
      const cw = 150, ch = 200;
      const gap = 24;
      const totalW = shown.length * cw + (shown.length - 1) * gap;
      const startX = (width - totalW) / 2;
      const y = 110;

      for (let i = 0; i < shown.length; i++) {
        const c = shown[i]!;
        const x = startX + i * (cw + gap);
        const color = c.rarityColor ?? getRarityEffectColor(c.rarity);
        drawRarityGlow(ctx, x, y, cw, ch, color, 0.55);
        await drawCardArt(ctx, mod, x, y, cw, ch, toAbsoluteImageUrl(c.imageUrl));
        drawCardFrame(ctx, x, y, cw, ch, color, 5);
        drawRarityBadge(ctx, x + cw - 10, y + 10, c.rarityLabel, color);
        drawTextWithShadow(ctx, `#${i + 1}`, x + 14, y + 18, "#ffffff", 16);

        const labelY = y + ch + 24;
        drawTextWithShadow(ctx, c.name, x + cw / 2, labelY, "#ffffff", fitText(ctx, c.name, cw + 20, 15, 11, TITLE_FONT));
        drawTextWithShadow(ctx, starRankString(c.star), x + cw / 2, labelY + 20, "#ffd54a", 17);
        drawTextWithShadow(ctx, `Lv ${c.level} · ×${c.count}`, x + cw / 2, labelY + 40, "#aab0c0", 14);
      }

      if (shown.length === 0) {
        drawTextWithShadow(ctx, "No duplicate cards yet — collect more!", width / 2, height / 2, "#aab0c0", 20);
      }

      return { buffer: await canvas.encode("png"), color: accent };
    } catch (err) {
      logger.debug({ err, guildId, userId }, "renderRecycleHubCanvas failed");
      return null;
    }
  });
}

// ── Selected card canvas (full progression overlay) ──────────────────────────

export async function renderRecycleSelectedCanvas(
  guildId: string, _userId: string, entry: RecycleCardEntry,
): Promise<{ buffer: Buffer; color: number } | null> {
  const card = await cardToRenderCard(entry);
  const revealBuffer = await renderCardReveal({ card, stats: null, info: null, shiny: false, index: 1, total: 1 });
  if (!revealBuffer) return null;
  const settings = await getRecycleSettings(guildId);

  return queueRender("recycle-card", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const { width, height } = CARD_CANVAS;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const art = await mod.loadImage(revealBuffer);
      ctx.drawImage(art, 0, 0, width, height);

      const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
      const panelH = 170;
      const panelY = height - 16 - panelH;
      const px = 28, pw = width - 56;

      // Dark backdrop
      ctx.save();
      ctx.fillStyle = "rgba(8,10,16,0.88)";
      roundRectPath(ctx, px, panelY, pw, panelH, 16);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRgba(color, 0.85);
      roundRectPath(ctx, px, panelY, pw, panelH, 16);
      ctx.stroke();
      ctx.restore();

      // Row 1: star rank + level
      const row1Y = panelY + 24;
      drawTextWithShadow(ctx, starRankString(entry.star), px + pw * 0.28, row1Y, "#ffd54a", 22, "center");
      const atMax = entry.level >= MAX_LEVEL;
      const levelStr = atMax ? `Level ${MAX_LEVEL} ✓ MAX` : `Level ${entry.level} / ${MAX_LEVEL}`;
      drawTextWithShadow(ctx, levelStr, px + pw * 0.72, row1Y, "#ffffff", 18, "center");

      // Row 2: XP bar
      const barY = panelY + 44;
      const barH = 10;
      const barX = px + 16, barW = pw - 32;
      const prog = levelProgress(entry.xp, entry.level);
      drawXpBar(ctx, barX, barY, barW, barH, prog.into, prog.needed, color);
      const xpStr = atMax ? "MAX LEVEL" : `${prog.into.toLocaleString()} / ${prog.needed.toLocaleString()} XP`;
      drawTextWithShadow(ctx, xpStr, px + pw / 2, barY + barH + 14, "#aab0c0", 13, "center");

      // Row 3: copies + spendable
      const row3Y = panelY + 84;
      const spendable = Math.max(0, entry.count - 1);
      drawTextWithShadow(ctx, `×${entry.count} owned  ·  ${spendable} spendable duplicate${spendable !== 1 ? "s" : ""}`, px + pw / 2, row3Y, "#ffffff", 15, "center");

      // Row 4: economy preview (recycle + fuse)
      const row4Y = panelY + 108;
      const scrapPer = scrapValueForCard(entry.rarity, entry.worthValue, settings);
      const totalScrap = spendable * scrapPer;
      const fuseXp = spendable * fuseXpPerCopy(entry.rarity, settings);
      const scrapStr = spendable > 0 ? `♻️ +${totalScrap.toLocaleString()} ⚙️` : "No dupes to recycle";
      const fuseStr  = spendable > 0 && !atMax ? `🌟 +${fuseXp.toLocaleString()} XP` : "";
      const fullStr = fuseStr ? `${scrapStr}  |  ${fuseStr}` : scrapStr;
      drawTextWithShadow(ctx, fullStr, px + pw / 2, row4Y, "#a8e6cf", 13, "center");

      // Row 5: scrap→XP hint
      const row5Y = panelY + 130;
      const rate = scrapToXpRate(settings);
      const rateStr = rate === 1 ? "1 ⚙️ = 1 XP" : `${rate.toFixed(2)} ⚙️ = 1 XP`;
      drawTextWithShadow(ctx, `⚙️ Spend Scrap on this card · ${rateStr}`, px + pw / 2, row5Y, "#74b9ff", 12, "center");

      // Row 6: Ascend hint
      const row6Y = panelY + 152;
      if (entry.level >= MAX_LEVEL && entry.star < MAX_STAR) {
        drawTextWithShadow(ctx, "⬆️ ASCEND READY — reset to Lv 1, gain a ★", px + pw / 2, row6Y, "#ffd54a", 13, "center");
      }

      return { buffer: await canvas.encode("png"), color };
    } catch (err) {
      logger.debug({ err, cardId: entry.cardId }, "renderRecycleSelectedCanvas overlay failed; falling back");
      return { buffer: revealBuffer, color: entry.rarityColor ?? getRarityEffectColor(entry.rarity) };
    }
  });
}

// ── Scrap animation (card shatters → ⚙️ scrap) ──────────────────────────────

export async function renderRecycleScrapAnimation(
  _guildId: string, _userId: string, entry: RecycleCardEntry, scrapEarned: number,
): Promise<AnimationResult | null> {
  const card = await cardToRenderCard(entry);
  const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
  const scrapColor = 0x64d4a4;
  const { width, height } = CARD_CANVAS;

  return encodeAnimation({
    width,
    height,
    speed: "normal",
    durationMs: 1800,
    maxFrames: 28,
    quality: 18,
    renderScale: 0.75,
    render: async (frame: FrameCtx) => {
      const { ctx, t, mod } = frame;
      const cx = width / 2, cy = height / 2;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(color, 0.3)],
        [0.5, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      const shatterT = easeInOutCubic(clamp01(t / 0.6));
      const rewardT  = easeOutBack(clamp01((t - 0.5) / 0.5));
      const cardAlpha = 1 - shatterT;

      // Phase 1: card shakes then shatters outward
      if (cardAlpha > 0.02) {
        const scale = lerp(1, 0.5, shatterT);
        const cw = 280 * scale, ch = 280 * scale;
        const shakeX = t < 0.3 ? Math.sin(t * 80) * 6 * (1 - t / 0.3) : 0;
        ctx.save();
        ctx.globalAlpha = cardAlpha;
        drawRarityGlow(ctx, cx - cw / 2 + shakeX, cy - ch / 2 - 40, cw, ch, color, 0.7 + shatterT * 0.5);
        await drawCardArt(ctx, mod, cx - cw / 2 + shakeX, cy - ch / 2 - 40, cw, ch, card.artUrl);
        drawCardFrame(ctx, cx - cw / 2 + shakeX, cy - ch / 2 - 40, cw, ch, color, 6);
        ctx.restore();
      }

      // Fragment shards scatter
      if (t > 0.25) {
        const fragT = clamp01((t - 0.25) / 0.5);
        const rng = (n: number) => ((Math.sin(n * 73.1) * 31337) % 1 + 1) % 1;
        for (let i = 0; i < 14; i++) {
          const angle = rng(i) * Math.PI * 2;
          const dist = lerp(0, 160 + rng(i + 50) * 80, fragT);
          const fx = cx + Math.cos(angle) * dist;
          const fy = cy + Math.sin(angle) * dist - 40;
          const sz = lerp(18 + rng(i + 20) * 14, 4, fragT);
          const alpha = lerp(0.9, 0, clamp01(fragT - 0.4) / 0.6);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = hexToRgba(color, 0.8);
          ctx.beginPath();
          ctx.moveTo(fx, fy - sz / 2);
          ctx.lineTo(fx + sz * 0.6, fy + sz / 2);
          ctx.lineTo(fx - sz * 0.6, fy + sz / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // Particles
      drawEmbers(ctx, 0, height * 0.3, width, height * 0.7, {
        color: scrapColor, count: 22, seed: `scrap-embers-${entry.cardId}`,
      });
      if (t > 0.4) {
        drawSparks(ctx, cx, cy - 40, {
          color: scrapColor, count: 18, maxLen: 90, seed: `scrap-sparks-${entry.cardId}`,
        });
      }
      if (t > 0.65) {
        drawExplosion(ctx, cx, cy - 40, {
          color: scrapColor, radius: 80, ringCount: 2, seed: `scrap-boom-${entry.cardId}`,
        });
      }

      // Phase 2: scrap reward pulses in
      if (rewardT > 0.02) {
        ctx.save();
        ctx.globalAlpha = rewardT;
        const sz = lerp(24, 72, rewardT);
        ctx.shadowColor = hexToRgba(scrapColor, 1);
        ctx.shadowBlur = 24 + rewardT * 20;
        drawTitle(ctx, `⚙️ +${scrapEarned.toLocaleString()}`, cx, cy + 60, hexToRgba(scrapColor, 1), sz);
        drawTextWithShadow(ctx, "Scrap earned", cx, cy + 100, "#ffffff", 20);
        ctx.restore();
      }

      drawTextWithShadow(ctx, `♻️  ${entry.name}`, cx, 36, "#ffffff", 22);
    },
  });
}

// ── Fuse animation (dupes fly in → level-up glow) ────────────────────────────

export async function renderFuseAnimation(
  _guildId: string, _userId: string, entry: RecycleCardEntry,
  oldLevel: number, newLevel: number, xpGained: number,
): Promise<AnimationResult | null> {
  const card = await cardToRenderCard(entry);
  const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
  const fuseColor = 0x74b9ff;
  const { width, height } = CARD_CANVAS;

  return encodeAnimation({
    width,
    height,
    speed: "normal",
    durationMs: 2000,
    maxFrames: 30,
    quality: 18,
    renderScale: 0.75,
    render: async (frame: FrameCtx) => {
      const { ctx, t, mod } = frame;
      const cx = width / 2, cy = height / 2;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(fuseColor, 0.25)],
        [0.5, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      // Main card — glows brighter as orbs fly in
      const glowStrength = lerp(0.5, 1.4, clamp01(t / 0.7));
      const cw = 260, ch = 260;
      drawRarityGlow(ctx, cx - cw / 2, cy - ch / 2 - 30, cw, ch, color, glowStrength);
      await drawCardArt(ctx, mod, cx - cw / 2, cy - ch / 2 - 30, cw, ch, card.artUrl);
      drawCardFrame(ctx, cx - cw / 2, cy - ch / 2 - 30, cw, ch, color, 6);

      // Orbiting duplicate orbs fly toward center
      const orbCount = Math.min(6, Math.max(2, Math.round(entry.count / 2)));
      for (let i = 0; i < orbCount; i++) {
        const startAngle = (i / orbCount) * Math.PI * 2;
        const flyT = clamp01((t - i * 0.08) / 0.55);
        if (flyT <= 0) continue;
        const dist = lerp(210 + (i % 3) * 30, 0, easeInOutCubic(flyT));
        const angle = startAngle + flyT * Math.PI * 0.3;
        const ox = cx + Math.cos(angle) * dist;
        const oy = (cy - 30) + Math.sin(angle) * dist * 0.7;
        const r = lerp(18, 4, flyT);
        const alpha = lerp(0.9, 0, clamp01((flyT - 0.8) / 0.2));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = hexToRgba(fuseColor, 1);
        ctx.shadowBlur = 14 + (1 - flyT) * 10;
        ctx.fillStyle = hexToRgba(fuseColor, 0.9);
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      drawEmbers(ctx, 0, 0, width, height, {
        color: fuseColor, count: 20, seed: `fuse-embers-${entry.cardId}`,
      });

      // Level-up text burst after t=0.65
      const lvlT = clamp01((t - 0.65) / 0.35);
      if (lvlT > 0.02) {
        const leveledUp = newLevel > oldLevel;
        ctx.save();
        ctx.globalAlpha = lvlT;
        if (leveledUp) {
          const sz = lerp(16, 52, easeOutBack(lvlT));
          drawTitle(ctx, `⬆ Level ${newLevel}`, cx, cy + 160, "#ffd54a", sz);
          drawTextWithShadow(ctx, `+${xpGained.toLocaleString()} XP`, cx, cy + 200, "#74b9ff", 22);
        } else {
          drawTitle(ctx, `+${xpGained.toLocaleString()} XP`, cx, cy + 160, "#74b9ff", 40);
          drawTextWithShadow(ctx, `Level ${newLevel}`, cx, cy + 204, "#ffffff", 20);
        }
        ctx.restore();
      }

      drawTextWithShadow(ctx, `🌟  Fusing ${entry.name}`, cx, 36, "#ffffff", 22);
    },
  });
}

// ── Ascend animation (card erupts → new star bursts in) ──────────────────────

export async function renderAscendAnimation(
  _guildId: string, _userId: string, entry: RecycleCardEntry, fromStar: number, toStar: number,
): Promise<AnimationResult | null> {
  const card = await cardToRenderCard(entry);
  const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
  const starColor = 0xffd54a;
  const { width, height } = CARD_CANVAS;

  return encodeAnimation({
    width,
    height,
    speed: "normal",
    durationMs: 2800,
    maxFrames: 40,
    quality: 18,
    renderScale: 0.75,
    render: async (frame: FrameCtx) => {
      const { ctx, t, mod } = frame;
      const cx = width / 2, cy = height / 2;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(starColor, 0.3)],
        [0.5, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      // Phase 1: white-out flash + card appears
      const flashA = t < 0.1 ? t / 0.1 : t < 0.3 ? 1 - (t - 0.1) / 0.2 : 0;
      const cardT = easeOutBack(clamp01((t - 0.1) / 0.45));
      const cw = 260 * cardT, ch = 260 * cardT;

      if (cw > 4) {
        drawRarityGlow(ctx, cx - cw / 2, cy - ch / 2 - 40, cw, ch, color, 0.6 + cardT * 0.6);
        await drawCardArt(ctx, mod, cx - cw / 2, cy - ch / 2 - 40, cw, ch, card.artUrl);
        drawCardFrame(ctx, cx - cw / 2, cy - ch / 2 - 40, cw, ch, color, 6);
      }

      // White flash overlay
      if (flashA > 0) {
        ctx.save();
        ctx.globalAlpha = flashA * 0.6;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      // Particles
      drawEmbers(ctx, 0, 0, width, height, {
        color: starColor, count: 28, seed: `ascend-embers-${entry.cardId}`,
      });
      if (t > 0.3) {
        drawExplosion(ctx, cx, cy - 40, {
          color: starColor, radius: 100 * clamp01((t - 0.3) / 0.4), ringCount: 3,
          seed: `ascend-boom-${entry.cardId}`,
        });
      }

      // Stars fill in one by one after t=0.45
      const starsRevealT = clamp01((t - 0.45) / 0.55);
      if (starsRevealT > 0) {
        const starSpacing = 56;
        const totalW = MAX_STAR * starSpacing;
        const starStartX = cx - totalW / 2 + starSpacing / 2;
        const starY = cy + 130;

        for (let i = 0; i < MAX_STAR; i++) {
          const isFilled = i < toStar;
          const isNew = i === toStar - 1;
          const starReveal = clamp01((starsRevealT * MAX_STAR - i));
          const sx = starStartX + i * starSpacing;

          if (isNew && starReveal > 0) {
            // New star bursts in with extra glow
            const sz = lerp(0, 28, easeOutBack(clamp01(starReveal * 2)));
            ctx.save();
            ctx.globalAlpha = Math.min(1, starReveal);
            ctx.shadowColor = hexToRgba(starColor, 1);
            ctx.shadowBlur = 20 + (1 - clamp01(starReveal - 0.5)) * 30;
            ctx.fillStyle = hexToRgba(starColor, 1);
            starPath(ctx, sx, starY, sz, sz * 0.42);
            ctx.fill();
            ctx.restore();
          } else if (isFilled && starReveal > 0) {
            const sz = 22 * Math.min(1, starReveal);
            ctx.save();
            ctx.globalAlpha = Math.min(1, starReveal);
            ctx.fillStyle = hexToRgba(starColor, 0.95);
            starPath(ctx, sx, starY, sz, sz * 0.42);
            ctx.fill();
            ctx.restore();
          } else {
            // Unfilled (hollow)
            const sz = 20 * Math.min(1, starsRevealT * 3);
            if (sz > 1) {
              ctx.save();
              ctx.globalAlpha = 0.35 * Math.min(1, starsRevealT * 3);
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 2;
              starPath(ctx, sx, starY, sz, sz * 0.42);
              ctx.stroke();
              ctx.restore();
            }
          }
        }

        // "Level 1" reset label
        if (starsRevealT > 0.6) {
          const labelA = clamp01((starsRevealT - 0.6) / 0.4);
          ctx.save();
          ctx.globalAlpha = labelA;
          drawTextWithShadow(ctx, "Lv 1 (Reset)", cx, starY + 44, "#aab0c0", 16);
          ctx.restore();
        }
      }

      drawTextWithShadow(ctx, `${starRankString(fromStar)}  →  ${starRankString(toStar)}`, cx, 36, "#ffd54a", 26);
      drawTitle(ctx, `⬆️  ${entry.name}`, cx, 70, "#ffffff", 20);
    },
  });
}

// ── Legacy morph animation (kept for old recycle:do compat) ──────────────────

export async function renderRecycleMorphAnimation(
  _guildId: string, _userId: string, entry: RecycleCardEntry, fromStar: number, toStar: number,
): Promise<AnimationResult | null> {
  const card = await cardToRenderCard(entry);
  const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
  const starColor = 0xffd54a;
  const { width, height } = CARD_CANVAS;

  return encodeAnimation({
    width, height, speed: "normal", durationMs: 1600, maxFrames: 24, quality: 18, renderScale: 0.75,
    render: async (frame: FrameCtx) => {
      const { ctx, t, mod } = frame;
      const cx = width / 2, cy = height / 2;
      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(color, 0.35)], [0.5, "#0c0e14"], [1, "#070810"],
      ], 0.3);
      const morphT = easeInOutCubic(clamp01(t / 0.55));
      const starT = easeOutBack(clamp01((t - 0.45) / 0.55));
      const cardAlpha = 1 - morphT;
      if (cardAlpha > 0.02) {
        const scale = lerp(1, 0.6, morphT);
        const cw = 300 * scale, ch = 300 * scale;
        const cx2 = cx - cw / 2, cy2 = 66 + (150 - ch / 2) * morphT;
        ctx.save();
        ctx.globalAlpha = cardAlpha;
        drawRarityGlow(ctx, cx2, cy2, cw, ch, color, 0.8 + morphT * 0.4);
        await drawCardArt(ctx, mod, cx2, cy2, cw, ch, card.artUrl);
        drawCardFrame(ctx, cx2, cy2, cw, ch, color, 6);
        ctx.restore();
      }
      drawEmbers(ctx, 0, height * 0.4, width, height * 0.6, { color: starColor, count: 18, seed: `recycle-embers-${entry.cardId}` });
      if (t > 0.35) drawSparks(ctx, cx, height * 0.45, { color: starColor, count: 16, maxLen: 80, seed: `recycle-sparks-${entry.cardId}` });
      if (t > 0.6) drawExplosion(ctx, cx, height * 0.45, { color: starColor, radius: 70, ringCount: 2, seed: `recycle-boom-${entry.cardId}` });
      if (starT > 0.02) {
        const outerR = lerp(30, 120, starT);
        const innerR = outerR * 0.42;
        ctx.save(); ctx.globalAlpha = starT;
        ctx.shadowColor = hexToRgba(starColor, 1); ctx.shadowBlur = 30 + starT * 30;
        ctx.fillStyle = hexToRgba(starColor, 0.95);
        starPath(ctx, cx, cy, outerR, innerR); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4;
        starPath(ctx, cx, cy, outerR, innerR); ctx.stroke(); ctx.restore();
        drawTitle(ctx, `${starRankString(toStar)}`, cx, cy + outerR + 46, "#ffd54a", 34);
        drawTextWithShadow(ctx, entry.name, cx, cy + outerR + 80, "#ffffff", fitText(ctx, entry.name, width - 80, 22, 14, TITLE_FONT));
      }
      drawTextWithShadow(ctx, `${starRankString(fromStar)}  →  ${starRankString(toStar)}`, cx, 36, "#ffffff", 24);
    },
  });
}

// ── Message builders ─────────────────────────────────────────────────────────

export async function buildRecycleHubMessage(guildId: string, userId: string) {
  const [cards, collection, scrap, settings] = await Promise.all([
    loadRecycleCandidates(guildId, userId, 5),
    loadUserRecycleCards(guildId, userId, 25),
    getScrap(guildId, userId),
    getRecycleSettings(guildId),
  ]);

  const footerLines = [`⚙️ Scrap: ${scrap.toLocaleString()}`];
  if (settings.scrapMultiplier !== 1) footerLines.push(`Scrap multiplier: ${Math.round(settings.scrapMultiplier * 100)}%`);
  if (settings.xpMultiplier !== 1) footerLines.push(`XP multiplier: ${Math.round(settings.xpMultiplier * 100)}%`);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("♻️ Card Progression Hub")
    .setDescription(collection.length === 0
      ? "You don't own any cards yet. Open packs and come back!"
      : "Pick a card from the dropdown, or **search by name**, to **Recycle**, **Fuse**, **Spend Scrap**, or **Ascend**.")
    .setFooter({ text: footerLines.join("  ·  ") });

  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  rows.push(cardSelectMenu(collection));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("recycle:search")
      .setLabel("🔍 Search by Name")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(collection.length === 0),
  ));

  const render = await renderRecycleHubCanvas(guildId, userId, cards);
  if (render) {
    embed.setImage(`attachment://${RECYCLE_HUB_FILE}`);
    return {
      embeds: [embed],
      components: rows,
      files: [new AttachmentBuilder(render.buffer, { name: RECYCLE_HUB_FILE })],
    };
  }
  return { embeds: [embed], components: rows };
}

export async function buildRecycleSelectedMessage(
  guildId: string, userId: string, cardId: number,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] } | string> {
  const entry = await loadSingleRecycleCard(guildId, userId, cardId);
  if (!entry) return "You do not own this card.";

  const settings = await getRecycleSettings(guildId);
  const spendable = Math.max(0, entry.count - 1);
  const atMaxLevel = entry.level >= MAX_LEVEL;
  const atMaxStar = entry.star >= MAX_STAR;
  const scrapPer = scrapValueForCard(entry.rarity, entry.worthValue, settings);
  const totalScrap = spendable * scrapPer;
  const fuseXp = spendable * fuseXpPerCopy(entry.rarity, settings);
  const scrapRate = scrapToXpRate(settings);
  const canAscend = atMaxLevel && !atMaxStar;
  const scrapBalance = await getScrap(guildId, userId);
  const canSpendScrap = !atMaxLevel && scrapBalance > 0 && scrapRate > 0;

  const lines: string[] = [
    `**${entry.rarityLabel}** · ${starRankString(entry.star)} · Level **${entry.level}** / ${MAX_LEVEL}`,
    `Owned: **×${entry.count}** (${spendable} spendable duplicate${spendable !== 1 ? "s" : ""})`,
    `⚙️ Scrap balance: **${scrapBalance.toLocaleString()}**`,
    "",
  ];
  if (spendable > 0) {
    lines.push(`♻️  **Recycle** → **+${totalScrap.toLocaleString()} ⚙️ Scrap** (${scrapPer}/copy)`);
    if (!atMaxLevel) lines.push(`🌟  **Fuse All** → **+${fuseXp.toLocaleString()} XP** toward Level ${entry.level + 1}`);
    else lines.push(`🌟  **Fuse All** → card is at max level; no XP benefit`);
  } else {
    lines.push("*No spendable duplicates — only your single copy remains.*");
  }
  if (canSpendScrap) {
    const rateStr = scrapRate === 1 ? "1 ⚙️ = 1 XP" : `${scrapRate.toFixed(2)} ⚙️ = 1 XP`;
    lines.push(`⚙️ **Spend Scrap** → ${rateStr} on this card`);
  }
  if (canAscend) {
    lines.push(`\n⬆️  **Ascend ready!** Reset to Lv 1 and gain ★ ${entry.star + 1}`);
  } else if (atMaxStar) {
    lines.push(`\n⬆️  Max star rank reached (**${MAX_STAR}★**).`);
  } else {
    lines.push(`\n⬆️  Ascend unlocks at Level ${MAX_LEVEL}.`);
  }

  const embed = new EmbedBuilder()
    .setColor(entry.rarityColor ?? 0x2ecc71)
    .setTitle(entry.name)
    .setDescription(lines.join("\n"));

  // Button row — five actions fit in one ActionRow
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`recycle:scrap:${cardId}`)
      .setLabel("♻️ Recycle")
      .setStyle(ButtonStyle.Success)
      .setDisabled(spendable === 0),
    new ButtonBuilder()
      .setCustomId(`recycle:fuse:${cardId}`)
      .setLabel("🌟 Fuse All")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(spendable === 0 || atMaxLevel),
    new ButtonBuilder()
      .setCustomId(`recycle:spendxp:${cardId}`)
      .setLabel("⚙️ Spend Scrap")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canSpendScrap),
    new ButtonBuilder()
      .setCustomId(`recycle:ascend:${cardId}`)
      .setLabel("⬆️ Ascend")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canAscend),
    new ButtonBuilder()
      .setCustomId("recycle:back")
      .setLabel("⬅️ Back")
      .setStyle(ButtonStyle.Secondary),
  );

  const render = await renderRecycleSelectedCanvas(guildId, userId, entry);
  if (render) {
    embed.setImage(`attachment://${RECYCLE_CARD_FILE}`);
    return { embeds: [embed], components: [row], files: [new AttachmentBuilder(render.buffer, { name: RECYCLE_CARD_FILE })] };
  }
  return { embeds: [embed], components: [row] };
}

// ── Interaction handlers ───────────────────────────────────────────────────────

export async function handleRecycleHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  // Safe to call from both a fresh slash command and from /card_recycle's wrapper
  // (user.ts already defers). Only defer if it hasn't been acknowledged yet.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }
  const settings = await getRecycleSettings(guildId);
  if (!settings.enabled) {
    await interaction.editReply({ content: "♻️ The Card Progression Hub is currently disabled by server admins.", embeds: [], components: [] }).catch(() => {});
    return;
  }
  const msg = await buildRecycleHubMessage(guildId, interaction.user.id);
  await interaction.editReply(msg).catch(() => {});
}

export async function handleRecycleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle") return;
  const sub = parts[1];

  if (interaction.isButton()) {
    if (sub === "select") {
      const cardId = Number(parts[2]);
      await interaction.deferUpdate().catch(() => {});
      const msg = await buildRecycleSelectedMessage(guildId, userId, cardId);
      if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [], files: [] }).catch(() => {}); return; }
      await interaction.editReply(msg).catch(() => {});
      return;
    }
    if (sub === "back") {
      await interaction.deferUpdate().catch(() => {});
      const msg = await buildRecycleHubMessage(guildId, userId);
      await interaction.editReply(msg).catch(() => {});
      return;
    }
    // Modal-launching buttons: must reply with showModal, no defer first.
    if (sub === "spendxp") {
      return handleRecycleSpendXpButton(interaction);
    }
    if (sub === "search") {
      return handleRecycleSearchButton(interaction);
    }
  }

  if (interaction.isStringSelectMenu() && sub === "search") {
    const cardId = Number(interaction.values[0]);
    await interaction.deferUpdate().catch(() => {});
    if (!cardId || isNaN(cardId)) {
      await interaction.editReply({ content: "❌ Invalid selection.", embeds: [], components: [], files: [] }).catch(() => {});
      return;
    }
    const msg = await buildRecycleSelectedMessage(guildId, userId, cardId);
    if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [], files: [] }).catch(() => {}); return; }
    await interaction.editReply(msg).catch(() => {});
  }
}

// ── ♻️ Recycle for Scrap handler ──────────────────────────────────────────────

export async function handleRecycleScrapButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || (parts[1] !== "scrap" && parts[1] !== "do")) return;
  const cardId = Number(parts[2]);
  await interaction.deferUpdate().catch(() => {});

  const entry = await loadSingleRecycleCard(guildId, userId, cardId);
  if (!entry) {
    await interaction.editReply({ content: "❌ Card not found in your collection.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const spendable = Math.max(0, entry.count - 1);
  if (spendable === 0) {
    await interaction.editReply({ content: "❌ No duplicate copies to recycle.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  // Play animation first
  const settings = await getRecycleSettings(guildId);
  const scrapEarned = spendable * scrapValueForCard(entry.rarity, entry.worthValue, settings);
  const anim = await renderRecycleScrapAnimation(guildId, userId, entry, scrapEarned);
  if (anim) {
    const embed = new EmbedBuilder()
      .setColor(entry.rarityColor ?? 0x2ecc71)
      .setTitle("♻️ Recycling…")
      .setDescription(`Shattering **${spendable}** duplicate${spendable !== 1 ? "s" : ""} of **${entry.name}**…`)
      .setImage(`attachment://${RECYCLE_ANIM_FILE}`);
    await interaction.editReply({ embeds: [embed], components: [], files: [new AttachmentBuilder(anim.buffer, { name: RECYCLE_ANIM_FILE })] }).catch(() => {});
    await sleep(2400);
  }

  // Perform the recycle
  const res = await recycleForScrap(guildId, userId, cardId, entry.rarity, entry.worthValue);
  if (!res.ok) {
    await interaction.editReply({ content: "❌ Recycle failed — try again.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const newScrap = await getScrap(guildId, userId);
  const embed = new EmbedBuilder()
    .setColor(0x64d4a4)
    .setTitle("♻️ Recycled for Scrap!")
    .setDescription(
      `Converted **×${res.consumed}** duplicate${res.consumed !== 1 ? "s" : ""} of **${entry.rarityLabel} ${entry.name}** into:\n\n` +
      `⚙️  **+${res.scrapEarned.toLocaleString()} Scrap**\n\n` +
      `Your Scrap balance: **${newScrap.toLocaleString()}**`,
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`recycle:select:${cardId}`).setLabel("🔍 View Card Again").setStyle(ButtonStyle.Primary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

// ── 🌟 Fuse All handler ───────────────────────────────────────────────────────

export async function handleRecycleFuse(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "fuse") return;
  const cardId = Number(parts[2]);
  await interaction.deferUpdate().catch(() => {});

  const entry = await loadSingleRecycleCard(guildId, userId, cardId);
  if (!entry) {
    await interaction.editReply({ content: "❌ Card not found in your collection.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const spendable = Math.max(0, entry.count - 1);
  if (spendable === 0) {
    await interaction.editReply({ content: "❌ No duplicate copies to fuse.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }
  if (entry.level >= MAX_LEVEL) {
    await interaction.editReply({ content: `❌ **${entry.name}** is already at max level. Ascend it to keep growing!`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const settings = await getRecycleSettings(guildId);
  const estXp = spendable * fuseXpPerCopy(entry.rarity, settings);
  const animEntry = { ...entry }; // snapshot before mutation

  // Play fuse animation first (with estimated new level)
  const estimatedNewLevel = Math.min(MAX_LEVEL, levelFromXp(entry.xp + estXp));
  const anim = await renderFuseAnimation(guildId, userId, animEntry, entry.level, estimatedNewLevel, estXp);
  if (anim) {
    const embed = new EmbedBuilder()
      .setColor(0x74b9ff)
      .setTitle("🌟 Fusing…")
      .setDescription(`Channeling **${spendable}** duplicate${spendable !== 1 ? "s" : ""} into **${entry.name}**…`)
      .setImage(`attachment://${RECYCLE_ANIM_FILE}`);
    await interaction.editReply({ embeds: [embed], components: [], files: [new AttachmentBuilder(anim.buffer, { name: RECYCLE_ANIM_FILE })] }).catch(() => {});
    await sleep(2600);
  }

  const res = await fuseCard(guildId, userId, cardId, entry.rarity);
  if (!res.ok) {
    const msg = res.reason === "no_duplicates" ? "No duplicate copies to fuse."
      : res.reason === "max_level" ? `**${entry.name}** is already at max level.`
      : "Fuse failed — try again.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x74b9ff)
    .setTitle("🌟 Fused!")
    .setDescription(
      `Consumed **×${res.consumed}** duplicate${res.consumed !== 1 ? "s" : ""} of **${entry.rarityLabel} ${entry.name}**.\n\n` +
      `⚡  **+${res.xpGained.toLocaleString()} XP**\n` +
      (res.leveledUp
        ? `📈  Level **${res.oldLevel}** → **${res.newLevel}** 🎉`
        : `📊  Still Level **${res.newLevel}** (more XP needed)`) +
      (res.newLevel >= MAX_LEVEL ? `\n\n⭐ **Max level reached — Ascend to gain a star!**` : ""),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`recycle:select:${cardId}`).setLabel("🔍 View Card").setStyle(ButtonStyle.Primary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

// ── ⬆️ Ascend handler ────────────────────────────────────────────────────────

export async function handleRecycleAscend(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "ascend") return;
  const cardId = Number(parts[2]);
  await interaction.deferUpdate().catch(() => {});

  const entry = await loadSingleRecycleCard(guildId, userId, cardId);
  if (!entry) {
    await interaction.editReply({ content: "❌ Card not found in your collection.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  if (entry.level < MAX_LEVEL) {
    await interaction.editReply({ content: `❌ **${entry.name}** must be at Level ${MAX_LEVEL} to Ascend. Currently Level ${entry.level}.`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }
  if (entry.star >= MAX_STAR) {
    await interaction.editReply({ content: `❌ **${entry.name}** is already at max Star Rank (${MAX_STAR}★).`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  // Animation before
  const anim = await renderAscendAnimation(guildId, userId, entry, entry.star, entry.star + 1);
  if (anim) {
    const embed = new EmbedBuilder()
      .setColor(0xffd54a)
      .setTitle("⬆️ Ascending…")
      .setDescription(`**${entry.name}** is ascending from ${starRankString(entry.star)} to ${starRankString(entry.star + 1)}…`)
      .setImage(`attachment://${RECYCLE_ANIM_FILE}`);
    await interaction.editReply({ embeds: [embed], components: [], files: [new AttachmentBuilder(anim.buffer, { name: RECYCLE_ANIM_FILE })] }).catch(() => {});
    await sleep(2800);
  }

  const res = await ascendCard(guildId, userId, cardId);
  if (!res.ok) {
    const msg = res.reason === "not_level_100" ? `Must be Level ${MAX_LEVEL} to Ascend.`
      : res.reason === "max_star" ? "Already at max Star Rank."
      : "Ascension failed — try again.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xffd54a)
    .setTitle("⬆️ Ascended!")
    .setDescription(
      `**${entry.rarityLabel} ${entry.name}** has ascended!\n\n` +
      `${starRankString(res.fromStar)}  →  **${starRankString(res.toStar)}**  (${res.toStar}★)\n\n` +
      `Level reset to **1** — time to level up again for the next Ascension.`,
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`recycle:select:${cardId}`).setLabel("🔍 View Card").setStyle(ButtonStyle.Primary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

// ── Legacy merge-all (kept for any in-flight messages) ───────────────────────

export async function handleRecycleMergeAll(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  await interaction.deferUpdate().catch(() => {});
  const res = await mergeAllRecycle(guildId, userId);
  if (!res.ok) {
    const msg = res.reason === "no_duplicates" ? "You don't have any duplicate cards to merge."
      : res.reason === "max_star" ? "Your top card is already at max Star Rank."
      : res.reason === "no_progress" ? "Not enough duplicates to raise the top card's star rank."
      : "Something went wrong merging cards.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("♻️ Merge All Complete")
    .setDescription(
      `Fused **${res.consumed}** duplicates into **${res.targetName}** for a star rank jump.\n\n` +
      `**${starRankString(res.fromStar)}**  →  **${starRankString(res.toStar)}**  (${res.toStar}★)\n\n` +
      `Sources:\n${res.sources.map(s => `• ${s.name}: ×${s.consumed}`).join("\n")}`,
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

// ── Legacy recycle confirm (recycle:do) — now routes to scrap ────────────────
// handleRecycleScrapButton already accepts parts[1] === "do" in its guard, so
// no customId mutation is needed — just delegate directly.
export async function handleRecycleConfirmButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "do") return;
  return handleRecycleScrapButton(interaction);
}

// ── ⚙️ Spend Scrap → XP ──────────────────────────────────────────────────────

export async function handleRecycleSpendXpButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "spendxp") return;
  const cardId = parts[2]!;
  const balance = await getScrap(interaction.guild.id, interaction.user.id);
  const modal = new ModalBuilder()
    .setCustomId(`recycle:spendxp:${cardId}`)
    .setTitle("Spend Scrap for XP")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`How much Scrap? (you have ${balance.toLocaleString()})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setPlaceholder("e.g. 100"),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleRecycleSpendXpModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "spendxp") return;
  const cardId = Number(parts[2]);
  await interaction.deferUpdate().catch(() => {});

  const amountRaw = interaction.fields.getTextInputValue("amount").trim().replace(/,/g, "");
  const amount = parseInt(amountRaw, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    await interaction.editReply({ content: "❌ Enter a positive whole number of Scrap.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const entry = await loadSingleRecycleCard(guildId, userId, cardId);
  if (!entry) {
    await interaction.editReply({ content: "❌ Card not found in your collection.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }
  if (entry.level >= MAX_LEVEL) {
    await interaction.editReply({ content: `❌ **${entry.name}** is already at max level.`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const res = await spendScrapForXp(guildId, userId, cardId, amount);
  if (!res.ok) {
    const msg = res.reason === "insufficient_scrap" ? "Not enough Scrap for that amount."
      : res.reason === "max_level" ? `**${entry.name}** is already at max level.`
      : "Spend failed — try again.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const newScrap = await getScrap(guildId, userId);
  const embed = new EmbedBuilder()
    .setColor(0x74b9ff)
    .setTitle("⚙️ Scrap Converted to XP!")
    .setDescription(
      `Spent **${res.scrapSpent.toLocaleString()} ⚙️ Scrap** on **${entry.rarityLabel} ${entry.name}**.\n\n` +
      `⚡  **+${res.xpGained.toLocaleString()} XP**\n` +
      (res.leveledUp
        ? `📈  Level **${res.oldLevel}** → **${res.newLevel}** 🎉`
        : `📊  Still Level **${res.newLevel}** (more XP needed)`) +
      `\n\nNew Scrap balance: **${newScrap.toLocaleString()}**`,
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`recycle:spendxp:${cardId}`).setLabel("⚙️ Spend More").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`recycle:select:${cardId}`).setLabel("🔍 View Card").setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

// ── 🔍 Search by name ─────────────────────────────────────────────────────────

export async function handleRecycleSearchButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "search") return;
  const modal = new ModalBuilder()
    .setCustomId("recycle:search")
    .setTitle("Find a card to level up")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Card name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("Type part of the card name…"),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleRecycleSearchModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  const query = interaction.fields.getTextInputValue("query").trim().toLowerCase();
  if (!query) {
    await interaction.editReply({ content: "❌ Enter a card name to search." }).catch(() => {});
    return;
  }

  const [collection, ctx, settings, displayMap, progressMap] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getCardProgressBatch(guildId, userId),
  ]);

  const matches = collection
    .filter(c => c.count > 0 && c.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map(c => {
      const display = getCardDisplayRarity(c, ctx, settings, displayMap);
      const prog = progressMap.get(c.id);
      return {
        cardId: c.id,
        name: c.name,
        rarityLabel: display.label,
        level: prog?.level ?? 1,
        count: c.count,
      };
    });

  if (matches.length === 0) {
    await interaction.editReply({ content: `❌ No owned cards matching "${query}".`, embeds: [], components: [] }).catch(() => {});
    return;
  }

  if (matches.length === 1) {
    const msg = await buildRecycleSelectedMessage(guildId, userId, matches[0]!.cardId);
    if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [] }).catch(() => {}); return; }
    await interaction.editReply({ ...msg, content: "🔍 Found one match:", embeds: msg.embeds, components: msg.components, files: msg.files }).catch(() => {});
    return;
  }

  const options = matches.map(m => ({
    label: `${m.name}`.slice(0, 100),
    description: `${m.rarityLabel} · Lv ${m.level} · ×${m.count}`.slice(0, 100),
    value: String(m.cardId),
  }));
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("recycle:search")
      .setPlaceholder(`🔍 ${matches.length} matches for "${query}"`)
      .addOptions(options),
  );
  await interaction.editReply({ content: `🔍 Found ${matches.length} cards matching "${query}":`, components: [row] }).catch(() => {});
}
