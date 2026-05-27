import type { ChatInputCommandInteraction, MessageComponentInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} from "discord.js";
import {
  getAllCards, getUserCollection, removeCardFromUser, catchCard,
  restoreCardToUser, getOrCreateCurrency, getOrCreateGuildSettings,
  getRarityContext, applyRarityContext, applyRarityContextAll,
  getDisplayRarities, effectiveRarityKey,
  getRarityDisplayOverrides,
  type DisplayRarity, type RarityContext,
} from "../db.js";
import {
  RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS, SHINY_EMOJI, SHINY_MULTIPLIER,
  rarityLabel, rarityEmoji, rarityColor,
  type Rarity, type RarityDisplayMap,
} from "../cards-data.js";
import type { GuildSettings } from "@workspace/db";
import { checkAchievements, formatUnlockLine } from "../achievements.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Card } from "@workspace/db";

export const TRADEIN_COST = 5;

// Built-in /tradein rarity choices remain on the slash command; custom tiers
// are reachable as the destination via position-ordered ladder lookup.
const RARITY_LADDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// Build a position-ordered ladder (ascending) of built-in + custom tiers for
// this guild. The "next" tier above any given tier is just the next element.
function buildLadder(ctx: RarityContext, settings: GuildSettings | null, displayMap?: RarityDisplayMap | null): DisplayRarity[] {
  return getDisplayRarities(ctx, settings, { rarestFirst: false, displayMap: displayMap ?? undefined });
}

function findNextTier(ladder: DisplayRarity[], fromKey: string): DisplayRarity | null {
  const i = ladder.findIndex(t => t.key === fromKey);
  if (i < 0 || i === ladder.length - 1) return null;
  return ladder[i + 1];
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
  fromTier: DisplayRarity, toTier: DisplayRarity, plan: ConsumePlan, losesUnique: boolean,
): EmbedBuilder {
  const lines = plan.map(p => `• **${p.taken}× ${p.name}**`).join("\n");
  const warn = losesUnique
    ? "\n\n⚠️ **Heads up:** you'd lose a card you only own one copy of."
    : "";
  return new EmbedBuilder()
    .setTitle(`🔄 Trade-In — ${fromTier.emoji} → ${toTier.emoji}`)
    .setColor(toTier.color)
    .setDescription(
      `Burn **${TRADEIN_COST}** ${fromTier.emoji} ${fromTier.label} cards ` +
      `for **1 random** ${toTier.emoji} **${toTier.label}**.\n\n` +
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
  const [settings, displayMap, ctx] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getRarityContext(guildId),
  ]);

  // Build the per-guild ladder (built-ins + custom tiers by position). The
  // slash command only exposes built-in rarities as the FROM tier, but the
  // ladder may contain custom tiers above/below them as the TO target.
  const ladder = buildLadder(ctx, settings, displayMap);
  const fromKey = fromRarity; // built-in keys ARE the rarity string
  const fromTier = ladder.find(t => t.key === fromKey);
  const toTier = fromTier ? findNextTier(ladder, fromTier.key) : null;

  if (!fromTier) {
    await interaction.editReply(`❌ "${fromRarity}" isn't on this server's rarity ladder.`);
    return;
  }
  if (!toTier) {
    await interaction.editReply(
      `❌ **${fromTier.label}** is already the top tier on this server — nothing higher to trade up to.`,
    );
    return;
  }

  // Group user holdings by the EFFECTIVE rarity key — cards reassigned to a
  // custom tier won't show up under their built-in rarity any more (which is
  // what the admin wants).
  const collection = await getUserCollection(guildId, userId);
  const eligible = collection
    .filter(c => !c.isEventExclusive && effectiveRarityKey(c, ctx) === fromKey)
    .map(c => ({ cardId: c.cardId, name: c.name, count: c.count }));
  const totalAtRarity = eligible.reduce((s, c) => s + c.count, 0);

  if (totalAtRarity < TRADEIN_COST) {
    await interaction.editReply(
      `❌ You need **${TRADEIN_COST}** ${fromTier.emoji} ${fromTier.label} cards to trade in. ` +
      `You have **${totalAtRarity}**.\n` +
      `Tip: \`/burn\` duplicates first if you'd rather have shards.`,
    );
    return;
  }

  // Reward pool: cards whose effective rarity key matches the destination
  // tier. For built-in destinations this is `c.rarity === toKey`; for custom
  // destinations it's `customByCard.get(c.id)?.slug === <slug>`.
  const allCards = applyRarityContextAll(await getAllCards(), ctx);
  const rewardPool = allCards.filter(c =>
    effectiveRarityKey(c, ctx) === toTier.key &&
    !c.isArchived &&
    !c.isEventExclusive &&
    (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
  );
  if (rewardPool.length === 0) {
    await interaction.editReply(
      `❌ No ${toTier.emoji} ${toTier.label} cards are available right now. ` +
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

  await interaction.editReply({
    embeds: [buildConfirmEmbed(fromTier, toTier, plan, losesUnique)],
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
      embeds: [buildConfirmEmbed(fromTier, toTier, plan, losesUnique)],
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

    // Roll the reward (re-filter in case stock changed). Re-fetch context so
    // an admin save between confirm and resolve is respected.
    const freshCtx = await getRarityContext(guildId);
    const freshAll = applyRarityContextAll(await getAllCards(), freshCtx);
    const freshPool = freshAll.filter(c =>
      effectiveRarityKey(c, freshCtx) === toTier.key &&
      !c.isArchived &&
      !c.isEventExclusive &&
      (!c.isLimitedEdition || c.maxCopies == null || c.totalMinted < c.maxCopies),
    );
    const rawReward = pickByDropWeight(freshPool);
    const reward = rawReward ? applyRarityContext(rawReward, freshCtx) : undefined;
    if (!reward) {
      // Nothing to award — give the user back exactly what we removed.
      await refund();
      await interaction.editReply({
        content: `❌ No ${toTier.emoji} ${toTier.label} cards left to award — your cards were returned.`,
        embeds: [], components: [],
      }).catch(() => { /* ignore */ });
      collector.stop("noaward");
      return;
    }

    const { isShiny } = await catchCard(guildId, userId, reward.id);
    const balance = (await getOrCreateCurrency(guildId, userId)).shards;
    const shinyPrefix = isShiny ? `${SHINY_EMOJI} ` : "";
    const rewardWorth = isShiny ? reward.worthValue * SHINY_MULTIPLIER : reward.worthValue;
    const rewardBurn = isShiny ? reward.burnValue * SHINY_MULTIPLIER : reward.burnValue;

    const fE = fromTier.emoji, fL = fromTier.label;
    const tE = toTier.emoji,   tL = toTier.label;
    const summary = new EmbedBuilder()
      .setTitle(`🔄 Trade-In Complete — ${tE} ${tL}!${isShiny ? ` ${SHINY_EMOJI}` : ""}`)
      .setColor(isShiny ? 0xf1c40f : toTier.color)
      .setDescription(
        `You burned **${TRADEIN_COST}** ${fE} ${fL} cards ` +
        `and received a random ${tE} **${tL}**.\n\n` +
        `**🎁 You got:** ${tE} ${shinyPrefix}**${reward.name}**` +
        (isShiny ? `\n${SHINY_EMOJI} **SHINY!** Counts at ${SHINY_MULTIPLIER}× value.` : "") +
        (reward.description ? `\n*${reward.description}*` : "") +
        `\n\n**Consumed:**\n${plan.map(p => `• **${p.taken}× ${p.name}**`).join("\n")}` +
        `\n\n💠 Balance: **${balance.toLocaleString()}**`,
      )
      .addFields(
        { name: "💠 Worth", value: rewardWorth.toLocaleString() + (isShiny ? ` *(${SHINY_MULTIPLIER}×)*` : ""), inline: true },
        { name: "🔥 Burn", value: rewardBurn.toLocaleString() + (isShiny ? ` *(${SHINY_MULTIPLIER}×)*` : ""), inline: true },
        { name: "Rarity", value: `${tE} ${tL}`, inline: true },
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
