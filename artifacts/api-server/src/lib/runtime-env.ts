const UNRESOLVED_TEMPLATE = /\$\{[^}]+\}/;

/**
 * Read an environment value only when the deployment replaced every template
 * reference. Managed artifact env entries remain as literal `${NAME}` strings
 * when the referenced secret does not exist, and those strings must never be
 * treated as working configuration.
 */
export function resolvedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value || UNRESOLVED_TEMPLATE.test(value)) return null;
  return value;
}

/** Return a validated absolute HTTP(S) URL from an environment variable. */
export function resolvedHttpUrl(name: string): string | null {
  const value = resolvedEnv(name);
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Shared runtime / host detection for Replit, Railway, and generic deploys.
 *
 * Discord allows only one gateway connection per bot token. Dev workflows must
 * not steal the lease from the published process — see
 * `.agents/memory/dev-prod-bot-token-race.md`.
 */

/** True when this process is the published host that should own Discord login. */
export function isPublishedDeployment(): boolean {
  if (process.env["REPLIT_DEPLOYMENT"] === "1") return true;
  // Railway injects these on every service; production and preview both count
  // as "the deployment" for that environment's bot token.
  if (process.env["RAILWAY_ENVIRONMENT"] || process.env["RAILWAY_SERVICE_ID"]) {
    return true;
  }
  // Escape hatch for Fly/Render/Docker/etc.
  if (process.env["DN_DEPLOYMENT"] === "1") return true;
  return false;
}

export function deploymentBuildId(): string {
  return (
    process.env["RAILWAY_DEPLOYMENT_ID"] ??
    process.env["RAILWAY_GIT_COMMIT_SHA"] ??
    process.env["REPLIT_DEPLOYMENT_ID"] ??
    process.env["REPL_SLUG"] ??
    "local"
  );
}

export function deploymentProcessType(): "deployment" | "dev" {
  return isPublishedDeployment() ? "deployment" : "dev";
}

/**
 * Public HTTPS origin for setup links, image rewrites, and dashboard URLs.
 * Prefer an explicit PUBLIC_BASE_URL in production.
 */
export function publicBaseUrl(fallback = "http://localhost"): string {
  const explicit = resolvedHttpUrl("PUBLIC_BASE_URL")?.replace(/\/$/, "");
  if (explicit) return explicit;

  const railway =
    process.env["RAILWAY_PUBLIC_DOMAIN"]?.trim() ||
    process.env["RAILWAY_STATIC_URL"]?.trim();
  if (railway) {
    return railway.startsWith("http") ? railway.replace(/\/$/, "") : `https://${railway}`;
  }

  const replit = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (replit) return `https://${replit}`;

  return fallback;
}

/** Hostname extracted from DATABASE_URL for startup banners (never the password). */
export function databaseHost(): string {
  const url = process.env["DATABASE_URL"] ?? "";
  const m = url.match(/@([^/:]+)/);
  return m?.[1] ?? "unknown";
}
