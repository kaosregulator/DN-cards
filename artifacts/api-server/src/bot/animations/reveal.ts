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
  drawTitle, drawFoilOverlay, drawHoloSparkles, getRarityEffectColor, fitText, drawScreenFlash, TITLE_FONT,
} from "./effects.js";
import { queueRender } from "./render-queue.js";
import { drawSparks, drawEmbers, drawConfetti, drawExplosion } from "./particles.js";
import { logger } from "../../lib/logger.js";

// Core helper: allocate a canvas, draw, and encode a PNG. Never throws. Routed
// through the shared render queue so concurrent card/pack/attack renders never
// spike CPU (this is a leaf renderer — safe to queue).
async function renderPng(
  width: number,
  height: number,
  draw: (ctx: Ctx, mod: CanvasMod) => Promise<void> | void,
): Promise<Buffer | null> {
  return queueRender("reveal", async () => {
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
  });
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
    drawTitle(ctx, "OPENING", width / 2, 46, "#ffffff", 30);
    drawTitle(ctx, input.tierLabel.toUpperCase(), width / 2, py + ph + 22, hexToRgba(color, 1), fitText(ctx, input.tierLabel.toUpperCase(), width - 60, 30, 14, TITLE_FONT));
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

// Collector info shown on /info — baked onto the canvas instead of embed text.
export interface RevealInfo {
  worth: number;
  burn: number;
  dropChance: string;   // pre-formatted, e.g. "~0.30%"
  totalCaught: number;
  typeLabel: string;
}

export interface CardRevealInput {
  card: RenderCard;
  stats: RevealStats | null;  // battle stats; null hides the stat block
  info?: RevealInfo | null;   // collector info block (used when stats is null)
  shiny: boolean;
  index: number;              // 1-based position in the pack
  total: number;
  // Header for the stat block. Defaults to "LEVEL 1 · BATTLE STATS"; a
  // pre-levelled catch/pull passes e.g. "LV 45 · 3★ · BATTLE STATS" so the
  // canvas reflects the card's real progression, not a hardcoded Level 1.
  statLabel?: string;
}

export async function renderCardReveal(input: CardRevealInput): Promise<Buffer | null> {
  const { width, height } = REVEAL_CARD;
  const { card, stats, info, shiny } = input;
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
    await drawCardArt(ctx, mod, cx, cy, cw, ch, card.artUrl, card.rarity);
    drawCardFrame(ctx, cx, cy, cw, ch, color, 6, card.rarity);
    if (shiny) {
      drawFoilOverlay(ctx, cx, cy, cw, ch, 0.5);
      drawHoloSparkles(ctx, cx, cy, cw, ch, 0.5, 22);
    }
    drawRarityBadge(ctx, cx + cw - 12, cy + 12, card.rarityLabel, color);

    // Name + shiny star.
    const nameY = cy + ch + 34;
    const name = shiny ? `✨ ${card.name}` : card.name;
    drawTitle(ctx, name, width / 2, nameY, "#ffffff", fitText(ctx, name, width - 60, 30, 12, TITLE_FONT));

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

      drawTextWithShadow(ctx, input.statLabel ?? "LEVEL 1 · BATTLE STATS", width / 2, boxY + 22, hexToRgba(color, 1), 16);

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
    } else if (info) {
      // Collector info block (worth / burn / drop / caught / type) — the /info
      // details baked onto the canvas so the embed can stay clean.
      const boxY = nameY + 26, boxH = 150, boxX = 40, boxW = width - 80;
      ctx.save();
      ctx.fillStyle = "rgba(18,18,26,0.82)";
      roundRectPath(ctx, boxX, boxY, boxW, boxH, 14);
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = hexToRgba(color, 0.9);
      roundRectPath(ctx, boxX, boxY, boxW, boxH, 14);
      ctx.stroke();
      ctx.restore();

      drawTextWithShadow(ctx, "CARD INFO", width / 2, boxY + 22, hexToRgba(color, 1), 16);

      const cells: [string, string][] = [
        ["💠 WORTH", info.worth.toLocaleString()],
        ["🔥 BURN", info.burn.toLocaleString()],
        ["🎲 DROP", info.dropChance],
        ["📦 CAUGHT", info.totalCaught.toLocaleString()],
        ["🃏 TYPE", info.typeLabel],
      ];
      const colW = boxW / 3;
      for (let i = 0; i < cells.length; i++) {
        const cxi = boxX + (i % 3) * colW + colW / 2;
        const cyi = boxY + 58 + Math.floor(i / 3) * 48;
        drawTextWithShadow(ctx, cells[i]![0], cxi, cyi, "#aab0c0", 15);
        drawTextWithShadow(ctx, cells[i]![1], cxi, cyi + 22, "#ffffff", fitText(ctx, cells[i]![1], colW - 18, 20));
      }
    }
  });
}

// ── Battle attack frame (single-card, cheap) ─────────────────────────────────
// One renderer, many "scenes". The battle loop derives a scene from the move +
// event flashes; each scene re-themes the SAME frame (accent, banner, impact FX)
// so we never spin up a second renderer. All scenes are best-effort static PNGs.
export type AttackScene =
  | "attack" | "crit" | "special" | "ultimate" | "counter"
  | "ko" | "buff" | "debuff" | "heal" | "shield" | "item" | "miss";

export interface AttackFrameInput {
  attacker: RenderCard;
  moveName: string;
  damage: number;
  isCrit: boolean;
  isHit: boolean;
  scene?: AttackScene;   // overrides the attack/crit/miss default when set
  subtitle?: string;     // optional small caption under the impact (e.g. "+120 HP")
  // Boss-raid intensity: forces the big-impact treatment, a heavier screen
  // flash, a "BOSS RAID" tag, and a larger damage readout so raid hits feel
  // weightier than normal battle hits. Reuses the same renderer — no new scene.
  boss?: boolean;
}

interface SceneTheme {
  accent: number;        // impact + banner accent colour
  banner: string;        // uppercased banner label
  bannerColor: string;
  impact: "burst" | "arrow_back" | "arrow_up" | "arrow_down" | "aura" | "cross" | "hex" | "skull" | "none";
  screenFlash?: number;  // 0..1 flash strength (ultimates/crits)
  bg?: [number, number, number]; // [top-accent, mid, bottom] hex override
}

function sceneTheme(scene: AttackScene, rarityColor: number): SceneTheme {
  switch (scene) {
    case "ultimate":
      return { accent: 0xffd54a, banner: "ULTIMATE", bannerColor: "#ffe27a", impact: "burst", screenFlash: 0.5, bg: [0x2a1200, 0x1a0d05, 0x07080c] };
    case "special":
      return { accent: 0xb56bff, banner: "SPECIAL", bannerColor: "#d9a8ff", impact: "burst", screenFlash: 0.22, bg: [0x1a0d2a, 0x0d0b1a, 0x07080c] };
    case "counter":
      return { accent: 0x36d6d6, banner: "COUNTER!", bannerColor: "#8ff0f0", impact: "arrow_back" };
    case "ko":
      return { accent: 0xff3b3b, banner: "K.O.", bannerColor: "#ff6b6b", impact: "skull", screenFlash: 0.4, bg: [0x2a0505, 0x140303, 0x050505] };
    case "buff":
      return { accent: 0x4ad991, banner: "EMPOWERED", bannerColor: "#8fffc0", impact: "arrow_up", bg: [0x052a18, 0x03140d, 0x07080c] };
    case "debuff":
      return { accent: 0xb56bff, banner: "WEAKENED", bannerColor: "#d9a8ff", impact: "arrow_down" };
    case "heal":
      return { accent: 0x4ad991, banner: "RECOVER", bannerColor: "#8fffc0", impact: "cross", bg: [0x052a18, 0x03140d, 0x07080c] };
    case "shield":
      return { accent: 0x4a9ff5, banner: "SHIELD", bannerColor: "#a8d4ff", impact: "hex", bg: [0x081a2a, 0x040d14, 0x07080c] };
    case "item":
      return { accent: 0xf5a623, banner: "ITEM", bannerColor: "#ffd27a", impact: "burst" };
    case "crit":
      return { accent: 0xff4444, banner: "CRITICAL!", bannerColor: "#ff6666", impact: "burst", screenFlash: 0.28 };
    case "miss":
      return { accent: 0x95a5a6, banner: "MISS", bannerColor: "#b6c0c2", impact: "none" };
    default:
      return { accent: rarityColor, banner: "", bannerColor: "#ffcc33", impact: "burst" };
  }
}

function drawImpact(
  ctx: Ctx, kind: SceneTheme["impact"], ix: number, iy: number, accent: number, big: boolean,
): void {
  const c = hexToRgba(accent, 0.85);
  ctx.save();
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  const scale = big ? 1.4 : 1;
  switch (kind) {
    case "burst": {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const len = (big ? 90 : 60) * scale;
        ctx.lineWidth = big ? 6 : 4;
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * 24, iy + Math.sin(a) * 24);
        ctx.lineTo(ix + Math.cos(a) * len, iy + Math.sin(a) * len);
        ctx.stroke();
      }
      break;
    }
    case "arrow_back": case "arrow_up": case "arrow_down": {
      const dir = kind === "arrow_back" ? { dx: -1, dy: 0 } : kind === "arrow_up" ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 34;
        const bx = ix + (dir.dx ? 0 : off);
        const by = iy + (dir.dy ? 0 : 0) + (dir.dx ? off : 0);
        const tipx = bx + dir.dx * 60, tipy = by + dir.dy * 60;
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(bx - dir.dx * 40, by - dir.dy * 40); ctx.lineTo(tipx, tipy); ctx.stroke();
        // arrowhead
        ctx.beginPath();
        ctx.moveTo(tipx, tipy);
        ctx.lineTo(tipx - dir.dx * 22 - dir.dy * 16, tipy - dir.dy * 22 - dir.dx * 16);
        ctx.lineTo(tipx - dir.dx * 22 + dir.dy * 16, tipy - dir.dy * 22 + dir.dx * 16);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case "aura": {
      for (let r = 30; r < 90; r += 18) { ctx.globalAlpha = 1 - r / 100; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(ix, iy, r, 0, Math.PI * 2); ctx.stroke(); }
      break;
    }
    case "cross": {
      // Filled plus-sign (rounded rects) — avoids lineCap, which the restricted
      // Ctx type doesn't declare.
      roundRectPath(ctx, ix - 8, iy - 40, 16, 80, 6); ctx.fill();
      roundRectPath(ctx, ix - 40, iy - 8, 80, 16, 6); ctx.fill();
      break;
    }
    case "hex": {
      ctx.lineWidth = 8;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + (i / 6) * Math.PI * 2; const px = ix + Math.cos(a) * 52; const py = iy + Math.sin(a) * 52; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.stroke();
      break;
    }
    case "skull": {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2; const len = 100;
        ctx.lineWidth = 6; ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * 30, iy + Math.sin(a) * 30);
        ctx.lineTo(ix + Math.cos(a) * len, iy + Math.sin(a) * len); ctx.stroke();
      }
      break;
    }
    case "none": break;
  }
  ctx.restore();
}

export async function renderAttackFrame(input: AttackFrameInput): Promise<Buffer | null> {
  const { width, height } = REVEAL_ATTACK;
  const { attacker } = input;
  const rarityColor = attacker.rarityColor ?? getRarityEffectColor(attacker.rarity);
  // Resolve the scene: explicit hint wins; otherwise crit/miss/attack default.
  const scene: AttackScene = input.scene ?? (!input.isHit ? "miss" : input.isCrit ? "crit" : "attack");
  const theme = sceneTheme(scene, rarityColor);
  const accent = scene === "attack" ? rarityColor : theme.accent;
  const boss = !!input.boss;
  return renderPng(width, height, async (ctx, mod) => {
    const [top, mid, bot] = theme.bg ?? [rarityColor, 0x0b1622, 0x07080c];
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(top === rarityColor ? rarityColor : top, boss ? 0.42 : 0.3)],
      [0.6, hexToRgba(mid, 1)],
      [1, hexToRgba(bot, 1)],
    ], 0.2);

    // Boss raids always flash harder than a normal battle hit.
    const flash = boss ? Math.max(theme.screenFlash ?? 0, 0.34) : theme.screenFlash;
    if (flash) drawScreenFlash(ctx, width, height, flash, accent);

    // Attacker card on the left, lunging toward the impact.
    const cw = 240, ch = 336, cx = 44, cy = (height - ch) / 2;
    drawRarityGlow(ctx, cx, cy, cw, ch, accent, boss ? 1 : scene === "ultimate" ? 0.95 : 0.7);
    await drawCardArt(ctx, mod, cx, cy, cw, ch, attacker.artUrl, attacker.rarity);
    drawCardFrame(ctx, cx, cy, cw, ch, rarityColor, boss ? 8 : 6, attacker.rarity);
    drawRarityBadge(ctx, cx + cw - 12, cy + 12, attacker.rarityLabel, rarityColor);
    drawTextWithShadow(ctx, attacker.name, cx + cw / 2, cy + ch + 22, "#ffffff", fitText(ctx, attacker.name, cw + 40, 22));

    // Move banner (name) + scene banner. Boss raids carry an extra tag.
    drawTitle(ctx, input.moveName.toUpperCase(), width / 2 + 90, 46, "#ffcc33", boss ? 26 : 24);
    if (theme.banner) drawTitle(ctx, theme.banner, width / 2 + 90, 78, theme.bannerColor, boss ? 22 : 20);
    if (boss) drawTextWithShadow(ctx, "⚔ BOSS RAID ⚔", width / 2 + 90, height - 26, hexToRgba(accent, 1), 18);

    // Boss aura: embers drifting up off the attacker card.
    if (boss) drawEmbers(ctx, cx - 10, cy, cw + 20, ch, { color: accent, seed: `${attacker.name}-ember` });

    // Impact FX + readout on the right. Boss hits always use the big treatment.
    const ix = width - 200, iy = height / 2;
    const big = boss || scene === "ultimate" || scene === "crit" || scene === "ko";
    drawImpact(ctx, theme.impact, ix, iy, accent, big);
    if (boss) drawImpact(ctx, theme.impact, ix, iy, accent, false); // layered burst = denser

    // Particle accents (seeded → stable per identical frame). Crits/ultimates
    // and boss hits throw sparks; a KO bursts a celebratory shockwave + confetti.
    const pSeed = `${input.moveName}-${input.damage}-${scene}`;
    if (scene === "ko") {
      drawExplosion(ctx, ix, iy, { color: accent, radius: big ? 110 : 84, seed: pSeed });
      drawConfetti(ctx, width, height, { seed: pSeed });
    } else if (scene === "crit" || scene === "ultimate" || boss) {
      drawSparks(ctx, ix, iy, { color: accent, count: big ? 20 : 14, maxLen: big ? 92 : 66, seed: pSeed });
    }

    // Primary readout: damage for offensive scenes, banner-driven otherwise.
    const dmgBoost = boss ? 12 : 0;
    if (scene === "miss") {
      drawTitle(ctx, "MISS", ix, iy, "#95a5a6", 46);
    } else if (scene === "ko") {
      drawTitle(ctx, "K.O.", ix, iy + 4, "#ff5555", 64 + dmgBoost);
    } else if (input.isHit && input.damage > 0 && (scene === "attack" || scene === "crit" || scene === "special" || scene === "ultimate" || scene === "counter" || scene === "item")) {
      const dmg = input.isCrit ? `${input.damage.toLocaleString()}!` : `-${input.damage.toLocaleString()}`;
      drawTitle(ctx, dmg, ix, iy, input.isCrit ? "#ff4444" : "#ffffff", (input.isCrit ? 60 : 46) + dmgBoost);
    }
    // Optional caption (e.g. "+120 HP", "Shield +80", status label).
    if (input.subtitle) drawTextWithShadow(ctx, input.subtitle, ix, iy + (scene === "ko" ? 54 : 52), theme.bannerColor, 22);
  });
}
