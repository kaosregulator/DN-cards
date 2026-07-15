// Animated battle turn / victory renderer.
// Generates GIFs for combat turns (attack, projectile, hit, damage, HP bars) and
// a separate victory flourish. The caller decides when to attach them to Discord.

import type { RenderCard } from "../battle/image/render.js";
import type { BattleAnimationInput, VictoryAnimationInput, AnimationSpeed, AnimationResult } from "./types.js";
import {
  encodeAnimation, BATTLE_CANVAS, lerp, easeOutBack, easeInOutCubic, clamp01,
  hexToRgba, drawGradientBackground, roundRectPath, type CanvasMod, type Ctx,
} from "./engine.js";
import {
  createBurst, drawParticles, drawDamageNumber, drawHealthBar,
  drawScreenFlash, drawRarityGlow, drawCardArt, drawCardFrame, drawRarityBadge,
  drawTextWithShadow, fitText, getRarityEffectColor,
} from "./effects.js";
import { extractArtColor } from "../battle/image/vibrant-color.js";

export async function renderBattleTurn(
  input: BattleAnimationInput,
  speed: AnimationSpeed,
): Promise<AnimationResult | null> {
  return encodeAnimation(
    BATTLE_CANVAS.width,
    BATTLE_CANVAS.height,
    speed,
    1800,
    (frame) => renderBattleTurnFrame(frame, input),
  );
}

export async function renderBattleVictory(
  input: VictoryAnimationInput,
  speed: AnimationSpeed,
): Promise<AnimationResult | null> {
  return encodeAnimation(
    BATTLE_CANVAS.width,
    BATTLE_CANVAS.height,
    speed,
    2200,
    (frame) => renderVictoryFrame(frame, input),
  );
}

async function renderBattleTurnFrame(
  frame: import("./engine.js").FrameCtx,
  input: BattleAnimationInput,
): Promise<void> {
  const { ctx, t, mod } = frame;
  const { width, height } = BATTLE_CANVAS;

  const colorA = (await extractArtColor(input.attacker.artUrl))
    ?? (input.attacker.rarityColor ?? getRarityEffectColor(input.attacker.rarity));
  const colorB = (await extractArtColor(input.defender.artUrl))
    ?? (input.defender.rarityColor ?? getRarityEffectColor(input.defender.rarity));
  const bg = undefined; // use vibrant blend

  // Draw the battlefield background.
  drawBattleBackground(ctx, width, height, colorA, colorB, bg);

  const left = { x: 70, y: 45, w: 340, h: 470 };
  const right = { x: 590, y: 45, w: 340, h: 470 };
  const cx = width / 2, cy = height / 2;

  // Phase timing: 0-0.2 idle, 0.2-0.4 lunge, 0.4-0.55 projectile/hit, 0.55-1.0 aftermath
  const lungeT = clamp01((t - 0.20) / 0.20);
  const hitT = clamp01((t - 0.40) / 0.15);
  const afterT = clamp01((t - 0.55) / 0.45);

  // Attacker lunge.
  const attackerOffset = lungeT < 1 ? lerp(0, 120, easeInOutCubic(lungeT)) : lerp(120, 0, easeInOutCubic(afterT));
  const attackerRecoil = input.isHit && hitT > 0 ? lerp(0, 15, easeOutBack(hitT)) : 0;
  const attackerX = left.x + attackerOffset - attackerRecoil;

  // Defender recoil when hit.
  const defenderRecoil = input.isHit && hitT > 0 ? lerp(0, 40, easeOutBack(hitT)) : 0;
  const defenderX = right.x + defenderRecoil;

  // Draw cards.
  await drawBattleCard(ctx, mod, attackerX, left.y, left.w, left.h, input.attacker, colorA);
  await drawBattleCard(ctx, mod, defenderX, right.y, right.w, right.h, input.defender, colorB);

  // Move name banner above attacker.
  drawTextWithShadow(ctx, input.moveName, attackerX + left.w / 2, left.y - 22, "#ffcc33", 22);

  // Projectile / hit flash.
  if (input.isHit && lungeT >= 1 && hitT > 0 && hitT < 1) {
    const px = lerp(attackerX + left.w, defenderX, hitT);
    const py = cy;
    const size = 8 + hitT * 24;
    ctx.save();
    ctx.fillStyle = hexToRgba(colorA, 1 - hitT * 0.5);
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Hit flash.
  if (input.isHit && hitT > 0 && hitT < 0.6) {
    drawScreenFlash(ctx, width, height, hitT / 0.6, colorA);
  }

  // Damage number.
  if (input.isHit && hitT > 0) {
    drawDamageNumber(ctx, input.damage, defenderX + right.w / 2, right.y + 60, hitT, input.isCrit);
  } else if (!input.isHit && hitT > 0) {
    drawDamageNumber(ctx, 0, defenderX + right.w / 2, right.y + 60, hitT, false, true);
  }

  // Burst on hit.
  let particles = createBurst(0, 0, 0, 0); // dummy
  if (input.isHit && hitT > 0 && hitT < 1) {
    const burst = createBurst(defenderX + right.w / 2, right.y + right.h / 2, colorA, input.isCrit ? 80 : 45, 160);
    for (let i = 0; i < burst.length; i++) {
      burst[i]!.x += burst[i]!.vx * hitT * 10;
      burst[i]!.y += burst[i]!.vy * hitT * 10;
    }
    particles = burst;
  }
  drawParticles(ctx, particles);

  // Health bars.
  const barW = 320, barH = 18;
  drawHealthBar(ctx, left.x + 10, left.y + left.h + 18, barW, barH, input.attackerHp, input.attackerMaxHp, colorA, 1, input.attackerHp);
  drawHealthBar(ctx, defenderX + 10, right.y + right.h + 18, barW, barH, input.defenderHp, input.defenderMaxHp, colorB, afterT, input.defenderHp + input.damage);

  // VS badge.
  drawTextWithShadow(ctx, "VS", cx, cy, "#ffcc33", 80);
}

async function renderVictoryFrame(
  frame: import("./engine.js").FrameCtx,
  input: VictoryAnimationInput,
): Promise<void> {
  const { ctx, t, mod } = frame;
  const { width, height } = BATTLE_CANVAS;
  const colorA = (await extractArtColor(input.winner.artUrl))
    ?? (input.winner.rarityColor ?? getRarityEffectColor(input.winner.rarity));
  const colorB = (await extractArtColor(input.loser.artUrl))
    ?? (input.loser.rarityColor ?? getRarityEffectColor(input.loser.rarity));
  drawBattleBackground(ctx, width, height, colorA, colorB, undefined);

  const winnerBox = { x: 220, y: 50, w: 420, h: 440 };
  const scale = 0.9 + 0.1 * Math.sin(t * Math.PI * 4);
  ctx.save();
  ctx.translate(winnerBox.x + winnerBox.w / 2, winnerBox.y + winnerBox.h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-winnerBox.w / 2, -winnerBox.h / 2);
  await drawBattleCard(ctx, mod, winnerBox.x, winnerBox.y, winnerBox.w, winnerBox.h, input.winner, colorA);
  ctx.restore();

  // Victory banner.
  drawTextWithShadow(ctx, "VICTORY", width / 2, 38, "#ffd700", 42);

  // Confetti burst at the start.
  let particles: import("./effects.js").Particle[] = [];
  if (t < 0.6) {
    particles = createBurst(width / 2, height / 2, colorA, 160, 280);
    for (const p of particles) {
      p.x += p.vx * t * 15;
      p.y += p.vy * t * 15;
      p.life = 1 - t / 0.6;
    }
  }
  drawParticles(ctx, particles);
}

function drawBattleBackground(
  ctx: Ctx,
  width: number, height: number,
  colorA: number, colorB: number,
  bg?: string,
): void {
  drawGradientBackground(ctx, width, height, [
    [0, hexToRgba(colorA, 0.22)],
    [0.5, "#0b1622"],
    [1, hexToRgba(colorB, 0.22)],
  ], 0.2);
  // Diagonal split tint.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(width, height); ctx.lineTo(width, 0); ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fill();
  ctx.restore();
}

async function drawBattleCard(
  ctx: Ctx,
  mod: CanvasMod,
  x: number, y: number, w: number, h: number,
  card: RenderCard,
  vibrantColor: number,
): Promise<void> {
  const color = card.rarityColor ?? getRarityEffectColor(card.rarity);
  drawRarityGlow(ctx, x, y, w, h, color, 0.6);
  await drawCardArt(ctx, mod, x + 8, y + 8, w - 16, h - 16, card.artUrl);
  drawCardFrame(ctx, x, y, w, h, color, 7);
  if (card.rarity === "legendary" || card.rarity === "mythic") {
    drawRarityGlow(ctx, x, y, w, h, color, 0.3);
  }
  drawRarityBadge(ctx, x + w - 20, y + 16, card.rarityLabel, color);
  if (card.level) {
    ctx.fillStyle = "rgba(245,245,245,0.92)";
    roundRectPath(ctx, x + 16, y + 16, 42, 34, 6);
    ctx.fill();
    drawTextWithShadow(ctx, String(card.level), x + 37, y + 33, "#111111", 20);
  }
  drawTextWithShadow(ctx, card.name, x + w / 2, y + h - 22, "#ffffff", fitText(ctx, card.name, w - 24, 24));
}

