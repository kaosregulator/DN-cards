import { describe, expect, it } from "vitest";
import {
  createSession, endSession, getSession, sessionCount, touchSession,
} from "../commands/session.js";
import { parseCid, cid } from "../commands/ui.js";

function make(ownerId = "u1") {
  return createSession({
    image: Buffer.from([1, 2, 3]),
    ownerId,
    sourceLabel: "test",
    animation: "shake",
    speed: "normal",
    direction: "right",
    size: "128",
    format: "gif",
  });
}

describe("session store", () => {
  it("round-trips a session by token", () => {
    const { token, session } = make();
    expect(getSession(token)).toBe(session);
  });

  it("issues distinct, opaque tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => make().token));
    expect(tokens.size).toBe(50);
    // customIds are colon-delimited, so a token containing ':' would corrupt them.
    for (const t of tokens) expect(t).not.toContain(":");
  });

  it("applies patches and keeps the session alive", () => {
    const { token } = make();
    const updated = touchSession(token, { animation: "spin", size: "64" });
    expect(updated?.animation).toBe("spin");
    expect(updated?.size).toBe("64");
    expect(getSession(token)?.animation).toBe("spin");
  });

  it("returns undefined for unknown or ended sessions", () => {
    const { token } = make();
    endSession(token);
    expect(getSession(token)).toBeUndefined();
    expect(touchSession(token, { animation: "spin" })).toBeUndefined();
    expect(getSession("never-existed")).toBeUndefined();
  });

  it("bounds itself so image buffers can't accumulate without limit", () => {
    for (let i = 0; i < 400; i++) make(`u${i}`);
    expect(sessionCount()).toBeLessThanOrEqual(200);
  });
});

describe("customId round-trip", () => {
  it("parses ids it built", () => {
    expect(parseCid(cid("effect", "abc123"))).toEqual({ action: "effect", token: "abc123" });
  });

  it("ignores ids belonging to other features", () => {
    expect(parseCid("pmd:effect:abc")).toBeNull();
    expect(parseCid("emoji:effect")).toBeNull();
    expect(parseCid("emoji:effect:abc:extra")).toBeNull();
    expect(parseCid("")).toBeNull();
  });
});
