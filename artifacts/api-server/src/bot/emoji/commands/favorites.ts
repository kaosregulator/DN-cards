// ─────────────────────────────────────────────────────────────────────────────
// Per-user MakeEmoji style favorites.
//
// Favorites are keyed by Discord user id and the manifest style *value*
// (`gen_btn_pet`), so they survive label tweaks and work with autocomplete.
// Persistence is a small JSON file — durable across restarts without a schema
// migration, and easy to stub in tests.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Cap so a single user can't grow the file without bound. */
const MAX_PER_USER = 100;

type StoreShape = Record<string, string[]>;

let pathOverride: string | null = null;
let memory: StoreShape | null = null;

function defaultPath(): string {
  return join(process.cwd(), "data", "emoji-style-favorites.json");
}

function storePath(): string {
  return pathOverride ?? defaultPath();
}

function load(): StoreShape {
  if (memory) return memory;
  const path = storePath();
  if (!existsSync(path)) {
    memory = {};
    return memory;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    memory = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as StoreShape
      : {};
  } catch {
    memory = {};
  }
  return memory;
}

function save(data: StoreShape): void {
  memory = data;
  const path = storePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  } catch {
    // Persistence is best-effort — in-memory still works for the process life.
  }
}

/** Style values currently starred by this user. */
export function listFavorites(userId: string): string[] {
  return [...(load()[userId] ?? [])];
}

export function isFavorite(userId: string, styleValue: string): boolean {
  return (load()[userId] ?? []).includes(styleValue);
}

/**
 * Toggle a style in the user's favorites. Returns whether it is now favorited.
 */
export function toggleFavorite(userId: string, styleValue: string): boolean {
  const data = load();
  const current = new Set(data[userId] ?? []);
  if (current.has(styleValue)) {
    current.delete(styleValue);
    data[userId] = [...current];
    if (data[userId].length === 0) delete data[userId];
    save(data);
    return false;
  }
  // Newest first so the favorites filter opens on recent picks.
  const next = [styleValue, ...[...current].filter(v => v !== styleValue)];
  data[userId] = next.slice(0, MAX_PER_USER);
  save(data);
  return true;
}

/** Test helpers. */
export function setFavoritesPathForTesting(path: string | null): void {
  pathOverride = path;
  memory = null;
}

export function resetFavoritesForTesting(): void {
  memory = {};
  pathOverride = null;
}
