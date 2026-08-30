// ─────────────────────────────────────────────────────────────────────────────
// Offline style recipes.
//
// Each of the ~473 discovered MakeEmoji styles maps to a recipe: a family
// (transform / overlay / atlas / frames / passthrough), a shared primitive, and
// parameters. Recipes live in artifacts/emoji-offline/recipes/recipes.json so
// they can be regenerated without a code change.
//
// offlineReady is true only when this process can actually render the style.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { offlinePackageRoot } from "./registry.js";

export type RecipeFamily =
  | "passthrough"
  | "transform"
  | "overlay"
  | "atlas"
  | "frames"
  | "unknown";

export interface StyleRecipe {
  id: string;
  slug: string;
  tag: string;
  family: RecipeFamily;
  directionSuffix?: string | null;
  preview?: { ext: string; url: string; bytes?: number } | null;
  assets?: Record<string, string>;
  primitive: string | null;
  params: Record<string, unknown>;
  offlineReady: boolean;
  fidelity: string | null;
  notes: string[];
}

let cached: StyleRecipe[] | undefined;
let byKey: Map<string, StyleRecipe> | undefined;

function recipesPath(): string | null {
  const root = offlinePackageRoot();
  if (!root) return null;
  const path = join(root, "recipes", "recipes.json");
  return existsSync(path) ? path : null;
}

export function loadRecipes(): StyleRecipe[] {
  if (cached) return cached;
  const path = recipesPath();
  if (!path) {
    cached = [];
    byKey = new Map();
    return cached;
  }
  cached = JSON.parse(readFileSync(path, "utf8")) as StyleRecipe[];
  byKey = new Map();
  for (const r of cached) {
    byKey.set(r.id.toLowerCase(), r);
    byKey.set(r.slug.toLowerCase(), r);
    byKey.set(r.tag.toLowerCase(), r);
    byKey.set(r.tag.toLowerCase().replace(/^gen_btn_/, ""), r);
  }
  return cached;
}

export function findRecipe(animation: string): StyleRecipe | undefined {
  loadRecipes();
  const needle = animation.trim().toLowerCase().replace(/^gen_btn_/, "").replace(/^:|:$/g, "");
  return byKey?.get(needle);
}

export function readyRecipes(): StyleRecipe[] {
  return loadRecipes().filter(r => r.offlineReady && r.primitive);
}

export function reloadRecipes(): void {
  cached = undefined;
  byKey = undefined;
}
