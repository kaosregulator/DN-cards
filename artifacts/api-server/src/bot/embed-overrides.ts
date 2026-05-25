import type { EmbedBuilder } from "discord.js";
import { db, embedOverridesTable, type EmbedOverrideConfig, type EmbedKey } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RARITY_COLORS, type Rarity } from "./cards-data.js";

// In-memory cache. Discord embed render is on the hot path (every spawn,
// every catch, every daily/pack/trade), so we don't want a DB round-trip
// each time. Guild → Map<embedKey, config>. Invalidated by the API on
// PUT/DELETE. TTL is a backstop; explicit invalidation is the truth.
const cache = new Map<string, { configs: Map<EmbedKey, EmbedOverrideConfig>; expiresAt: number }>();
const TTL_MS = 60_000;

export function invalidateEmbedCache(guildId: string): void {
  cache.delete(guildId);
}

async function loadGuildOverrides(guildId: string): Promise<Map<EmbedKey, EmbedOverrideConfig>> {
  const now = Date.now();
  const hit = cache.get(guildId);
  if (hit && hit.expiresAt > now) return hit.configs;

  const rows = await db.select().from(embedOverridesTable).where(eq(embedOverridesTable.guildId, guildId));
  const configs = new Map<EmbedKey, EmbedOverrideConfig>();
  for (const row of rows) configs.set(row.embedKey as EmbedKey, row.config);
  cache.set(guildId, { configs, expiresAt: now + TTL_MS });
  return configs;
}

export async function getEmbedOverride(guildId: string | null, key: EmbedKey): Promise<EmbedOverrideConfig | null> {
  if (!guildId) return null;
  const map = await loadGuildOverrides(guildId);
  const cfg = map.get(key);
  if (!cfg || cfg.enabled === false) return null;
  return cfg;
}

// ── Token substitution ────────────────────────────────────────────────────────
// Supported tokens (all optional in `ctx`):
//   {user}      → <@userId> mention
//   {username}  → plain display name
//   {card}      → card name
//   {rarity}    → "Common" | "Uncommon" | ...
//   {worth}     → formatted shard amount
//   {chance}    → drop chance percent
//   {streak}    → streak day count
//   {tier}      → pack tier label
//   {amount}    → generic amount (gift, shards, etc.)
//   {balance}   → user's shard balance
//   {guild}     → guild name
//   {channel}   → <#channelId>
export interface TokenCtx {
  userId?: string;
  username?: string;
  card?: string;
  rarity?: string;
  worth?: number | string;
  chance?: number | string;
  streak?: number | string;
  tier?: string;
  amount?: number | string;
  balance?: number | string;
  guild?: string;
  channelId?: string;
}

const fmt = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
};

export function substituteTokens(template: string, ctx: TokenCtx): string {
  return template
    .replace(/\{user\}/g, ctx.userId ? `<@${ctx.userId}>` : "")
    .replace(/\{username\}/g, fmt(ctx.username))
    .replace(/\{card\}/g, fmt(ctx.card))
    .replace(/\{rarity\}/g, fmt(ctx.rarity))
    .replace(/\{worth\}/g, fmt(ctx.worth))
    .replace(/\{chance\}/g, fmt(ctx.chance))
    .replace(/\{streak\}/g, fmt(ctx.streak))
    .replace(/\{tier\}/g, fmt(ctx.tier))
    .replace(/\{amount\}/g, fmt(ctx.amount))
    .replace(/\{balance\}/g, fmt(ctx.balance))
    .replace(/\{guild\}/g, fmt(ctx.guild))
    .replace(/\{channel\}/g, ctx.channelId ? `<#${ctx.channelId}>` : "");
}

// ── Apply override to an EmbedBuilder ─────────────────────────────────────────
// Mutates the builder in place. Defaults are whatever the call site already
// set — we only override what the user explicitly customized. Image handling
// is intentionally on this helper too, so individual embeds don't each have
// to re-implement "default vs large vs thumbnail vs none".
export interface ApplyOpts {
  guildId: string | null;
  key: EmbedKey;
  ctx?: TokenCtx;
  defaultImageUrl?: string | null;
  rarity?: Rarity;
}

export async function applyEmbedOverride(builder: EmbedBuilder, opts: ApplyOpts): Promise<void> {
  const cfg = await getEmbedOverride(opts.guildId, opts.key);
  const ctx = opts.ctx ?? {};

  // Color: rarityColors wins over flat color when rarity is in play.
  if (opts.rarity && cfg?.rarityColors && cfg.rarityColors[opts.rarity] !== undefined) {
    builder.setColor(cfg.rarityColors[opts.rarity]!);
  } else if (cfg?.color !== undefined) {
    builder.setColor(cfg.color);
  } else if (opts.rarity && (!cfg || cfg.color === undefined)) {
    // If no override, leave whatever the caller set.
  }

  if (cfg?.title) {
    const subbed = substituteTokens(cfg.title, ctx).slice(0, 256);
    if (subbed) builder.setTitle(subbed);
  }
  if (cfg?.footer) {
    const subbed = substituteTokens(cfg.footer, ctx).slice(0, 2048);
    if (subbed) builder.setFooter({ text: subbed });
  }
  if (cfg?.descriptionPrefix) {
    const prefix = substituteTokens(cfg.descriptionPrefix, ctx);
    if (prefix) {
      const current = builder.data.description ?? "";
      const merged = (prefix + "\n\n" + current).slice(0, 4096);
      builder.setDescription(merged);
    }
  }

  // Image mode: governs both card-image embeds (spawn/claimed/info/pack) and
  // banner embeds (welcome/rules/commands). customImageUrl wins over default.
  const url = cfg?.customImageUrl ?? opts.defaultImageUrl ?? null;
  const mode = cfg?.imageMode ?? "default";
  if (mode === "none") {
    builder.setImage(null);
    builder.setThumbnail(null);
  } else if (url) {
    if (mode === "thumbnail") {
      builder.setImage(null);
      builder.setThumbnail(url);
    } else if (mode === "large") {
      builder.setThumbnail(null);
      builder.setImage(url);
    } else if (cfg?.customImageUrl) {
      // "default" mode but the user set a custom URL — apply to whichever
      // slot the caller was using (don't know, so use setImage).
      builder.setImage(url);
    }
    // else: pure "default" with no custom URL — leave the caller's call alone
  }
}

// Convenience: should this side-data be rendered?
export async function shouldShow(guildId: string | null, key: EmbedKey, what: "worth" | "dropChance"): Promise<boolean> {
  const cfg = await getEmbedOverride(guildId, key);
  if (!cfg) return true;
  if (what === "worth") return cfg.showWorth !== false;
  if (what === "dropChance") return cfg.showDropChance !== false;
  return true;
}

// Re-export the rarity defaults so the API & dashboard can show them as the
// "current default" placeholder when no override is set.
export const DEFAULT_RARITY_COLORS = RARITY_COLORS;
