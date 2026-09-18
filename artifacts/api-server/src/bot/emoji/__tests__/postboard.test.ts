import { describe, expect, it, beforeEach } from "vitest";
import { buildEmojiCommandJson, buildPostboardCommandJson } from "../commands/definition.js";
import {
  buildControls, buildFinishScreen, buildPublicBoard, buildTargetChooser,
  parseCid, BOARD_TOKEN, resultHint, encodeBoardToken, parseBoardAccess, isBoardToken,
} from "../commands/ui.js";
import { createSession } from "../commands/session.js";
import {
  BOARD_COOLDOWN_MS, checkBoardCooldown, armBoardCooldown, memberMayUseBoard,
  resetBoardCooldownsForTesting,
} from "../commands/postboard.js";
import type { EmojiSession } from "../commands/session.js";

describe("/postboard definition", () => {
  it("is an admin channel-picker with optional role gates", () => {
    const cmd = buildPostboardCommandJson() as {
      name: string;
      default_member_permissions?: string | null;
      options?: { name: string; required?: boolean }[];
    };
    expect(cmd.name).toBe("postboard");
    const names = (cmd.options ?? []).map(o => o.name);
    expect(names).toContain("channel");
    expect(names).toContain("allow_role");
    expect(names).toContain("block_role");
    expect(cmd.options?.find(o => o.name === "channel")?.required).toBe(true);
    expect(cmd.default_member_permissions).toBeTruthy();
  });

  it("stays separate from the option-free /emoji entry point", () => {
    expect(buildEmojiCommandJson().name).toBe("emoji");
    expect((buildEmojiCommandJson() as { options?: unknown[] }).options ?? []).toEqual([]);
  });
});

describe("public board message", () => {
  it("includes how-to instructions and the same controls as /emoji", () => {
    const board = buildPublicBoard();
    expect(board.content).toMatch(/Live emoji board/i);
    expect(board.content).toMatch(/How to use/i);
    expect(board.content).toMatch(/press-and-hold|right-click/i);
    expect(board.content).toMatch(/cooldown/i);

    const actions = (board.components as unknown as {
      components: { data: { custom_id?: string } }[];
    }[]).flatMap(r => r.components.map(c => parseCid(c.data.custom_id ?? "")));

    for (const action of ["pick_user", "pick_me", "upload", "pick_server", "pick_fav"]) {
      expect(actions.some(a => a?.action === action && isBoardToken(a.token)), action).toBe(true);
    }
  });

  it("mentions allow/block roles when configured", () => {
    const board = buildPublicBoard({
      allowRoleIds: ["111"],
      blockRoleIds: ["222"],
    });
    expect(board.content).toContain("<@&111>");
    expect(board.content).toContain("<@&222>");
    const token = parseCid(
      (board.components as unknown as { components: { data: { custom_id?: string } }[] }[])[0]!
        .components[0]!.data.custom_id!,
    )!.token;
    expect(parseBoardAccess(token)).toEqual({
      allowRoleIds: ["111"],
      blockRoleIds: ["222"],
    });
  });

  it("keeps the private /emoji chooser copy separate", () => {
    const privateChooser = buildTargetChooser("tok");
    expect(privateChooser.content).toMatch(/Make an emoji/);
    expect(privateChooser.content).not.toMatch(/Live emoji board/);
  });
});

describe("board access token encoding", () => {
  it("round-trips allow and block role ids", () => {
    const token = encodeBoardToken({ allowRoleIds: ["123456789012345678"], blockRoleIds: ["987654321098765432"] });
    expect(isBoardToken(token)).toBe(true);
    expect(parseBoardAccess(token)).toEqual({
      allowRoleIds: ["123456789012345678"],
      blockRoleIds: ["987654321098765432"],
    });
  });

  it("treats legacy board token as open access", () => {
    expect(isBoardToken(BOARD_TOKEN)).toBe(true);
    expect(parseBoardAccess(BOARD_TOKEN)).toEqual({ allowRoleIds: [], blockRoleIds: [] });
  });
});

describe("memberMayUseBoard", () => {
  function memberWith(roleIds: string[]) {
    const cache = new Map(roleIds.map(id => [id, { id }]));
    return {
      roles: { cache: { has: (id: string) => cache.has(id) } },
    } as unknown as import("discord.js").GuildMember;
  }

  it("allows everyone when no gates are set", () => {
    expect(memberMayUseBoard(memberWith([]), { allowRoleIds: [], blockRoleIds: [] }).ok).toBe(true);
  });

  it("requires an allow role when whitelist is set", () => {
    const access = { allowRoleIds: ["vip"], blockRoleIds: [] as string[] };
    expect(memberMayUseBoard(memberWith(["vip"]), access).ok).toBe(true);
    expect(memberMayUseBoard(memberWith(["other"]), access).ok).toBe(false);
  });

  it("denies a blocklisted role", () => {
    const access = { allowRoleIds: [] as string[], blockRoleIds: ["muted"] };
    expect(memberMayUseBoard(memberWith(["muted"]), access).ok).toBe(false);
    expect(memberMayUseBoard(memberWith(["ok"]), access).ok).toBe(true);
  });

  it("lets admins / owners through either gate", () => {
    const access = { allowRoleIds: ["vip"], blockRoleIds: ["muted"] };
    expect(memberMayUseBoard(memberWith(["muted"]), access, { isAdministrator: true }).ok).toBe(true);
    expect(memberMayUseBoard(memberWith([]), access, { isGuildOwner: true }).ok).toBe(true);
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

describe("per-user board cooldown (after generate)", () => {
  beforeEach(() => resetBoardCooldownsForTesting());

  it("allows browsing until a generate arms the cooldown", () => {
    expect(checkBoardCooldown("g1", "u1").ok).toBe(true);
    expect(checkBoardCooldown("g1", "u1").ok).toBe(true); // still free — not armed
    armBoardCooldown("g1", "u1");
    const blocked = checkBoardCooldown("g1", "u1");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryMs).toBeGreaterThan(0);
    expect(blocked.retryMs).toBeLessThanOrEqual(BOARD_COOLDOWN_MS);
    expect(blocked.message).toMatch(/board/i);
  });

  it("does not share cooldowns across users or guilds", () => {
    armBoardCooldown("g1", "u1");
    expect(checkBoardCooldown("g1", "u2").ok).toBe(true);
    expect(checkBoardCooldown("g2", "u1").ok).toBe(true);
  });
});
