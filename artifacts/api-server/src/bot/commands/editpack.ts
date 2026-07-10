import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import {
  listCustomPacks, getCustomPack, updateCustomPack, getCustomPackCards,
  addCardsToPack, removeCardsFromPack, getAllCards, getOrCreateGuildSettings,
  getRarityDisplayOverrides, getRarityContext, isAdmin,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";
import { getCardDisplayRarity } from "../rarity-runtime.js";
import type { CustomPack } from "@workspace/db";

// ── Admin entry: /editpack ───────────────────────────────────────────────────
// One command to tweak an existing custom pack: rename it, change cost/size/limit,
// set an emoji, enable/disable it, and add/remove individual cards or whole rarities.
// The `pack` option is autocompleted from this guild's custom packs.

const RARITY_CHOICES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as Rarity[];

function parseNumber(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function isValidEmoji(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true; // blank clears emoji
  // Allow a single Unicode emoji, or a Discord custom emoji like <:name:id>
  if (/^\p{Emoji_Presentation}$/u.test(trimmed)) return true;
  if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{17,}>$/.test(trimmed)) return true;
  return false;
}

export async function handleEditPackCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  // Caller (admin.ts) already deferred the interaction ephemerally.

  const guildId = interaction.guild.id;
  const member = interaction.member as GuildMember | null;
  const isAuthorized =
    interaction.guild.ownerId === interaction.user.id ||
    member?.permissions.has("Administrator") ||
    (await isAdmin(guildId, interaction.user.id));
  if (!isAuthorized) {
    await interaction.editReply("❌ Only admins can edit packs.");
    return;
  }

  const opts = interaction.options;

  const packName = opts.getString("pack", true).trim();
  const pack = await findPackByName(guildId, packName);
  if (!pack) {
    await interaction.editReply(`❌ No custom pack found matching **${packName}**.`);
    return;
  }

  const patch: Partial<CustomPack> = {};
  const newName = opts.getString("new_name")?.trim();
  if (newName && newName !== pack.name) patch.name = newName;
  if (opts.getInteger("cost") != null) patch.cost = Math.max(0, opts.getInteger("cost", true));
  if (opts.getInteger("size") != null) {
    const size = opts.getInteger("size", true);
    patch.size = Math.max(1, Math.min(10, size));
  }
  if (opts.getInteger("weekly_limit") != null) {
    patch.weeklyLimit = Math.max(0, opts.getInteger("weekly_limit", true));
  }
  const description = opts.getString("description")?.trim();
  if (description !== undefined) patch.description = description;
  const emoji = opts.getString("emoji")?.trim();
  if (emoji !== undefined) {
    if (!isValidEmoji(emoji)) {
      await interaction.editReply("❌ Emoji must be a single Unicode emoji or a custom Discord emoji like `<:name:id>`.");
      return;
    }
    patch.emoji = emoji || null;
  }
  if (opts.getBoolean("active") != null) patch.isActive = opts.getBoolean("active", true);

  const addCardName = opts.getString("add_card")?.trim();
  const removeCardName = opts.getString("remove_card")?.trim();
  const addRarity = opts.getString("add_rarity") as Rarity | null;
  const removeRarity = opts.getString("remove_rarity") as Rarity | null;

  const allCards = await getAllCards(guildId);
  const cardByName = (name: string) => allCards.find(c => c.name.toLowerCase() === name.toLowerCase());

  const addedCards: string[] = [];
  const removedCards: string[] = [];
  const skippedCards: string[] = [];

  if (addCardName) {
    const card = cardByName(addCardName);
    if (!card) {
      await interaction.editReply(`❌ Card **${addCardName}** not found.`);
      return;
    }
    await addCardsToPack(pack.id, [card.id]);
    addedCards.push(card.name);
  }

  if (removeCardName) {
    const card = cardByName(removeCardName);
    if (!card) {
      await interaction.editReply(`❌ Card **${removeCardName}** not found.`);
      return;
    }
    await removeCardsFromPack(pack.id, [card.id]);
    removedCards.push(card.name);
  }

  if (addRarity) {
    const toAdd = allCards.filter(c => c.rarity === addRarity && !c.isArchived && c.droppable && c.inPacks);
    if (toAdd.length > 0) {
      await addCardsToPack(pack.id, toAdd.map(c => c.id));
      addedCards.push(...toAdd.map(c => c.name));
    } else {
      skippedCards.push(`No matching ${RARITY_EMOJI[addRarity]} ${RARITY_LABELS[addRarity]} cards to add`);
    }
  }

  if (removeRarity) {
    const toRemove = allCards.filter(c => c.rarity === removeRarity);
    if (toRemove.length > 0) {
      await removeCardsFromPack(pack.id, toRemove.map(c => c.id));
      removedCards.push(...toRemove.map(c => c.name));
    } else {
      skippedCards.push(`No ${RARITY_EMOJI[removeRarity]} ${RARITY_LABELS[removeRarity]} cards in pack to remove`);
    }
  }

  if (Object.keys(patch).length > 0) {
    await updateCustomPack(pack.id, patch);
  }

  const fresh = await getCustomPack(pack.id);
  if (!fresh) {
    await interaction.editReply("❌ Pack disappeared while editing.");
    return;
  }
  const packCards = await getCustomPackCards(pack.id);
  const [settings, displayMap, ctx] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getRarityContext(guildId),
  ]);

  const embed = buildEditPackSummary(fresh, packCards, allCards, addedCards, removedCards, skippedCards, settings, displayMap, ctx);
  await interaction.editReply({ embeds: [embed] });
}

async function findPackByName(guildId: string, name: string): Promise<CustomPack | undefined> {
  const packs = await listCustomPacks(guildId, true);
  const lower = name.toLowerCase();
  return packs.find(p => p.name.toLowerCase() === lower || p.slug.toLowerCase() === lower || p.id.toString() === name);
}

function buildEditPackSummary(
  pack: CustomPack,
  packCards: { cardId: number }[],
  allCards: { id: number; name: string; rarity: string }[],
  added: string[],
  removed: string[],
  skipped: string[],
  settings: Awaited<ReturnType<typeof getOrCreateGuildSettings>>,
  displayMap: Awaited<ReturnType<typeof getRarityDisplayOverrides>> | null,
  ctx: Awaited<ReturnType<typeof getRarityContext>>,
) {
  const allMap = new Map(allCards.map(c => [c.id, c]));
  const whitelisted = packCards.map(p => allMap.get(p.cardId)).filter(Boolean) as typeof allCards;
  const typeLine = pack.cardTypes.length > 0 ? `Types: ${pack.cardTypes.join(", ")}` : "Types: *All*";
  const whitelistLine = whitelisted.length > 0
    ? `Cards: ${whitelisted.length} whitelisted`
    : "Cards: *using type filter*";

  const fields = [
    {
      name: "🎁 Pack details",
      value:
        `${pack.emoji || "🎁"} **${pack.name}**\n` +
        `💠 ${pack.cost.toLocaleString()} · ${pack.size} card/open · ${pack.weeklyLimit === 0 ? "∞" : `${pack.weeklyLimit}/week`}\n` +
        `${typeLine}\n${whitelistLine}\n` +
        `Status: ${pack.isActive ? "🟢 Active" : "🔴 Inactive"}`,
      inline: false,
    },
  ];

  if (added.length > 0) {
    const lines = added.slice(0, 15).map(n => {
      const c = allCards.find(x => x.name === n);
      if (!c) return `• ${n}`;
      const r = getCardDisplayRarity(c as any, ctx, settings, displayMap);
      return `• ${r.emoji} ${n}`;
    });
    const more = added.length > 15 ? `\n...and ${added.length - 15} more` : "";
    fields.push({
      name: `✅ Added (${added.length})`,
      value: lines.join("\n").slice(0, 1000) + more,
      inline: false,
    });
  }

  if (removed.length > 0) {
    const lines = removed.slice(0, 15).map(n => `• ${n}`);
    const more = removed.length > 15 ? `\n...and ${removed.length - 15} more` : "";
    fields.push({
      name: `🗑️ Removed (${removed.length})`,
      value: lines.join("\n").slice(0, 1000) + more,
      inline: false,
    });
  }

  if (whitelisted.length > 0 && whitelisted.length <= 25) {
    const lines = whitelisted
      .slice(0, 25)
      .map(c => {
        const r = getCardDisplayRarity(c as any, ctx, settings, displayMap);
        return `• ${r.emoji} ${c.name}`;
      });
    fields.push({
      name: `📋 Current whitelist (${whitelisted.length})`,
      value: lines.join("\n").slice(0, 1000),
      inline: false,
    });
  }

  if (skipped.length > 0) {
    fields.push({
      name: "ℹ️ Skipped",
      value: skipped.map(s => `• ${s}`).join("\n").slice(0, 1000),
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setTitle("🎛️ Edit Pack")
    .setColor(0x57f287)
    .setDescription("Updated the pack. Use `/editpack` again to keep tweaking it.")
    .addFields(fields)
    .setFooter({ text: "Packs with a whitelist ignore the type filter; clear the whitelist to use types again." });
}

