import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.use("/api", router);

export default app;
