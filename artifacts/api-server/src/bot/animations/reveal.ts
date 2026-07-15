// ─────────────────────────────────────────────────────────────────────────────
// DN Cards — Static reveal canvases (pack opening + battle attack frames)
//
// These are CHEAP single-frame PNG renders (no GIF encoding), designed to be
// shown in sequence via message edits. That gives a lively "one card at a time"
// pack-opening (and per-turn battle attack visuals) at a fraction of the CPU of
// animated GIFs. All drawing reuses the shared helpers in engine.ts/effects.ts.
//
// Every function is best-effort: if the native canvas isn't available or a draw
// throws, it returns null and the caller falls back to the plain embed.
// ─────────────────────────────────────────────────────────────────────────────

import type { RenderCard } from "../battle/image/render.js";
import {
  getCanvas, hexToRgba, roundRectPath, drawGradientBackground,
  type Ctx, type CanvasMod,
} from "./engine.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawRarityBadge, drawTextWithShadow,
  drawFoilOverlay, drawHoloSparkles, getRarityEffectColor, fitText,
} from "./effects.js";
import { logger } from "../../lib/logger.js";

// Core helper: allocate a canvas, draw, and encode a PNG. Never throws.
async function renderPng(
  width: number,
  height: number,
  draw: (ctx: Ctx, mod: CanvasMod) => Promise<void> | void,
): Promise<Buffer | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  try {
    const canvas = mod.createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    await draw(ctx, mod);
    return await canvas.encode("png");
  } catch (err) {
    logger.debug({ err }, "reveal renderer: draw/encode failed");
    return null;
  }
}

export const REVEAL_COVER = { width: 640, height: 400 } as const;
export const REVEAL_CARD = { width: 520, height: 660 } as const;
export const REVEAL_ATTACK = { width: 720, height: 440 } as const;

// ── Pack cover ────────────────────────────────────────────────────────────────
export interface PackCoverInput {
  tierLabel: string;
  tierColor: number;
  emoji?: string;      // shown large on the pack (falls back to 📦)
  size: number;        // number of cards in the pack
}

export async function renderPackCover(input: PackCoverInput): Promise<Buffer | null> {
  const { width, height } = REVEAL_COVER;
  const color = input.tierColor;
  return renderPng(width, height, (ctx) => {
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(color, 0.4)],
      [0.55, "#0b0d12"],
      [1, "#07080c"],
    ], 0.35);

    // Pack box, centered, with a rarity-style glow + frame.
    const pw = 220, ph = 300;
    const px = (width - pw) / 2, py = (height - ph) / 2 - 6;
    drawRarityGlow(ctx, px, py, pw, ph, color, 0.7);
    drawCardFrame(ctx, px, py, pw, ph, color, 8);
    ctx.save();
    roundRectPath(ctx, px + 14, py + 14, pw - 28, ph - 28, 12);
    ctx.clip();
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(color, 0.5)],
      [1, "rgba(15,15,20,0.95)"],
    ], 1.2);
    ctx.restore();

    drawTextWithShadow(ctx, input.emoji || "📦", width / 2, py + ph / 2 - 26, "#ffffff", 84);
    drawTextWithShadow(ctx, "OPENING", width / 2, 46, "#ffffff", 30);
    drawTextWithShadow(ctx, input.tierLabel.toUpperCase(), width / 2, py + ph + 22, hexToRgba(color, 1), 30);
    drawTextWithShadow(ctx, `${input.size} card${input.size === 1 ? "" : "s"} inside…`, width / 2, height - 22, "#c8c8d0", 18);
  });
}

// ── Per-card reveal ─────────────────────────────────────────────────────────
export interface RevealStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  critChance: number;  // percent
  accuracy: number;    // percent
}

export interface CardRevealInput {
  card: RenderCard;
  stats: RevealStats | null;  // Level-1 battle stats; null hides the stat block
  shiny: boolean;
  index: number;              // 1-based position in the pack
  total: number;
}

export async function renderCardReveal(input: CardRevealInput): Promise<Buffer | null> {
  const { width, height } = REVEAL_CARD;
  const { card, stats, shiny } = input;
  const color = card.rarityColor ?? getRarityEffectColor(card.rarity);
  return renderPng(width, height, async (ctx, mod) => {
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(color, 0.28)],
      [0.5, "#0c0e14"],
      [1, "#070810"],
    ], 0.3);

    // Header: position + shiny tag.
    drawTextWithShadow(ctx, `Card ${input.index}/${input.total}`, width / 2, 30, "#c8c8d0", 18);

    // Card art panel with rarity glow + frame.
    const cw = 300, ch = 300, cx = (width - cw) / 2, cy = 66;
    drawRarityGlow(ctx, cx, cy, cw, ch, color, shiny ? 0.85 : 0.6);
    await drawCardArt(ctx, mod, cx, cy, cw, ch, card.artUrl);
    drawCardFrame(ctx, cx, cy, cw, ch, color, 6);
    if (shiny) {
      drawFoilOverlay(ctx, cx, cy, cw, ch, 0.5);
      drawHoloSparkles(ctx, cx, cy, cw, ch, 0.5, 22);
    }
    drawRarityBadge(ctx, cx + cw - 12, cy + 12, card.rarityLabel, color);

    // Name + shiny star.
    const nameY = cy + ch + 34;
    const name = shiny ? `✨ ${card.name}` : card.name;
    drawTextWithShadow(ctx, name, width / 2, nameY, "#ffffff", fitText(ctx, name, width - 60, 30));

    // Stat block (Level 1).
    if (stats) {
      const boxY = nameY + 26, boxH = 150, boxX = 40, boxW = width - 80;
      ctx.save();
      ctx.fillStyle = "rgba(18,18,26,0.82)";
      roundRectPath(ctx, boxX, boxY, boxW, boxH, 14);
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = hexToRgba(color, 0.9);
      roundRectPath(ctx, boxX, boxY, boxW, boxH, 14);
      ctx.stroke();
      ctx.restore();

      drawTextWithShadow(ctx, "LEVEL 1 · BATTLE STATS", width / 2, boxY + 22, hexToRgba(color, 1), 16);

      const cells: [string, string][] = [
        ["❤️ HP", stats.hp.toLocaleString()],
        ["⚔️ ATK", stats.atk.toLocaleString()],
        ["🛡️ DEF", stats.def.toLocaleString()],
        ["💨 SPD", stats.spd.toLocaleString()],
        ["🎯 CRIT", `${stats.critChance}%`],
        ["🏹 ACC", `${stats.accuracy}%`],
      ];
      const colW = boxW / 3;
      for (let i = 0; i < cells.length; i++) {
        const cxi = boxX + (i % 3) * colW + colW / 2;
        const cyi = boxY + 58 + Math.floor(i / 3) * 48;
        drawTextWithShadow(ctx, cells[i]![0], cxi, cyi, "#aab0c0", 15);
        drawTextWithShadow(ctx, cells[i]![1], cxi, cyi + 22, "#ffffff", 22);
      }
    }
  });
}

// ── Battle attack frame (single-card, cheap) ─────────────────────────────────
export interface AttackFrameInput {
  attacker: RenderCard;
  moveName: string;
  damage: number;
  isCrit: boolean;
  isHit: boolean;
}

export async function renderAttackFrame(input: AttackFrameInput): Promise<Buffer | null> {
  const { width, height } = REVEAL_ATTACK;
  const { attacker } = input;
  const color = attacker.rarityColor ?? getRarityEffectColor(attacker.rarity);
  return renderPng(width, height, async (ctx, mod) => {
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(color, 0.3)],
      [0.6, "#0b1622"],
      [1, "#07080c"],
    ], 0.2);

    // Attacker card on the left, lunging toward the impact.
    const cw = 240, ch = 336, cx = 44, cy = (height - ch) / 2;
    drawRarityGlow(ctx, cx, cy, cw, ch, color, 0.7);
    await drawCardArt(ctx, mod, cx, cy, cw, ch, attacker.artUrl);
    drawCardFrame(ctx, cx, cy, cw, ch, color, 6);
    drawRarityBadge(ctx, cx + cw - 12, cy + 12, attacker.rarityLabel, color);
    drawTextWithShadow(ctx, attacker.name, cx + cw / 2, cy + ch + 22, "#ffffff", fitText(ctx, attacker.name, cw + 40, 22));

    // Move banner.
    drawTextWithShadow(ctx, input.moveName.toUpperCase(), width / 2 + 90, 54, "#ffcc33", 26);

    // Impact burst + damage number on the right.
    const ix = width - 200, iy = height / 2;
    if (input.isHit) {
      ctx.save();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const len = input.isCrit ? 90 : 60;
        ctx.strokeStyle = hexToRgba(color, 0.8);
        ctx.lineWidth = input.isCrit ? 6 : 4;
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * 24, iy + Math.sin(a) * 24);
        ctx.lineTo(ix + Math.cos(a) * len, iy + Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.restore();
      const dmg = input.isCrit ? `${input.damage.toLocaleString()}!` : `-${input.damage.toLocaleString()}`;
      drawTextWithShadow(ctx, dmg, ix, iy, input.isCrit ? "#ff4444" : "#ffffff", input.isCrit ? 60 : 46);
      if (input.isCrit) drawTextWithShadow(ctx, "CRITICAL!", ix, iy + 52, "#ff6666", 22);
    } else {
      drawTextWithShadow(ctx, "MISS", ix, iy, "#95a5a6", 46);
    }
  });
}
