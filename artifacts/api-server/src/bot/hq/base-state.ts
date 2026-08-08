// ─────────────────────────────────────────────────────────────────────────────
// HQ — unified BaseState.
//
// One logical model for everything that makes up a player's HQ: outdoor terrain,
// water, buildings, decorations, furniture, walls/doors/windows (room shell),
// skybox, shield, room layouts, and metadata. Persistence stays additive —
// existing tables + player_hq.stats — this module assembles and validates the
// view so rendering, editor, and Discord UI share one shape.
//
// Rendering, editor logic, and UI import from here instead of each re-deriving
// the same fields from scattered tables.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlayerHq, HqBaseState as HqCaptureState } from "@workspace/db";
import {
  getOrCreateHq, updateHq, getPlacements, getDefenders, getBaseState, getDisplays, getUnlockedItemIds,
} from "./db.js";
import { resolveTheme } from "./defs/themes.js";
import { resolveRoom, sumRoomBonus, type HqRoom } from "./defs/rooms.js";
import { resolveWall } from "./defs/walls.js";
import { resolveFloor } from "./defs/floors.js";
import { resolveBackdrop } from "./defs/backdrops.js";
import { resolveWallpaper } from "./defs/wallpapers.js";
import { resolveSkybox, DEFAULT_SKYBOX_ID, type HqSkybox } from "./defs/skyboxes.js";
import { baseTier, computeFortification, nextBaseTier, type Fortification, type BaseTier } from "./fortify.js";
import { BASE_CANVAS_ID, listTerrain } from "./terrain.js";
import type { HqTerrainFeature } from "./render-terrain.js";
import { readCursor, type BuildCursor, type StoredBuild } from "./build-state.js";
import { HQ_BASE_GRID, HQ_GRID } from "./grid.js";
import { unlockedRooms, isRoomUnlocked } from "./engine.js";

/** Soft presentation / editor flags stored in player_hq.stats. */
export interface HqStatsBlob {
  title?: string;
  motto?: string;
  backdropId?: string;
  wallpaperId?: string;
  skyboxId?: string;
  wallsOff?: boolean;
  glassOff?: boolean;
  companionId?: string;
  baseTier?: number;
  build?: StoredBuild;
  /** Editor layer visibility toggles (outdoor). */
  layers?: Partial<Record<EditorLayer, boolean>>;
  /** Selected editor category tab. */
  editorCategory?: string;
  /** Selected editor tool/mode. */
  editorMode?: EditorMode;
  /** Connected HQ floorplan (walls, doors, zones). */
  floorplan?: import("./defs/floorplan.js").FloorplanState;
}

export type EditorMode =
  | "select" | "move" | "place" | "rotate" | "delete" | "duplicate" | "clear";

export type EditorLayer =
  | "ground" | "water" | "structures" | "decorations" | "fences" | "skybox";

export type EditorCategory =
  | "nature" | "buildings" | "defenses" | "decorations" | "water"
  | "fences" | "terrain" | "skyboxes"
  | "walls" | "doors" | "floors" | "windows" | "furniture"
  | "lighting" | "trophies" | "defense";

/** One placed object on a canvas (terrain feature or decoration placement). */
export interface BaseObject {
  id: string;
  kind: "terrain" | "decoration" | "defender" | "display";
  canvas: string;
  refId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation: number;
  meta?: Record<string, unknown>;
}

export interface RoomLayoutState {
  roomId: string;
  wallId: string;
  floorId: string;
  wallpaperId: string | null;
  decorations: Map<number, string>;
  terrain: HqTerrainFeature[];
  pedestals: Map<number, number>;
}

export interface QuickStats {
  health: number;
  defense: number;
  storage: number;
  incomeBonusPct: number;
  fortifyPct: number;
  hqLevel: number;
  baseTier: BaseTier;
  nextTier: BaseTier | null;
}

/**
 * The single BaseState every HQ screen reads. Capture/siege fields live on
 * `capture`; cosmetics and layouts under the rest.
 */
export interface BaseState {
  guildId: string;
  userId: string;
  hq: PlayerHq;
  stats: HqStatsBlob;
  themeId: string;
  activeRoomId: string;
  skybox: HqSkybox;
  shieldUntil: Date | null;
  shieldActive: boolean;
  capture: HqCaptureState | null;
  fortification: Fortification;
  quickStats: QuickStats;
  outdoorTerrain: HqTerrainFeature[];
  outdoorDecor: Map<number, string>;
  defenders: Map<number, number>;
  cursor: BuildCursor;
  owned: Set<string>;
  unlockedRoomList: HqRoom[];
  roomBonusFortify: number;
  roomBonusIncome: number;
  roomBonusStorage: number;
  roomBonusDefenders: number;
}

export function readHqStats(hq: PlayerHq): HqStatsBlob {
  const s = (hq.stats ?? {}) as HqStatsBlob;
  return {
    title: s.title,
    motto: s.motto,
    backdropId: s.backdropId,
    wallpaperId: s.wallpaperId,
    skyboxId: s.skyboxId,
    wallsOff: s.wallsOff,
    glassOff: s.glassOff,
    companionId: s.companionId,
    baseTier: s.baseTier,
    build: s.build,
    layers: s.layers,
    editorCategory: s.editorCategory,
    editorMode: s.editorMode,
    floorplan: s.floorplan,
  };
}

export async function saveHqStats(
  guildId: string, userId: string, patch: Partial<HqStatsBlob>,
): Promise<HqStatsBlob> {
  const hq = await getOrCreateHq(guildId, userId);
  const next = { ...readHqStats(hq), ...patch };
  await updateHq(guildId, userId, { stats: next });
  return next;
}

function baseHealth(tier: BaseTier): number {
  return tier.health;
}

function baseDefenseStat(tier: BaseTier, forti: Fortification): number {
  return tier.defense + forti.buildPct * 10;
}

function baseStorage(tier: BaseTier, roomStorage: number): number {
  return tier.storage + roomStorage;
}

function baseIncome(tier: BaseTier, roomIncome: number): number {
  return tier.incomeBonusPct + roomIncome;
}

/** Assemble the full BaseState for a player. */
export async function loadBaseState(guildId: string, userId: string): Promise<BaseState> {
  const hq = await getOrCreateHq(guildId, userId);
  const stats = readHqStats(hq);
  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  const unlockedRoomList = unlockedRooms(owned);
  const unlockedIds = unlockedRoomList.map(r => r.id);

  const roomBonusFortify = sumRoomBonus(unlockedIds, "fortify");
  const roomBonusIncome = sumRoomBonus(unlockedIds, "income");
  const roomBonusStorage = sumRoomBonus(unlockedIds, "storage");
  const roomBonusDefenders = sumRoomBonus(unlockedIds, "defenders");

  const [outdoorTerrain, outdoorDecor, defenders, capture] = await Promise.all([
    listTerrain(guildId, userId, BASE_CANVAS_ID).catch(() => [] as HqTerrainFeature[]),
    getPlacements(guildId, userId, BASE_CANVAS_ID).catch(() => new Map<number, string>()),
    getDefenders(guildId, userId).catch(() => new Map<number, number>()),
    getBaseState(guildId, userId).catch(() => null),
  ]);

  const forti = computeFortification(outdoorTerrain, stats.baseTier);
  // Room fortify bonuses stack softly into the displayed total (capped elsewhere).
  const effectiveForti: Fortification = {
    ...forti,
    totalPct: Math.min(85, forti.totalPct + roomBonusFortify),
  };

  const tier = baseTier(stats.baseTier);
  const shieldUntil = capture?.shieldUntil ?? null;
  const shieldActive = !!shieldUntil && shieldUntil.getTime() > Date.now();
  const skybox = resolveSkybox(stats.skyboxId ?? DEFAULT_SKYBOX_ID);
  const grid = stats.build?.canvas === BASE_CANVAS_ID || !stats.build?.canvas
    ? HQ_BASE_GRID : HQ_GRID;
  const canvas = stats.build?.canvas ?? BASE_CANVAS_ID;
  const cursor = readCursor(stats.build, canvas, grid);

  const quickStats: QuickStats = {
    health: baseHealth(tier),
    defense: baseDefenseStat(tier, effectiveForti),
    storage: baseStorage(tier, roomBonusStorage),
    incomeBonusPct: baseIncome(tier, roomBonusIncome),
    fortifyPct: effectiveForti.totalPct,
    hqLevel: hq.hqLevel,
    baseTier: tier,
    nextTier: nextBaseTier(tier.level),
  };

  return {
    guildId, userId, hq, stats,
    themeId: hq.themeId,
    activeRoomId: hq.activeRoomId,
    skybox,
    shieldUntil,
    shieldActive,
    capture,
    fortification: effectiveForti,
    quickStats,
    outdoorTerrain,
    outdoorDecor,
    defenders,
    cursor,
    owned,
    unlockedRoomList,
    roomBonusFortify,
    roomBonusIncome,
    roomBonusStorage,
    roomBonusDefenders,
  };
}

/** Load one room's layout for the shared editor. */
export async function loadRoomLayout(
  guildId: string, userId: string, roomId: string, hq?: PlayerHq,
): Promise<RoomLayoutState> {
  const row = hq ?? await getOrCreateHq(guildId, userId);
  const stats = readHqStats(row);
  const room = resolveRoom(roomId);
  const [decorations, terrain, pedestals] = await Promise.all([
    getPlacements(guildId, userId, room.id),
    listTerrain(guildId, userId, room.id).catch(() => [] as HqTerrainFeature[]),
    room.pedestals > 0 ? getDisplays(guildId, userId) : Promise.resolve(new Map<number, number>()),
  ]);
  return {
    roomId: room.id,
    wallId: row.wallId,
    floorId: row.floorId,
    wallpaperId: stats.wallpaperId ?? null,
    decorations,
    terrain,
    pedestals,
  };
}

/** Resolve style pieces used by both overview and room renders. */
export function resolveStyleBundle(stats: HqStatsBlob, hq: PlayerHq) {
  return {
    theme: resolveTheme(hq.themeId),
    room: resolveRoom(hq.activeRoomId),
    wall: resolveWall(hq.wallId),
    floor: resolveFloor(hq.floorId),
    backdrop: resolveBackdrop(stats.backdropId),
    wallpaper: resolveWallpaper(stats.wallpaperId),
    skybox: resolveSkybox(stats.skyboxId),
  };
}

export function isLayerVisible(stats: HqStatsBlob, layer: EditorLayer): boolean {
  if (!stats.layers) return true;
  return stats.layers[layer] !== false;
}

export { isRoomUnlocked, unlockedRooms };
