import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import {
  isAdmin,
  createSet, renameSet, deleteSetById,
  addCardToSet, removeCardFromSet, moveCardBetweenSets,
  bulkAddCardsToSet, bulkRemoveCardsFromSet,
  getSetByName, getCardsInSet, getCardByName,
  setActiveSet, clearActiveSet, getActiveSet,
  listSetsV2,
} from "../db.js";
import { RARITY_EMOJI, type Rarity } from "../cards-data.js";

async function checkAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

// Split a comma/newline/space-separated list into trimmed card-name candidates.
function parseList(raw: string): string[] {
  return raw.split(/[,\n]+/).map(s => s.trim()).filter(s => s.length > 0);
}

export async function handleSetAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // The /setadmin defer happens up the stack in admin.ts. Here we just route.
  if (!interaction.guild) return;
  if (!(await checkAdmin(interaction))) {
    await interaction.editReply("❌ Admins only.");
    return;
  }
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand(true);

  // ── create ───────────────────────────────────────────────────────────────
  if (sub === "create") {
    const name = interaction.options.getString("name", true);
    const description = interaction.options.getString("description") ?? undefined;
    try {
      const existing = await getSetByName(name);
      if (existing) {
        await interaction.editReply(`⚠️ Set \`${existing.name}\` already exists.`);
        return;
      }
      const set = await createSet(name, description);
      await interaction.editReply(
        `✅ Created set \`${set.name}\`. Add cards with \`/setadmin add set:${set.name} card:<Name>\` or activate it for spawns with \`/setadmin active set:${set.name}\`.`,
      );
    } catch (err: any) {
      await interaction.editReply(`❌ ${err?.message ?? "Failed to create set."}`);
    }
    return;
  }

  // ── rename ───────────────────────────────────────────────────────────────
  if (sub === "rename") {
    const fromName = interaction.options.getString("from", true);
    const toName = interaction.options.getString("to", true);
    const set = await getSetByName(fromName);
    if (!set) { await interaction.editReply(`❌ No set named \`${fromName}\`.`); return; }
    try {
      const updated = await renameSet(set.id, toName);
      await interaction.editReply(`✅ Renamed \`${set.name}\` → \`${updated?.name}\`.`);
    } catch (err: any) {
      await interaction.editReply(`❌ ${err?.message ?? "Rename failed."}`);
    }
    return;
  }

  // ── delete ───────────────────────────────────────────────────────────────
  if (sub === "delete") {
    const name = interaction.options.getString("name", true);
    const set = await getSetByName(name);
    if (!set) { await interaction.editReply(`❌ No set named \`${name}\`.`); return; }
    const { removedMemberships } = await deleteSetById(set.id);
    await interaction.editReply(
      `✅ Deleted set \`${set.name}\` — kept all cards intact, removed **${removedMemberships}** membership${removedMemberships === 1 ? "" : "s"}. ` +
      `To delete cards too, use \`!removecard <Name>\` per card.`,
    );
    return;
  }

  // ── add ──────────────────────────────────────────────────────────────────
  if (sub === "add") {
    const setName = interaction.options.getString("set", true);
    const cardName = interaction.options.getString("card", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const card = await getCardByName(cardName);
    if (!card) { await interaction.editReply(`❌ No card named **${cardName}**.`); return; }
    const { added } = await addCardToSet(set.id, card.id);
    await interaction.editReply(
      added
        ? `✅ Added **${card.name}** to \`${set.name}\`.`
        : `⚠️ **${card.name}** is already in \`${set.name}\`.`,
    );
    return;
  }

  // ── remove ───────────────────────────────────────────────────────────────
  if (sub === "remove") {
    const setName = interaction.options.getString("set", true);
    const cardName = interaction.options.getString("card", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const card = await getCardByName(cardName);
    if (!card) { await interaction.editReply(`❌ No card named **${cardName}**.`); return; }
    const { removed } = await removeCardFromSet(set.id, card.id);
    await interaction.editReply(
      removed
        ? `✅ Removed **${card.name}** from \`${set.name}\`. Card itself is untouched.`
        : `⚠️ **${card.name}** wasn't in \`${set.name}\`.`,
    );
    return;
  }

  // ── move ─────────────────────────────────────────────────────────────────
  if (sub === "move") {
    const fromName = interaction.options.getString("from", true);
    const toName = interaction.options.getString("to", true);
    const cardName = interaction.options.getString("card", true);
    const fromSet = await getSetByName(fromName);
    const toSet = await getSetByName(toName);
    if (!fromSet) { await interaction.editReply(`❌ No set named \`${fromName}\`.`); return; }
    if (!toSet) { await interaction.editReply(`❌ No set named \`${toName}\`.`); return; }
    const card = await getCardByName(cardName);
    if (!card) { await interaction.editReply(`❌ No card named **${cardName}**.`); return; }
    await moveCardBetweenSets(fromSet.id, toSet.id, card.id);
    await interaction.editReply(`✅ Moved **${card.name}** from \`${fromSet.name}\` → \`${toSet.name}\`.`);
    return;
  }

  // ── bulkadd ──────────────────────────────────────────────────────────────
  if (sub === "bulkadd") {
    const setName = interaction.options.getString("set", true);
    const cardsRaw = interaction.options.getString("cards", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const names = parseList(cardsRaw);
    if (names.length === 0) { await interaction.editReply("❌ Provide a comma-separated list of card names."); return; }
    const { added, alreadyIn, notFound } = await bulkAddCardsToSet(set.id, names);
    await interaction.editReply(
      `✅ Bulk add → \`${set.name}\`\n` +
      `➕ Added: **${added}**\n` +
      `⏭️ Already in set: **${alreadyIn}**` +
      (notFound.length > 0 ? `\n❓ Not found: ${notFound.slice(0, 10).map(n => `\`${n}\``).join(", ")}${notFound.length > 10 ? ` (+${notFound.length - 10} more)` : ""}` : ""),
    );
    return;
  }

  // ── bulkremove ───────────────────────────────────────────────────────────
  if (sub === "bulkremove") {
    const setName = interaction.options.getString("set", true);
    const cardsRaw = interaction.options.getString("cards", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const names = parseList(cardsRaw);
    if (names.length === 0) { await interaction.editReply("❌ Provide a comma-separated list of card names."); return; }
    const { removed, notInSet, notFound } = await bulkRemoveCardsFromSet(set.id, names);
    await interaction.editReply(
      `✅ Bulk remove from \`${set.name}\`\n` +
      `➖ Removed: **${removed}**\n` +
      `⏭️ Wasn't in set: **${notInSet}**` +
      (notFound.length > 0 ? `\n❓ Not found: ${notFound.slice(0, 10).map(n => `\`${n}\``).join(", ")}${notFound.length > 10 ? ` (+${notFound.length - 10} more)` : ""}` : ""),
    );
    return;
  }

  // ── active ───────────────────────────────────────────────────────────────
  if (sub === "active") {
    const setName = interaction.options.getString("set", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const memberCount = (await getCardsInSet(set.id)).filter(c => c.droppable && !c.isArchived).length;
    await setActiveSet(guildId, set.id);
    await interaction.editReply(
      `✅ Active set for this server → \`${set.name}\` (**${memberCount}** droppable cards).\n` +
      (memberCount === 0
        ? `⚠️ This set has no droppable cards, so random spawns still won't fire. Add cards with \`/setadmin add\`.`
        : `Random spawns now pull exclusively from this set.`),
    );
    return;
  }

  // ── deactivate ───────────────────────────────────────────────────────────
  if (sub === "deactivate") {
    await clearActiveSet(guildId);
    await interaction.editReply(
      `✅ Cleared active set. **Random spawns are now disabled** until you pick a new one with \`/setadmin active\`. Admin \`/drop name:<Card>\` still works.`,
    );
    return;
  }

  // ── view ─────────────────────────────────────────────────────────────────
  if (sub === "view") {
    const setName = interaction.options.getString("name", true);
    const set = await getSetByName(setName);
    if (!set) { await interaction.editReply(`❌ No set named \`${setName}\`.`); return; }
    const cards = await getCardsInSet(set.id);
    const active = await getActiveSet(guildId);
    const isActive = active?.id === set.id;
    const sets = await listSetsV2();
    const setRow = sets.find(s => s.set.id === set.id);
    const total = setRow?.cardCount ?? cards.length;
    const droppable = cards.filter(c => c.droppable && !c.isArchived).length;
    const grouped: Partial<Record<Rarity, string[]>> = {};
    for (const c of cards) {
      const r = c.rarity as Rarity;
      (grouped[r] ??= []).push(c.name);
    }
    const order: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];
    const fields = order
      .filter(r => grouped[r] && grouped[r]!.length > 0)
      .map(r => {
        const list = grouped[r]!.sort();
        const value = list.slice(0, 30).join(", ") + (list.length > 30 ? ` (+${list.length - 30} more)` : "");
        return { name: `${RARITY_EMOJI[r]} ${r} (${list.length})`, value: value.slice(0, 1024) };
      });
    const embed = new EmbedBuilder()
      .setTitle(`📦 Set: ${set.name}${isActive ? "  ✦ active" : ""}`)
      .setColor(isActive ? 0x57f287 : 0x5865f2)
      .setDescription(
        (set.description ? `${set.description}\n\n` : "") +
        `**${total}** cards · **${droppable}** droppable`,
      )
      .addFields(fields.length > 0 ? fields : [{ name: "Empty", value: "No cards yet — use `/setadmin add` or `/setadmin bulkadd`." }]);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await interaction.editReply(`❌ Unknown subcommand: \`${sub}\`.`);
}
