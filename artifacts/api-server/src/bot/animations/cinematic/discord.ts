// ─────────────────────────────────────────────────────────────────────────────
// Scripted-Discord cinematic layers — a reusable "fake Discord" UI toolkit.
//
// The onboarding adventure (and any future tutorial) recreates Discord ON the
// existing canvas rather than shipping prerecorded GIFs: a channel that types a
// slash command, shows autocomplete, moves a cursor, presses a button, and prints
// a bot reply. Every piece here is a LAYER FACTORY for the Cinematic Engine, so a
// tutorial is authored as a SCRIPT — a list of these layers with timings — not as
// a new bespoke animation. Add a new lesson by composing existing layers.
//
// Built entirely on the shared cinematic engine + canvas helpers; no new deps.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp01, hexToRgba, lerp, roundRectPath, type Ctx } from "../engine.js";
import { keyframes, ease, renderCinematic, type CinematicLayer, type CinematicFrame } from "./engine.js";
import type { AnimationResult } from "../types.js";

// ── Discord dark-theme palette ────────────────────────────────────────────────
export const DISCORD = {
  chatBg: 0x313338,
  headerBg: 0x2b2d31,
  inputBg: 0x383a40,
  popupBg: 0x2b2d31,
  popupHover: 0x36373d,
  card: 0x2b2d31,
  textNormal: 0xdbdee1,
  textMuted: 0x949ba4,
  textBright: 0xffffff,
  blurple: 0x5865f2,
  green: 0x248046,
  grey: 0x4e5058,
  red: 0xda373c,
  divider: 0x3f4147,
} as const;

export type ButtonStyle = "blurple" | "green" | "grey" | "red";
const BTN_COLOR: Record<ButtonStyle, number> = {
  blurple: DISCORD.blurple, green: DISCORD.green, grey: DISCORD.grey, red: DISCORD.red,
};

// ── Text helper ───────────────────────────────────────────────────────────────
const SANS = `"DejaVu Sans", "Arial", sans-serif`;
interface TextOpts { size?: number; weight?: number | string; color?: number; align?: "left" | "center" | "right"; alpha?: number; }
function text(ctx: Ctx, str: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.font = `${o.weight ?? 400} ${o.size ?? 16}px ${SANS}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = hexToRgba(o.color ?? DISCORD.textNormal, 1);
  ctx.fillText(str, x, y);
  ctx.restore();
}

// Fade/slide-in envelope shared by most UI elements: 0 before `at`, eases to 1
// over `dur`, and holds. Returns { alpha, rise } — rise is a small upward slide.
function appear(t: number, at: number, dur = 0.06): { alpha: number; rise: number } {
  const p = clamp01((t - at) / dur);
  const e = ease.outCubic(p);
  return { alpha: e, rise: (1 - e) * 10 };
}

// ── Layers ────────────────────────────────────────────────────────────────────

// The channel backdrop: chat area + a top header with the channel name. Always
// the first layer of a scene.
export function discordChrome(opts: { channelName?: string } = {}): CinematicLayer {
  const name = opts.channelName ?? "dn-cards";
  return ({ ctx, width, height }: CinematicFrame) => {
    ctx.fillStyle = hexToRgba(DISCORD.chatBg, 1);
    ctx.fillRect(0, 0, width, height);
    // header
    ctx.fillStyle = hexToRgba(DISCORD.headerBg, 1);
    ctx.fillRect(0, 0, width, 48);
    ctx.fillStyle = hexToRgba(DISCORD.divider, 1);
    ctx.fillRect(0, 48, width, 1);
    text(ctx, "#", 20, 31, { size: 20, weight: 700, color: DISCORD.textMuted });
    text(ctx, name, 38, 31, { size: 17, weight: 700, color: DISCORD.textBright });
  };
}

// A chat message: avatar + bold name + timestamp + one or more text lines.
export function chatMessage(opts: {
  author: string; authorColor?: number; avatarColor?: number;
  lines: string[]; y: number; at: number; timestamp?: string;
}): CinematicLayer {
  const authorColor = opts.authorColor ?? DISCORD.textBright;
  const avatarColor = opts.avatarColor ?? DISCORD.blurple;
  return ({ ctx, t }: CinematicFrame) => {
    const { alpha, rise } = appear(t, opts.at);
    if (alpha <= 0) return;
    const y = opts.y - rise;
    ctx.save();
    ctx.globalAlpha = alpha;
    // avatar
    ctx.fillStyle = hexToRgba(avatarColor, 1);
    ctx.beginPath(); ctx.arc(38, y + 6, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hexToRgba(0xffffff, 0.9);
    text(ctx, opts.author.slice(0, 1).toUpperCase(), 38, y + 12, { size: 18, weight: 700, color: 0xffffff, align: "center" });
    // name + timestamp
    text(ctx, opts.author, 70, y + 2, { size: 16, weight: 700, color: authorColor });
    const nameW = measure(ctx, opts.author, 16, 700);
    if (opts.timestamp) text(ctx, opts.timestamp, 70 + nameW + 10, y + 1, { size: 12, color: DISCORD.textMuted });
    // lines
    opts.lines.forEach((ln, i) => text(ctx, ln, 70, y + 26 + i * 22, { size: 16, color: DISCORD.textNormal }));
    ctx.restore();
  };
}

// A "Bot is typing…" indicator with three bouncing dots. Shown between at..until.
export function typingIndicator(opts: { author?: string; y: number; at: number; until: number }): CinematicLayer {
  const author = opts.author ?? "DN Bot";
  return ({ ctx, t }: CinematicFrame) => {
    if (t < opts.at || t > opts.until) return;
    const y = opts.y;
    ctx.save();
    // three dots
    for (let i = 0; i < 3; i++) {
      const bounce = Math.sin(t * Math.PI * 8 - i * 0.7) * 0.5 + 0.5;
      ctx.fillStyle = hexToRgba(DISCORD.textMuted, 0.5 + bounce * 0.5);
      ctx.beginPath(); ctx.arc(74 + i * 14, y - bounce * 3, 4, 0, Math.PI * 2); ctx.fill();
    }
    text(ctx, `${author} is typing…`, 74 + 3 * 14 + 8, y + 5, { size: 13, color: DISCORD.textMuted, alpha: 0.9 });
    ctx.restore();
  };
}

// The message input box that types a slash command, with a slash-command
// autocomplete popup floating above it (options + a highlighted row). The
// command text types out char-by-char between `at` and `typeUntil`.
export function slashInput(opts: {
  command: string;                    // e.g. "/daily" or "/pack tier:basic"
  y: number;                          // input box top
  width: number;
  at: number; typeUntil: number;
  autocomplete?: { label: string; desc?: string }[];
  highlight?: number;                 // which autocomplete row is highlighted
  showPopupUntil?: number;            // popup fades out after this phase
}): CinematicLayer {
  return ({ ctx, t, width: W }: CinematicFrame) => {
    const boxX = 16, boxW = opts.width ?? W - 32, boxH = 44, y = opts.y;
    // typed portion of the command
    const typed = clamp01((t - opts.at) / Math.max(0.001, opts.typeUntil - opts.at));
    const shown = opts.command.slice(0, Math.round(typed * opts.command.length));

    // autocomplete popup (above the box) while typing
    const popup = opts.autocomplete ?? [];
    const popupAlpha = clamp01((t - opts.at) / 0.05) * (opts.showPopupUntil != null ? clamp01((opts.showPopupUntil - t) / 0.05) : 1);
    if (popup.length && popupAlpha > 0) {
      const rowH = 40, padTop = 8, popupH = padTop * 2 + popup.length * rowH;
      const popupY = y - 10 - popupH;
      ctx.save();
      ctx.globalAlpha = popupAlpha;
      ctx.fillStyle = hexToRgba(DISCORD.popupBg, 1);
      roundRectPath(ctx, boxX, popupY, boxW, popupH, 8); ctx.fill();
      ctx.strokeStyle = hexToRgba(0x000000, 0.4); ctx.lineWidth = 1; ctx.stroke();
      popup.forEach((o, i) => {
        const ry = popupY + padTop + i * rowH;
        if (i === (opts.highlight ?? 0)) {
          ctx.fillStyle = hexToRgba(DISCORD.popupHover, 1);
          roundRectPath(ctx, boxX + 4, ry, boxW - 8, rowH - 4, 5); ctx.fill();
        }
        text(ctx, o.label, boxX + 16, ry + 18, { size: 15, weight: 600, color: DISCORD.textBright });
        if (o.desc) text(ctx, o.desc, boxX + 16, ry + 33, { size: 12, color: DISCORD.textMuted });
      });
      ctx.restore();
    }

    // the input box
    ctx.save();
    ctx.fillStyle = hexToRgba(DISCORD.inputBg, 1);
    roundRectPath(ctx, boxX, y, boxW, boxH, 8); ctx.fill();
    // "+" affordance
    ctx.fillStyle = hexToRgba(DISCORD.textMuted, 1);
    ctx.beginPath(); ctx.arc(boxX + 24, y + boxH / 2, 11, 0, Math.PI * 2); ctx.fill();
    text(ctx, "+", boxX + 24, y + boxH / 2 + 6, { size: 20, weight: 700, color: DISCORD.chatBg, align: "center" });
    // typed command — slash commands render the leading token in blurple
    const slashEnd = shown.indexOf(" ") === -1 ? shown.length : shown.indexOf(" ");
    text(ctx, shown.slice(0, slashEnd), boxX + 46, y + boxH / 2 + 6, { size: 16, weight: 600, color: DISCORD.blurple });
    const headW = measure(ctx, shown.slice(0, slashEnd), 16, 600);
    if (shown.length > slashEnd) text(ctx, shown.slice(slashEnd), boxX + 46 + headW, y + boxH / 2 + 6, { size: 16, color: DISCORD.textNormal });
    // blinking caret
    if (Math.floor(t * 20) % 2 === 0) {
      const caretX = boxX + 46 + measure(ctx, shown.slice(0, slashEnd), 16, 600) + (shown.length > slashEnd ? measure(ctx, shown.slice(slashEnd), 16, 400) : 0) + 2;
      ctx.fillStyle = hexToRgba(DISCORD.textNormal, 0.9);
      ctx.fillRect(caretX, y + 12, 2, boxH - 24);
    }
    ctx.restore();
  };
}

// A row of Discord buttons; one depresses/glows when "pressed" at `pressAt`.
export function buttonRow(opts: {
  buttons: { label: string; style?: ButtonStyle }[];
  x: number; y: number; at: number;
  pressIndex?: number; pressAt?: number;
}): CinematicLayer {
  return ({ ctx, t }: CinematicFrame) => {
    const { alpha } = appear(t, opts.at);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    let x = opts.x;
    const h = 36, gap = 8;
    opts.buttons.forEach((b, i) => {
      const w = Math.max(80, measure(ctx, b.label, 14, 600) + 28);
      const pressed = opts.pressIndex === i && opts.pressAt != null && t >= opts.pressAt && t < opts.pressAt + 0.12;
      const c = BTN_COLOR[b.style ?? "grey"];
      ctx.fillStyle = hexToRgba(c, pressed ? 0.75 : 1);
      const oy = pressed ? 2 : 0;
      roundRectPath(ctx, x, opts.y + oy, w, h, 6); ctx.fill();
      if (pressed) { ctx.strokeStyle = hexToRgba(0xffffff, 0.5); ctx.lineWidth = 2; ctx.stroke(); }
      text(ctx, b.label, x + w / 2, opts.y + h / 2 + 5 + oy, { size: 14, weight: 600, color: DISCORD.textBright, align: "center" });
      x += w + gap;
    });
    ctx.restore();
  };
}

// A bot response embed: coloured left bar, bold title, and description lines.
export function botReply(opts: {
  title: string; lines: string[]; color?: number; y: number; at: number; width?: number;
}): CinematicLayer {
  const color = opts.color ?? DISCORD.blurple;
  return ({ ctx, t, width: W }: CinematicFrame) => {
    const { alpha, rise } = appear(t, opts.at, 0.08);
    if (alpha <= 0) return;
    const x = 70, w = opts.width ?? W - 100, y = opts.y - rise;
    const h = 44 + opts.lines.length * 22;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hexToRgba(DISCORD.card, 1);
    roundRectPath(ctx, x, y, w, h, 6); ctx.fill();
    ctx.fillStyle = hexToRgba(color, 1);
    roundRectPath(ctx, x, y, 5, h, 3); ctx.fill();
    text(ctx, opts.title, x + 18, y + 26, { size: 16, weight: 700, color: DISCORD.textBright });
    opts.lines.forEach((ln, i) => text(ctx, ln, x + 18, y + 48 + i * 22, { size: 15, color: DISCORD.textNormal }));
    ctx.restore();
  };
}

// A mouse cursor that glides across keyframed points and ripples on clicks.
export function cursor(opts: {
  points: { at: number; x: number; y: number }[];
  clicks?: number[];
}): CinematicLayer {
  return ({ ctx, t }: CinematicFrame) => {
    if (opts.points.length === 0 || t < opts.points[0]!.at) return;
    const x = keyframes(t, opts.points.map(p => ({ at: p.at, value: p.x, ease: ease.inOutCubic })));
    const y = keyframes(t, opts.points.map(p => ({ at: p.at, value: p.y, ease: ease.inOutCubic })));
    // click ripple
    for (const c of opts.clicks ?? []) {
      const d = t - c;
      if (d >= 0 && d < 0.18) {
        const p = d / 0.18;
        ctx.save();
        ctx.strokeStyle = hexToRgba(0xffffff, (1 - p) * 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 6 + p * 22, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    // arrow cursor
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#000000"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 18); ctx.lineTo(4.5, 13.5); ctx.lineTo(8, 20); ctx.lineTo(11, 18.5);
    ctx.lineTo(7.5, 12); ctx.lineTo(13, 12); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  };
}

// ── Scene composition ─────────────────────────────────────────────────────────
export interface ScriptedScene {
  width?: number;
  height?: number;
  durationMs?: number;
  seed?: string;
  channelName?: string;
  /** Element layers (built from the factories above) drawn over the chrome. */
  layers: CinematicLayer[];
}

/**
 * Render a scripted "fake Discord" scene to a looping GIF. The channel chrome is
 * added automatically as the base layer; callers pass the timed element layers.
 * This is the one entry point a tutorial script uses.
 */
export async function renderScriptedScene(scene: ScriptedScene): Promise<AnimationResult | null> {
  return renderCinematic({
    width: scene.width ?? 720,
    height: scene.height ?? 460,
    durationMs: scene.durationMs ?? 5200,
    seed: scene.seed ?? "onboarding",
    maxFrames: 40,
    quality: 18,
    renderScale: 0.9,
    layers: [discordChrome({ channelName: scene.channelName }), ...scene.layers],
  });
}

// Precise text width for layout math (matches the SANS stack used above).
function measure(ctx: Ctx, str: string, size: number, weight: number | string = 400): number {
  ctx.save();
  ctx.font = `${weight} ${size}px ${SANS}`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

// Small shared easing re-export so scripts can time custom motion without
// reaching into the engine module directly.
export { ease, keyframes, lerp };
