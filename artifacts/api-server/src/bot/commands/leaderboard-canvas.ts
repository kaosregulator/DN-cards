// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard canvas — the clean, avatar-based render behind the unified /top.
//
// One source-agnostic renderer: the caller passes already-resolved rows (rank,
// Discord avatar URL, display name, a big primary value + a muted secondary).
// Reuses the shared animation engine + effect helpers and the user-hub header's
// avatar/rounded-panel style. Best-effort → null falls back to a text embed.
// ─────────────────────────────────────────────────────────────────────────────

import { getCanvas, hexToRgba, roundRectPath, drawGradientBackground, type Ctx } from "../animations/engine.js";
import { drawTextWithShadow, drawTitle, fitText, loadArt } from "../animations/effects.js";
import { queueRender } from "../animations/render-queue.js";
import { logger } from "../../lib/logger.js";

export const LEADERBOARD_FILE = "leaderboard.png";

export interface LbRenderRow {
  rank: number;
  name: string;
  avatarUrl: string | null;
  primary: string;    // headline value, e.g. "2,236,620"
  secondary: string;  // muted detail, e.g. "1878 cards"
}

export interface LeaderboardRender {
  title: string;
  subtitle: string;
  accent: number;     // header/theme accent
  rows: LbRenderRow[];
}

const MEDAL = [0xffd54a, 0xc0c8d0, 0xcd7f32]; // gold / silver / bronze

export async function renderLeaderboard(input: LeaderboardRender): Promise<Buffer | null> {
  return queueRender("leaderboard", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    const rows = input.rows.slice(0, 10);
    const width = 900;
    const headerH = 116;
    const rowH = 72, rowGap = 8, padX = 36, padBottom = 30;
    const height = headerH + Math.max(1, rows.length) * (rowH + rowGap) + padBottom;

    try {
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const accent = input.accent;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(accent, 0.30)],
        [0.5, "#0c0e14"],
        [1, "#07080c"],
      ], 0.35);

      drawTitle(ctx, input.title, width / 2, 44, "#ffffff", 34);
      drawTextWithShadow(ctx, input.subtitle, width / 2, 80, hexToRgba(accent, 1), 18);

      if (rows.length === 0) {
        drawTextWithShadow(ctx, "No entries yet — be the first!", width / 2, headerH + 60, "#aab0c0", 20);
        return await canvas.encode("png");
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const y = headerH + i * (rowH + rowGap);
        const medal = MEDAL[i];

        // Row panel.
        ctx.save();
        roundRectPath(ctx, padX, y, width - padX * 2, rowH, 14);
        ctx.fillStyle = i < 3 ? hexToRgba(medal!, 0.12) : "rgba(255,255,255,0.05)";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = i < 3 ? hexToRgba(medal!, 0.7) : "rgba(255,255,255,0.12)";
        roundRectPath(ctx, padX, y, width - padX * 2, rowH, 14);
        ctx.stroke();
        ctx.restore();

        // Rank badge.
        const rankColor = medal ?? 0x8894a8;
        drawTitle(ctx, `#${r.rank}`, padX + 40, y + rowH / 2, hexToRgba(rankColor, 1), 26);

        // Round avatar.
        const ar = 26, ax = padX + 78, ay = y + rowH / 2 - ar;
        const av = await loadArt(mod, r.avatarUrl).catch(() => null);
        ctx.save();
        ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
        if (av) ctx.drawImage(av, ax, ay, ar * 2, ar * 2);
        else { ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(ax, ay, ar * 2, ar * 2); }
        ctx.restore();
        ctx.save();
        ctx.lineWidth = 2; ctx.strokeStyle = hexToRgba(rankColor, 0.9);
        ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();

        // Name + secondary (left block).
        const nameX = ax + ar * 2 + 18;
        drawTextWithShadow(ctx, r.name, nameX, y + 26, "#ffffff", fitText(ctx, r.name, 360, 22), "left");
        drawTextWithShadow(ctx, r.secondary, nameX, y + 50, "#9aa4b6", 15, "left");

        // Primary value (right-aligned).
        drawTextWithShadow(ctx, r.primary, width - padX - 24, y + rowH / 2, hexToRgba(accent, 1), 26, "right");
      }

      return await canvas.encode("png");
    } catch (err) {
      logger.debug({ err }, "leaderboard canvas: render failed");
      return null;
    }
  });
}
