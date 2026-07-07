import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  ModalBuilder,
  MessageFlags,
  TextInputStyle,
  type GuildMember,
} from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { db, cardsTable, collectionsTable, userCurrencyTable } from "@workspace/db";
import {
  getOrCreateCurrency,
  getUserCollection,
  getAllCards,
  getCardByName,
  catchCard,
  removeCardFromUser,
  addShards,
  deductShards,
  isAdmin,
} from "../db.js";
import { getCollectorRank, getShinyMultiplier } from "../cards-data.js";
import { getOrCreateGuildSettings } from "../db.js";
import { getRarityContext } from "../db.js";

// ── /edituser — interactive admin panel for editing a guild member's profile ─
// Actions: add/remove/set cards (normal + shiny), add/remove/set shards.
// All changes are guild-scoped; collector rank is recomputed from unique cards.

const MAX_AMOUNT = 1_000_000;

const ACTIONS = [
  { value: "add_cards", label: "➕ Add cards", desc: "Mint normal copies for the user" },
  { value: "remove_cards", label: "➖ Remove cards", desc: "Delete normal copies (stops at 0)" },
  { value: "set_cards", label: "🔢 Set card count", desc: "Set exact normal copy count" },
  { value: "add_shinies", label: "✨ Add shinies", desc: "Mint shiny copies" },
  { value: "remove_shinies", label: "🔥 Remove shinies", desc: "Delete shiny copies (stops at 0)" },
  { value: "set_shinies", label: "🔢 Set shiny count", desc: "Set exact shiny copy count" },
  { value: "add_shards", label: "💠 Add shards", desc: "Increase shard balance" },
  { value: "remove_shards", label: "💠 Remove shards", desc: "Decrease shard balance (min 0)" },
  { value: "set_shards", label: "🔢 Set shards", desc: "Set exact shard balance" },
];

function panelCustomId(guildId: string, userId: string) {
  return `edituser:menu:${guildId}:${userId}`;
}

function modalCustomId(action: string, guildId: string, userId: string) {
  return `edituser:modal:${action}:${guildId}:${userId}`;
}

function parseIds(customId: string): { action: string; guildId: string; userId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  return { action: parts[2]!, guildId: parts[3]!, userId: parts[4]! };
}

async function checkCallerAdmin(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

async function fetchUserSummary(guildId: string, userId: string) {
  const [currency, items, settings, ctx] = await Promise.all([
    getOrCreateCurrency(guildId, userId),
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getRarityContext(guildId),
  ]);
  const shinyMultiplier = getShinyMultiplier(settings);
  const totalCopies = items.reduce((s, i) => s + i.count + i.shinyCount, 0);
  const totalShinies = items.reduce((s, i) => s + i.shinyCount, 0);
  const unique = items.length;
  const netWorth = items.reduce(
    (s, i) => s + i.worthValue * (i.count + i.shinyCount * shinyMultiplier),
    0,
  );
  const rank = getCollectorRank(unique);
  return { currency, items, totalCopies, totalShinies, unique, netWorth, rank };
}

function buildPanel(guildId: string, userId: string, username: string, summary: Awaited<ReturnType<typeof fetchUserSummary>>) {
  const { currency, totalCopies, totalShinies, unique, netWorth, rank } = summary;
  const embed = new EmbedBuilder()
    .setTitle(`🛠️ Edit Member · ${username}`)
    .setColor(0x5865f2)
    .setDescription(`<@${userId}> (${userId})`)
    .addFields(
      { name: "💠 Shards", value: currency.shards.toLocaleString(), inline: true },
      { name: "🃏 Unique cards", value: unique.toString(), inline: true },
      { name: "📦 Total copies", value: totalCopies.toString(), inline: true },
      { name: "✨ Shinies", value: totalShinies.toString(), inline: true },
      { name: "💰 Net worth", value: `${netWorth.toLocaleString()} 💠`, inline: true },
      { name: "🏅 Rank", value: `${rank.emoji} ${rank.name}`, inline: true },
    )
    .setFooter({ text: "Pick an action below. Card changes are guild-scoped." });

  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(guildId, userId))
    .setPlaceholder("Choose an edit action…")
    .addOptions(ACTIONS.map(a => ({ label: a.label, value: a.value, description: a.desc })));

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embeds: [embed], components: [row] };
}

export async function handleEditUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // /admin already deferred the reply ephemerally before dispatching us.
  if (!interaction.guild) {
    await interaction.editReply("❌ This command must be used in a server.");
    return;
  }
  const guildId = interaction.guild.id;
  const target = interaction.options.getUser("user", true);
  const summary = await fetchUserSummary(guildId, target.id);
  await interaction.editReply(buildPanel(guildId, target.id, target.username, summary));
}

export async function handleEditUserInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.customId.startsWith("edituser:menu:")) return;
  if (!interaction.guild) { await interaction.deferUpdate().catch(() => {}); return; }
  if (!(await checkCallerAdmin(interaction))) {
    await interaction.reply({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const parts = interaction.customId.split(":");
  const guildId = parts[2]!;
  const userId = parts[3]!;
  if (guildId !== interaction.guild.id) {
    await interaction.reply({ content: "❌ Guild mismatch.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const action = interaction.values[0];
  if (!action) { await interaction.deferUpdate().catch(() => {}); return; }

  const needsCard = action.includes("cards") || action.includes("shinies");

  const modal = new ModalBuilder()
    .setCustomId(modalCustomId(action, guildId, userId))
    .setTitle(ACTIONS.find(a => a.value === action)?.label ?? "Edit Member");

  const components = [];
  if (needsCard) {
    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("card")
          .setLabel("Card name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("Partial name OK — e.g. Abrams, Raptor, Mi-35"),
      ),
    );
  }
  components.push(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Amount")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("Whole number, 0 or higher")
        .setValue("1"),
    ),
  );
  modal.addComponents(components);
  await interaction.showModal(modal);
}

export async function handleEditUserModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseIds(interaction.customId);
  if (!parsed) return;
  const { action, guildId, userId } = parsed;

  if (!interaction.guild) {
    await interaction.reply({ content: "❌ This interaction must be used in a server.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (!(await checkCallerAdmin(interaction))) {
    await interaction.reply({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (guildId !== interaction.guild.id) {
    await interaction.reply({ content: "❌ Guild mismatch.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const amountRaw = interaction.fields.getTextInputValue("amount").trim().replace(/,/g, "");
  const amount = Number(amountRaw);
  const isAdditive = action.startsWith("add_") || action.startsWith("remove_");
  const minAmount = isAdditive ? 1 : 0;
  if (!Number.isInteger(amount) || amount < minAmount || amount > MAX_AMOUNT) {
    const operator = isAdditive ? "1" : "0";
    await interaction.reply({
      content: `❌ Amount must be a whole number between ${operator} and ${MAX_AMOUNT.toLocaleString()}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const cardName = action.includes("cards") || action.includes("shinies")
    ? interaction.fields.getTextInputValue("card").trim()
    : null;

  let cardId: number | undefined;
  let resolvedCardName: string | undefined;
  if (cardName) {
    let card = await getCardByName(cardName, guildId);
    if (!card) {
      // Fuzzy fallback: partial case-insensitive match across the full roster
      const allCards = await getAllCards(guildId);
      const q = cardName.toLowerCase();
      const matches = allCards.filter(c => c.name.toLowerCase().includes(q));
      if (matches.length === 1) {
        card = matches[0];
      } else if (matches.length > 1) {
        const list = matches.slice(0, 8).map(c => `• ${c.name}`).join("\n");
        const more = matches.length > 8 ? `\n…and ${matches.length - 8} more` : "";
        await interaction.reply({
          content: `❌ **"${cardName}"** matches multiple cards — be more specific:\n${list}${more}`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }
    }
    if (!card) {
      await interaction.reply({ content: `❌ Card "**${cardName}**" not found.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    cardId = card.id;
    resolvedCardName = card.name;
  }

  await interaction.deferUpdate();

  let feedback = "";
  try {
    switch (action) {
      case "add_cards": {
        await db.transaction(async tx => {
          await tx.insert(collectionsTable)
            .values({ guildId, userId, cardId: cardId!, count: amount, shinyCount: 0 })
            .onConflictDoUpdate({
              target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
              set: { count: sql`${collectionsTable.count} + ${amount}`, lastCaughtAt: new Date() },
            });
          await tx.update(cardsTable)
            .set({ totalMinted: sql`${cardsTable.totalMinted} + ${amount}` })
            .where(eq(cardsTable.id, cardId!));
        });
        feedback = `✅ Added **${resolvedCardName}** ×${amount.toLocaleString()} to <@${userId}>.`;
        break;
      }
      case "remove_cards": {
        const result = await db.transaction(async tx => {
          const [entry] = await tx.select().from(collectionsTable)
            .where(and(
              eq(collectionsTable.guildId, guildId),
              eq(collectionsTable.userId, userId),
              eq(collectionsTable.cardId, cardId!),
            ));
          if (!entry || entry.count < 1) return { removed: 0, had: 0 };
          const removed = Math.min(amount, entry.count);
          const newCount = entry.count - removed;
          if (newCount === 0 && entry.shinyCount === 0) {
            await tx.delete(collectionsTable).where(eq(collectionsTable.id, entry.id));
          } else {
            await tx.update(collectionsTable).set({ count: newCount }).where(eq(collectionsTable.id, entry.id));
          }
          await tx.update(cardsTable)
            .set({ totalMinted: sql`GREATEST(0, ${cardsTable.totalMinted} - ${removed})` })
            .where(eq(cardsTable.id, cardId!));
          return { removed, had: entry.count };
        });
        feedback = result.removed > 0
          ? `✅ Removed **${resolvedCardName}** ×${result.removed.toLocaleString()} from <@${userId}>${result.removed < amount ? ` (only had ${result.had})` : ""}.`
          : `❌ <@${userId}> has no normal copies of **${resolvedCardName}**.`;
        break;
      }
      case "set_cards":
      case "set_shinies": {
        const isShiny = action === "set_shinies";
        const countCol = isShiny ? collectionsTable.shinyCount : collectionsTable.count;
        await db.transaction(async tx => {
          const [existing] = await tx.select().from(collectionsTable)
            .where(and(
              eq(collectionsTable.guildId, guildId),
              eq(collectionsTable.userId, userId),
              eq(collectionsTable.cardId, cardId!),
            ));
          const before = existing ? (isShiny ? existing.shinyCount : existing.count) : 0;
          if (amount === 0 && existing) {
            const other = isShiny ? existing.count : existing.shinyCount;
            if (other === 0) {
              await tx.delete(collectionsTable).where(eq(collectionsTable.id, existing.id));
            } else {
              await tx.update(collectionsTable).set({ [countCol.name]: 0 }).where(eq(collectionsTable.id, existing.id));
            }
          } else if (amount > 0) {
            if (existing) {
              await tx.update(collectionsTable).set({ [countCol.name]: amount }).where(eq(collectionsTable.id, existing.id));
            } else {
              await tx.insert(collectionsTable).values({
                guildId,
                userId,
                cardId: cardId!,
                count: isShiny ? 0 : amount,
                shinyCount: isShiny ? amount : 0,
              });
            }
          }
          const delta = amount - before;
          if (delta !== 0) {
            await tx.update(cardsTable)
              .set({ totalMinted: sql`GREATEST(0, ${cardsTable.totalMinted} + ${delta})` })
              .where(eq(cardsTable.id, cardId!));
          }
        });
        const typeLabel = isShiny ? "shiny" : "normal";
        feedback = `✅ Set <@${userId}>'s ${typeLabel} **${resolvedCardName}** count to ${amount.toLocaleString()}.`;
        break;
      }
      case "add_shinies": {
        await db.transaction(async tx => {
          await tx.insert(collectionsTable)
            .values({ guildId, userId, cardId: cardId!, count: 0, shinyCount: amount })
            .onConflictDoUpdate({
              target: [collectionsTable.guildId, collectionsTable.userId, collectionsTable.cardId],
              set: { shinyCount: sql`${collectionsTable.shinyCount} + ${amount}`, lastCaughtAt: new Date() },
            });
          await tx.update(cardsTable)
            .set({ totalMinted: sql`${cardsTable.totalMinted} + ${amount}` })
            .where(eq(cardsTable.id, cardId!));
        });
        feedback = `✅ Added **${resolvedCardName}** shiny ×${amount.toLocaleString()} to <@${userId}>.`;
        break;
      }
      case "remove_shinies": {
        const result = await db.transaction(async tx => {
          const [entry] = await tx.select().from(collectionsTable)
            .where(and(
              eq(collectionsTable.guildId, guildId),
              eq(collectionsTable.userId, userId),
              eq(collectionsTable.cardId, cardId!),
            ));
          if (!entry || entry.shinyCount < 1) return { removed: 0, had: 0 };
          const removed = Math.min(amount, entry.shinyCount);
          const newShiny = entry.shinyCount - removed;
          if (newShiny === 0 && entry.count === 0) {
            await tx.delete(collectionsTable).where(eq(collectionsTable.id, entry.id));
          } else {
            await tx.update(collectionsTable).set({ shinyCount: newShiny }).where(eq(collectionsTable.id, entry.id));
          }
          await tx.update(cardsTable)
            .set({ totalMinted: sql`GREATEST(0, ${cardsTable.totalMinted} - ${removed})` })
            .where(eq(cardsTable.id, cardId!));
          return { removed, had: entry.shinyCount };
        });
        feedback = result.removed > 0
          ? `✅ Removed **${resolvedCardName}** shiny ×${result.removed.toLocaleString()} from <@${userId}>${result.removed < amount ? ` (only had ${result.had})` : ""}.`
          : `❌ <@${userId}> has no shiny copies of **${resolvedCardName}**.`;
        break;
      }
      case "add_shards": {
        await addShards(guildId, userId, amount);
        feedback = `✅ Added 💠 **${amount.toLocaleString()} shards** to <@${userId}>.`;
        break;
      }
      case "remove_shards": {
        const result = await deductShards(guildId, userId, amount);
        feedback = result.success
          ? `✅ Removed 💠 **${amount.toLocaleString()} shards** from <@${userId}>. Balance: **${result.remaining.toLocaleString()}**.`
          : `❌ Could not remove shards from <@${userId}> (balance too low or none).`;
        break;
      }
      case "set_shards": {
        await getOrCreateCurrency(guildId, userId);
        await db.update(userCurrencyTable)
          .set({ shards: amount, updatedAt: new Date() })
          .where(and(eq(userCurrencyTable.guildId, guildId), eq(userCurrencyTable.userId, userId)));
        feedback = `✅ Set <@${userId}>'s shard balance to 💠 **${amount.toLocaleString()}**.`;
        break;
      }
      default:
        feedback = "❌ Unknown action.";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    feedback = `❌ Edit failed: ${msg}`;
  }

  // Refresh the panel and show the feedback in the message content.
  const summary = await fetchUserSummary(guildId, userId);
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const username = member?.user.username ?? interaction.user.username;
  await interaction.editReply({ content: feedback, ...buildPanel(guildId, userId, username, summary) });
}
