/**
 * home-guild.ts — Cross-guild tenant isolation guard
 *
 * Cards and sets are globally shared data (no guildId column on cards or sets).
 * Any guild that adds the bot would otherwise allow its owner/admins to mutate
 * shared data affecting every other community.
 *
 * HOME_GUILD_IDS (comma-separated) lists the Discord servers authorised to run
 * commands that create, edit, or delete globally shared records (cards table,
 * sets table, card_set_memberships table). Falls back to the legacy single-value
 * HOME_GUILD_ID for backward compatibility.
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

function parseHomeGuildIds(): string[] {
  const multi = process.env["HOME_GUILD_IDS"]?.trim();
  if (multi) {
    return multi.split(",").map(id => id.trim()).filter(Boolean);
  }
  const single = process.env["HOME_GUILD_ID"]?.trim();
  return single ? [single] : [];
}

/** All guild IDs authorised to mutate global data. */
export const HOME_GUILD_IDS: readonly string[] = parseHomeGuildIds();

/** @deprecated Use HOME_GUILD_IDS instead. Kept for dashboard route compat. */
export const HOME_GUILD_ID: string | null = HOME_GUILD_IDS[0] ?? null;

export function isHomeGuild(guildId: string): boolean {
  // When no home guilds are configured, allow all guilds (fail-open).
  // The restriction only activates once you explicitly set the env var,
  // at which point only listed servers can mutate globally shared data.
  if (HOME_GUILD_IDS.length === 0) return true;
  return HOME_GUILD_IDS.includes(guildId);
}

export const GLOBAL_ONLY_MSG =
  "❌ This command modifies shared global data (cards/sets) and can only be " +
  "run from a home server. Guild-scoped commands (`/setadmin active`, " +
  "`/setadmin deactivate`, `/rarity`, `/embed`, `/admin config`) still work from " +
  "any server.\n" +
  "*(Bot operator: set the `HOME_GUILD_IDS` environment variable to a " +
  "comma-separated list of authorised server IDs.)*";

export const GLOBAL_ONLY_MSG_TEXT =
  "❌ This command modifies shared global data and can only be run from a " +
  "home server. Guild-scoped commands (setchannel, setinterval, setrarity, " +
  "spawnenable/disable, tradingenable/disable, addadmin, etc.) still work. " +
  "Bot operator: set the HOME_GUILD_IDS environment variable.";
