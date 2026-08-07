// ─────────────────────────────────────────────────────────────────────────────
// HQ — wallpaper registry (data-only).
//
// Real wallpaper: a repeating pattern papered onto the room's two wall faces in
// isometric perspective, with an optional dado rail and skirting so a wall reads
// as a decorated interior surface rather than a flat colour. Before this, "wall
// paper" reused a stretched landscape photo, which never tiled and never looked
// like a wall covering.
//
// A wallpaper is (base colour + motif + accent + repeat density). The motif
// names are generic shapes render-wallpaper.ts knows how to stamp, so adding a
// pattern is a data edit. `spriteKey` is the same asset seam every other HQ
// visual uses: drop `wallpaper/<id>.png` into the pack and the painter blits
// that seamless tile instead of stamping the procedural motif.
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export type WallpaperMotif =
  | "plain"      // flat colour with a soft vertical sheen
  | "stripe"     // vertical two-tone stripes
  | "damask"     // repeating ornamental medallion
  | "floral"     // small five-petal blooms on a stem grid
  | "diamond"    // harlequin lattice
  | "chevron"    // zig-zag bands
  | "brickwork"  // offset brick courses
  | "panel"      // raised rectangular wainscot panels
  | "hex"        // honeycomb tech grid
  | "starfield"  // scattered stars/sparks
  | "circuit"    // traced circuit lines with solder dots
  | "tartan";    // woven cross-hatch plaid

export interface HqWallpaper {
  id: string;
  name: string;
  emoji: string;
  motif: WallpaperMotif;
  base: string;        // wall body colour
  accent: string;      // motif colour
  highlight: string;   // secondary motif / sheen colour
  repeatX: number;     // motif columns across one wall face
  repeatY: number;     // motif rows up one wall face
  dado: string | null; // horizontal rail colour (null = no rail)
  skirting: string;    // baseboard colour
  spriteKey: string;   // asset-pack key "wallpaper/<id>" → optional seamless tile
  unlock: UnlockRule;
  price?: number;      // shard price in the shop's Surfaces aisle
}

export const HQ_WALLPAPERS: HqWallpaper[] = [
  { id: "none", name: "None (wall style)", emoji: "⬜", motif: "plain",
    base: "#d8cbb0", accent: "#c9b795", highlight: "#efe4cc", repeatX: 1, repeatY: 1,
    dado: null, skirting: "#b7a17a", spriteKey: "wallpaper/none", unlock: { kind: "always" } },

  { id: "cream-stripe", name: "Cream Stripe", emoji: "🎽", motif: "stripe",
    base: "#e7dcc4", accent: "#d3c39f", highlight: "#f6efdd", repeatX: 16, repeatY: 1,
    dado: "#a8916a", skirting: "#8f7b58", spriteKey: "wallpaper/cream-stripe", unlock: { kind: "always" } },

  { id: "sage-panel", name: "Sage Wainscot", emoji: "🪟", motif: "panel",
    base: "#8fa48c", accent: "#6f8a6c", highlight: "#c2d3bd", repeatX: 5, repeatY: 2,
    dado: "#e8e2d2", skirting: "#e8e2d2", spriteKey: "wallpaper/sage-panel", unlock: { kind: "always" } },

  { id: "royal-damask", name: "Royal Damask", emoji: "👑", motif: "damask",
    base: "#3b2a55", accent: "#c8a94e", highlight: "#8a6fc0", repeatX: 6, repeatY: 4,
    dado: "#c8a94e", skirting: "#241a35", spriteKey: "wallpaper/royal-damask",
    unlock: { kind: "accountLevel", n: 10 }, price: 1200 },

  { id: "rose-floral", name: "Rose Garden", emoji: "🌹", motif: "floral",
    base: "#f2e3e6", accent: "#d1607f", highlight: "#7fa86a", repeatX: 8, repeatY: 6,
    dado: "#c9a2ad", skirting: "#9c7b84", spriteKey: "wallpaper/rose-floral",
    unlock: { kind: "always" }, price: 500 },

  { id: "harlequin", name: "Harlequin", emoji: "🔷", motif: "diamond",
    base: "#26303e", accent: "#3f5570", highlight: "#7fa8c9", repeatX: 9, repeatY: 6,
    dado: "#7fa8c9", skirting: "#161d26", spriteKey: "wallpaper/harlequin",
    unlock: { kind: "battleWins", n: 10 }, price: 700 },

  { id: "chevron-ash", name: "Ash Chevron", emoji: "📐", motif: "chevron",
    base: "#4c4f56", accent: "#6b6f78", highlight: "#9aa0aa", repeatX: 10, repeatY: 8,
    dado: null, skirting: "#2f3237", spriteKey: "wallpaper/chevron-ash",
    unlock: { kind: "always" }, price: 450 },

  { id: "red-brick", name: "Exposed Brick", emoji: "🧱", motif: "brickwork",
    base: "#8f4a3f", accent: "#7a3b32", highlight: "#c9b9a4", repeatX: 11, repeatY: 12,
    dado: null, skirting: "#4a2620", spriteKey: "wallpaper/red-brick",
    unlock: { kind: "accountLevel", n: 5 }, price: 600 },

  { id: "highland-plaid", name: "Highland Plaid", emoji: "🧣", motif: "tartan",
    base: "#5c2f2f", accent: "#2f4a2f", highlight: "#d8c98a", repeatX: 7, repeatY: 5,
    dado: "#d8c98a", skirting: "#331a1a", spriteKey: "wallpaper/highland-plaid",
    unlock: { kind: "dailyStreak", n: 7 }, price: 800 },

  { id: "neon-hex", name: "Neon Hex", emoji: "🟪", motif: "hex",
    base: "#1a1030", accent: "#b06bff", highlight: "#2fd4d4", repeatX: 10, repeatY: 8,
    dado: "#b06bff", skirting: "#0d0819", spriteKey: "wallpaper/neon-hex",
    unlock: { kind: "accountLevel", n: 20 }, price: 1300 },

  { id: "void-circuit", name: "Void Circuit", emoji: "🛰️", motif: "circuit",
    base: "#0b1418", accent: "#2fd4d4", highlight: "#1d6f74", repeatX: 8, repeatY: 6,
    dado: "#2fd4d4", skirting: "#050a0c", spriteKey: "wallpaper/void-circuit",
    unlock: { kind: "accountLevel", n: 25 }, price: 1500 },

  { id: "starlit", name: "Starlit Night", emoji: "🌌", motif: "starfield",
    base: "#131a33", accent: "#f6e6a8", highlight: "#6f7fd0", repeatX: 14, repeatY: 10,
    dado: null, skirting: "#0a0e1c", spriteKey: "wallpaper/starlit",
    unlock: { kind: "shinyOwned", n: 1 }, price: 1000 },
];

export const DEFAULT_WALLPAPER_ID = "none";

const BY_ID = new Map<string, HqWallpaper>(HQ_WALLPAPERS.map(w => [w.id, w]));

/** Resolve a wallpaper id, degrading to "none" so a stale id never throws. */
export function resolveWallpaper(id: string | null | undefined): HqWallpaper {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_WALLPAPER_ID)!;
}

export function getWallpaperById(id: string): HqWallpaper | undefined {
  return BY_ID.get(id);
}

/** Wallpapers sold in the shop's Surfaces aisle. */
export function buyableWallpapers(): HqWallpaper[] {
  return HQ_WALLPAPERS.filter(w => typeof w.price === "number" && w.price > 0);
}
