// ─────────────────────────────────────────────────────────────────────────────
// API client — the Activity's ONLY channel to the authoritative backend.
//
// Inside Discord, the iframe's CSP blocks arbitrary hosts; all traffic must go
// through Discord's proxy. Requests are made to a RELATIVE base which Discord
// rewrites via `/.proxy/…` to the URL mapping configured in the Developer
// Portal ( `/api`  →  the DN Cards api-server ). Outside Discord (local dev) we
// hit the api-server directly.
//
// The client is NOT authoritative: it sends a Discord access token and the
// server decides who the caller is and what they own.
// ─────────────────────────────────────────────────────────────────────────────

import { isInDiscord } from "../discord/env";
import type { DuelSetup } from "../duel/types";

function resolveBase(): string {
  const override = import.meta.env.VITE_API_BASE?.trim();
  if (override) return override.replace(/\/$/, "");
  // In-frame: go through the Discord proxy. The `/api` mapping is configured in
  // the Discord Developer Portal to target the DN Cards api-server.
  if (isInDiscord()) return "/.proxy/api";
  // Local dev: same-origin api-server (or a Vite proxy) at /api.
  return "/api";
}

const API_BASE = resolveBase();

function demoHeaders(): Record<string, string> {
  // Avoid importing demo.ts (circular with context → api).
  const demo =
    typeof location !== "undefined" && /(?:\?|&)demo\b/.test(location.search);
  return demo ? { "x-world-builder-demo": "1" } : {};
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

// ── Typed endpoints (mirror api-server/src/routes/activity.ts) ────────────────

export interface ActivityStatus {
  configured: boolean;
  homeGuildId: string | null;
}

export interface PlayerSnapshot {
  user: { id: string; username: string; avatar: string | null };
  guildId: string;
  player: {
    level: number;
    xp: number;
    xpInto: number;
    xpNeeded: number;
    shards: number;
    collection: { unique: number; total: number };
    battles: { wins: number; losses: number; level: number };
    achievements: number;
  };
  hq: {
    level: number;
    themeId: string;
    activeRoomId: string;
    wallId: string;
    floorId: string;
  };
}

// ── HQ live world (mirrors routes/activity.ts + activity-catalog.ts) ──────────

export interface CatalogAsset {
  id: string;
  name: string;
  sprite: string;
  category: string;
  footprint: { w: number; h: number };
  rotatable: boolean;
  unlock: string;
  rooms?: string[];
  scale?: number;
  owned: boolean;
}

export interface LayoutRoom {
  id: string;
  roomId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floorId: string;
}

export interface LayoutObject {
  uid: string;
  assetId: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
}

export interface HqLayout {
  version: 1;
  rooms: LayoutRoom[];
  objects: LayoutObject[];
}

export interface HqWorld {
  worldTiles: number;
  ground: string;
  user: { id: string; username: string };
  hq: { level: number; themeId: string; shards: number };
  shield: { active: boolean; strength: number };
  rooms: { id: string; name: string; emoji: string; kind: string; category: string }[];
  floors: { id: string; name: string; sprite: string }[];
  catalog: CatalogAsset[];
  layout: HqLayout;
  revision: number;
}

let tokenRef: string | null = null;

export const api = {
  /** Store the Discord token once so HQ calls don't each thread it through. */
  setToken(token: string): void {
    tokenRef = token;
  },
  assetBase(): string {
    return API_BASE;
  },
  status(): Promise<ActivityStatus> {
    return request<ActivityStatus>("/activity/status");
  },
  exchangeToken(code: string): Promise<{ access_token: string }> {
    return request<{ access_token: string }>("/activity/token", {
      method: "POST",
      body: { code },
    });
  },
  me(token: string): Promise<PlayerSnapshot> {
    return request<PlayerSnapshot>("/activity/@me", { token });
  },
  assetManifest(): Promise<{ base: string; sprites: Record<string, string> }> {
    return request<{ base: string; sprites: Record<string, string> }>("/activity/assets/manifest");
  },
  hq(): Promise<HqWorld> {
    return request<HqWorld>("/activity/hq", { token: tokenRef });
  },
  saveLayout(layout: HqLayout): Promise<{ ok: boolean; layout: HqLayout; revision: number }> {
    return request("/activity/hq/layout", { method: "POST", body: { layout }, token: tokenRef });
  },
  battle(): Promise<BattleModel> {
    return request<BattleModel>("/activity/battle", { token: tokenRef });
  },
  raid(): Promise<RaidModel> {
    return request<RaidModel>("/activity/raid", { token: tokenRef });
  },
  packs(): Promise<PackModel> {
    return request<PackModel>("/activity/packs", { token: tokenRef });
  },
  /** Battle Phaser: a true Yu-Gi-Oh style duel deck built from real cards. */
  duel(): Promise<DuelSetup> {
    return request<DuelSetup>("/activity/duel", { token: tokenRef });
  },
  /** Absolute URL for a card's proxied art (loads inside Discord's CSP). */
  cardArtUrl(cardId: number): string {
    return `${API_BASE}/activity/card-art/${cardId}`;
  },
  /** Card Shop interior: the server's real cards (our art) + prices. */
  shop(): Promise<ShopModel> {
    return request<ShopModel>("/activity/shop", { token: tokenRef });
  },

  // ── World Builder (admin) ───────────────────────────────────────────────────
  worldBuilderStatus(): Promise<{ canEdit: boolean; openMode: boolean; userId: string | null }> {
    return request("/activity/world-builder/status", {
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderCatalog(): Promise<{
    packs: import("../world/editor/types").WorldAssetPack[];
    assets: import("../world/editor/types").WorldAssetEntry[];
  }> {
    return request("/activity/world-builder/catalog", {
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderLoadMap(mapKey: string): Promise<{
    doc: import("../world/editor/types").WorldEditDocument;
    meta?: import("../world/editor/types").CustomMapMeta | null;
  }> {
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}`, {
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderSaveMap(
    mapKey: string,
    doc: import("../world/editor/types").WorldEditDocument,
  ): Promise<{
    ok: boolean;
    doc: import("../world/editor/types").WorldEditDocument;
    meta?: import("../world/editor/types").CustomMapMeta | null;
  }> {
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}`, {
      method: "POST",
      body: { doc },
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderListMaps(): Promise<{
    maps: import("../world/editor/types").CustomMapMeta[];
    custom: import("../world/editor/types").CustomMapMeta[];
  }> {
    return request("/activity/world-builder/maps", {
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderCreateMap(
    body: import("../world/editor/types").CreateMapRequest,
  ): Promise<{
    ok: boolean;
    meta: import("../world/editor/types").CustomMapMeta;
    doc: import("../world/editor/types").WorldEditDocument;
  }> {
    return request("/activity/world-builder/maps", {
      method: "POST",
      body,
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderRenameMap(mapKey: string, name: string): Promise<{
    ok: boolean;
    meta: import("../world/editor/types").CustomMapMeta;
  }> {
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}`, {
      method: "PATCH",
      body: { name },
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderDuplicateMap(mapKey: string, name?: string): Promise<{
    ok: boolean;
    meta: import("../world/editor/types").CustomMapMeta;
    doc: import("../world/editor/types").WorldEditDocument;
  }> {
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}/duplicate`, {
      method: "POST",
      body: { name },
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderDeleteMap(mapKey: string): Promise<{ ok: boolean }> {
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}`, {
      method: "DELETE",
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderListSpawns(mapKey: string): Promise<{
    spawns: Array<{
      uid: string; name: string; kind: string; x: number; y: number; isDefault: boolean;
    }>;
  }> {
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}/spawns`, {
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderResolveSpawn(mapKey: string, name?: string): Promise<{
    spawn: { tx: number; ty: number; name?: string } | null;
  }> {
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    return request(`/activity/world-builder/maps/${encodeURIComponent(mapKey)}/resolve-spawn${q}`, {
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  async worldBuilderImportZip(file: Blob, name?: string): Promise<{
    ok: boolean;
    summary: import("../world/editor/types").PackImportSummary;
  }> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/zip",
      ...demoHeaders(),
    };
    if (tokenRef) headers.Authorization = `Bearer ${tokenRef}`;
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    const res = await fetch(`${API_BASE}/activity/world-builder/packs/import${q}`, {
      method: "POST",
      headers,
      body: file,
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch { /* */ }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as { ok: boolean; summary: import("../world/editor/types").PackImportSummary };
  },
  worldBuilderImportFolder(
    name: string,
    files: { path: string; dataBase64: string }[],
  ): Promise<{ ok: boolean; summary: import("../world/editor/types").PackImportSummary }> {
    return request("/activity/world-builder/packs/import-folder", {
      method: "POST",
      body: { name, files },
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
  worldBuilderDeletePack(packId: string): Promise<{ ok: boolean }> {
    return request(`/activity/world-builder/packs/${encodeURIComponent(packId)}`, {
      method: "DELETE",
      token: tokenRef,
      headers: demoHeaders(),
    });
  },
};

export interface ShopCard {
  cardId: number;
  name: string;
  art: string | null;
  rarity: string;
  color: number;
  level: number;
  atk: number;
  def: number;
  attribute: string;
  desc: string;
  price: number;
  owned: number;
}
export interface ShopModel {
  shards: number;
  cards: ShopCard[];
}

// ── Play-scene models (mirror bot/activity/read-models.ts) ────────────────────

export interface Combatant {
  name: string;
  rarity: string;
  color: number;
  hp: number;
  atk: number;
  sprite: string;
}

export interface BattleModel {
  backdrops: string[];
  player: Combatant[];
  opponent: Combatant[];
}

export interface RaidBossModel {
  id: number;
  name: string;
  rarity: string;
  color: number;
  maxHealth: number;
  enrageTurn: number;
  sprite: string;
  defeated: boolean;
}

export interface RaidModel {
  backdrops: string[];
  bosses: RaidBossModel[];
  progress: { defeated: number; total: number; nextName: string | null; complete: boolean };
  team: Combatant[];
}

export interface PackModel {
  tiers: { id: string; label: string; cost: number; size: number; emoji: string }[];
  rarities: { key: string; label: string; color: number; weight: number }[];
}
