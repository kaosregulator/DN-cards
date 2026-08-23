import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Shared animated banner + section palette for the unified /help hub (and other
// intro embeds). The banner is a free, direct-hotlink animated GIF — a full-
// width glowing stripe that renders inline in Discord embeds (the same asset the
// welcome guide already uses, from the widely-used GitHub user-images CDN).
//
// Everything here is a DEFAULT: the /help embed runs through applyEmbedOverride
// with the "help" key, so an admin can swap the banner, color, title, or footer
// at any time with `/embed set key:help field:customImageUrl value:<url>` — no
// code change required.

// Free, hotlinkable animated divider GIF (renders as an animated stripe in
// Discord). Kept as the single reliable default; admins can override per guild.
export const HELP_BANNER =
  "https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif";

// A slimmer animated line used as an in-embed separator where a full banner
// would be too heavy. Same source family; overridable via the "help" key.
export const HELP_DIVIDER = HELP_BANNER;

// Brand palette (dark military theme). Each help section gets an accent color so
// pages feel distinct even though they share one animated banner.
// ── Brand name — the single source of truth for the bot's display name. ───────
// Rename the whole bot here: every user-visible title/footer that shows the
// brand imports BRAND_NAME, so a rebrand is one edit. BRAND_SHORT is the casual
// form used mid-sentence where the full name would read as heavy ("your cards",
// "card battles"). Comments, logs and internal ids are intentionally NOT keyed
// off these — they never reach a player.
export const BRAND_NAME = "Dex N Cards";
export const BRAND_SHORT = "Cards";

export const BRAND_COLOR = 0xe63946; // DarkNight red

export const SECTION_COLOR = {
  home:     0xe63946, // red
  collect:  0x3498db, // blue
  economy:  0xf1c40f, // gold
  trade:    0x2ecc71, // green
  battle:   0xe74c3c, // combat red
  giveaway: 0x9b59b6, // purple
  quests:   0xe67e22, // orange
  social:   0x1abc9c, // teal
  admin:    0xeb459e, // pink
} as const;

export type HelpSection = keyof typeof SECTION_COLOR;

// The public site URL, resolved from the Replit domain when available.
export function siteUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  return domain ? `https://${domain}` : "https://dncards.com";
}

// ── Bundled brand art (assets/brand/) ────────────────────────────────────────
// The Dex N Cards banner + circle logo, attached to embeds by name. Resolved
// with a URL-relative-then-cwd fallback (the same approach the font loader uses)
// so it works from the bundled build and a source run alike. Best-effort — a
// missing file returns null and the caller falls back to its default image.

export const BRAND_BANNER_FILE = "brand-banner.png";
export const BRAND_LOGO_FILE = "brand-logo.png";

export function brandAsset(name: string): Buffer | null {
  const candidates = [
    fileURLToPath(new URL(`../../assets/brand/${name}`, import.meta.url)),
    join(process.cwd(), `assets/brand/${name}`),
    join(process.cwd(), `artifacts/api-server/assets/brand/${name}`),
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return readFileSync(p); } catch { /* try next */ }
  }
  return null;
}
