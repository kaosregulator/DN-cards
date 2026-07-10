// /edit_image — quick admin command to change only a card's image.
//
// Uses the same flow as /edit_card for image persistence, but if no image is
// uploaded it looks up the card name on MTTV and uses the MTTV item's image.
// If MTTV has no image for that card, it tells the user to upload one themselves.

import type { ChatInputCommandInteraction } from "discord.js";
import { getCardByName, updateCard } from "../db.js";
import { isOwnedBy } from "../home-guild.js";
import { logger } from "../../lib/logger.js";
import { renderPanel, persistBotImage } from "./edit-card.js";
import { fetchMTTVItems, matchScore } from "./mttvalues.js";

export async function handleEditImageCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString("name", true).trim();
  const image = interaction.options.getAttachment("image");
  const guildId = interaction.guildId;
  if (!guildId) return;

  const card = await getCardByName(name, guildId);
  if (!card) {
    await interaction.editReply(`❌ No card named **${name}**. Use autocomplete to pick one.`);
    return;
  }
  if (!isOwnedBy(card, guildId)) {
    await interaction.editReply(`❌ You can only edit cards owned by this server.`);
    return;
  }

  let imageUrl: string | undefined;

  if (image) {
    imageUrl = await persistBotImage(image.url, image.contentType ?? undefined);
  } else {
    let item;
    try {
      const items = await fetchMTTVItems();
      item = items.find((i) => i.name.toLowerCase() === card.name.toLowerCase());
      if (!item) {
        const scored = items
          .map((i) => ({ i, score: matchScore(i, card.name) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score);
        item = scored[0]?.i;
      }
    } catch (err) {
      logger.error({ err }, "Failed to fetch MTTV items for edit_image");
      await interaction.editReply("❌ Could not reach MTTV. Try again later or upload an image yourself.");
      return;
    }

    if (!item || !item.image) {
      await interaction.editReply(
        `❌ No image found on MTTV for **${card.name}**. Upload an image yourself with the \`image\` option.`,
      );
      return;
    }

    imageUrl = await persistBotImage(item.image);
  }

  if (imageUrl) {
    await updateCard(card.id, { imageUrl });
  }

  await renderPanel(
    interaction,
    card.id,
    false,
    image ? `✅ Updated image for **${card.name}**` : `✅ Updated image for **${card.name}** from MTTV`,
  );
}
