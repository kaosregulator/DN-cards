import 'dotenv/config';
import path from 'node:path';

// Centralised, validated configuration. Reads once at boot. Missing values are
// reported (not fatal) so the web server can still start and show setup help —
// which makes "deploy first, paste secrets after" workflows painless.

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}
function int(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}
function list(name) {
  return str(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Add-on mode: DN-Cards sets THEATER_ADDON=1 when it embeds the Theater in its
// own process. A Discord Application can own only ONE embedded Activity, and the
// host Application already owns another (its game Activity). So in add-on mode
// the Theater must NEVER borrow the host's Discord Application for its Activity —
// its Activity credentials come ONLY from the Theater's own THEATER_CLIENT_ID /
// THEATER_CLIENT_SECRET (a separate Application, added later) and stay empty
// until then, which cleanly disables the embedded launch without touching the
// host's game Activity. Standalone mode (no THEATER_ADDON) is unchanged: it
// still reads DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET exactly as before.
const IS_ADDON = str('THEATER_ADDON') === '1';
function activityClientId() {
  return str('THEATER_CLIENT_ID') || (IS_ADDON ? '' : str('DISCORD_CLIENT_ID'));
}
function activityClientSecret() {
  return str('THEATER_CLIENT_SECRET') || (IS_ADDON ? '' : str('DISCORD_CLIENT_SECRET'));
}

export const config = {
  discord: {
    // Bot gateway token. In add-on mode the Theater shares the host bot client
    // and never logs in with this — it's only used by standalone mode.
    botToken: str('THEATER_BOT_TOKEN') || str('DISCORD_BOT_TOKEN'),
    clientId: activityClientId(),
    clientSecret: activityClientSecret(),
    devGuildId: str('DISCORD_DEV_GUILD_ID'),
  },
  // Local-device movie host. Videos are served from disk with HTTP range
  // support — no cloud storage, no transcoding service.
  media: {
    dir: path.resolve(process.cwd(), str('MEDIA_DIR', 'media')),
    maxUploadMb: int('MAX_UPLOAD_MB', 8192),
    tokenTtl: int('MEDIA_TOKEN_TTL', 86400), // playback URLs valid 24h by default
    // Temporary per-party session files are scrubbed after this age, or after
    // ~30 min of inactivity, or when the party ends — whichever comes first.
    sessionTtl: int('SESSION_TTL_SECONDS', 21600), // 6h (covers a 3h+ movie)
    // Key that protects the /host upload page. Falls back to SESSION_SECRET.
    get adminKey() {
      return str('HOST_ADMIN_KEY') || config.app.sessionSecret;
    },
  },
  app: {
    // The Theater's own public URL / port. In add-on mode these are the
    // THEATER_* values (its own Activity endpoint in the same deployment);
    // standalone falls back to PUBLIC_BASE_URL / PORT exactly as before.
    baseUrl: (str('THEATER_PUBLIC_BASE_URL') || str('PUBLIC_BASE_URL')).replace(/\/$/, ''),
    port: int('THEATER_PORT', int('PORT', 3000)),
    adminUserIds: list('ADMIN_USER_IDS'),
    sessionSecret: str('SESSION_SECRET', 'change-me'),
  },
};

// Which subsystems are ready. The media host needs no secrets, so it's always on.
export const readiness = {
  get bot() {
    return Boolean(config.discord.botToken && config.discord.clientId);
  },
  get activity() {
    return Boolean(config.discord.clientId && config.discord.clientSecret);
  },
  get media() {
    return true;
  },
};

export function missingSecrets() {
  const missing = [];
  if (!config.discord.botToken) missing.push('DISCORD_BOT_TOKEN');
  if (!config.discord.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.discord.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!config.app.baseUrl) missing.push('PUBLIC_BASE_URL');
  return missing;
}
