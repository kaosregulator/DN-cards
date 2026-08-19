// ─────────────────────────────────────────────────────────────────────────────
// Online duel relay — matchmaking + action relay for the Activity's PvP mode.
//
// Deliberately thin. The server does NOT simulate the duel: it identifies both
// players against Discord, builds one shared deck setup from their REAL
// collections, picks a seed, and then relays each side's moves to the other.
// Both clients run the same seeded engine, so identical action streams keep the
// boards in lockstep. Nothing here mutates the database — a PvP duel, like the
// rest of the Activity, spends and grants nothing.
//
// Rooms are keyed by the Discord Activity instance id, so everyone who launched
// the same Activity lands in the same matchmaking pool.
// ─────────────────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger.js";

const DISCORD_API = "https://discord.com/api";
const PATH = "/api/activity/duel-ws";

/** Max time a socket may stay unauthenticated before we drop it. */
const HELLO_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

interface Client {
  ws: WebSocket;
  userId: string;
  name: string;
  room: string;
  /** The opponent's socket once matched. */
  peer: Client | null;
  alive: boolean;
}

/** room key → the player waiting there for an opponent. */
const waiting = new Map<string, Client>();

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch { /* peer vanished mid-write */ }
  }
}

/** Resolve a Discord access token to a user. Never trust a client-sent id. */
async function identify(token: string): Promise<{ id: string; username: string } | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; username?: string };
    return u.id ? { id: u.id, username: u.username ?? "Duelist" } : null;
  } catch (err) {
    logger.debug({ err }, "duel-ws identify failed");
    return null;
  }
}

/** Build the shared setup: each player's OWN cards form their own deck.
 *  The deck reader (and with it the database) is imported lazily so merely
 *  attaching the socket never drags the DB into the module graph. */
async function buildMatchSetup(a: { userId: string; name: string }, b: { userId: string; name: string }) {
  const [{ duelReadModel }, { HOME_GUILD_ID }] = await Promise.all([
    import("../bot/activity/duel-model.js"),
    import("../bot/home-guild.js"),
  ]);
  const guildId = HOME_GUILD_ID!;
  const [da, db] = await Promise.all([
    duelReadModel(guildId, a.userId, a.name),
    duelReadModel(guildId, b.userId, b.name),
  ]);
  return {
    startingLp: da.startingLp,
    handSize: da.handSize,
    // "player" is whoever was waiting first; the other client is told it is
    // the "opponent" side of this same shared state.
    player: { name: a.name, deck: da.player.deck },
    opponent: { name: b.name, deck: db.player.deck },
  };
}

function partWays(c: Client, notify: boolean): void {
  const peer = c.peer;
  if (peer) {
    peer.peer = null;
    if (notify) send(peer.ws, { t: "opponentLeft" });
  }
  c.peer = null;
  if (waiting.get(c.room) === c) waiting.delete(c.room);
}

/** Seams so tests can drive the relay without Discord or the database. */
export interface DuelNetDeps {
  identify: (token: string) => Promise<{ id: string; username: string } | null>;
  buildSetup: (a: { userId: string; name: string }, b: { userId: string; name: string }) => Promise<unknown>;
  configured: () => boolean;
}

const realDeps: DuelNetDeps = {
  identify,
  buildSetup: (a, b) => buildMatchSetup(a, b) as Promise<unknown>,
  configured: () => !!process.env["HOME_GUILD_ID"]?.trim(),
};

export function attachDuelSocket(server: HttpServer, deps: DuelNetDeps = realDeps): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on("upgrade", (req, socket, head) => {
    let pathname: string;
    try { pathname = new URL(req.url ?? "/", "http://localhost").pathname; } catch { return; }
    // Discord proxies the Activity, so the path may arrive prefixed.
    if (!pathname.endsWith(PATH) && pathname !== PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let client: Client | null = null;

    const helloTimer = setTimeout(() => {
      if (!client) { send(ws, { t: "error", message: "Authentication timed out." }); ws.close(); }
    }, HELLO_TIMEOUT_MS);

    ws.on("pong", () => { if (client) client.alive = true; });

    ws.on("message", async (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }

      // ── hello: authenticate and enter the room's matchmaking pool ──
      if (msg.t === "hello") {
        if (client) return;                                  // already said hello
        if (!deps.configured()) { send(ws, { t: "error", message: "PvP is not configured." }); ws.close(); return; }
        const token = typeof msg.token === "string" ? msg.token : "";
        const user = await deps.identify(token);
        if (!user) { send(ws, { t: "error", message: "Discord sign-in failed." }); ws.close(); return; }
        clearTimeout(helloTimer);

        const room = typeof msg.room === "string" && msg.room ? msg.room.slice(0, 64) : "lobby";
        client = { ws, userId: user.id, name: user.username, room, peer: null, alive: true };

        const opponent = waiting.get(room);
        // Don't pair someone with their own second tab.
        if (opponent && opponent.ws.readyState === WebSocket.OPEN && opponent.userId !== user.id) {
          waiting.delete(room);
          client.peer = opponent;
          opponent.peer = client;
          try {
            const setup = await deps.buildSetup(
              { userId: opponent.userId, name: opponent.name },
              { userId: client.userId, name: client.name },
            );
            const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
            // Both sides get the SAME setup and seed; each is told which half
            // of that shared state it controls.
            send(opponent.ws, { t: "match", seed, setup, youAre: "player", opponentName: client.name });
            send(client.ws, { t: "match", seed, setup, youAre: "opponent", opponentName: opponent.name });
            logger.info({ room, a: opponent.userId, b: user.id }, "duel-ws match made");
          } catch (err) {
            logger.error({ err }, "duel-ws failed to build match");
            send(ws, { t: "error", message: "Couldn't build the match." });
            send(opponent.ws, { t: "error", message: "Couldn't build the match." });
            partWays(client, false);
          }
        } else {
          waiting.set(room, client);
          send(ws, { t: "waiting" });
        }
        return;
      }

      if (!client) return;                                   // nothing before hello

      // ── action: relay verbatim to the opponent ──
      if (msg.t === "action") {
        if (!client.peer) return;
        send(client.peer.ws, { t: "action", action: msg.action });
        return;
      }

      if (msg.t === "leave") { partWays(client, true); ws.close(); }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (client) partWays(client, true);
    });
    ws.on("error", () => { if (client) partWays(client, true); });
  });

  // Drop sockets that stop answering so rooms don't fill with ghosts.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const sock = ws as WebSocket & { __alive?: boolean };
      if (sock.__alive === false) { ws.terminate(); continue; }
      sock.__alive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, PING_INTERVAL_MS);
  wss.on("close", () => clearInterval(heartbeat));
  wss.on("connection", (ws) => {
    const sock = ws as WebSocket & { __alive?: boolean };
    sock.__alive = true;
    ws.on("pong", () => { sock.__alive = true; });
  });

  logger.info({ path: PATH }, "Duel PvP socket attached");
}
