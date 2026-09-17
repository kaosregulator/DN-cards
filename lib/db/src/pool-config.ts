import type { PoolConfig } from "pg";

/**
 * Build a node-postgres Pool config from DATABASE_URL.
 *
 * Managed hosts (Railway, Neon, Supabase, RDS, …) usually require TLS. Local
 * Postgres typically does not. Callers can force either side with DATABASE_SSL.
 *
 * Important: when TLS is enabled we pass `ssl: { rejectUnauthorized: false }`
 * and strip `sslmode=` from the URL. Recent `pg` treats `sslmode=require` as
 * verify-full, which rejects Railway / many managed certs.
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
  // Private Railway networking does not need public CA verification; treat it
  // like other managed hosts so we still speak TLS when the server asks.
  const looksManaged =
    /railway\.(app|internal)|rlwy\.net|neon\.tech|supabase\.(co|com)|amazonaws\.com|azure\.com|render\.com/i.test(
      connectionString,
    ) || /[?&]sslmode=/i.test(connectionString);

  const useSsl = forceOn || (!forceOff && !looksLocal && looksManaged);

  return {
    connectionString: stripSslMode(connectionString),
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/** Remove sslmode query params so explicit `ssl` options win. */
function stripSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return connectionString
      .replace(/([?&])sslmode=[^&]*/gi, "$1")
      .replace(/([?&])uselibpqcompat=[^&]*/gi, "$1")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}
