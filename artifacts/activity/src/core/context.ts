// ─────────────────────────────────────────────────────────────────────────────
// GameContext — the Core Game Runtime seam shared by EVERY scene.
//
// This is the single object all experiences (HQ, Battle, Raid, Packs) read from,
// so they share one API client, one player-state cache, one event bus, and one
// Discord session. Phase 1 wires the pieces that actually exist now; the asset /
// animation / audio / input managers are declared as the intended slots and
// filled in later phases rather than faked today.
//
// It is stored in Phaser's registry (game.registry) under CONTEXT_KEY so any
// scene can retrieve it with `getContext(this)`.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";
import { api } from "../net/api";
import { PlayerState } from "../state/playerState";
import { AssetManager } from "./assetManager";
import type { DiscordSession } from "../discord/sdk";

export const CONTEXT_KEY = "dncards.context";

// A tiny typed event bus for cross-scene game events (selection, mode changes,
// server pushes). Phaser has its own EventEmitter; we reuse the type for parity.
export type GameEvents = Phaser.Events.EventEmitter;

export interface GameContext {
  /** Discord session (access token + in-frame flag). */
  session: DiscordSession;
  /** The one API client for all backend calls. */
  api: typeof api;
  /** Authoritative player snapshot cache. */
  playerState: PlayerState;
  /** Shared asset manager (manifest + lazy texture loading). */
  assets: AssetManager;
  /** Cross-scene event bus. */
  events: GameEvents;
}

export function createContext(session: DiscordSession, events: GameEvents): GameContext {
  return {
    session,
    api,
    playerState: new PlayerState(),
    assets: new AssetManager(),
    events,
  };
}

export function getContext(scene: Phaser.Scene): GameContext {
  const ctx = scene.game.registry.get(CONTEXT_KEY) as GameContext | undefined;
  if (!ctx) throw new Error("GameContext missing from registry — game not bootstrapped correctly.");
  return ctx;
}
