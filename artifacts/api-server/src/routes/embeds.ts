import { Router, type IRouter } from "express";
import { db, embedOverridesTable, EMBED_KEYS, type EmbedKey, type EmbedOverrideConfig } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireDashboardAuth } from "../middlewares/dashboard-auth.js";
import { invalidateEmbedCache } from "../bot/embed-overrides.js";
import { getBotClient } from "../bot/client-holder.js";

const router: IRouter = Router();
router.use(requireDashboardAuth);

const embedKeySchema = z.enum(EMBED_KEYS as unknown as [EmbedKey, ...EmbedKey[]]);

const colorSchema = z.number().int().min(0).max(0xffffff);
const rarityColorsSchema = z.object({
  common: colorSchema.optional(),
  uncommon: colorSchema.optional(),
  rare: colorSchema.optional(),
  epic: colorSchema.optional(),
  legendary: colorSchema.optional(),
}).partial();

const configSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().max(256).optional(),
  footer: z.string().max(2048).optional(),
  descriptionPrefix: z.string().max(2000).optional(),
  color: colorSchema.optional(),
  rarityColors: rarityColorsSchema.optional(),
  imageMode: z.enum(["default", "large", "thumbnail", "none"]).optional(),
  customImageUrl: z.string().url().max(2048).or(z.literal("")).optional(),
  showWorth: z.boolean().optional(),
  showDropChance: z.boolean().optional(),
}).strict();

// ── GET /api/embeds/guilds — guilds the bot is in (and can be customized) ────
router.get("/guilds", async (_req, res) => {
  const client = getBotClient();
  if (!client?.isReady()) {
    res.json({ guilds: [] });
    return;
  }
  const guilds = client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL({ size: 64 }) ?? null,
    memberCount: g.memberCount,
  }));
  res.json({ guilds });
});

// ── GET /api/embeds/:guildId — all overrides for one guild ────────────────────
router.get("/:guildId", async (req, res) => {
  const guildId = req.params.guildId;
  const rows = await db.select().from(embedOverridesTable).where(eq(embedOverridesTable.guildId, guildId));
  const byKey: Record<string, EmbedOverrideConfig> = {};
  for (const r of rows) byKey[r.embedKey] = r.config;
  // Always return all 8 keys (empty config = "use defaults")
  const overrides: Record<EmbedKey, EmbedOverrideConfig> = {} as Record<EmbedKey, EmbedOverrideConfig>;
  for (const k of EMBED_KEYS) overrides[k] = byKey[k] ?? {};
  res.json({ guildId, overrides });
});

// ── PUT /api/embeds/:guildId/:embedKey — upsert override ──────────────────────
router.put("/:guildId/:embedKey", async (req, res) => {
  const guildId = req.params.guildId;
  const keyParsed = embedKeySchema.safeParse(req.params.embedKey);
  if (!keyParsed.success) {
    res.status(400).json({ error: "Unknown embed key" });
    return;
  }
  const cfgParsed = configSchema.safeParse(req.body);
  if (!cfgParsed.success) {
    res.status(400).json({ error: "Invalid config", details: z.flattenError(cfgParsed.error) });
    return;
  }
  const updatedBy = req.session?.username ?? "admin-token";
  await db.insert(embedOverridesTable).values({
    guildId,
    embedKey: keyParsed.data,
    config: cfgParsed.data,
    updatedBy,
  }).onConflictDoUpdate({
    target: [embedOverridesTable.guildId, embedOverridesTable.embedKey],
    set: { config: cfgParsed.data, updatedAt: new Date(), updatedBy },
  });
  invalidateEmbedCache(guildId);
  res.json({ ok: true, embedKey: keyParsed.data, config: cfgParsed.data });
});

// ── DELETE /api/embeds/:guildId/:embedKey — reset to defaults ─────────────────
router.delete("/:guildId/:embedKey", async (req, res) => {
  const guildId = req.params.guildId;
  const keyParsed = embedKeySchema.safeParse(req.params.embedKey);
  if (!keyParsed.success) {
    res.status(400).json({ error: "Unknown embed key" });
    return;
  }
  await db.delete(embedOverridesTable).where(and(
    eq(embedOverridesTable.guildId, guildId),
    eq(embedOverridesTable.embedKey, keyParsed.data),
  ));
  invalidateEmbedCache(guildId);
  res.json({ ok: true, reset: keyParsed.data });
});

export default router;
