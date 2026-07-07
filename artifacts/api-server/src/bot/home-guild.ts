/**
 * home-guild.ts — Cross-guild tenant isolation guard
 *
 * Cards and sets are globally shared data (no guildId column on cards or sets).
 * Any guild that adds the bot would otherwise allow its owner/admins to mutate
 * shared data affecting every other community.
 *
 * HOME_GUILD_ID designates the single Discord server authorised to run commands
 * that create, edit, or delete globally shared records (cards table,
 * sets table, card_set_memberships table).
 *
 * Guild-scoped operations remain available from ANY server:
 *   /setadmin active|deactivate|view|showweights|list
 *   /rarity, /embed, /config, /adminhub, /setup
 *   gameplay commands (/drop, /give, /event, /daily, /pack, …)
 *
 * How to find your guild ID:
 *   Discord → right-click the server icon (Developer Mode on) → Copy Server ID
 *   — OR — Server Settings → Widget → Server ID
 */
export const HOME_GUILD_ID: string | null =
  process.env["HOME_GUILD_ID"]?.trim() || null;

export function isHomeGuild(guildId: string): boolean {
  // When HOME_GUILD_ID is not configured, allow all guilds (fail-open).
  // The restriction only activates once you explicitly set the env var,
  // at which point only that one server can mutate globally shared data.
  if (!HOME_GUILD_ID) return true;
  return guildId === HOME_GUILD_ID;
}

// A card/set is visible to a guild if it belongs to the home guild (shared)
// or to the viewing guild itself. The home guild can see everything.
export function isVisibleTo(record: { guildId: string }, viewerGuildId: string | null | undefined): boolean {
  if (!HOME_GUILD_ID) return true;
  if (record.guildId === HOME_GUILD_ID) return true;
  if (viewerGuildId && record.guildId === viewerGuildId) return true;
  if (viewerGuildId && isHomeGuild(viewerGuildId)) return true;
  return false;
}

// A card/set can be mutated by a guild if that guild owns it or is the home guild.
export function isOwnedBy(record: { guildId: string }, actorGuildId: string): boolean {
  if (!HOME_GUILD_ID) return true;
  if (isHomeGuild(actorGuildId)) return true;
  return record.guildId === actorGuildId;
}

export const GLOBAL_ONLY_MSG =
  "❌ This command modifies shared global data (cards/sets) and can only be " +
  "run from the home server. Guild-scoped commands (`/setadmin active`, " +
  "`/setadmin deactivate`, `/rarity`, `/embed`, `/admin config`) still work from " +
  "any server.\n" +
  "*(Bot operator: set the `HOME_GUILD_ID` environment variable to your " +
  "server's ID.)*";

export const GLOBAL_ONLY_MSG_TEXT =
  "❌ This command modifies shared global data and can only be run from the " +
  "home server. Guild-scoped commands (setchannel, setinterval, setrarity, " +
  "spawnenable/disable, tradingenable/disable, addadmin, etc.) still work. " +
  "Bot operator: set the HOME_GUILD_ID environment variable.";
