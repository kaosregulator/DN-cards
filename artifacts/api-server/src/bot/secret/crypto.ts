import crypto from "crypto";

// AES-256-CBC payload encryption, ported from the standalone Echo-Whisper bot.
// The key is derived from ENCRYPTION_KEY (falling back to the bot token so a
// server that never set ENCRYPTION_KEY still gets a stable per-deployment key
// rather than a hard-coded public default).

export interface SecretPayload {
  t: string;          // message text
  s?: string;         // sender id (whispers)
  r?: string;         // receiver id (whispers)
}

function getKey(): Buffer {
  const raw =
    process.env.ENCRYPTION_KEY ??
    process.env.DISCORD_BOT_TOKEN ??
    "dn-cards-secret-default-key-changeme!";
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptPayload(payload: SecretPayload): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

export function decryptPayload(encoded: string): SecretPayload {
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
  return JSON.parse(json) as SecretPayload;
}

// Short public transmission code (e.g. "1A2B"). Guild-scoped uniqueness is
// enforced by the DB; callers retry on the rare collision.
export function generateCode(): string {
  return crypto.randomBytes(2).toString("hex").toUpperCase();
}

export function formatCodeForDisplay(code: string, type: "whisper" | "adminsecret"): string {
  const prefix = type === "whisper" ? "WSP" : "ECH";
  return `🔒 ${prefix}-${code}`;
}

export function extractCodeFromDisplay(content: string): string | null {
  const match = content.match(/🔒\s+(?:WSP|ECH)-([A-F0-9]{4})/);
  return match ? match[1] : null;
}
