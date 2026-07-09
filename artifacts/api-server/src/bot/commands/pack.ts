import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { db, userCurrencyTable, cardsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  getAllCards, catchCard, getOrCreateCurrency,
  getOrCreateGuildSettings,
  getRarityContext, applyRarityContextAll,
  getCardDisplayRarity,
  getRarityDisplayOverrides,
} from "../db.js";
import {
  SHINY_EMOJI, getShinyMultiplier, getShinyName,
  type Rarity,
} from "../cards-data.js";
import { checkAchievements, formatUnlockLine } from "../achievements.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Card, GuildSettings } from "@workspace/db";

// ── Tier definitions ─────────────────────────────────────────────────────────
export type PackTier = "basic" | "premium" | "legendary";
export const PACK_TIERS: PackTier[] = ["basic", "premium", "legendary"];

export const PACK_TIER_META: Record<PackTier, {
  label: string; emoji: string; color: number; tagline: string;
}> = {
  basic: {
    label: "Basic", emoji: "🥉", color: 0xcd7f32,
    tagline: "Workhorse pack — solid odds, friendly price.",
  },
  premium: {
    label: "Premium", emoji: "🥈", color: 0xc0c0c0,
    tagline: "2× rare/epic, 6× legendary chance.",
  },
  legendary: {
    label: "Legendary", emoji: "🥇", color: 0xffd700,
    tagline: "No commons. Stacked with rare+ guarantees.",
  },
};

// Per-tier rarity distribution. Sums to 1.0.
// Mythic appears only in the Legendary tier (0.5%) by default — it's the new
// top tier, so it's intentionally rarer than Legendary itself.
const TIER_RATES: Record<PackTier, Record<Rarity, number>> = {
  basic:     { common: 0.60, uncommon: 0.25, rare: 0.110, epic: 0.035, legendary: 0.005, mythic: 0.000 },
  premium:   { common: 0.40, uncommon: 0.25, rare: 0.220, epic: 0.100, legendary: 0.030, mythic: 0.000 },
  legendary: { common: 0.00, uncommon: 0.30, rare: 0.345, epic: 0.250, legendary: 0.100, mythic: 0.005 },
};

// Hard-coded defaults — used at schema creation time too. Kept in sync with
// the column defaults in lib/db/src/schema/cards.ts so manual cell-by-cell
// resets in the UI work even if the row was created before columns existed.
export const PACK_DEFAULTS = {
  cooldownSeconds: 60,
  basic:     { cost: 250,  size: 5, weeklyLimit: 50 },
  premium:   { cost: 750,  size: 5, weeklyLimit: 20 },
  legendary: { cost: 2000, size: 5, weeklyLimit: 5  },
} as const;

export interface ResolvedTierConfig {
  cost: number;
  size: number;
  weeklyLimit: number; // 0 = unlimited
}

export function resolveTierConfig(s: GuildSettings, tier: PackTier): ResolvedTierConfig {
  // Columns are NOT NULL with defaults, so values always exist after migration.
  if (tier === "basic") {
    return { cost: s.packBasicCost, size: s.packBasicSize, weeklyLimit: s.packBasicWeeklyLimit };
  }
  if (tier === "premium") {
    return { cost: s.packPremiumCost, size: s.packPremiumSize, weeklyLimit: s.packPremiumWeeklyLimit };
  }
  return { cost: s.packLegendaryCost, size: s.packLegendarySize, weeklyLimit: s.packLegendaryWeeklyLimit };
}

function readWeekCounter(c: { packsBasicWeek: number; packsPremiumWeek: number; packsLegendaryWeek: number }, tier: PackTier): number {
  if (tier === "basic") return c.packsBasicWeek;
  if (tier === "premium") return c.packsPremiumWeek;
  return c.packsLegendaryWeek;
}

// ── Weekly bucket math ───────────────────────────────────────────────────────
// Buckets reset every Monday 00:00 UTC. If the stored reset date is in the
// past, all three tier counters are zeroed in one atomic update.
function nextMondayUtc(from: Date): Date {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const daysUntilMon = ((1 - day + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMon);
  return d;
}

// Idempotent rollover for read paths (/packstats). Guarded by WHERE so concurrent
// callers can't undo each other's increments — only flips when the row's
// reset date is still the stale value we observed.
async function rolloverIfStale(
  guildId: string, userId: string, observedResetAt: Date,
): Promise<{ packsBasicWeek: number; packsPremiumWeek: number; packsLegendaryWeek: number; packsWeekResetAt: Date } | null> {
  if (observedResetAt.getTime() > Date.now()) return null;
  const next = nextMondayUtc(new Date());
  const rows = await db.update(userCurrencyTable)
    .set({
      packsBasicWeek: 0, packsPremiumWeek: 0, packsLegendaryWeek: 0,
      packsWeekResetAt: next,
    })
    .where(and(
      eq(userCurrencyTable.guildId, guildId),
      eq(userCurrencyTable.userId, userId),
      eq(userCurrencyTable.packsWeekResetAt, observedResetAt),
    ))
    .returning({
      packsBasicWeek: userCurrencyTable.packsBasicWeek,
      packsPremiumWeek: userCurrencyTable.packsPremiumWeek,
      packsLegendaryWeek: userCurrencyTable.packsLegendaryWeek,
      packsWeekResetAt: userCurrencyTable.packsWeekResetAt,
    });
  return rows[0] ?? null;
}

// ── Draw logic ───────────────────────────────────────────────────────────────
function rollRarity(tier: PackTier): Rarity {
  const rates = TIER_RATES[tier];
  const r = Math.random();
  let acc = 0;
  for (const [rarity, weight] of Object.entries(rates) as [Rarity, number][]) {
    acc += weight;
    if (r <= acc) return rarity;
  }
  return "common";
}

function pickByDropWeight(pool: Card[]): Card | undefined {
  if (pool.length === 0) return undefined;
  const total = pool.reduce((s, c) => s + Math.max(c.dropWeight, 0.0001), 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= Math.max(c.dropWeight, 0.0001);
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

async function drawPack(tier: PackTier, size: number, guildId: string): Promise<Card[]> {
  const ctx = await getRarityContext(guildId);
  // Stage-2: cards assigned to a custom tier are excluded from packs by
  // default (and entirely whenever their tier sets `inPacks=false`). This
  // keeps the built-in pack tiers (Basic/Premium/Legendary) focused on the
  // built-in rarity ladder unless an admin explicitly opts a custom tier in.
  const all = applyRarityContextAll(
    (await getAllCards()).filter(c => {
      if (!(c.droppable && c.inPacks && !c.isArchived && !c.isEventExclusive)) return false;
      if (c.isLimitedEdition && c.maxCopies != null && c.totalMinted >= c.maxCopies) return false;
      const customTier = ctx.customByCard.get(c.id);
      if (customTier && !customTier.inPacks) return false;
      return true;
    }),
    ctx,
  );
  if (all.length === 0) return [];

  const byRarity: Record<Rarity, Card[]> = {
    common: [], uncommon: [], rare: [], epic: [], legendary: [], mythic: [],
  };
  for (const c of all) byRarity[c.rarity as Rarity]?.push(c);

  // Fallback order tries adjacent rarities if the rolled tier has no cards.
  // For legendary-tier packs, never fall back into commons.
  // Mythic falls back to Legendary (no empty-bucket dead rolls in legendary packs).
  const allRarities: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];
  const allowed = tier === "legendary"
    ? allRarities.filter(r => r !== "common")
    : allRarities;

  const drawn: Card[] = [];
  for (let i = 0; i < size; i++) {
    const rarity = rollRarity(tier);
    // Search allowed rarities starting from the rolled rarity, then walk both ways.
    const startIdx = Math.max(0, allowed.indexOf(rarity));
    let picked: Card | undefined;
    for (let j = startIdx; j < allowed.length; j++) {
      picked = pickByDropWeight(byRarity[allowed[j]!]!);
      if (picked) break;
    }
    if (!picked) {
      for (let j = 0; j < startIdx; j++) {
        picked = pickByDropWeight(byRarity[allowed[j]!]!);
        if (picked) break;
      }
    }
    if (picked) drawn.push(picked);
  }
  return drawn;
}

// ── Summary embed ────────────────────────────────────────────────────────────
async function buildSummaryEmbed(
  tier: PackTier, cards: Card[], shinies: boolean[], spent: number, balanceAfter: number,
  guildId: string | null = null, userId: string | null = null,
): Promise<EmbedBuilder> {
  const meta = PACK_TIER_META[tier];
  const shinyCount = shinies.filter(Boolean).length;
  const last = cards[cards.length - 1]!;
  const [settings, displayMap, ctx] = await Promise.all([
    guildId ? getOrCreateGuildSettings(guildId) : Promise.resolve(null),
    guildId ? getRarityDisplayOverrides(guildId) : Promise.resolve(null),
    guildId ? getRarityContext(guildId) : Promise.resolve(null),
  ]);
  const shinyMultiplier = getShinyMultiplier(settings);
  const shinyName = getShinyName(settings);
  const totalWorth = cards.reduce(
    (s, c, i) => s + c.worthValue * (shinies[i] ? shinyMultiplier : 1),
    0,
  );
  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${meta.label} Pack — ${cards.length} cards${shinyCount > 0 ? ` · ${SHINY_EMOJI} ${shinyName} ×${shinyCount}` : ""}`)
    .setColor(shinyCount > 0 ? 0xf1c40f : meta.color)
    .setDescription(
      cards.map((c, i) => {
        const rarity = getCardDisplayRarity(c, ctx, settings, displayMap);
        const shiny = shinies[i];
        const worth = c.worthValue * (shiny ? shinyMultiplier : 1);
        const prefix = shiny ? `${SHINY_EMOJI} ` : "";
        return `**${i + 1}.** ${rarity.emoji} ${prefix}**${c.name}** — *${rarity.label}* · 💠 ${worth.toLocaleString()}${shiny ? ` *(${shinyMultiplier}×)*` : ""}`;
      }).join("\n") +
      `\n\n**Total worth:** 💠 ${totalWorth.toLocaleString()}\n` +
      `Spent: 💠 ${spent.toLocaleString()} · Balance: 💠 ${balanceAfter.toLocaleString()}`,
    )
    .setFooter({ text: "Cards added to your collection — use /collection to view. /packstats for your weekly cap." });
  const defaultImg = toAbsoluteImageUrl(last.imageUrl);
  if (defaultImg) embed.setThumbnail(defaultImg);
  await applyEmbedOverride(embed, {
    guildId, key: "pack", defaultImageUrl: defaultImg,
    ctx: {
      userId: userId ?? undefined, tier: meta.label,
      amount: spent, balance: balanceAfter,
    },
  });
  return embed;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return mr > 0 ? `${h}h ${mr}m` : `${h}h`;
}

// ── Atomic pack claim ────────────────────────────────────────────────────────
// One UPDATE that enforces ALL gates (shards, cooldown, weekly cap) and
// applies the weekly-bucket rollover inline. If 0 rows match, no state is
// changed — caller re-reads the row to explain *why* it failed.
//
// This is the only way to be race-safe across concurrent /pack invocations.

type ClaimSuccess = {
  ok: true;
  shardsAfter: number;
  weekUsedAfter: number;
  weekResetAt: Date;
};
type ClaimFailReason = "shards" | "cooldown" | "cap";
type ClaimFailure = { ok: false; reason: ClaimFailReason; detail: string };

async function tryClaimPack(
  guildId: string, userId: string, tier: PackTier, cfg: ResolvedTierConfig, cooldownSec: number,
): Promise<ClaimSuccess | ClaimFailure> {
  const nextMonday = nextMondayUtc(new Date());
  const weekColMap = {
    basic: userCurrencyTable.packsBasicWeek,
    premium: userCurrencyTable.packsPremiumWeek,
    legendary: userCurrencyTable.packsLegendaryWeek,
  };
  const weekCol = weekColMap[tier];
  const resetCol = userCurrencyTable.packsWeekResetAt;
  const cooldownCol = userCurrencyTable.lastPackOpenedAt;

  // Effective week count *after* rollover — i.e. what the column would read
  // if we applied the rollover. Used in both the cap predicate and the SET.
  const effectiveWeekUsed = sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${weekCol} END)`;

  const capPredicate = cfg.weeklyLimit > 0
    ? sql`${effectiveWeekUsed} < ${cfg.weeklyLimit}`
    : sql`TRUE`;

  const cooldownPredicate = cooldownSec > 0
    ? sql`(${cooldownCol} IS NULL OR ${cooldownCol} <= NOW() - (${cooldownSec} || ' seconds')::interval)`
    : sql`TRUE`;

  // Per-tier increment + zero out the other two tiers on rollover.
  const tierWeekSet: Record<PackTier, ReturnType<typeof sql>> = {
    basic:     sql`${effectiveWeekUsed} + 1`,
    premium:   sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${userCurrencyTable.packsPremiumWeek} END)`,
    legendary: sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${userCurrencyTable.packsLegendaryWeek} END)`,
  };
  if (tier === "premium") {
    tierWeekSet.basic     = sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${userCurrencyTable.packsBasicWeek} END)`;
    tierWeekSet.premium   = sql`${effectiveWeekUsed} + 1`;
    tierWeekSet.legendary = sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${userCurrencyTable.packsLegendaryWeek} END)`;
  } else if (tier === "legendary") {
    tierWeekSet.basic     = sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${userCurrencyTable.packsBasicWeek} END)`;
    tierWeekSet.premium   = sql`(CASE WHEN ${resetCol} <= NOW() THEN 0 ELSE ${userCurrencyTable.packsPremiumWeek} END)`;
    tierWeekSet.legendary = sql`${effectiveWeekUsed} + 1`;
  }

  const rows = await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} - ${cfg.cost}`,
      packsOpened: sql`${userCurrencyTable.packsOpened} + 1`,
      packsBasicWeek: tierWeekSet.basic,
      packsPremiumWeek: tierWeekSet.premium,
      packsLegendaryWeek: tierWeekSet.legendary,
      packsWeekResetAt: sql`(CASE WHEN ${resetCol} <= NOW() THEN ${nextMonday} ELSE ${resetCol} END)`,
      lastPackOpenedAt: new Date(),
    })
    .where(and(
      eq(userCurrencyTable.guildId, guildId),
      eq(userCurrencyTable.userId, userId),
      sql`${userCurrencyTable.shards} >= ${cfg.cost}`,
      cooldownPredicate,
      capPredicate,
    ))
    .returning({
      shards: userCurrencyTable.shards,
      basicWeek: userCurrencyTable.packsBasicWeek,
      premiumWeek: userCurrencyTable.packsPremiumWeek,
      legendaryWeek: userCurrencyTable.packsLegendaryWeek,
      resetAt: userCurrencyTable.packsWeekResetAt,
    });

  const row = rows[0];
  if (row) {
    const weekUsedAfter =
      tier === "basic"   ? row.basicWeek :
      tier === "premium" ? row.premiumWeek :
                           row.legendaryWeek;
    return { ok: true, shardsAfter: row.shards, weekUsedAfter, weekResetAt: row.resetAt };
  }

  // Claim failed — figure out why. Re-read row to give the user a useful message.
  const current = await getOrCreateCurrency(guildId, userId);
  const meta = PACK_TIER_META[tier];

  // Cooldown?
  if (cooldownSec > 0 && current.lastPackOpenedAt) {
    const sinceMs = Date.now() - current.lastPackOpenedAt.getTime();
    const cdMs = cooldownSec * 1000;
    if (sinceMs < cdMs) {
      return {
        ok: false, reason: "cooldown",
        detail: `⏳ Slow down! You can open another pack in **${formatRemaining(cdMs - sinceMs)}**.\n` +
          `*(Server cooldown: ${formatRemaining(cdMs)} between any pack opens.)*`,
      };
    }
  }

  // Cap? (after rollover, the effective count)
  const effectiveWeekUsedJs = current.packsWeekResetAt.getTime() <= Date.now()
    ? 0
    : readWeekCounter(current, tier);
  if (cfg.weeklyLimit > 0 && effectiveWeekUsedJs >= cfg.weeklyLimit) {
    const resetAt = current.packsWeekResetAt.getTime() <= Date.now() ? nextMonday : current.packsWeekResetAt;
    return {
      ok: false, reason: "cap",
      detail: `🚫 You've hit your weekly cap for ${meta.emoji} **${meta.label}** packs ` +
        `(**${effectiveWeekUsedJs}/${cfg.weeklyLimit}** this week).\n` +
        `Resets in **${formatRemaining(resetAt.getTime() - Date.now())}**. Try a different tier — caps are per-tier!`,
    };
  }

  // Otherwise: shards.
  return {
    ok: false, reason: "shards",
    detail: `❌ ${meta.emoji} **${meta.label} Pack** costs 💠 **${cfg.cost.toLocaleString()}**.\n` +
      `You have 💠 **${current.shards.toLocaleString()}**. ` +
      `Earn more by burning duplicates (\`/cards burn\`), claiming \`/cards daily\`, or opening a cheaper tier.`,
  };
}

// Refund a fully-failed claim. Restores shards + decrements the per-tier
// weekly counter and lifetime packsOpened. Does NOT touch lastPackOpenedAt
// or packsWeekResetAt — those are advisory, and rolling them back has its
// own race; the small "ate one cooldown" cost is preferable to incorrectness.
async function refundClaim(
  guildId: string, userId: string, tier: PackTier, cost: number,
): Promise<void> {
  const tierPatch =
    tier === "basic"   ? { packsBasicWeek:     sql`GREATEST(0, ${userCurrencyTable.packsBasicWeek} - 1)` } :
    tier === "premium" ? { packsPremiumWeek:   sql`GREATEST(0, ${userCurrencyTable.packsPremiumWeek} - 1)` } :
                         { packsLegendaryWeek: sql`GREATEST(0, ${userCurrencyTable.packsLegendaryWeek} - 1)` };
  await db.update(userCurrencyTable)
    .set({
      shards: sql`${userCurrencyTable.shards} + ${cost}`,
      packsOpened: sql`GREATEST(0, ${userCurrencyTable.packsOpened} - 1)`,
      ...tierPatch,
    })
    .where(and(
      eq(userCurrencyTable.guildId, guildId),
      eq(userCurrencyTable.userId, userId),
    ));
}

// ── Handler ──────────────────────────────────────────────────────────────────
export async function handlePack(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const tierInput = (interaction.options.getString("tier") ?? "basic") as PackTier;
  const tier: PackTier = PACK_TIERS.includes(tierInput) ? tierInput : "basic";

  const settings = await getOrCreateGuildSettings(guildId);
  const cfg = resolveTierConfig(settings, tier);

  // Ensure the currency row exists so the atomic UPDATE has something to hit.
  await getOrCreateCurrency(guildId, userId);

  // Draw cards BEFORE claiming so a "no droppable cards" error doesn't
  // momentarily consume the cooldown. Cheap pure-RAM operation.
  const cards = await drawPack(tier, cfg.size, guildId);
  if (cards.length === 0) {
    await interaction.editReply("❌ No droppable cards available right now. Ask an admin to load a card set.");
    return;
  }

  // Atomic gate: shards + cooldown + weekly cap + rollover, in ONE UPDATE.
  const claim = await tryClaimPack(guildId, userId, tier, cfg, settings.packCooldownSeconds);
  if (!claim.ok) {
    await interaction.editReply(claim.detail);
    return;
  }

  // Grant the cards. Any failure here triggers a full refund of the claim.
  // Track shiny per-card so the summary can mark which ones rolled shiny.
  let granted = 0;
  let lastError: unknown = null;
  const shinies: boolean[] = [];
  for (const card of cards) {
    try {
      const { isShiny } = await catchCard(guildId, userId, card.id);
      shinies.push(isShiny);
      granted += 1;
    } catch (err) {
      lastError = err;
      break;
    }
  }

  if (granted === 0) {
    await refundClaim(guildId, userId, tier, cfg.cost);
    await interaction.editReply("❌ Pack opening failed — your shards were refunded. Please try again.");
    if (lastError) throw lastError;
    return;
  }

  if (granted < cards.length) cards.length = granted;

  await interaction.editReply({
    embeds: [await buildSummaryEmbed(tier, cards, shinies, cfg.cost, claim.shardsAfter, guildId, interaction.user.id)],
    components: [],
  });

  // Quest progress — opening a pack counts once, and each pulled card counts as
  // a catch (rarity-aware). Best-effort; never blocks the pack flow.
  try {
    const { recordQuestEvent, formatQuestCompletions } = await import("../quests/engine.js");
    const completed = [
      ...await recordQuestEvent(guildId, userId, "pack_open", 1),
    ];
    for (const card of cards) {
      completed.push(...await recordQuestEvent(guildId, userId, "catch", 1, card.rarity as Rarity));
    }
    const note = formatQuestCompletions(completed);
    if (note) await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });
    const { recordGiveawayEvent } = await import("../giveaway/engine.js");
    await recordGiveawayEvent(guildId, userId, "pack_open", 1);
    for (const card of cards) {
      await recordGiveawayEvent(guildId, userId, "catch", 1, { rarity: card.rarity as Rarity });
    }
  } catch { /* non-fatal */ }

  const newly = await checkAchievements(guildId, userId);
  if (newly.length > 0) {
    await interaction.followUp({
      content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
}

// ── /packstats — show user's pack usage ──────────────────────────────────────
export async function handlePackStats(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const [settings, currency] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getOrCreateCurrency(guildId, userId),
  ]);

  // Rollover if stale so the displayed numbers match reality. The helper is
  // idempotent (WHERE-guarded) so concurrent stats lookups can't double-reset.
  let cur = currency;
  const fresh = await rolloverIfStale(guildId, userId, currency.packsWeekResetAt);
  if (fresh) cur = { ...currency, ...fresh };

  const cooldownMs = settings.packCooldownSeconds * 1000;
  const sinceMs = cur.lastPackOpenedAt ? Date.now() - cur.lastPackOpenedAt.getTime() : Infinity;
  const cdRemainMs = cooldownMs > 0 ? Math.max(0, cooldownMs - sinceMs) : 0;

  const resetIn = formatRemaining(cur.packsWeekResetAt.getTime() - Date.now());

  const tierLine = (tier: PackTier): string => {
    const cfg = resolveTierConfig(settings, tier);
    const used = readWeekCounter(cur, tier);
    const cap = cfg.weeklyLimit === 0 ? "∞" : cfg.weeklyLimit.toLocaleString();
    const meta = PACK_TIER_META[tier];
    return `${meta.emoji} **${meta.label}** — 💠 ${cfg.cost.toLocaleString()} · ` +
      `${cfg.size} cards · used **${used}/${cap}** this week`;
  };

  const embed = new EmbedBuilder()
    .setTitle("📦 Your Pack Stats")
    .setColor(0x5865f2)
    .setDescription(
      `**Lifetime packs opened:** ${cur.packsOpened.toLocaleString()}\n` +
      `**Shards:** 💠 ${cur.shards.toLocaleString()}`,
    )
    .addFields(
      {
        name: "🎴 Tiers (this week)",
        value: PACK_TIERS.map(tierLine).join("\n"),
      },
      {
        name: "⏱️ Cooldown",
        value: cooldownMs === 0
          ? "No cooldown — open as fast as your shards allow."
          : cdRemainMs > 0
            ? `Next pack available in **${formatRemaining(cdRemainMs)}**.`
            : `Ready to open. *(${formatRemaining(cooldownMs)} between opens.)*`,
        inline: true,
      },
      {
        name: "📅 Weekly reset",
        value: `In **${resetIn}** *(Mondays 00:00 UTC)*`,
        inline: true,
      },
    )
    .setFooter({ text: "Caps are per-tier. Hit one? Try another tier. Admins can tweak all of this in /config." });
  await interaction.editReply({ embeds: [embed] });
}

void cardsTable;
