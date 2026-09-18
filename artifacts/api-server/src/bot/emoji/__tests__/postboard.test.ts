import { describe, expect, it, beforeEach } from "vitest";
import { buildEmojiCommandJson, buildPostboardCommandJson } from "../commands/definition.js";
import {
  buildControls, buildFinishScreen, buildPublicBoard, buildTargetChooser,
  parseCid, BOARD_TOKEN, resultHint,
} from "../commands/ui.js";
import { createSession } from "../commands/session.js";
import {
  BOARD_COOLDOWN_MS, consumeBoardCooldown, resetBoardCooldownsForTesting,
} from "../commands/postboard.js";
import type { EmojiSession } from "../commands/session.js";

describe("/postboard definition", () => {
  it("is an admin channel-picker command", () => {
    const cmd = buildPostboardCommandJson() as {
      name: string;
      default_member_permissions?: string | null;
      options?: { name: string; required?: boolean }[];
    };
    expect(cmd.name).toBe("postboard");
    expect(cmd.options?.[0]?.name).toBe("channel");
    expect(cmd.options?.[0]?.required).toBe(true);
    // Administrator bit — Discord encodes as a permission string.
    expect(cmd.default_member_permissions).toBeTruthy();
  });

  it("stays separate from the option-free /emoji entry point", () => {
    expect(buildEmojiCommandJson().name).toBe("emoji");
    expect((buildEmojiCommandJson() as { options?: unknown[] }).options ?? []).toEqual([]);
  });
});

describe("public board message", () => {
  it("matches the /emoji target chooser, keyed with the board sentinel", () => {
    const board = buildPublicBoard();
    const privateChooser = buildTargetChooser("tok");
    expect(board.content).toBe(privateChooser.content);

    const actions = (board.components as unknown as {
      components: { data: { custom_id?: string } }[];
    }[]).flatMap(r => r.components.map(c => parseCid(c.data.custom_id ?? "")));

    for (const action of ["pick_user", "pick_me", "upload", "pick_server", "pick_fav"]) {
      expect(actions.some(a => a?.action === action && a.token === BOARD_TOKEN), action).toBe(true);
    }
  });
});

describe("postboard sessions hide Post", () => {
  function session(allowPost: boolean): EmojiSession {
    return createSession({
      image: Buffer.from([1]),
      ownerId: "u1",
      sourceLabel: "your avatar",
      animation: "gen_btn_shake",
      format: "gif",
      allowPost,
      lastResult: {
        buffer: Buffer.from([1, 2, 3]), format: "gif", bytes: 4096,
        providerId: "offline", cached: false,
      },
    }).session;
  }

  it("omits Post from the control panel and finish screen", () => {
    const tok = "tok";
    const s = session(false);
    // createSession mints its own token; rebuild UI against a fixed one.
    const ids = (buildControls(s, tok) as unknown as {
      components: { data: { custom_id?: string } }[];
    }[]).flatMap(r => r.components.map(c => parseCid(c.data.custom_id ?? "")?.action ?? ""));
    expect(ids).not.toContain("post");
    expect(ids).toContain("done");

    const finish = buildFinishScreen(s, tok);
    const finishIds = (finish.components as unknown as {
      components: { data: { custom_id?: string } }[];
    }[]).flatMap(r => r.components.map(c => parseCid(c.data.custom_id ?? "")?.action ?? ""));
    expect(finishIds).not.toContain("post");
    expect(finishIds).toContain("keep_editing");
    expect(resultHint(s)).not.toMatch(/Post/i);
  });

  it("keeps Post on normal /emoji sessions", () => {
    const s = session(true);
    const ids = (buildControls(s, "tok") as unknown as {
      components: { data: { custom_id?: string } }[];
    }[]).flatMap(r => r.components.map(c => parseCid(c.data.custom_id ?? "")?.action ?? ""));
    expect(ids).toContain("post");
    expect(resultHint(s)).toMatch(/Post/);
  });
});

describe("per-user board cooldown", () => {
  beforeEach(() => resetBoardCooldownsForTesting());

  it("allows the first use, then blocks the same user until the gap elapses", () => {
    expect(consumeBoardCooldown("g1", "u1").ok).toBe(true);
    const blocked = consumeBoardCooldown("g1", "u1");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryMs).toBeGreaterThan(0);
    expect(blocked.retryMs).toBeLessThanOrEqual(BOARD_COOLDOWN_MS);
    expect(blocked.message).toMatch(/board/i);
  });

  it("does not share cooldowns across users or guilds", () => {
    expect(consumeBoardCooldown("g1", "u1").ok).toBe(true);
    expect(consumeBoardCooldown("g1", "u2").ok).toBe(true);
    expect(consumeBoardCooldown("g2", "u1").ok).toBe(true);
  });
});
