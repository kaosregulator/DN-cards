/**
 * home-guild.ts — Cross-guild tenant isolation guard
 *
 * Cards and sets are owned per-guild. The home guild keeps its own cards/sets
 * (and is the only guild that can use the admin dashboard), but every other
 * guild is a completely separate tenant: they only see and mutate cards/sets
 * that belong to their own server.
 *
 * HOME_GUILD_ID designates the single Discord server authorised to run commands
 * that create, edit, or delete globally shared records (cards table,
 * sets table, card_set_memberships table).
 *
 * Guild-scoped operations remain available from ANY server:
 *   /set_hub · /set_admin (activate/deactivate/view/weights via hubs)
 *   /rarity, /embed, /config, /admin_hub, /setup
 *   gameplay commands (/drop, /give, /event, /user-hub daily, /pack, …)
 *
 * How to find your guild ID:
 *   Discord → right-click the server icon (Developer Mode on) → Copy Server ID
 *   — OR — Server Settings → Widget → Server ID
 */
export const HOME_GUILD_ID: string | null =
  process.env["HOME_GUILD_ID"]?.trim() || null;

export function isHomeGuild(guildId: string): boolean {
  // When HOME_GUILD_ID is not configured, treat every guild as home. This only
  // affects the dashboard gate; visibility/ownership below are still strict
  // per-guild, so a missing env var does not leak data across servers.
  if (!HOME_GUILD_ID) return true;
  return guildId === HOME_GUILD_ID;
}

// A card/set is visible to a guild only if it belongs to that guild.
// No cross-guild visibility, including from the home guild.
export function isVisibleTo(record: { guildId: string }, viewerGuildId: string | null | undefined): boolean {
  if (!viewerGuildId) return false;
  return record.guildId === viewerGuildId;
}

// A card/set can be mutated only by its owning guild.
export function isOwnedBy(record: { guildId: string }, actorGuildId: string): boolean {
  if (!actorGuildId) return false;
  return record.guildId === actorGuildId;
}

export const GLOBAL_ONLY_MSG =
  "❌ This command modifies shared global data (cards/sets) and can only be " +
  "run from the home server. Guild-scoped commands (`/set_hub`, `/set_admin`, " +
  "`/rarity`, `/embed`, `/config`) still work from any server.\n" +
  "*(Bot operator: set the `HOME_GUILD_ID` environment variable to your " +
  "server's ID.)*";

export const GLOBAL_ONLY_MSG_TEXT =
  "❌ This command modifies shared global data and can only be run from the " +
  "home server. Guild-scoped commands (setchannel, setinterval, setrarity, " +
  "spawnenable/disable, tradingenable/disable, addadmin, etc.) still work. " +
  "Bot operator: set the HOME_GUILD_ID environment variable.";
