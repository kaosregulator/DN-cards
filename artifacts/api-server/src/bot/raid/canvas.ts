// ─────────────────────────────────────────────────────────────────────────────
// Raid canvases — the visual layer that makes Boss Raids feel earned.
//
// Three single-frame PNG renders, all reusing the SHARED animation engine and
// effects helpers (no second renderer):
//   • renderRaidIntro    — the gym-battle moment: battlefield (or dramatic
//     gradient), the boss towering on the right, the party's cards lined up
//     against it, "BOSS RAID" banner. Shown when the fight begins.
//   • renderRaidGallery  — the trophy wall on a clear: every ENABLED boss on
//     the server in a row, with a red ✗ struck through the one just defeated
//     and a "1 down · N remain" caption.
//   • renderRaidWipeScene — the mirror image on a loss: the boss dominant and
//     victorious, the party's cards below with a red ✗ on every downed
//     fighter, plus a damage-dealt/taken readout.
//
// Best-effort like every other canvas: null on failure → plain embed fallback.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getCanvas, hexToRgba, roundRectPath, drawGradientBackground, type Ctx, type CanvasMod,
} from "../animations/engine.js";
import { queueRender } from "../animations/render-queue.js";
import { drawEmbers, drawExplosion } from "../animations/particles.js";
import { drawAtmosphere, atmospherePreset, densityForParticipants } from "../animations/atmosphere.js";
import { drawImpactDebris } from "../animations/physics.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawRarityBadge, drawTextWithShadow,
  drawTitle, fitText, getRarityEffectColor, loadArt, TITLE_FONT,
} from "../animations/effects.js";
import type { Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

export const RAID_CANVAS = { width: 1000, height: 560 } as const;
export const RAID_INTRO_FILE = "raid-intro.png";
export const RAID_GALLERY_FILE = "raid-gallery.png";
export const RAID_WIPE_FILE = "raid-wipe.png";
export const RAID_CAMPAIGN_FILE = "raid-campaign.png";

export interface RaidIntroBoss {
  name: string;
  imageUrl: string | null;
  rarity: Rarity;
  rarityColor?: number | null;
  battlefieldUrl?: string | null;
}

export interface RaidIntroPartyCard {
  name: string;
  imageUrl: string | null;
  rarity: Rarity;
  rarityColor?: number | null;
  stars: number; // card stars shown under the frame
}

// Full-bleed cover-fit background image (battlefield) with a darkening pass so
// the fighters pop. Falls back to a dramatic red-black gradient.
async function layerBattlefield(ctx: Ctx, mod: CanvasMod, url: string | null | undefined, accent: number) {
  const { width, height } = RAID_CANVAS;
  const img = await loadArt(mod, url);
  if (img) {
    const s = Math.max(width / img.width, height / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, width, height);
  } else {
    drawGradientBackground(ctx, width, height, [
      [0, hexToRgba(accent, 0.35)],
      [0.55, "#120a0a"],
      [1, "#050507"],
    ], 0.3);
  }
  // Ground-line vignette so the arena has a floor.
  const g = ctx.createLinearGradient(0, height * 0.72, 0, height);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);
}

export async function renderRaidIntro(
  boss: RaidIntroBoss, party: RaidIntroPartyCard[],
): Promise<Buffer | null> {
  return queueRender("raid-intro", async () => {
  const mod = await getCanvas();
  if (!mod) return null;
  const { width, height } = RAID_CANVAS;
  try {
    const accent = boss.rarityColor ?? getRarityEffectColor(boss.rarity);
    const canvas = mod.createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as Ctx;

    await layerBattlefield(ctx, mod, boss.battlefieldUrl, accent);

    // Ambient arena atmosphere behind everything — fog, dust, and embers, thinned
    // automatically as the party grows so a full raid never spikes CPU.
    drawAtmosphere(ctx, width, height, atmospherePreset("arena"), {
      seed: `${boss.name}-intro`, color: accent, density: densityForParticipants(party.length),
    });

    // Boss panel — towering on the right, bigger than any card on purpose.
    const bw = 330, bh = 420, bx = width - bw - 52, by = 84;
    // Boss entrance: a shockwave radiates from BEHIND the boss (drawn first so
    // the card art stays fully visible on top).
    drawExplosion(ctx, bx + bw / 2, by + bh / 2, { color: accent, radius: 150, ringCount: 3, seed: `${boss.name}-entrance` });
    // Physics debris kicked up at the boss's feet by the stomp (behind the art).
    await drawImpactDebris(ctx, bx + bw / 2, by + bh, {
      color: accent, count: 24, power: 15, spread: 0.7, steps: 16, seed: `${boss.name}-stomp`,
    });
    drawRarityGlow(ctx, bx, by, bw, bh, accent, 0.95);
    await drawCardArt(ctx, mod, bx, by, bw, bh, boss.imageUrl);
    drawCardFrame(ctx, bx, by, bw, bh, accent, 8);
    drawRarityBadge(ctx, bx + bw - 14, by + 16, "BOSS", accent);
    drawTitle(ctx, boss.name, bx + bw / 2, by + bh + 26, "#ffffff", fitText(ctx, boss.name, bw + 60, 28, 12, TITLE_FONT));

    // Fiery embers drifting up around the boss (subtle, in front of the art).
    drawEmbers(ctx, bx - 20, by, bw + 40, bh, { color: accent, count: 40, seed: `${boss.name}-aura` });

    // Party — the challengers' cards lined up on the left, facing the boss.
    const shown = party.slice(0, 4);
    const cw = 150, ch = 210, gap = 22;
    const px0 = 56;
    const py = height - ch - 96;
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i]!;
      const px = px0 + i * (cw + gap);
      const color = p.rarityColor ?? getRarityEffectColor(p.rarity);
      drawRarityGlow(ctx, px, py, cw, ch, color, 0.5);
      await drawCardArt(ctx, mod, px, py, cw, ch, p.imageUrl);
      drawCardFrame(ctx, px, py, cw, ch, color, 5);
      drawTextWithShadow(ctx, p.name, px + cw / 2, py + ch + 18, "#ffffff", fitText(ctx, p.name, cw + 14, 17));
      if (p.stars > 0) drawTextWithShadow(ctx, "★".repeat(Math.min(5, p.stars)), px + cw / 2, py + ch + 40, "#ffd54a", 16);
    }

    // "VS" between party and boss.
    drawTitle(ctx, "VS", (px0 + shown.length * (cw + gap) + bx) / 2, height / 2 + 30, hexToRgba(accent, 1), 64);

    // Title banner.
    drawTitle(ctx, "⚔ BOSS RAID ⚔", width / 2, 40, "#ffffff", 40);
    drawTitle(ctx, "THE CHALLENGE BEGINS", width / 2, 74, hexToRgba(accent, 1), 20);

    return await canvas.encode("png");
  } catch (err) {
    logger.debug({ err }, "raid intro canvas: render failed");
    return null;
  }
  });
}

// ── Defeat gallery — the roster wall with the beaten boss struck out ─────────
export interface GalleryBoss {
  name: string;
  imageUrl: string | null;
  rarity: Rarity;
  defeated: boolean; // the boss this party just beat
}

export async function renderRaidGallery(bosses: GalleryBoss[]): Promise<Buffer | null> {
  return queueRender("raid-gallery", async () => {
  const mod = await getCanvas();
  if (!mod) return null;
  const shown = bosses.slice(0, 8);
  if (shown.length === 0) return null;

  // Layout: single row up to 4, two rows beyond.
  const cols = Math.min(4, shown.length);
  const rows = Math.ceil(shown.length / cols);
  const cw = 190, ch = 250, gap = 26, padX = 60, padTop = 96, padBottom = 66;
  const width = Math.max(640, padX * 2 + cols * cw + (cols - 1) * gap);
  const height = padTop + rows * ch + (rows - 1) * (gap + 26) + padBottom;

  try {
    const canvas = mod.createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as Ctx;
    drawGradientBackground(ctx, width, height, [
      [0, "rgba(46,204,113,0.25)"],
      [0.5, "#0b0f14"],
      [1, "#06070a"],
    ], 0.3);

    drawTitle(ctx, "🏆 BOSS ROSTER", width / 2, 38, "#ffffff", 34);
    const downed = shown.filter(b => b.defeated).length;
    const remain = shown.length - downed;
    drawTextWithShadow(
      ctx,
      `${downed} boss${downed === 1 ? "" : "es"} down · ${remain} remain${remain === 1 ? "s" : ""}`,
      width / 2, 70, "#8fffc0", 19,
    );

    for (let i = 0; i < shown.length; i++) {
      const b = shown[i]!;
      const col = i % cols, row = Math.floor(i / cols);
      const x = padX + col * (cw + gap);
      const y = padTop + row * (ch + gap + 26);
      const color = getRarityEffectColor(b.rarity);
      drawRarityGlow(ctx, x, y, cw, ch, b.defeated ? 0x2ecc71 : color, b.defeated ? 0.35 : 0.55);
      await drawCardArt(ctx, mod, x, y, cw, ch, b.imageUrl);
      drawCardFrame(ctx, x, y, cw, ch, b.defeated ? 0x2ecc71 : color, 6);
      if (b.defeated) {
        // Dim the portrait, then strike it with a bold red ✗.
        ctx.save();
        roundRectPath(ctx, x, y, cw, ch, 14);
        ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = "rgba(231,60,60,0.95)";
        ctx.lineWidth = 14;
        ctx.beginPath(); ctx.moveTo(x + 18, y + 18); ctx.lineTo(x + cw - 18, y + ch - 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + cw - 18, y + 18); ctx.lineTo(x + 18, y + ch - 18); ctx.stroke();
        ctx.restore();
        drawTextWithShadow(ctx, "DEFEATED", x + cw / 2, y + ch - 20, "#ff6b6b", 20);
      }
      drawTextWithShadow(ctx, b.name, x + cw / 2, y + ch + 18, b.defeated ? "#8fffc0" : "#ffffff", fitText(ctx, b.name, cw + 10, 18));
    }

    return await canvas.encode("png");
  } catch (err) {
    logger.debug({ err }, "raid gallery canvas: render failed");
    return null;
  }
  });
}

// ── Wipe/loss scene — the boss stands over the fallen party ─────────────────
// The mirror image of renderRaidIntro: the boss victorious and dominant, the
// party's cards below with a red ✗ struck through each downed fighter, plus a
// damage-dealt/damage-taken readout. Shown on a wipe or timeout loss.
export interface RaidWipePartyCard {
  name: string;
  imageUrl: string | null;
  rarity: Rarity;
  rarityColor?: number | null;
  downed: boolean; // struck with a red ✗ when true
}

export async function renderRaidWipeScene(
  boss: RaidIntroBoss,
  party: RaidWipePartyCard[],
  damageDealt: number,
  damageTaken: number,
): Promise<Buffer | null> {
  return queueRender("raid-wipe", async () => {
  const mod = await getCanvas();
  if (!mod) return null;
  const { width, height } = RAID_CANVAS;
  try {
    const accent = boss.rarityColor ?? getRarityEffectColor(boss.rarity);
    const canvas = mod.createCanvas(width, height);
    const ctx = canvas.getContext("2d") as unknown as Ctx;

    await layerBattlefield(ctx, mod, boss.battlefieldUrl, accent);
    // Extra red wash for the defeat mood.
    ctx.fillStyle = "rgba(120,0,0,0.18)";
    ctx.fillRect(0, 0, width, height);
    // Smoke + settling ash over the loss, thinned by party size. Behind fighters.
    drawAtmosphere(ctx, width, height, atmospherePreset("ash"), {
      seed: `${boss.name}-wipe`, color: accent, density: densityForParticipants(party.length),
    });

    drawTitle(ctx, "💀 RAID FAILED 💀", width / 2, 32, "#ff5555", 32);

    // Boss dominant, centered, victorious — sized so its name + the damage
    // readout both fit above the party row with no overlap.
    const bw = 230, bh = 210, bx = (width - bw) / 2, by = 54;
    drawRarityGlow(ctx, bx, by, bw, bh, accent, 1);
    await drawCardArt(ctx, mod, bx, by, bw, bh, boss.imageUrl);
    drawCardFrame(ctx, bx, by, bw, bh, accent, 7);
    drawRarityBadge(ctx, bx + bw - 12, by + 14, "VICTOR", accent);
    drawTitle(ctx, boss.name, width / 2, by + bh + 24, "#ffffff", fitText(ctx, boss.name, bw + 200, 26, 12, TITLE_FONT));

    // Damage readout — one centered line between the boss and the party row.
    drawTextWithShadow(
      ctx, `⚔️ Dealt ${damageDealt.toLocaleString()}     🛡️ Taken ${damageTaken.toLocaleString()}`,
      width / 2, by + bh + 54, "#ffcc66", 19,
    );

    // The party below, each downed fighter struck out.
    const shown = party.slice(0, 4);
    const cw = 130, ch = 150, gap = 22;
    const rowY = height - ch - 46;
    const totalW = shown.length * cw + Math.max(0, shown.length - 1) * gap;
    const startX = (width - totalW) / 2;
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i]!;
      const px = startX + i * (cw + gap);
      const color = p.rarityColor ?? getRarityEffectColor(p.rarity);
      drawRarityGlow(ctx, px, rowY, cw, ch, p.downed ? 0xe74c3c : color, p.downed ? 0.3 : 0.6);
      await drawCardArt(ctx, mod, px, rowY, cw, ch, p.imageUrl);
      drawCardFrame(ctx, px, rowY, cw, ch, p.downed ? 0x8a1f1f : color, 5);
      if (p.downed) {
        ctx.save();
        roundRectPath(ctx, px, rowY, cw, ch, 12);
        ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(px, rowY, cw, ch);
        ctx.strokeStyle = "rgba(231,60,60,0.95)";
        ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(px + 10, rowY + 10); ctx.lineTo(px + cw - 10, rowY + ch - 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + cw - 10, rowY + 10); ctx.lineTo(px + 10, rowY + ch - 10); ctx.stroke();
        ctx.restore();
      }
      drawTextWithShadow(ctx, p.name, px + cw / 2, rowY + ch + 16, p.downed ? "#ff8080" : "#ffffff", fitText(ctx, p.name, cw + 10, 15));
    }

    return await canvas.encode("png");
  } catch (err) {
    logger.debug({ err }, "raid wipe canvas: render failed");
    return null;
  }
  });
}

// ── Campaign progress — the "keep going" screen shown on a clear ──────────────
// Reuses this file's helpers (battlefield, card art, embers, titles) plus the
// progression-bar style from the user-hub header. Left: the boss you just beat.
// Right: rewards earned, a segmented X/N campaign bar, and the next boss (or the
// "Final Boss Unlocked" / "Campaign Complete" milestone). Best-effort → null.

export interface CampaignBossArt {
  name: string;
  imageUrl: string | null;
  rarity: Rarity;
  battlefieldUrl?: string | null;
}

export interface CampaignProgressInput {
  defeatedBoss: CampaignBossArt;
  rewards: string[];               // e.g. ["🃏 Boss Card", "🖼️ Aegis Frame", "💠 500 Shards"]
  defeated: number;
  total: number;
  next: { name: string; imageUrl: string | null; rarity: Rarity } | null;
  isFinaleNext: boolean;
  isComplete: boolean;
}

// Segmented progress meter: `total` rounded cells, `filled` of them lit.
function drawSegmentedBar(
  ctx: Ctx, x: number, y: number, w: number, h: number, filled: number, total: number, color: number,
): void {
  const n = Math.max(1, total);
  const gap = n > 1 ? 8 : 0;
  const cw = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const cx = x + i * (cw + gap);
    const lit = i < filled;
    ctx.save();
    roundRectPath(ctx, cx, y, cw, h, Math.min(8, h / 2));
    ctx.fillStyle = lit ? hexToRgba(color, 0.95) : "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = lit ? hexToRgba(color, 1) : "rgba(255,255,255,0.22)";
    roundRectPath(ctx, cx, y, cw, h, Math.min(8, h / 2));
    ctx.stroke();
    ctx.restore();
  }
}

export async function renderCampaignProgress(input: CampaignProgressInput): Promise<Buffer | null> {
  return queueRender("raid-campaign", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    const { width, height } = RAID_CANVAS;
    try {
      const accent = getRarityEffectColor(input.defeatedBoss.rarity);
      const gold = 0xffd54a, green = 0x2ecc71;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;

      await layerBattlefield(ctx, mod, input.defeatedBoss.battlefieldUrl, accent);
      ctx.fillStyle = "rgba(6,12,10,0.58)";
      ctx.fillRect(0, 0, width, height);
      drawEmbers(ctx, 0, 0, width, height, { color: gold, seed: `${input.defeatedBoss.name}-victory` });

      drawTitle(ctx, "BOSS DEFEATED!", width / 2, 46, hexToRgba(gold, 1), 40);

      // Left: the boss just beaten.
      const cw = 300, ch = 384, cx = 56, cy = 96;
      drawRarityGlow(ctx, cx, cy, cw, ch, green, 0.5);
      await drawCardArt(ctx, mod, cx, cy, cw, ch, input.defeatedBoss.imageUrl);
      drawCardFrame(ctx, cx, cy, cw, ch, green, 7);
      // DEFEATED stamp
      ctx.save();
      roundRectPath(ctx, cx, cy, cw, ch, 14); ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(cx, cy, cw, ch);
      ctx.restore();
      drawTextWithShadow(ctx, "DEFEATED", cx + cw / 2, cy + ch - 22, "#8fffc0", 22);
      drawTextWithShadow(ctx, input.defeatedBoss.name, cx + cw / 2, cy + ch + 26, "#ffffff", fitText(ctx, input.defeatedBoss.name, cw + 20, 24));

      // Right column.
      const rx = 400, rw = width - rx - 44;
      let y = 108;

      drawTextWithShadow(ctx, "REWARDS EARNED", rx, y, hexToRgba(gold, 1), 22, "left"); y += 32;
      for (const r of input.rewards.slice(0, 3)) {
        drawTextWithShadow(ctx, `+ ${r}`, rx + 6, y, "#ffffff", 20, "left"); y += 28;
      }
      if (input.rewards.length === 0) { drawTextWithShadow(ctx, "—", rx + 6, y, "#aab0c0", 20, "left"); y += 28; }
      y += 16;

      ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + rw, y); ctx.stroke();
      y += 30;

      drawTextWithShadow(ctx, "CAMPAIGN PROGRESS", rx, y, hexToRgba(gold, 1), 22, "left"); y += 30;
      drawSegmentedBar(ctx, rx, y, rw, 26, input.defeated, input.total, green); y += 26 + 26;
      drawTextWithShadow(ctx, `${input.defeated} / ${input.total} bosses defeated`, rx, y, "#ffffff", 20, "left"); y += 40;

      // Next / milestone.
      if (input.isComplete) {
        drawTitle(ctx, "CAMPAIGN COMPLETE", rx, y + 8, hexToRgba(gold, 1), 30, "left");
        drawTextWithShadow(ctx, "You've conquered every boss on the ladder.", rx, y + 40, "#8fffc0", 18, "left");
      } else if (input.next) {
        const bannerColor = input.isFinaleNext ? gold : accent;
        drawTextWithShadow(ctx, input.isFinaleNext ? "FINAL BOSS UNLOCKED" : "NEXT BOSS", rx, y, hexToRgba(bannerColor, 1), 20, "left"); y += 12;
        const nw = 96, nh = 122, ny = y;
        drawRarityGlow(ctx, rx, ny, nw, nh, getRarityEffectColor(input.next.rarity), 0.5);
        await drawCardArt(ctx, mod, rx, ny, nw, nh, input.next.imageUrl);
        drawCardFrame(ctx, rx, ny, nw, nh, getRarityEffectColor(input.next.rarity), 5);
        drawTextWithShadow(ctx, input.next.name, rx + nw + 18, ny + nh / 2, "#ffffff", fitText(ctx, input.next.name, rw - nw - 24, 26), "left");
      }

      return await canvas.encode("png");
    } catch (err) {
      logger.debug({ err }, "raid campaign canvas: render failed");
      return null;
    }
  });
}
