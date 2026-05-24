import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { db, userCurrencyTable, cardsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  getAllCards, catchCard, spendShards, refundShards, getOrCreateCurrency,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, type Rarity,
} from "../cards-data.js";
import { checkAchievements, formatUnlockLine } from "../achievements.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Card } from "@workspace/db";

export const PACK_COST = 250;
export const PACK_SIZE = 5;

// Per-card rarity roll within a pack. Sums to 1.0.
const PACK_RATES: Record<Rarity, number> = {
  common:    0.60,
  uncommon:  0.25,
  rare:      0.11,
  epic:      0.035,
  legendary: 0.005,
};

function rollRarity(): Rarity {
  const r = Math.random();
  let acc = 0;
  for (const [rarity, weight] of Object.entries(PACK_RATES) as [Rarity, number][]) {
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

async function drawPack(): Promise<Card[]> {
  const all = (await getAllCards()).filter(c =>
    c.droppable && c.inPacks && !c.isArchived && !c.isEventExclusive &&
    (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
  );
  if (all.length === 0) return [];

  const byRarity: Record<Rarity, Card[]> = {
    common: [], uncommon: [], rare: [], epic: [], legendary: [],
  };
  for (const c of all) byRarity[c.rarity as Rarity]?.push(c);

  const fallbackOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
  const drawn: Card[] = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const rarity = rollRarity();
    const startIdx = fallbackOrder.indexOf(rarity);
    let picked: Card | undefined;
    for (let j = startIdx; j < fallbackOrder.length; j++) {
      picked = pickByDropWeight(byRarity[fallbackOrder[j]]);
      if (picked) break;
    }
    if (!picked) {
      for (let j = 0; j < startIdx; j++) {
        picked = pickByDropWeight(byRarity[fallbackOrder[j]]);
        if (picked) break;
      }
    }
    if (picked) drawn.push(picked);
  }
  return drawn;
}

function buildSummaryEmbed(cards: Card[], spent: number, balanceAfter: number): EmbedBuilder {
  const totalWorth = cards.reduce((s, c) => s + c.worthValue, 0);
  const last = cards[cards.length - 1];
  const embed = new EmbedBuilder()
    .setTitle(`🎴 Pack Opened — ${cards.length} cards`)
    .setColor(RARITY_COLORS[last.rarity as Rarity] ?? 0x5865f2)
    .setDescription(
      cards.map((c, i) => {
        const emoji = RARITY_EMOJI[c.rarity as Rarity] ?? "🃏";
        return `**${i + 1}.** ${emoji} **${c.name}** — *${RARITY_LABELS[c.rarity as Rarity]}* · 💠 ${c.worthValue.toLocaleString()}`;
      }).join("\n") +
      `\n\n**Total worth:** 💠 ${totalWorth.toLocaleString()}\n` +
      `Spent: 💠 ${spent.toLocaleString()} · Balance: 💠 ${balanceAfter.toLocaleString()}`,
    )
    .setFooter({ text: "Cards added to your collection — use /collection to view." });
  const img = toAbsoluteImageUrl(last.imageUrl);
  if (img) embed.setThumbnail(img);
  return embed;
}

// ── Handler (no animation — simple & reliable) ─────────────────────────────
export async function handlePack(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const before = await getOrCreateCurrency(guildId, userId);
  if (before.shards < PACK_COST) {
    await interaction.editReply(
      `❌ You need 💠 **${PACK_COST.toLocaleString()}** shards to open a pack. ` +
      `You have 💠 **${before.shards.toLocaleString()}**.\n` +
      `Earn more by burning duplicates (\`/burn\`) or claiming \`/daily\`.`,
    );
    return;
  }

  const cards = await drawPack();
  if (cards.length === 0) {
    await interaction.editReply("❌ No droppable cards available right now. Ask an admin to load a card set.");
    return;
  }

  // Spend first (atomic). Then grant the cards.
  const spent = await spendShards(guildId, userId, PACK_COST);
  if (!spent) {
    await interaction.editReply(`❌ Insufficient shards (need 💠 ${PACK_COST.toLocaleString()}).`);
    return;
  }

  // Grant cards one at a time. If a mid-loop failure happens (rare —
  // catchCard is an upsert), we refund shards ONLY if zero cards landed.
  // Otherwise the user keeps what was granted and pays the full pack price.
  // This prevents the "free cards + refund" exploit.
  let granted = 0;
  let lastError: unknown = null;
  for (const card of cards) {
    try {
      await catchCard(guildId, userId, card.id);
      granted += 1;
    } catch (err) {
      lastError = err;
      break;
    }
  }

  if (granted === 0) {
    await refundShards(guildId, userId, PACK_COST);
    await interaction.editReply("❌ Pack opening failed — your shards were refunded. Please try again.");
    if (lastError) throw lastError;
    return;
  }

  // Best-effort packsOpened bump — non-fatal.
  try {
    await db.update(userCurrencyTable)
      .set({ packsOpened: sql`${userCurrencyTable.packsOpened} + 1` })
      .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
  } catch { /* ignore — cosmetic counter only */ }

  if (granted < cards.length) {
    // Partial grant — trim summary to what actually landed; no refund.
    cards.length = granted;
  }

  const balanceAfter = before.shards - PACK_COST;

  await interaction.editReply({
    embeds: [buildSummaryEmbed(cards, PACK_COST, balanceAfter)],
    components: [],
  });

  // Achievements
  const newly = await checkAchievements(guildId, userId);
  if (newly.length > 0) {
    await interaction.followUp({
      content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
}

// Keep the unused import silencer for cardsTable usage (referenced via @workspace/db re-export only).
void cardsTable;
