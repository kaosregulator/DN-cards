import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { attachDuelSocket, type DuelNetDeps } from "../duel-net";

// Integration test: a REAL http server with the REAL relay attached, driven by
// two REAL WebSocket clients. Only Discord identity and deck-building are
// stubbed — the matchmaking, pairing and relay paths are the shipping ones.

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) { try { s.close(); } catch { /* closing */ } }
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

const FAKE_SETUP = { startingLp: 8000, handSize: 5, player: { name: "A", deck: [] }, opponent: { name: "B", deck: [] } };

function deps(overrides: Partial<DuelNetDeps> = {}): DuelNetDeps {
  return {
    // token "tok:<id>:<name>" identifies as that user.
    identify: async (token: string) => {
      const m = /^tok:([^:]+):(.+)$/.exec(token);
      return m ? { id: m[1]!, username: m[2]! } : null;
    },
    buildSetup: async () => FAKE_SETUP,
    configured: () => true,
    ...overrides,
  };
}

async function startRelay(d: DuelNetDeps = deps()): Promise<number> {
  const server = createServer();
  attachDuelSocket(server, d);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, r));
  return (server.address() as { port: number }).port;
}

/** A client that records every message it receives. */
function connect(port: number): { ws: WebSocket; msgs: Record<string, unknown>[]; next: (t: string, ms?: number) => Promise<Record<string, unknown>> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/activity/duel-ws`);
  sockets.push(ws);
  const msgs: Record<string, unknown>[] = [];
  ws.on("message", (raw) => { try { msgs.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
  const next = (t: string, ms = 4000) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const found = msgs.find((m) => m.t === t);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${t}"`)), ms);
    const onMsg = (raw: unknown) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }
      if (m.t === t) { clearTimeout(timer); ws.off("message", onMsg); resolve(m); }
    };
    ws.on("message", onMsg);
  });
  return { ws, msgs, next };
}
const open = (ws: WebSocket) => new Promise<void>((r) => (ws.readyState === WebSocket.OPEN ? r() : ws.on("open", () => r())));
const hello = (ws: WebSocket, id: string, name: string, room = "r1") =>
  ws.send(JSON.stringify({ t: "hello", token: `tok:${id}:${name}`, room, name }));

describe("duel PvP relay", () => {
  it("puts the first player in a waiting room", async () => {
    const port = await startRelay();
    const a = connect(port);
    await open(a.ws);
    hello(a.ws, "u1", "Alice");
    expect((await a.next("waiting")).t).toBe("waiting");
  });

  it("matches two players and gives BOTH the same seed and setup", async () => {
    const port = await startRelay();
    const a = connect(port), b = connect(port);
    await open(a.ws); await open(b.ws);
    hello(a.ws, "u1", "Alice");
    await a.next("waiting");
    hello(b.ws, "u2", "Bob");

    const ma = await a.next("match");
    const mb = await b.next("match");
    // Identical shared state inputs — this is what keeps them in lockstep.
    expect(ma.seed).toBe(mb.seed);
    expect(Number.isInteger(ma.seed)).toBe(true);
    expect(ma.setup).toEqual(mb.setup);
    // Opposite sides of that state, and each sees the other's name.
    expect(ma.youAre).toBe("player");
    expect(mb.youAre).toBe("opponent");
    expect(ma.opponentName).toBe("Bob");
    expect(mb.opponentName).toBe("Alice");
  });

  it("relays actions to the opponent only", async () => {
    const port = await startRelay();
    const a = connect(port), b = connect(port);
    await open(a.ws); await open(b.ws);
    hello(a.ws, "u1", "Alice"); await a.next("waiting");
    hello(b.ws, "u2", "Bob");
    await a.next("match"); await b.next("match");

    const action = { k: "summon", handIndex: 2, position: "attack", tributeZones: [] };
    a.ws.send(JSON.stringify({ t: "action", action }));
    const got = await b.next("action");
    expect(got.action).toEqual(action);
    // The sender does not receive an echo of its own move.
    expect(a.msgs.filter((m) => m.t === "action").length).toBe(0);
  });

  it("tells the survivor when their opponent disconnects", async () => {
    const port = await startRelay();
    const a = connect(port), b = connect(port);
    await open(a.ws); await open(b.ws);
    hello(a.ws, "u1", "Alice"); await a.next("waiting");
    hello(b.ws, "u2", "Bob");
    await a.next("match"); await b.next("match");
    b.ws.close();
    expect((await a.next("opponentLeft")).t).toBe("opponentLeft");
  });

  it("never pairs a player with their own second connection", async () => {
    const port = await startRelay();
    const a = connect(port), b = connect(port);
    await open(a.ws); await open(b.ws);
    hello(a.ws, "u1", "Alice"); await a.next("waiting");
    hello(b.ws, "u1", "Alice");            // same user id, second tab
    expect((await b.next("waiting")).t).toBe("waiting");
    expect(a.msgs.some((m) => m.t === "match")).toBe(false);
  });

  it("keeps separate rooms from matching each other", async () => {
    const port = await startRelay();
    const a = connect(port), b = connect(port);
    await open(a.ws); await open(b.ws);
    hello(a.ws, "u1", "Alice", "roomA"); await a.next("waiting");
    hello(b.ws, "u2", "Bob", "roomB");
    await b.next("waiting");
    expect(a.msgs.some((m) => m.t === "match")).toBe(false);
  });

  it("rejects a bad token", async () => {
    const port = await startRelay();
    const a = connect(port);
    await open(a.ws);
    a.ws.send(JSON.stringify({ t: "hello", token: "garbage", room: "r1" }));
    expect(String((await a.next("error")).message)).toMatch(/sign-in/i);
  });

  it("refuses to match when PvP isn't configured", async () => {
    const port = await startRelay(deps({ configured: () => false }));
    const a = connect(port);
    await open(a.ws);
    hello(a.ws, "u1", "Alice");
    expect(String((await a.next("error")).message)).toMatch(/not configured/i);
  });

  it("ignores actions sent before authenticating", async () => {
    const port = await startRelay();
    const a = connect(port);
    await open(a.ws);
    a.ws.send(JSON.stringify({ t: "action", action: { k: "endTurn" } }));
    await new Promise((r) => setTimeout(r, 250));
    expect(a.msgs.length).toBe(0);           // no crash, no response
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("surfaces an error if the match setup fails to build", async () => {
    const port = await startRelay(deps({ buildSetup: async () => { throw new Error("db down"); } }));
    const a = connect(port), b = connect(port);
    await open(a.ws); await open(b.ws);
    hello(a.ws, "u1", "Alice"); await a.next("waiting");
    hello(b.ws, "u2", "Bob");
    expect(String((await b.next("error")).message)).toMatch(/couldn't build/i);
  });
});
