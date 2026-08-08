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

export const api = {
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
};
