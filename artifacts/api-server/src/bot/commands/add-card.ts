// /addcard — interactive slash command replacing !addcard / !addlimited / !addevent.
//
// The command itself takes the core required fields (name, rarity, type) plus
// optional extras. The image option accepts a Discord attachment (drag-and-drop
// from the file picker) OR a URL in the imageurl option.
//
// After creation the bot renders the /editcard panel in the same ephemeral
// message so the admin can immediately refine anything.

import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { addCard, getCardByName } from "../db.js";
import { renderPanel } from "./edit-card.js";

const RARITY_DEFAULTS: Record<string, { worth: number; burn: number; weight: number }> = {
  common:    { worth: 10,   burn: 5,    weight: 60 },
  uncommon:  { worth: 50,   burn: 25,   weight: 25 },
  rare:      { worth: 200,  burn: 100,  weight: 10 },
  epic:      { worth: 750,  burn: 375,  weight: 4  },
  legendary: { worth: 2500, burn: 1250, weight: 1  },
  mythic:    { worth: 6000, burn: 3000, weight: 0  },
};

export async function handleAddCardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const opts = interaction.options;
  const name           = opts.getString("name", true).trim();
  const rarity         = opts.getString("rarity", true);
  const type           = opts.getString("type", true);
  const imageAttachment = opts.getAttachment("image");
  const imageUrl       = imageAttachment?.url ?? opts.getString("imageurl") ?? undefined;
  const description    = opts.getString("description") ?? "";
  const defs           = RARITY_DEFAULTS[rarity] ?? RARITY_DEFAULTS.common!;
  const worth          = opts.getInteger("worth")  ?? defs.worth;
  const burn           = opts.getInteger("burn")   ?? defs.burn;
  const weight         = opts.getNumber("weight")  ?? defs.weight;
  const limited        = opts.getBoolean("limited") ?? false;
  const maxCopies      = opts.getInteger("max_copies") ?? undefined;
  const eventExclusive = opts.getBoolean("event_exclusive") ?? false;

  if (!name) {
    await interaction.editReply("❌ Card name cannot be empty.");
    return;
  }

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
    rarity,
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
    inPacks:   !eventExclusive && rarity !== "mythic",
  });

  await renderPanel(interaction, card.id, false, `✅ Created **${card.name}** — tweak any field below`);
}
