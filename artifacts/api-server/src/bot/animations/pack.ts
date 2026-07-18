// Pack opening animation renderer.
// Generates a GIF that shows a pack shaking, glowing, bursting, and then flipping
// each card into view with rarity-appropriate effects. Multi-pack opens are
// rendered as a single animated strip of cards.

import type { Rarity } from "../cards-data.js";
import type { RenderCard } from "../battle/image/render.js";
import type { PackAnimationInput, AnimationSpeed, AnimationResult } from "./types.js";
import {
  encodeAnimation, PACK_CANVAS, lerp, easeOutBack, easeInOutCubic, clamp01,
  hexToRgba, drawGradientBackground, type CanvasMod,
} from "./engine.js";
import {
  createBurst, updateParticles, drawParticles, drawRarityGlow, drawFoilOverlay,
  drawHoloSparkles, drawShineSweep, drawCardArt, drawCardFrame, drawRarityBadge,
  drawTextWithShadow, fitText, getRarityEffectColor, rarityBurstCount,
} from "./effects.js";
import { drawAtmosphere } from "./atmosphere.js";
import { simulateWrapperTear, drawWrapperShards } from "./physics.js";

interface PackFrameState {
  particles: Particle[];
  revealed: number;     // how many cards have been revealed
}

type Particle = import("./effects.js").Particle;

export async function renderPackOpening(
  input: PackAnimationInput,
  speed: AnimationSpeed,
): Promise<AnimationResult | null> {
  return encodeAnimation({
    width: PACK_CANVAS.width,
    height: PACK_CANVAS.height,
    speed,
    durationMs: totalDurationMs(input.cards.length),
    // Optimization budget: cap frames, render at 0.72× resolution, and use a
    // coarser palette. Gradients/particles compress poorly, so these keep even
    // large multi-card opens comfortably under Discord's 8MB limit.
    maxFrames: 30,
    quality: 18,
    renderScale: 0.72,
    render: (frame) => renderPackFrame(frame, input),
  });
}

function totalDurationMs(cardCount: number): number {
  return 1500 + cardCount * 550;
}

async function renderPackFrame(
  frame: import("./engine.js").FrameCtx,
  input: PackAnimationInput,
): Promise<void> {
  const { ctx, t } = frame;
  const { width, height } = PACK_CANVAS;

  // Phase timings
  const burstAt = 0.18;
  const revealStart = 0.30;

  // Background gradient from tier color → dark.
  const tierColor = input.tierColor;
  drawGradientBackground(ctx, width, height, [
    [0, hexToRgba(tierColor, 0.35)],
    [0.5, "#0b0d12"],
    [1, "#07080c"],
  ], 0.3);

  // Faint drifting dust + sparks behind everything, tinted to the pack tier.
  drawAtmosphere(ctx, width, height, [
    { kind: "dust", intensity: 0.5 },
    { kind: "sparks", intensity: 0.35, color: tierColor },
  ], { seed: `pack-${input.tier}`, t, color: tierColor });

  // Title
  drawTextWithShadow(ctx, `Opening ${input.tier} Pack…`, width / 2, 40, "#ffffff", 28);

  // Pack box (centered) before the burst.
  const packW = 240, packH = 320, packX = (width - packW) / 2, packY = 100;
  const packT = clamp01(t / burstAt);
  const shake = packT < 1 ? Math.sin(t * 80) * 4 * (1 - packT) : 0;
  const glow = packT < 1 ? packT * 0.8 : 0;

  if (packT < 1) {
    ctx.save();
    ctx.translate(width / 2 + shake, packY + packH / 2);
    ctx.rotate(shake * 0.01);
    ctx.translate(-packW / 2, -packH / 2);
    drawRarityGlow(ctx, 0, 0, packW, packH, tierColor, glow);
    drawCardFrame(ctx, 0, 0, packW, packH, tierColor, 8);
    ctx.fillStyle = "rgba(20,20,24,0.9)";
    ctx.fillRect(20, 20, packW - 40, packH - 40);
    drawTextWithShadow(ctx, "PACK", packW / 2, packH / 2 - 20, "#ffffff", 32);
    drawTextWithShadow(ctx, input.tier, packW / 2, packH / 2 + 20, hexToRgba(tierColor, 1), 24);
    ctx.restore();
  }

  // Burst effect at revealStart.
  let burstT = 0;
  if (t >= burstAt && t <= revealStart) {
    burstT = (t - burstAt) / (revealStart - burstAt);
  } else if (t > revealStart) {
    burstT = 1;
  }
  if (burstT > 0) {
    const ringR = 50 + burstT * 400;
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(tierColor, 1 - burstT);
    ctx.lineWidth = 12 * (1 - burstT);
    ctx.stroke();
    ctx.restore();

    // Physics wrapper tear: the pack's foil splits into fragments that fly out and
    // fall. Advances with the burst; fades as the reveal takes over. Behind cards.
    if (burstT < 1 || t < revealStart + 0.15) {
      const shards = await simulateWrapperTear(width / 2, 160, 240, 320, {
        color: tierColor, count: 16, power: 10,
        steps: Math.max(2, Math.round((0.4 + burstT) * 16)), seed: `wrap-${input.tier}`,
      });
      const fade = clamp01(1 - (t - burstAt) / (revealStart + 0.15 - burstAt));
      for (const s of shards) s.alpha = fade;
      drawWrapperShards(ctx, shards);
    }
  }

  // Card reveals.
  const cards = input.cards;
  const slotW = Math.min(220, (width - 80) / Math.max(1, cards.length));
  const slotH = 340;
  const gap = 20;
  const totalRowW = cards.length * slotW + (cards.length - 1) * gap;
  const startX = (width - totalRowW) / 2;
  const slotY = 120;

  for (let i = 0; i < cards.length; i++) {
    const cardT = clamp01((t - revealStart - i * 0.08) / 0.18);
    if (cardT <= 0) continue;
    const card = cards[i]!;
    const shiny = input.shinies[i] ?? false;
    const rarity = card.rarity;
    const color = getRarityEffectColor(rarity);
    const x = startX + i * (slotW + gap);
    const scale = easeOutBack(cardT);
    const rotation = (1 - cardT) * Math.PI * 1.2;
    const opacity = clamp01(cardT * 1.5);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(x + slotW / 2, slotY + slotH / 2 + 30);
    ctx.scale(scale, scale);
    ctx.rotate(rotation);
    ctx.translate(-slotW / 2, -slotH / 2);

    drawCardArt(ctx, frame.mod, 0, 0, slotW, slotH, card.artUrl);
    drawCardFrame(ctx, 0, 0, slotW, slotH, color, 6);
    drawRarityGlow(ctx, 0, 0, slotW, slotH, color, 0.5);
    if (shiny) {
      drawFoilOverlay(ctx, 0, 0, slotW, slotH, t);
      drawHoloSparkles(ctx, 0, 0, slotW, slotH, t, 20);
    }
    drawRarityBadge(ctx, slotW - 12, 14, card.rarityLabel, color);
    drawTextWithShadow(ctx, card.name, slotW / 2, slotH - 24, "#ffffff", fitText(ctx, card.name, slotW - 24, 22));
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Final "pack opened" line.
  if (t > 0.9) {
    drawTextWithShadow(ctx, `${cards.length} cards added to your collection`, width / 2, height - 28, "#aaaaaa", 18);
  }
}
