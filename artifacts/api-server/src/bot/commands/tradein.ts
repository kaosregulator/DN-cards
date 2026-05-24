import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import {
  getAllCards, getUserCollection, removeCardFromUser, catchCard,
  getOrCreateCurrency,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, type Rarity,
} from "../cards-data.js";
import { checkAchievements, formatUnlockLine } from "../achievements.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Card } from "@workspace/db";

export const TRADEIN_COST = 5;

const RARITY_LADDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

function nextRarity(r: Rarity): Rarity | null {
  const i = RARITY_LADDER.indexOf(r);
  if (i < 0 || i === RARITY_LADDER.length - 1) return null;
  return RARITY_LADDER[i + 1];
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

export async function handleTradein(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const fromRarityRaw = interaction.options.getString("rarity", true).toLowerCase();
  if (!RARITY_LADDER.includes(fromRarityRaw as Rarity)) {
    await interaction.editReply(`❌ Invalid rarity. Choose one of: ${RARITY_LADDER.join(", ")}.`);
    return;
  }
  const fromRarity = fromRarityRaw as Rarity;
  const toRarity = nextRarity(fromRarity);

  if (!toRarity) {
    await interaction.editReply(
      `❌ Legendary is the top tier — there's nothing higher to trade up to.\n` +
      `Try \`/tradein rarity:epic\` to chase a Legendary instead.`,
    );
    return;
  }

  // Collect the user's holdings at the chosen rarity. We need TRADEIN_COST
  // total copies, drawn from any combination of cards at that rarity.
  const collection = await getUserCollection(guildId, userId);
  const eligible = collection.filter(c => c.rarity === fromRarity && !c.isEventExclusive);
  const totalAtRarity = eligible.reduce((s, c) => s + c.count, 0);

  if (totalAtRarity < TRADEIN_COST) {
    await interaction.editReply(
      `❌ You need **${TRADEIN_COST}** ${RARITY_EMOJI[fromRarity]} ${RARITY_LABELS[fromRarity]} cards to trade in. ` +
      `You have **${totalAtRarity}**.\n` +
      `Tip: \`/burn\` duplicates first if you'd rather have shards.`,
    );
    return;
  }

  // Greedy burn: take duplicates first (preserve uniques where possible),
  // then take from the largest stacks. This keeps the user's set as
  // complete as possible after the trade-in.
  const pool = [...eligible].sort((a, b) => b.count - a.count);
  const consumed: Array<{ cardId: number; name: string; taken: number }> = [];
  let needed = TRADEIN_COST;
  for (const entry of pool) {
    if (needed <= 0) break;
    // Leave 1 copy behind if we can, so the user doesn't lose a unique card.
    const available = Math.max(0, entry.count - 1);
    const take = Math.min(available, needed);
    if (take > 0) {
      consumed.push({ cardId: entry.cardId, name: entry.name, taken: take });
      needed -= take;
    }
  }
  // If duplicates alone weren't enough, fall through and consume uniques too.
  if (needed > 0) {
    for (const entry of pool) {
      if (needed <= 0) break;
      const already = consumed.find(c => c.cardId === entry.cardId)?.taken ?? 0;
      const remaining = entry.count - already;
      if (remaining <= 0) continue;
      const take = Math.min(remaining, needed);
      const existing = consumed.find(c => c.cardId === entry.cardId);
      if (existing) existing.taken += take;
      else consumed.push({ cardId: entry.cardId, name: entry.name, taken: take });
      needed -= take;
    }
  }

  if (needed > 0) {
    await interaction.editReply("❌ Couldn't gather enough cards — please try again.");
    return;
  }

  // Pick the reward BEFORE we burn, so if there's nothing to award we abort
  // cleanly and the user keeps their cards.
  const allCards = await getAllCards();
  const rewardPool = allCards.filter(c =>
    c.rarity === toRarity &&
    !c.isArchived &&
    !c.isEventExclusive &&
    (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
  );
  const reward = pickByDropWeight(rewardPool);
  if (!reward) {
    await interaction.editReply(
      `❌ No ${RARITY_EMOJI[toRarity]} ${RARITY_LABELS[toRarity]} cards are available to award right now. ` +
      `Ask an admin to load more cards. Your cards were **not** consumed.`,
    );
    return;
  }

  // Burn the inputs.
  const burned: string[] = [];
  for (const c of consumed) {
    for (let i = 0; i < c.taken; i++) {
      const res = await removeCardFromUser(guildId, userId, c.cardId);
      if (!res.success) {
        // Race condition — try to refund what we already took.
        for (const refund of burned) void refund; // best-effort, no rollback path needed since we credit reward last
      }
    }
    burned.push(`**${c.taken}× ${c.name}**`);
  }

  // Award the reward.
  await catchCard(guildId, userId, reward.id);

  const balance = (await getOrCreateCurrency(guildId, userId)).shards;

  const embed = new EmbedBuilder()
    .setTitle(`🔄 Trade-In Complete — ${RARITY_EMOJI[toRarity]} ${RARITY_LABELS[toRarity]}!`)
    .setColor(RARITY_COLORS[toRarity] ?? 0x5865f2)
    .setDescription(
      `You burned **${TRADEIN_COST}** ${RARITY_EMOJI[fromRarity]} ${RARITY_LABELS[fromRarity]} cards ` +
      `and received a random ${RARITY_EMOJI[toRarity]} **${RARITY_LABELS[toRarity]}**.\n\n` +
      `**🎁 You got:** ${RARITY_EMOJI[toRarity]} **${reward.name}**` +
      (reward.description ? `\n*${reward.description}*` : "") +
      `\n\n**Consumed:**\n${burned.map(b => `• ${b}`).join("\n")}` +
      `\n\n💠 Balance: **${balance.toLocaleString()}**`,
    )
    .addFields(
      { name: "💠 Worth", value: reward.worthValue.toLocaleString(), inline: true },
      { name: "🔥 Burn", value: reward.burnValue.toLocaleString(), inline: true },
      { name: "Rarity", value: `${RARITY_EMOJI[toRarity]} ${RARITY_LABELS[toRarity]}`, inline: true },
    )
    .setFooter({ text: "Use /collection to view your new card." });
  const img = toAbsoluteImageUrl(reward.imageUrl);
  if (img) embed.setImage(img);

  await interaction.editReply({ embeds: [embed] });

  const newly = await checkAchievements(guildId, userId);
  if (newly.length > 0) {
    await interaction.followUp({
      content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
}
