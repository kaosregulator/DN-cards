import type { ChatInputCommandInteraction, MessageComponentInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} from "discord.js";
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

  const drawn: Card[] = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    let rarity = rollRarity();
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

// ── Visuals ────────────────────────────────────────────────────────────────
function buildRevealEmbed(card: Card, idx: number, total: number): EmbedBuilder {
  const rarity = card.rarity as Rarity;
  const e = new EmbedBuilder()
    .setTitle(`🎴 Card ${idx + 1} of ${total} — ${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`)
    .setDescription(`**${card.name}**${card.description ? `\n*${card.description}*` : ""}`)
    .addFields(
      { name: "💠 Worth", value: card.worthValue.toLocaleString(), inline: true },
      { name: "🔥 Burn", value: card.burnValue.toLocaleString(), inline: true },
      { name: "Rarity", value: `${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}`, inline: true },
    )
    .setColor(RARITY_COLORS[rarity] ?? 0x5865f2);
  const img = toAbsoluteImageUrl(card.imageUrl);
  if (img) e.setImage(img);
  return e;
}

function buildFlipFrame(idx: number, total: number, frame: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🎴 Card ${idx + 1} of ${total}`)
    .setDescription(`${frame}\n\n*Get ready…*`)
    .setColor(0x5865f2);
}

function buildSummaryEmbed(cards: Card[], spent: number, balanceAfter: number): EmbedBuilder {
  const totalWorth = cards.reduce((s, c) => s + c.worthValue, 0);
  const last = cards[cards.length - 1];
  return new EmbedBuilder()
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
}

function buttonsRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pack_skip").setLabel("⏭️ Skip animation").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

// ── Handler ────────────────────────────────────────────────────────────────
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

  // Spend first (atomic). Then grant. Then animate.
  const spent = await spendShards(guildId, userId, PACK_COST);
  if (!spent) {
    await interaction.editReply(`❌ Insufficient shards (need 💠 ${PACK_COST.toLocaleString()}).`);
    return;
  }

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

  const balanceAfter = before.shards - PACK_COST;

  // Initial reveal frame + Skip button. Fetch the reply Message so we can
  // attach a component collector for the Skip button.
  await interaction.editReply({
    embeds: [buildFlipFrame(0, cards.length, "🎴 ✨ Opening pack…")],
    components: [buttonsRow()],
  });

  // Attach skip-button collector. fetchReply on ephemeral works in discord.js
  // v14, but be defensive: if it fails, just skip the collector and animate
  // through without a working Skip button.
  let skipped = false;
  let collector: ReturnType<typeof import("discord.js").Message.prototype.createMessageComponentCollector> | null = null;
  try {
    const replyMsg = await interaction.fetchReply();
    collector = replyMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: (i: MessageComponentInteraction) => i.user.id === userId,
    });
    collector.on("collect", async (i) => {
      if (i.customId !== "pack_skip") return;
      skipped = true;
      await i.deferUpdate().catch(() => { /* ignore */ });
      collector?.stop("skip");
    });
  } catch { /* no collector — animation still plays */ }

  // Per-card animated reveal: flip → reveal → short pause.
  for (let i = 0; i < cards.length; i++) {
    if (skipped) break;
    const card = cards[i];
    await interaction.editReply({
      embeds: [buildFlipFrame(i, cards.length, "🎴 ✨ Flipping…")],
      components: [buttonsRow()],
    }).catch(() => { skipped = true; });
    if (skipped) break;
    await sleep(500);
    if (skipped) break;
    await interaction.editReply({
      embeds: [buildRevealEmbed(card, i, cards.length)],
      components: i === cards.length - 1 ? [buttonsRow(true)] : [buttonsRow()],
    }).catch(() => { skipped = true; });
    if (skipped) break;
    await sleep(1200);
  }

  collector?.stop("done");

  await interaction.editReply({
    embeds: [buildSummaryEmbed(cards, PACK_COST, balanceAfter)],
    components: [],
  }).catch(() => { /* ignore */ });

  // Achievements
  const newly = await checkAchievements(guildId, userId);
  if (newly.length > 0) {
    await interaction.followUp({
      content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
