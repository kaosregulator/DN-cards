import type { Card } from "@/hooks/queries";

/** Built-in rarity keys that have dedicated theme colors. Custom tier slugs
 *  (e.g. "gold_legendary") fall back to their base `rarity` for styling. */
export type RarityKey = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export const RARITY_BADGE: Record<RarityKey, string> = {
  common: "bg-muted text-muted-foreground border-muted-foreground/30",
  uncommon: "bg-[hsl(var(--rarity-uncommon)_/_0.1)] text-[hsl(var(--rarity-uncommon))] border-[hsl(var(--rarity-uncommon)_/_0.3)]",
  rare: "bg-[hsl(var(--rarity-rare)_/_0.1)] text-[hsl(var(--rarity-rare))] border-[hsl(var(--rarity-rare)_/_0.3)]",
  epic: "bg-[hsl(var(--rarity-epic)_/_0.1)] text-[hsl(var(--rarity-epic))] border-[hsl(var(--rarity-epic)_/_0.3)]",
  legendary: "bg-[hsl(var(--rarity-legendary)_/_0.1)] text-[hsl(var(--rarity-legendary))] border-[hsl(var(--rarity-legendary)_/_0.3)]",
  mythic: "bg-pink-500/10 text-pink-400 border-pink-500/30",
};

export const RARITY_BORDER: Record<RarityKey, string> = {
  common: "border-border",
  uncommon: "border-[hsl(var(--rarity-uncommon)_/_0.5)]",
  rare: "border-[hsl(var(--rarity-rare)_/_0.5)]",
  epic: "border-[hsl(var(--rarity-epic)_/_0.5)]",
  legendary: "border-[hsl(var(--rarity-legendary))] rarity-glow-legendary",
  mythic: "border-pink-500 rarity-glow-legendary",
};

/** Radial holo gradient used behind the card in the full-screen viewer. */
export const RARITY_STAGE_BG: Record<RarityKey, string> = {
  mythic: "radial-gradient(ellipse at top, rgba(255,45,146,0.28), rgba(0,0,0,0) 60%)",
  legendary: "radial-gradient(ellipse at top, rgba(234,179,8,0.25), rgba(0,0,0,0) 60%)",
  epic: "radial-gradient(ellipse at top, rgba(168,85,247,0.25), rgba(0,0,0,0) 60%)",
  rare: "radial-gradient(ellipse at top, rgba(59,130,246,0.22), rgba(0,0,0,0) 60%)",
  uncommon: "radial-gradient(ellipse at top, rgba(34,197,94,0.18), rgba(0,0,0,0) 60%)",
  common: "radial-gradient(ellipse at top, rgba(148,163,184,0.15), rgba(0,0,0,0) 60%)",
};

/** Plain CSS color per rarity — for glows, dots, and inline accents. */
export const RARITY_ACCENT: Record<RarityKey, string> = {
  common: "hsl(var(--rarity-common))",
  uncommon: "hsl(var(--rarity-uncommon))",
  rare: "hsl(var(--rarity-rare))",
  epic: "hsl(var(--rarity-epic))",
  legendary: "hsl(var(--rarity-legendary))",
  mythic: "hsl(330 85% 60%)",
};

/** Resolve which themed rarity key to style a card with. Prefers the effective
 *  (custom-tier / renamed) rarity when it maps to a known key, else base. */
export function rarityKeyOf(card: Pick<Card, "rarity" | "effectiveRarity">): RarityKey {
  const eff = card.effectiveRarity;
  if (eff && eff in RARITY_BADGE) return eff as RarityKey;
  return (card.rarity in RARITY_BADGE ? card.rarity : "common") as RarityKey;
}

/** The human label to show for a card's category/rarity. */
export function rarityLabelOf(
  card: Pick<Card, "rarity" | "effectiveRarityLabel" | "websiteCategoryLabel">,
): string {
  return card.websiteCategoryLabel ?? card.effectiveRarityLabel ?? card.rarity;
}

/** The grouping/filter key for a card (website category > effective > base). */
export function categoryKeyOf(
  card: Pick<Card, "rarity" | "effectiveRarity" | "websiteCategory">,
): string {
  return card.websiteCategory ?? card.effectiveRarity ?? card.rarity;
}
