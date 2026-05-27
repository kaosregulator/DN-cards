import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";

// /rarityname is superseded by /rarity edit, which covers all six built-in
// tiers (not just Mythic) with a visual interactive panel. This handler
// redirects all invocations to the new command so muscle memory still works.
export async function handleRarityName(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("🔀 Command moved to `/rarity edit`")
    .setColor(0x5865f2)
    .setDescription(
      "`/rarityname` has been superseded by `/rarity edit`, which lets you rename " +
      "**all six built-in rarity tiers** (not just Mythic) with custom name, emoji, " +
      "and color — using an interactive panel with a live preview.\n\n" +
      "**To rename the Mythic tier:** run `/rarity edit` and select **Mythic** from the dropdown.\n\n" +
      "Your previous Mythic customisation (if any) is still active — `/rarity edit` will " +
      "show it under the Mythic tier and let you adjust or clear it.",
    )
    .setFooter({ text: "/rarityname will be removed in a future update" });
  await interaction.editReply({ embeds: [embed] });
}
