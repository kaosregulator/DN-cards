// Russian roulette duel — multi-scene cinematic GIFs with player avatars.
// Reuses battle particle / loadArt patterns (not a single static flash GIF).

import {
  encodeAnimation, getCanvas, clamp01, lerp, easeInOutCubic, easeOutBack,
  hexToRgba, roundRectPath, type Ctx, type CanvasMod,
} from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import { loadArt } from "../animations/effects.js";
import { drawSparks, drawEmbers, shakeOffset } from "../animations/particles.js";

const W = 640;
const H = 360;

export type RussianScene =
  | "intro"      // two avatars face off, table + toy gun
  | "load"       // chambers loading
  | "spin"       // cylinder spin
  | "raise"      // gun raises toward one player
  | "click"      // safe click
  | "bang";      // bang / loser

export type RussianSceneOpts = {
  scene: RussianScene;
  challengerUrl: string | null;
  targetUrl: string | null;
  challengerName: string;
  targetName: string;
  /** Whose turn / who the gun points at for raise/click/bang */
  aimedAt?: "challenger" | "target";
  chamber?: number;
};

async function loadAvatar(mod: CanvasMod, url: string | null) {
  if (!url) return null;
  try {
    return await loadArt(mod, url);
  } catch {
    return null;
  }
}

function drawAvatarCircle(
  ctx: Ctx,
  img: Awaited<ReturnType<typeof loadArt>>,
  cx: number, cy: number, r: number,
  label: string,
  highlight: boolean,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + (highlight ? 4 : 0), 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "#fbbf24" : "#334155";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    // LoadedImage from @napi-rs/canvas
    ctx.drawImage(img as never, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#475569";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `bold ${Math.floor(r * 0.7)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.slice(0, 1).toUpperCase(), cx, cy);
  }
  ctx.restore();
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label.slice(0, 16), cx, cy + r + 20);
}

/** Toy western revolver — silhouette, not realistic gore. */
function drawToyGun(
  ctx: Ctx,
  cx: number, cy: number,
  opts: { angle?: number; scale?: number; cylinderSpin?: number; raised?: number },
) {
  const angle = opts.angle ?? 0;
  const scale = opts.scale ?? 1;
  const spin = opts.cylinderSpin ?? 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // grip
  ctx.fillStyle = "#5c3a21";
  roundRectPath(ctx, -18, 8, 28, 42, 6);
  ctx.fill();
  // frame
  ctx.fillStyle = "#64748b";
  roundRectPath(ctx, -22, -18, 70, 28, 8);
  ctx.fill();
  // barrel
  ctx.fillStyle = "#475569";
  roundRectPath(ctx, 40, -10, 55, 14, 4);
  ctx.fill();
  // cylinder
  ctx.save();
  ctx.translate(10, -4);
  ctx.rotate(spin);
  ctx.fillStyle = "#94a3b8";
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.fillStyle = i === 0 ? "#ef4444" : "#1e293b";
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 9, Math.sin(a) * 9, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // hammer
  ctx.fillStyle = "#334155";
  ctx.fillRect(-28, -22, 10, 12);
  ctx.restore();
}

function feltTable(ctx: Ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a3d32");
  g.addColorStop(1, "#0c221c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2 + 40, 260, 90, 0, 0, Math.PI * 2);
  ctx.fill();
  // wood rail
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 14;
  ctx.strokeRect(8, 8, W - 16, H - 16);
}

export async function renderRussianScene(opts: RussianSceneOpts): Promise<AnimationResult | null> {
  const mod = await getCanvas();
  if (!mod) return null;
  const [challengerImg, targetImg] = await Promise.all([
    loadAvatar(mod, opts.challengerUrl),
    loadAvatar(mod, opts.targetUrl),
  ]);

  const scene = opts.scene;
  const durationMs =
    scene === "spin" ? 2200
      : scene === "raise" ? 1600
        : scene === "bang" ? 1800
          : scene === "click" ? 1400
            : scene === "load" ? 1800
              : 1600;

  return encodeAnimation({
    width: W, height: H, durationMs, speed: "normal",
    maxFrames: scene === "spin" ? 24 : 18,
    quality: 14, renderScale: 0.8,
    render: async ({ ctx, t }) => {
      feltTable(ctx);
      drawEmbers(ctx, 0, 0, W, H, { count: 18, color: 0xc4a574, seed: `rr-${scene}`, rise: -0.2 });

      const leftX = 130, rightX = W - 130, avY = 130;
      const aimLeft = opts.aimedAt === "challenger";
      const aimRight = opts.aimedAt === "target";

      drawAvatarCircle(
        ctx, challengerImg, leftX, avY, 52,
        opts.challengerName, aimLeft && (scene === "raise" || scene === "bang" || scene === "click"),
      );
      drawAvatarCircle(
        ctx, targetImg, rightX, avY, 52,
        opts.targetName, aimRight && (scene === "raise" || scene === "bang" || scene === "click"),
      );

      // VS badge
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("VS", W / 2, 60);

      const gunY = H / 2 + 40;
      let gunAngle = 0;
      let gunX = W / 2;
      let spin = 0;
      let scale = 1.1;

      if (scene === "intro") {
        gunAngle = -0.4;
        scale = 0.9 + easeOutBack(clamp01(t)) * 0.25;
        ctx.fillStyle = "#a7f3d0";
        ctx.font = "16px sans-serif";
        ctx.fillText("Toy duel · pull when ready", W / 2, H - 28);
      } else if (scene === "load") {
        const loadT = easeInOutCubic(t);
        spin = loadT * Math.PI * 2;
        gunAngle = -0.2;
        // chamber dots lighting up
        for (let i = 0; i < 6; i++) {
          const lit = loadT > (i + 1) / 6;
          ctx.fillStyle = lit ? "#ef4444" : "#334155";
          ctx.beginPath();
          ctx.arc(W / 2 - 60 + i * 24, H - 48, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("Loading chambers…", W / 2, H - 24);
      } else if (scene === "spin") {
        spin = t * Math.PI * 8;
        gunAngle = Math.sin(t * Math.PI * 6) * 0.15;
        const sh = shakeOffset(`spin-${Math.floor(t * 20)}`, 2);
        ctx.translate(sh.dx, sh.dy);
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("Spinning the cylinder…", W / 2, H - 28);
      } else if (scene === "raise") {
        const raise = easeOutBack(clamp01(t));
        gunX = lerp(W / 2, aimLeft ? leftX + 70 : rightX - 70, raise);
        gunAngle = lerp(0, aimLeft ? Math.PI : 0, raise) + (aimLeft ? 0.2 : -0.2);
        scale = lerp(1.1, 1.35, raise);
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("Raising…", W / 2, H - 28);
      } else if (scene === "click") {
        gunX = aimLeft ? leftX + 70 : rightX - 70;
        gunAngle = aimLeft ? Math.PI + 0.2 : -0.2;
        scale = 1.3;
        if (t > 0.3) {
          drawSparks(ctx, gunX + (aimLeft ? -40 : 40), gunY - 10, {
            count: 10, color: 0x4ade80, seed: `click-${Math.floor(t * 8)}`,
          });
        }
        ctx.fillStyle = "#4ade80";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("CLICK — safe", W / 2, H - 32);
      } else if (scene === "bang") {
        gunX = aimLeft ? leftX + 70 : rightX - 70;
        gunAngle = aimLeft ? Math.PI + 0.2 : -0.2;
        scale = 1.35;
        const sh = shakeOffset(`bang-${Math.floor(t * 25)}`, 6 * (1 - t));
        ctx.translate(sh.dx, sh.dy);
        if (t < 0.5) {
          drawSparks(ctx, gunX + (aimLeft ? -50 : 50), gunY - 10, {
            count: 20, color: 0xff6644, maxLen: 80, seed: `bang-${Math.floor(t * 10)}`,
          });
          ctx.fillStyle = hexToRgba(0xffe4a0, 0.5 * (1 - t * 2));
          ctx.beginPath();
          ctx.arc(gunX + (aimLeft ? -40 : 40), gunY - 10, 40 + t * 80, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#f87171";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("BANG!", W / 2, H - 32);
      }

      drawToyGun(ctx, gunX, gunY, {
        angle: gunAngle,
        scale,
        cylinderSpin: spin,
      });
    },
  });
}
