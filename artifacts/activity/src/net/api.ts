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
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
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
};

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
