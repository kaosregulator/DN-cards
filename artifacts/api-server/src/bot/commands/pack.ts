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
  // Only droppable, non-event-exclusive cards; limited only if there's room.
  const all = (await getAllCards()).filter(c =>
    c.droppable && c.inPacks && !c.isArchived && !c.isEventExclusive &&
    (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
  );
  if (all.length === 0) return [];

  const byRarity: Record<Rarity, Card[]> = {
    common: [], uncommon: [], rare: [], epic: [], legendary: [],
  };
  for (const c of all) byRarity[c.rarity as Rarity]?.push(c);

  const drawn: Card[] = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    let rarity = rollRarity();
    // Fall back through rarer→commoner if a tier is empty
    const fallbackOrder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    const startIdx = fallbackOrder.indexOf(rarity);
    let picked: Card | undefined;
    for (let j = startIdx; j < fallbackOrder.length; j++) {
      const tier = fallbackOrder[j];
      picked = pickByDropWeight(byRarity[tier]);
      if (picked) { rarity = tier; break; }
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function buildOpeningEmbed(revealed: Card[], total: number): EmbedBuilder {
  const lines: string[] = [];
  for (let i = 0; i < total; i++) {
    const c = revealed[i];
    if (c) {
      const emoji = RARITY_EMOJI[c.rarity as Rarity] ?? "🃏";
      lines.push(`**${i + 1}.** ${emoji} **${c.name}** — *${RARITY_LABELS[c.rarity as Rarity]}* (💠 ${c.worthValue})`);
    } else {
      lines.push(`**${i + 1}.** 🎴 \`???\``);
    }
  }
  const last = revealed[revealed.length - 1];
  const color = last ? (RARITY_COLORS[last.rarity as Rarity] ?? 0x5865f2) : 0x5865f2;
  return new EmbedBuilder()
    .setTitle("🎴 Opening Pack…")
    .setColor(color)
    .setDescription(lines.join("\n"));
}

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

  // ── Spend FIRST (atomic) — fails fast if balance < cost or under contention ──
  const spent = await spendShards(guildId, userId, PACK_COST);
  if (!spent) {
    await interaction.editReply(`❌ Insufficient shards (need 💠 ${PACK_COST.toLocaleString()}).`);
    return;
  }

  // ── Grant all cards next, BEFORE the slow animation. If any grant throws we
  //    refund the full pack cost so a partial pack never charges the user. ──
  try {
    for (const card of cards) {
      await catchCard(guildId, userId, card.id);
    }
    await db.update(userCurrencyTable)
      .set({ packsOpened: sql`${userCurrencyTable.packsOpened} + 1` })
      .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
  } catch (err) {
    await refundShards(guildId, userId, PACK_COST);
    await interaction.editReply("❌ Pack opening failed — your shards were refunded. Please try again.");
    throw err;
  }

  // ── Animated reveal (visual only — grants already persisted) ─────────────
  const revealed: Card[] = [];
  await interaction.editReply({ embeds: [buildOpeningEmbed(revealed, cards.length)] });
  for (const card of cards) {
    await sleep(900);
    revealed.push(card);
    await interaction.editReply({ embeds: [buildOpeningEmbed(revealed, cards.length)] }).catch(() => {
      /* animation edit can fail (deleted/rate-limited) — cards already granted, ignore */
    });
  }

  // Final summary
  const totalWorth = cards.reduce((s, c) => s + c.worthValue, 0);
  const finalLast = cards[cards.length - 1];
  const finalEmbed = new EmbedBuilder()
    .setTitle(`🎴 Pack Opened — ${cards.length} cards`)
    .setColor(RARITY_COLORS[finalLast.rarity as Rarity] ?? 0x5865f2)
    .setDescription(
      cards.map((c, i) => {
        const emoji = RARITY_EMOJI[c.rarity as Rarity] ?? "🃏";
        return `**${i + 1}.** ${emoji} **${c.name}** — *${RARITY_LABELS[c.rarity as Rarity]}* · 💠 ${c.worthValue.toLocaleString()}`;
      }).join("\n") +
      `\n\n**Total worth:** 💠 ${totalWorth.toLocaleString()}\n` +
      `Spent: 💠 ${PACK_COST.toLocaleString()} · Balance: 💠 ${(before.shards - PACK_COST).toLocaleString()}`,
    )
    .setFooter({ text: "Cards added to your collection — use /collection to view." });
  await interaction.editReply({ embeds: [finalEmbed] });

  // Achievements
  const newly = await checkAchievements(guildId, userId);
  if (newly.length > 0) {
    await interaction.followUp({
      content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
