import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the bot client + DB so the gate can be exercised without a Discord
// connection or a live database.
const guildState: {
  ownerId: string;
  members: Map<string, { permissions: { has: (p: bigint) => boolean } }>;
} = { ownerId: "owner-1", members: new Map() };

vi.mock("../../client-holder.js", () => ({
  getBotClient: () => ({
    guilds: { cache: { get: (id: string) => (id === "home-guild" ? {
      ownerId: guildState.ownerId,
      members: {
        cache: { get: (uid: string) => guildState.members.get(uid) },
        fetch: async (uid: string) => {
          const m = guildState.members.get(uid);
          if (!m) throw new Error("unknown member");
          return m;
        },
      },
    } : undefined) } },
  }),
}));

const dbAdmins = new Set<string>();
vi.mock("../../db.js", () => ({
  isAdmin: async (_guildId: string, userId: string) => dbAdmins.has(userId),
}));

vi.mock("../../home-guild.js", () => ({ HOME_GUILD_ID: "home-guild" }));

const ADMIN = 8n; // PermissionsBitField.Flags.Administrator
const perms = (bits: bigint) => ({ has: (p: bigint) => (bits & p) === p });

let auth: typeof import("../auth.js");

describe("world-builder auth gate", () => {
  beforeEach(async () => {
    delete process.env["WORLD_BUILDER_OPEN"];
    process.env["NODE_ENV"] = "production"; // closed mode → real checks run
    guildState.ownerId = "owner-1";
    guildState.members = new Map();
    dbAdmins.clear();
    vi.resetModules();
    auth = await import("../auth.js");
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("precedence: open mode and overrides win; else owner/admin OR db-admin", () => {
    const r = auth.resolveCanEdit;
    expect(r({ openMode: true, isGuildOwnerOrAdmin: false, isDbAdmin: false })).toBe(true);
    expect(r({ openMode: false, discordAdminOverride: true, isGuildOwnerOrAdmin: false, isDbAdmin: false })).toBe(true);
    expect(r({ openMode: false, isGuildOwnerOrAdmin: true, isDbAdmin: false })).toBe(true);
    expect(r({ openMode: false, isGuildOwnerOrAdmin: false, isDbAdmin: true })).toBe(true);
    expect(r({ openMode: false, isGuildOwnerOrAdmin: false, isDbAdmin: false })).toBe(false);
  });

  it("lets the home-guild OWNER edit even with no admin_users row", async () => {
    // The reported bug: real admin, not in the DB table.
    expect(await auth.canEditWorld("owner-1")).toBe(true);
  });

  it("lets a Discord ADMINISTRATOR edit with no admin_users row", async () => {
    guildState.members.set("mod-9", { permissions: perms(ADMIN) });
    expect(await auth.canEditWorld("mod-9")).toBe(true);
  });

  it("still lets an admin_users DB row edit (existing behavior)", async () => {
    dbAdmins.add("dbguy-2");
    expect(await auth.canEditWorld("dbguy-2")).toBe(true);
  });

  it("denies a non-admin member (no Administrator, not owner, not in DB)", async () => {
    guildState.members.set("rando-3", { permissions: perms(0n) });
    expect(await auth.canEditWorld("rando-3")).toBe(false);
  });

  it("denies when there is no user id", async () => {
    expect(await auth.canEditWorld(null)).toBe(false);
  });
});
