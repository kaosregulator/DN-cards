// ─────────────────────────────────────────────────────────────────────────────
// Recipe explainability.
//
// A recipe is not a black box: it is a decomposition, and the user should see it.
// `explain` renders the "SIGH → eyes:slow_close · mouth:exhale · head:drop"
// breakdown; `credit` renders the provenance line naming which source emoji each
// borrowed movement came from, so Noto-derived motion is always traceable.
// ─────────────────────────────────────────────────────────────────────────────

import type { MotionTrack, Recipe, Region } from "../types.js";

const REGION_LABEL: Record<Exclude<Region, "effect">, string> = {
  global: "head/body",
  brows: "brows",
  eyes: "eyes",
  cheeks: "cheeks",
  mouth: "mouth",
};

const ORDER: Exclude<Region, "effect">[] = ["global", "brows", "eyes", "cheeks", "mouth"];

/** Human breakdown: "eyes:blink · mouth:yawn · head/body:nod (+ tears)". */
export function explain(recipe: Recipe): string {
  const parts: string[] = [];
  for (const region of ORDER) {
    const track = recipe.tracks[region];
    if (track) parts.push(`${REGION_LABEL[region]}:${track.name.toLowerCase()}`);
  }
  for (const fx of recipe.effects) parts.push(`fx:${fx.name.toLowerCase()}`);
  return parts.length ? parts.join(" · ") : "no motion";
}

/** One track's provenance chip, e.g. "🥱 Yawning face". */
function chip(track: MotionTrack): string {
  return `${track.source.glyph} ${track.source.name}`;
}

/** Provenance credit: which source each borrowed piece came from, de-duplicated. */
export function credit(recipe: Recipe): string {
  const seen = new Set<string>();
  const chips: string[] = [];
  const all: (MotionTrack | null | undefined)[] = [
    recipe.tracks.global, recipe.tracks.brows, recipe.tracks.eyes,
    recipe.tracks.cheeks, recipe.tracks.mouth, ...recipe.effects,
  ];
  for (const t of all) {
    if (!t) continue;
    const c = chip(t);
    if (seen.has(c)) continue;
    seen.add(c);
    chips.push(c);
  }
  return chips.length ? `borrowed from ${chips.join(" · ")}` : "";
}

/** True when every borrowed piece is real harvested Noto motion (for a badge). */
export function isAllNoto(recipe: Recipe): boolean {
  const all = [
    recipe.tracks.global, recipe.tracks.brows, recipe.tracks.eyes,
    recipe.tracks.cheeks, recipe.tracks.mouth, ...recipe.effects,
  ].filter(Boolean) as MotionTrack[];
  return all.length > 0 && all.every(t => t.source.origin === "noto");
}
