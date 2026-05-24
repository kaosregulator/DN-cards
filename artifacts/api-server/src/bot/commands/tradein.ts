import type { ChatInputCommandInteraction, MessageComponentInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} from "discord.js";
import {
  getAllCards, getUserCollection, removeCardFromUser, catchCard,
  restoreCardToUser, getOrCreateCurrency,
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

type ConsumePlan = Array<{ cardId: number; name: string; taken: number }>;

/** Picks which cards to burn — duplicates first, then uniques if needed. */
function planConsumption(
  eligible: Array<{ cardId: number; name: string; count: number }>,
): ConsumePlan | null {
  const pool = [...eligible].sort((a, b) => b.count - a.count);
  const plan: ConsumePlan = [];
  let needed = TRADEIN_COST;

  // Pass 1: take duplicates only (leave 1 copy of each card).
  for (const e of pool) {
    if (needed <= 0) break;
    const available = Math.max(0, e.count - 1);
    const take = Math.min(available, needed);
    if (take > 0) {
      plan.push({ cardId: e.cardId, name: e.name, taken: take });
      needed -= take;
    }
  }
  // Pass 2: still short — consume uniques.
  if (needed > 0) {
    for (const e of pool) {
      if (needed <= 0) break;
      const already = plan.find(p => p.cardId === e.cardId)?.taken ?? 0;
      const remaining = e.count - already;
      if (remaining <= 0) continue;
      const take = Math.min(remaining, needed);
      const existing = plan.find(p => p.cardId === e.cardId);
      if (existing) existing.taken += take;
      else plan.push({ cardId: e.cardId, name: e.name, taken: take });
      needed -= take;
    }
  }
  return needed > 0 ? null : plan;
}

function buildConfirmEmbed(
  fromRarity: Rarity, toRarity: Rarity, plan: ConsumePlan, losesUnique: boolean,
): EmbedBuilder {
  const lines = plan.map(p => `• **${p.taken}× ${p.name}**`).join("\n");
  const warn = losesUnique
    ? "\n\n⚠️ **Heads up:** you'd lose a card you only own one copy of."
    : "";
  return new EmbedBuilder()
    .setTitle(`🔄 Trade-In — ${RARITY_EMOJI[fromRarity]} → ${RARITY_EMOJI[toRarity]}`)
    .setColor(RARITY_COLORS[toRarity] ?? 0x5865f2)
    .setDescription(
      `Burn **${TRADEIN_COST}** ${RARITY_EMOJI[fromRarity]} ${RARITY_LABELS[fromRarity]} cards ` +
      `for **1 random** ${RARITY_EMOJI[toRarity]} **${RARITY_LABELS[toRarity]}**.\n\n` +
      `**Will be destroyed:**\n${lines}${warn}\n\n` +
      `Are you sure?`,
    )
    .setFooter({ text: "This cannot be undone. You have 30 seconds to confirm." });
}

function confirmRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("tradein_confirm").setLabel("✅ Confirm trade-in").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId("tradein_cancel").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
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

  // Snapshot the user's eligible holdings.
  const collection = await getUserCollection(guildId, userId);
  const eligible = collection
    .filter(c => c.rarity === fromRarity && !c.isEventExclusive)
    .map(c => ({ cardId: c.cardId, name: c.name, count: c.count }));
  const totalAtRarity = eligible.reduce((s, c) => s + c.count, 0);

  if (totalAtRarity < TRADEIN_COST) {
    await interaction.editReply(
      `❌ You need **${TRADEIN_COST}** ${RARITY_EMOJI[fromRarity]} ${RARITY_LABELS[fromRarity]} cards to trade in. ` +
      `You have **${totalAtRarity}**.\n` +
      `Tip: \`/burn\` duplicates first if you'd rather have shards.`,
    );
    return;
  }

  // Make sure there's something to award before we ask for confirmation.
  const allCards = await getAllCards();
  const rewardPool = allCards.filter(c =>
    c.rarity === toRarity &&
    !c.isArchived &&
    !c.isEventExclusive &&
    (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
  );
  if (rewardPool.length === 0) {
    await interaction.editReply(
      `❌ No ${RARITY_EMOJI[toRarity]} ${RARITY_LABELS[toRarity]} cards are available right now. ` +
      `Ask an admin to load more cards.`,
    );
    return;
  }

  const plan = planConsumption(eligible);
  if (!plan) {
    await interaction.editReply("❌ Couldn't gather enough cards — please try again.");
    return;
  }
  const losesUnique = plan.some(p => {
    const owned = eligible.find(e => e.cardId === p.cardId)?.count ?? 0;
    return owned === p.taken;
  });

  // Show confirm prompt.
  await interaction.editReply({
    embeds: [buildConfirmEmbed(fromRarity, toRarity, plan, losesUnique)],
    components: [confirmRow()],
  });

  // Attach a button collector. fetchReply on an ephemeral reply works in
  // discord.js v14; if it ever fails, the user can re-run the command.
  let replyMsg;
  try {
    replyMsg = await interaction.fetchReply();
  } catch {
    await interaction.editReply({
      content: "❌ Couldn't open the confirmation dialog — please run the command again.",
      embeds: [], components: [],
    }).catch(() => { /* ignore */ });
    return;
  }

  const collector = replyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30_000,
    filter: (i: MessageComponentInteraction) => i.user.id === userId,
  });

  let resolved = false;
  collector.on("collect", async (i) => {
    if (resolved) return;
    resolved = true;

    if (i.customId === "tradein_cancel") {
      await i.update({
        content: "🚫 Trade-in cancelled — no cards were destroyed.",
        embeds: [], components: [],
      }).catch(() => { /* ignore */ });
      collector.stop("cancelled");
      return;
    }

    if (i.customId !== "tradein_confirm") return;

    // Acknowledge immediately and rebuild the preview with disabled buttons
    // so the user sees we're working.
    await i.update({
      embeds: [buildConfirmEmbed(fromRarity, toRarity, plan, losesUnique)],
      components: [confirmRow(true)],
    }).catch(() => { /* ignore */ });

    // Re-verify holdings haven't changed since the preview (e.g. a /burn
    // between preview and confirm). If they have, abort cleanly.
    const fresh = await getUserCollection(guildId, userId);
    for (const p of plan) {
      const owned = fresh.find(c => c.cardId === p.cardId)?.count ?? 0;
      if (owned < p.taken) {
        await interaction.editReply({
          content: "❌ Your collection changed since the prompt opened — trade-in aborted, no cards destroyed.",
          embeds: [], components: [],
        }).catch(() => { /* ignore */ });
        collector.stop("stale");
        return;
      }
    }

    // Burn the inputs. Track the ACTUAL number of copies removed per card
    // so we can refund precisely if something goes wrong mid-flight (e.g.
    // concurrent /burn or /trade).
    const removed: Array<{ cardId: number; count: number }> = [];
    // Refund returns the exact copies we removed WITHOUT incrementing the
    // global mint counter — these cards were never destroyed from the
    // world's perspective, so the supply accounting must stay still.
    const refund = async () => {
      for (const r of removed) {
        for (let k = 0; k < r.count; k++) {
          await restoreCardToUser(guildId, userId, r.cardId);
        }
      }
    };

    for (const c of plan) {
      let taken = 0;
      for (let k = 0; k < c.taken; k++) {
        const res = await removeCardFromUser(guildId, userId, c.cardId);
        if (!res.success) break;
        taken += 1;
      }
      if (taken > 0) removed.push({ cardId: c.cardId, count: taken });
      if (taken < c.taken) {
        // Concurrent change ate the card under us — refund exactly what we took.
        await refund();
        await interaction.editReply({
          content: "❌ Your collection changed mid-trade — no cards were lost. Try again.",
          embeds: [], components: [],
        }).catch(() => { /* ignore */ });
        collector.stop("race");
        return;
      }
    }

    // Roll the reward (re-filter in case stock changed).
    const freshAll = await getAllCards();
    const freshPool = freshAll.filter(c =>
      c.rarity === toRarity &&
      !c.isArchived &&
      !c.isEventExclusive &&
      (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
    );
    const reward = pickByDropWeight(freshPool);
    if (!reward) {
      // Nothing to award — give the user back exactly what we removed.
      await refund();
      await interaction.editReply({
        content: `❌ No ${RARITY_EMOJI[toRarity]} cards left to award — your cards were returned.`,
        embeds: [], components: [],
      }).catch(() => { /* ignore */ });
      collector.stop("noaward");
      return;
    }

    await catchCard(guildId, userId, reward.id);
    const balance = (await getOrCreateCurrency(guildId, userId)).shards;

    const summary = new EmbedBuilder()
      .setTitle(`🔄 Trade-In Complete — ${RARITY_EMOJI[toRarity]} ${RARITY_LABELS[toRarity]}!`)
      .setColor(RARITY_COLORS[toRarity] ?? 0x5865f2)
      .setDescription(
        `You burned **${TRADEIN_COST}** ${RARITY_EMOJI[fromRarity]} ${RARITY_LABELS[fromRarity]} cards ` +
        `and received a random ${RARITY_EMOJI[toRarity]} **${RARITY_LABELS[toRarity]}**.\n\n` +
        `**🎁 You got:** ${RARITY_EMOJI[toRarity]} **${reward.name}**` +
        (reward.description ? `\n*${reward.description}*` : "") +
        `\n\n**Consumed:**\n${plan.map(p => `• **${p.taken}× ${p.name}**`).join("\n")}` +
        `\n\n💠 Balance: **${balance.toLocaleString()}**`,
      )
      .addFields(
        { name: "💠 Worth", value: reward.worthValue.toLocaleString(), inline: true },
        { name: "🔥 Burn", value: reward.burnValue.toLocaleString(), inline: true },
        { name: "Rarity", value: `${RARITY_EMOJI[toRarity]} ${RARITY_LABELS[toRarity]}`, inline: true },
      )
      .setFooter({ text: "Use /collection to view your new card." });
    const img = toAbsoluteImageUrl(reward.imageUrl);
    if (img) summary.setImage(img);

    await interaction.editReply({ content: "", embeds: [summary], components: [] }).catch(() => { /* ignore */ });

    const newly = await checkAchievements(guildId, userId);
    if (newly.length > 0) {
      await interaction.followUp({
        content: "🏆 **Achievement unlocked!**\n" + newly.map(formatUnlockLine).join("\n"),
        flags: MessageFlags.Ephemeral,
      }).catch(() => { /* ignore */ });
    }

    collector.stop("done");
  });

  collector.on("end", async (_collected, reason) => {
    if (resolved) return;
    if (reason === "time") {
      await interaction.editReply({
        content: "⏱️ Trade-in timed out — no cards were destroyed. Run `/tradein` again to retry.",
        embeds: [], components: [],
      }).catch(() => { /* ignore */ });
    }
  });
}
