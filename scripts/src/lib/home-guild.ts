/**
 * The home guild ID, shared by the backup/migration scripts.
 *
 * Prefers HOME_GUILD_ID from the environment (set in .replit userenv, and
 * required by the API server at boot — see artifacts/api-server/src/index.ts).
 * Falls back to the literal used as the cards.guild_id column default so these
 * scripts still run in a shell where the env var was not exported.
 */
export const HOME_GUILD_ID: string =
  process.env["HOME_GUILD_ID"]?.trim() || "1363917781355069761";
