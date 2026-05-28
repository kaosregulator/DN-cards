// /addcard — interactive slash command replacing !addcard / !addlimited / !addevent.
//
// The command itself takes the core required fields (name, rarity, type) plus
// optional extras. The image option accepts a Discord attachment (drag-and-drop
// from the file picker) OR a URL in the imageurl option.
//
// After creation the bot renders the /editcard panel in the same ephemeral
// message so the admin can immediately refine anything.

import {
  type ChatInputCommandInteraction,
} from "discord.js";
import { addCard, getCardByName, getCustomRarityBySlug, assignCardToCustomRarity } from "../db.js";
import { renderPanel } from "./edit-card.js";
import type { Rarity } from "../cards-data.js";

const BUILTIN_RARITIES = new Set<string>(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);

const RARITY_DEFAULTS: Record<string, { worth: number; burn: number; weight: number }> = {
  common:    { worth: 10,   burn: 5,    weight: 60 },
  uncommon:  { worth: 50,   burn: 25,   weight: 25 },
  rare:      { worth: 200,  burn: 100,  weight: 10 },
  epic:      { worth: 750,  burn: 375,  weight: 4  },
  legendary: { worth: 2500, burn: 1250, weight: 1  },
  mythic:    { worth: 6000, burn: 3000, weight: 0  },
};

export async function handleAddCardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const opts        = interaction.options;
  const guildId     = interaction.guildId!;
  const name        = opts.getString("name", true).trim();
  const rarityInput = opts.getString("rarity", true);
  const type        = opts.getString("type", true);
  const imageAttachment = opts.getAttachment("image");
  const imageUrl    = imageAttachment?.url ?? opts.getString("imageurl") ?? undefined;
  const description = opts.getString("description") ?? "";
  const limited        = opts.getBoolean("limited") ?? false;
  const maxCopies      = opts.getInteger("max_copies") ?? undefined;
  const eventExclusive = opts.getBoolean("event_exclusive") ?? false;

  if (!name) {
    await interaction.editReply("❌ Card name cannot be empty.");
    return;
  }

  // Resolve whether this is a built-in rarity or a guild custom tier slug.
  const isCustom = !BUILTIN_RARITIES.has(rarityInput);
  let baseRarity: Rarity = "common";
  let customSlug: string | null = null;
  let defs = RARITY_DEFAULTS.common!;

  if (isCustom) {
    const tier = await getCustomRarityBySlug(guildId, rarityInput);
    if (!tier) {
      await interaction.editReply(`❌ Unknown rarity \`${rarityInput}\`. Please pick one from the autocomplete list.`);
      return;
    }
    customSlug = tier.slug;
    // Use the custom tier's economy values as defaults; admin can override via the fields.
    defs = { worth: tier.worthValue, burn: tier.burnValue, weight: tier.dropWeight };
    // The DB rarity column is an enum — store "common" as a neutral placeholder.
    // The custom tier override in card_rarity_overrides is the actual source of truth.
    baseRarity = "common";
  } else {
    baseRarity = rarityInput as Rarity;
    defs = RARITY_DEFAULTS[rarityInput] ?? RARITY_DEFAULTS.common!;
  }

  const worth  = opts.getInteger("worth")  ?? defs.worth;
  const burn   = opts.getInteger("burn")   ?? defs.burn;
  const weight = opts.getNumber("weight")  ?? defs.weight;

  const existing = await getCardByName(name);
  if (existing) {
    await interaction.editReply(
      `❌ A card named **${name}** already exists (ID #${existing.id}). ` +
      `Use \`/editcard\` to modify it.`,
    );
    return;
  }

  const card = await addCard({
    name,
    rarity: baseRarity,
    cardType: type,
    description,
    imageUrl,
    worthValue: worth,
    burnValue:  burn,
    dropWeight: weight,
    isLimitedEdition: limited,
    maxCopies: limited ? (maxCopies ?? 50) : undefined,
    isEventExclusive: eventExclusive,
    droppable: !eventExclusive,
    inPacks:   !eventExclusive && baseRarity !== "mythic",
  });

  // If a custom tier was chosen, assign it now so the rarity resolver picks it up immediately.
  if (customSlug) {
    await assignCardToCustomRarity(guildId, card.id, customSlug);
  }

  const rarityLabel = customSlug ? `custom tier \`${customSlug}\`` : `**${baseRarity}**`;
  await renderPanel(interaction, card.id, false, `✅ Created **${card.name}** (${rarityLabel}) — tweak any field below`);
}
