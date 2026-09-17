import type { PoolConfig } from "pg";

/**
 * Build a node-postgres Pool config from DATABASE_URL.
 *
 * Managed hosts (Railway, Neon, Supabase, RDS, …) usually require TLS. Local
 * Postgres typically does not. Callers can force either side with DATABASE_SSL.
 */
export function buildPoolConfig(connectionString: string): PoolConfig {
  const sslMode = (process.env["DATABASE_SSL"] ?? "").trim().toLowerCase();
  const forceOff = sslMode === "0" || sslMode === "false" || sslMode === "disable";
  const forceOn =
    sslMode === "1" ||
    sslMode === "true" ||
    sslMode === "require" ||
    sslMode === "prefer";

  const looksLocal = /@(localhost|127\.0\.0\.1)([:/]|$)/i.test(connectionString);
  const looksManaged =
    /railway\.(app|internal)|rlwy\.net|neon\.tech|supabase\.(co|com)|amazonaws\.com|azure\.com|render\.com/i.test(
      connectionString,
    ) || /[?&]sslmode=require\b/i.test(connectionString);

  const useSsl = forceOn || (!forceOff && !looksLocal && looksManaged);

  return {
    connectionString,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}
