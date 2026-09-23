import {
  MessageFlags, EmbedBuilder,
  type ButtonInteraction, type GuildMember, type Interaction,
  type MessageComponentInteraction,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getQuietState } from "./models.js";
import { QUIET_BRAND, QUIET_CUSTOM, QUIET_EMOJI } from "./shared.js";
import { leaveQuietFromInteraction } from "./lifecycle.js";

// ─────────────────────────────────────────────────────────────────────────────
// Quiet Mode — component interactions (quiet:* customIds)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleQuietInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  if (!interaction.customId.startsWith("quiet:")) return;

  if (interaction.isButton() && interaction.customId === QUIET_CUSTOM.READY) {
    await handleReadyButton(interaction);
    return;
  }

  // Unknown quiet:* control — ack quietly so Discord doesn't error-toast.
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: "That Quiet Room control is no longer active.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

async function handleReadyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Quiet Mode only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.editReply("Couldn't resolve your membership.");
    return;
  }

  // Only the quiet user may press I'm Ready on their own card.
  // Staff force-out: `/quiet user:@Member` (toggle) when they are already quiet.
  const state = await getQuietState(interaction.guild.id, member.id);
  if (!state) {
    // Maybe they clicked someone else's card — check message mentions.
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_SOFT)
        .setTitle(`${QUIET_EMOJI.SUN} Already back`)
        .setDescription(
          "You're not in Quiet Mode right now.\n" +
          "If the bot restarted mid-session, run `/quiet` once more to clear any leftover state.",
        )],
    });
    return;
  }

  try {
    const result = await leaveQuietFromInteraction(member);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(QUIET_BRAND.COLOR_OK)
        .setTitle(`${QUIET_EMOJI.SUN} Welcome back.`)
        .setDescription(result.wasQuiet
          ? "Glad you're here.\nYour normal server access was restored. No explanation needed."
          : "You weren't in Quiet Mode.")],
    });

    // Disable the button on the original message if we can.
    if (interaction.message.editable) {
      await interaction.message.edit({ components: [] }).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, userId: member.id }, "Quiet ready button failed");
    await interaction.editReply(
      "Something went wrong restoring access. Try `/quiet` again — that also brings you back.",
    );
  }
}

/** Type guard helper for the index router. */
export function isQuietComponent(interaction: MessageComponentInteraction): boolean {
  return interaction.customId.startsWith("quiet:");
}
