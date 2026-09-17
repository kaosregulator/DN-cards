import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * Prefer the caller's DATABASE_URL. When talking to managed hosts without an
 * explicit sslmode, append sslmode=require so drizzle-kit's node-postgres
 * client negotiates TLS the same way the runtime Pool does.
 */
function connectionUrl(): string {
  const url = process.env.DATABASE_URL!;
  if (/[?&]sslmode=/i.test(url)) return url;
  if (/@(localhost|127\.0\.0\.1)([:/]|$)/i.test(url)) return url;
  if (
    process.env.DATABASE_SSL === "0" ||
    process.env.DATABASE_SSL === "false" ||
    process.env.DATABASE_SSL === "disable"
  ) {
    return url;
  }
  const managed =
    /railway\.(app|internal)|rlwy\.net|neon\.tech|supabase\.(co|com)|amazonaws\.com|azure\.com|render\.com/i.test(
      url,
    ) ||
    process.env.DATABASE_SSL === "1" ||
    process.env.DATABASE_SSL === "true" ||
    process.env.DATABASE_SSL === "require";
  if (!managed) return url;
  return url.includes("?") ? `${url}&sslmode=require` : `${url}?sslmode=require`;
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: connectionUrl(),
  },
});
