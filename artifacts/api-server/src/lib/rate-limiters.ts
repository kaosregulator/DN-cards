import { rateLimit } from "express-rate-limit";

// ── Login / setup rate limiter ────────────────────────────────────────────────
// Applied to POST /api/auth/login, GET /api/auth/setup/:token/check, and
// POST /api/auth/setup/:token to slow credential-guessing and token-enumeration
// attacks. 10 attempts per IP per 15-minute window; resets automatically.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait before trying again." },
  skipSuccessfulRequests: false,
});
