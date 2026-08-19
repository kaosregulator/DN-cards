// ─────────────────────────────────────────────────────────────────────────────
// Duel socket — the online-PvP transport.
//
// Connects to the api-server's duel relay over WebSocket. Inside Discord the
// iframe can only reach our backend through the proxy, so the URL is built from
// the same relative base the REST client uses (`/.proxy/api/...`) and upgraded
// to wss://.
//
// The server never holds game state: it matches two players, hands both the
// SAME deck setup and seed, and relays each side's DuelActions to the other.
// Both clients run the identical seeded engine, so the boards stay in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

import type { DuelAction } from "../duel/actions";
import type { DuelSetup, PlayerId } from "../duel/types";
import { api } from "./api";

export interface MatchInfo {
  seed: number;
  setup: DuelSetup;
  /** Which side of the shared duel state THIS client controls. */
  youAre: PlayerId;
  opponentName: string;
}

export interface DuelSocketHandlers {
  onWaiting?: () => void;
  onMatch?: (m: MatchInfo) => void;
  onAction?: (a: DuelAction) => void;
  onOpponentLeft?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

function socketUrl(): string {
  const base = api.assetBase();                       // "/.proxy/api" or "/api"
  const abs = new URL(base, window.location.href);
  abs.protocol = abs.protocol === "https:" ? "wss:" : "ws:";
  abs.pathname = `${abs.pathname.replace(/\/$/, "")}/activity/duel-ws`;
  return abs.toString();
}

export class DuelSocket {
  private ws: WebSocket | null = null;
  private handlers: DuelSocketHandlers;
  private closed = false;
  private queue: string[] = [];

  constructor(handlers: DuelSocketHandlers) { this.handlers = handlers; }

  /** Hand the socket to a new owner (the matchmaking screen → the duel). */
  setHandlers(handlers: DuelSocketHandlers): void { this.handlers = handlers; }

  /** Connect and join the matchmaking room for this Activity instance. */
  connect(token: string, room: string, name: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      this.handlers.onError?.("Couldn't open a connection.");
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: "hello", token, room, name });
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => { if (!this.closed) this.handlers.onError?.("Connection error."); };
    ws.onclose = () => { if (!this.closed) this.handlers.onClose?.(); };
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    switch (msg.t) {
      case "waiting": this.handlers.onWaiting?.(); break;
      case "match":
        this.handlers.onMatch?.({
          seed: Number(msg.seed),
          setup: msg.setup as DuelSetup,
          youAre: msg.youAre === "opponent" ? "opponent" : "player",
          opponentName: String(msg.opponentName ?? "Rival"),
        });
        break;
      case "action": this.handlers.onAction?.(msg.action as DuelAction); break;
      case "opponentLeft": this.handlers.onOpponentLeft?.(); break;
      case "error": this.handlers.onError?.(String(msg.message ?? "Server error.")); break;
    }
  }

  /** Tell the opponent what we just did. */
  sendAction(action: DuelAction): void { this.send({ t: "action", action }); }

  private send(obj: unknown): void {
    const raw = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    else this.queue.push(raw);
  }

  close(): void {
    this.closed = true;
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
  }
}
