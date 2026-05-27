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
  if (!HOME_GUILD_ID) return false;
  return guildId === HOME_GUILD_ID;
}

export const GLOBAL_ONLY_MSG =
  "❌ This command modifies shared global data (cards/sets) and can only be " +
  "run from the home server. Guild-scoped commands (`/setadmin active`, " +
  "`/setadmin deactivate`, `/rarity`, `/embed`, `/config`) still work from " +
  "any server.\n" +
  "*(Bot operator: set the `HOME_GUILD_ID` environment variable to your " +
  "server's ID.)*";

export const GLOBAL_ONLY_MSG_TEXT =
  "❌ This command modifies shared global data and can only be run from the " +
  "home server. Guild-scoped commands (setchannel, setinterval, setrarity, " +
  "spawnenable/disable, tradingenable/disable, addadmin, etc.) still work. " +
  "Bot operator: set the HOME_GUILD_ID environment variable.";
