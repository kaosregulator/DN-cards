import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Redact one-time tokens that appear in URL path segments, e.g.
// GET /api/auth/setup/<token>/check or POST /api/auth/setup/<token>
// The logger already strips query strings; this covers path-embedded secrets.
const SETUP_PATH_RE = /\/setup\/[A-Za-z0-9_-]+/g;

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        const rawUrl: string = req.url?.split("?")[0] ?? "";
        const safeUrl = rawUrl.replace(SETUP_PATH_RE, "/setup/[REDACTED]");
        return {
          id: req.id,
          method: req.method,
          url: safeUrl,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// World Builder folder imports send base64 file batches; keep a higher JSON ceiling.
app.use(express.json({ limit: "40mb" }));
app.use(express.urlencoded({ extended: true, limit: "40mb" }));

// ── Session (dashboard auth) ──────────────────────────────────────────────────
// MemoryStore is fine for a single-instance bot; sessions reset on restart
// (users just log back in). If we ever run multiple processes, swap in
// connect-pg-simple using the existing Postgres connection.
const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) {
  logger.warn("SESSION_SECRET not set — dashboard logins will be unstable");
}
app.set("trust proxy", 1); // we sit behind Replit's reverse proxy
app.use(
  session({
    name: "dn-dash",
    secret: sessionSecret ?? "insecure-dev-secret-please-set-SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  }),
);

// Health check — must respond before bot/migrations finish booting
app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", router);

export default app;
