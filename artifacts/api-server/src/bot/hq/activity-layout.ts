// ─────────────────────────────────────────────────────────────────────────────
// HQ Activity — layout persistence + server-side validation.
//
// The client sends a proposed floorplan; the server decides what is legal. Every
// object is validated against the asset catalog AND the player's earned unlocks
// (hq_unlocks) before anything is written. An illegal object is DROPPED, not
// rejected wholesale, so a stale client never bricks a save — the server returns
// the sanitised layout it actually stored.
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq } from "drizzle-orm";
import { db, hqActivityLayoutTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { getUnlockedItemIds } from "./db.js";
import { HQ_DECORATIONS } from "./defs/decorations.js";
import { HQ_ROOMS } from "./defs/rooms.js";
import {
  ACTIVITY_ASSETS, ACTIVITY_FLOOR_IDS, getActivityAsset,
} from "./activity-catalog.js";

// World is a fixed tile grid; rooms + objects live on it in tile coordinates.
export const WORLD_TILES = 40;               // 40×40 build plot
const MAX_ROOMS = 12;
const MAX_OBJECTS = 400;

export interface LayoutRoom {
  id: string;              // instance id (unique within layout)
  roomId: string;          // HQ_ROOMS id (purpose/theme)
  x: number; y: number;    // top-left tile
  w: number; h: number;    // size in tiles
  floorId: string;         // ACTIVITY_FLOORS id
}

export interface LayoutObject {
  uid: string;             // instance id
  assetId: string;         // ACTIVITY_ASSETS id
  x: number; y: number;    // tile position (anchor tile)
  rot: 0 | 1 | 2 | 3;      // 90° rotation steps
}

export interface HqLayout {
  version: 1;
  rooms: LayoutRoom[];
  objects: LayoutObject[];
}

const ROOM_IDS = new Set(HQ_ROOMS.map((r) => r.id));
const ALWAYS_DECO = new Set(
  HQ_DECORATIONS.filter((d) => d.unlock.kind === "always").map((d) => d.id),
);

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}

/** Is this asset placeable by this player right now? (authoritative gate) */
function assetAllowed(assetId: string, unlocked: Set<string>): boolean {
  const asset = getActivityAsset(assetId);
  if (!asset) return false;
  if (asset.unlock === "always") return true;
  // Gated: satisfied if in the player's unlock ledger, or the decoration itself
  // is an "always" decoration (defensive — catalog + defs can drift).
  return unlocked.has(asset.unlock) || ALWAYS_DECO.has(asset.unlock);
}

/**
 * Sanitise a proposed layout into one that is legal to store for this player.
 * Pure — no I/O — so it is trivially testable and reused by seed + save.
 */
export function sanitizeLayout(raw: unknown, unlocked: Set<string>): HqLayout {
  const input = (raw ?? {}) as Partial<HqLayout>;
  const rooms: LayoutRoom[] = [];
  const seenRoom = new Set<string>();

  for (const r of Array.isArray(input.rooms) ? input.rooms : []) {
    if (rooms.length >= MAX_ROOMS) break;
    if (!r || typeof r !== "object") continue;
    const roomId = String((r as LayoutRoom).roomId ?? "");
    if (!ROOM_IDS.has(roomId)) continue;
    const id = String((r as LayoutRoom).id ?? `room-${rooms.length}`);
    if (seenRoom.has(id)) continue;
    seenRoom.add(id);
    const x = clampInt((r as LayoutRoom).x, 0, WORLD_TILES - 2, 0);
    const y = clampInt((r as LayoutRoom).y, 0, WORLD_TILES - 2, 0);
    const w = clampInt((r as LayoutRoom).w, 3, WORLD_TILES - x, 6);
    const h = clampInt((r as LayoutRoom).h, 3, WORLD_TILES - y, 6);
    const floorId = ACTIVITY_FLOOR_IDS.has(String((r as LayoutRoom).floorId))
      ? String((r as LayoutRoom).floorId) : "stone";
    rooms.push({ id, roomId, x, y, w, h, floorId });
  }

  const objects: LayoutObject[] = [];
  const seenObj = new Set<string>();
  for (const o of Array.isArray(input.objects) ? input.objects : []) {
    if (objects.length >= MAX_OBJECTS) break;
    if (!o || typeof o !== "object") continue;
    const assetId = String((o as LayoutObject).assetId ?? "");
    if (!assetAllowed(assetId, unlocked)) continue; // ← the security gate
    const uid = String((o as LayoutObject).uid ?? `obj-${objects.length}`);
    if (seenObj.has(uid)) continue;
    seenObj.add(uid);
    const x = clampInt((o as LayoutObject).x, 0, WORLD_TILES - 1, 0);
    const y = clampInt((o as LayoutObject).y, 0, WORLD_TILES - 1, 0);
    const rot = clampInt((o as LayoutObject).rot, 0, 3, 0) as 0 | 1 | 2 | 3;
    objects.push({ uid, assetId, x, y, rot });
  }

  return { version: 1, rooms, objects };
}

// A clean, purpose-communicating starter HQ for first-time players. Uses only
// "always" assets so it is legal for everyone. Command Center + Armory + Treasury
// connected by a hallway, populated with real furniture.
export function starterLayout(): HqLayout {
  const objects: LayoutObject[] = [];
  let n = 0;
  const put = (assetId: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0) =>
    objects.push({ uid: `s${n++}`, assetId, x, y, rot });

  // Command Center (10..19, 4..13)
  put("command-rug", 13, 8);
  put("briefing-table", 13, 8, 0);
  put("officer-chair", 12, 8, 1);
  put("officer-chair", 15, 8, 3);
  put("figure-knight", 11, 5);
  put("npc-aide", 17, 11);
  put("flag", 10, 4);
  put("flag", 18, 4);

  // Armory (22..29, 4..11)
  put("supply-crates", 23, 6);
  put("barrel", 25, 6);
  put("stacked-barrels", 27, 6);
  put("wall-column", 22, 4);
  put("figure-ranger", 26, 9);

  // Treasury (22..29, 16..23)
  put("vault-rug", 24, 19);
  put("treasure-chest", 24, 19);
  put("treasure-chest-open", 26, 19);
  put("sovereign-crown", 25, 17);

  // Grounds — landscaping
  put("yard-tree", 4, 6);
  put("tree-tall", 5, 20);
  put("yard-bush", 6, 8);
  put("yard-rock", 3, 14);
  put("npc-scout", 7, 24);

  return {
    version: 1,
    rooms: [
      { id: "r-command", roomId: "entrance", x: 10, y: 4, w: 10, h: 10, floorId: "marble" },
      { id: "r-armory", roomId: "trophy-hall", x: 22, y: 4, w: 8, h: 8, floorId: "wood" },
      { id: "r-treasury", roomId: "trophy-hall", x: 22, y: 16, w: 8, h: 8, floorId: "blue-stone" },
    ],
    objects,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

export interface StoredLayout {
  layout: HqLayout;
  revision: number;
}

/** Read the player's layout, seeding a starter on first access. */
export async function getActivityLayout(guildId: string, userId: string): Promise<StoredLayout> {
  const [row] = await db.select().from(hqActivityLayoutTable)
    .where(and(eq(hqActivityLayoutTable.guildId, guildId), eq(hqActivityLayoutTable.userId, userId)))
    .limit(1);

  if (row && row.layout && (row.layout as HqLayout).version === 1) {
    return { layout: row.layout as HqLayout, revision: row.revision };
  }

  // Seed a starter layout (idempotent). Never trusts client input.
  const seed = starterLayout();
  const [created] = await db.insert(hqActivityLayoutTable)
    .values({ guildId, userId, layout: seed, revision: 1 })
    .onConflictDoUpdate({
      target: [hqActivityLayoutTable.guildId, hqActivityLayoutTable.userId],
      set: { layout: seed, revision: 1, updatedAt: new Date() },
    })
    .returning();
  return { layout: created.layout as HqLayout, revision: created.revision };
}

/** Validate + persist a proposed layout. Returns what was actually stored. */
export async function saveActivityLayout(
  guildId: string, userId: string, proposed: unknown,
): Promise<StoredLayout> {
  const unlocked = await getUnlockedItemIds(guildId, userId);
  const clean = sanitizeLayout(proposed, unlocked);
  const [row] = await db.insert(hqActivityLayoutTable)
    .values({ guildId, userId, layout: clean, revision: 1 })
    .onConflictDoUpdate({
      target: [hqActivityLayoutTable.guildId, hqActivityLayoutTable.userId],
      set: {
        layout: clean,
        // revision = old + 1, done in SQL to avoid a read-modify-write race.
        revision: sqlIncrementRevision(),
        updatedAt: new Date(),
      },
    })
    .returning();
  logger.debug({ guildId, userId, objects: clean.objects.length }, "activity layout saved");
  return { layout: row.layout as HqLayout, revision: row.revision };
}

// drizzle raw-ish increment helper kept local to avoid leaking sql() everywhere.
import { sql } from "drizzle-orm";
function sqlIncrementRevision() {
  return sql`${hqActivityLayoutTable.revision} + 1`;
}

/** The full placeable catalog with per-player unlock status (for the client). */
export async function getActivityCatalog(guildId: string, userId: string) {
  const unlocked = await getUnlockedItemIds(guildId, userId);
  return ACTIVITY_ASSETS.map((a) => ({
    ...a,
    owned: a.unlock === "always" || unlocked.has(a.unlock) || ALWAYS_DECO.has(a.unlock),
  }));
}
