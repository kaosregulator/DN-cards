import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  type ButtonInteraction,
} from "discord.js";
import { QUIET_BRAND } from "../shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// "Stones in the Water" — a short therapeutic release game.
//
// Inspired by grounding / externalization exercises used in counseling:
// name a weight → place it outside yourself → watch it sink → breathe →
// allow the feeling without fixing it. Click-driven embed “animation”.
// ─────────────────────────────────────────────────────────────────────────────

/** customId: quiet:game:release:<stepIndex> — button advances TO that step */
export const RELEASE_PREFIX = "quiet:game:release:";

const STEPS: { title: string; body: string; nextLabel: string; nextStep: number }[] = [
  {
    title: "🌊 Stones in the Water",
    body:
      "Imagine a still shoreline.\n\n" +
      "In your hand is a smooth stone — it can be worry, anger, grief, shame, or something without a name.\n\n" +
      "You don't have to name it out loud. Just feel its weight.",
    nextLabel: "Drop the stone",
    nextStep: 1,
  },
  {
    title: "🌊 Ripples",
    body:
      "You let go.\n\n" +
      "The water takes it. Rings spread… then settle.\n\n" +
      "Nothing asked you to be strong. Nothing asked you to explain.\n" +
      "The stone can stay down there as long as it needs to.",
    nextLabel: "Breathe with the water",
    nextStep: 2,
  },
  {
    title: "🫧 Soft tide",
    body:
      "In… two… three… four.\nHold… two… three.\nOut… two… three… four… five.\n\n" +
      "If your eyes sting, that's allowed.\n" +
      "If your chest loosens a little, that's allowed too.\n\n" +
      "Crying isn't breaking — sometimes it's the first honest thing the body gets to do.",
    nextLabel: "Sit with it a moment",
    nextStep: 3,
  },
  {
    title: "🌤️ You're still here",
    body:
      "The shore is quiet again.\n\n" +
      "You didn't fix the whole world. You didn't have to.\n" +
      "You set one weight down — and you're still worthy of rest.\n\n" +
      "When you're ready for the server again, press **I'm Ready** on your room card.\n" +
      "Or drop another stone anytime.",
    nextLabel: "Drop another stone",
    nextStep: 1,
  },
];

function parseStep(customId: string): number | null {
  if (!customId.startsWith(RELEASE_PREFIX)) return null;
  const n = Number(customId.slice(RELEASE_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : null;
}

export function buildReleaseGameStart(): {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
} {
  const step = STEPS[0];
  const embed = new EmbedBuilder()
    .setColor(QUIET_BRAND.COLOR_SOFT)
    .setTitle(step.title)
    .setDescription(step.body)
    .setFooter({ text: "A small release exercise • private to this room" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RELEASE_PREFIX}${step.nextStep}`)
      .setLabel(step.nextLabel)
      .setStyle(ButtonStyle.Primary),
  );
  return { embed, row };
}

export async function handleReleaseGameButton(interaction: ButtonInteraction): Promise<boolean> {
  const stepIdx = parseStep(interaction.customId);
  if (stepIdx === null) return false;

  const step = STEPS[stepIdx];
  const embed = new EmbedBuilder()
    .setColor(stepIdx >= 3 ? QUIET_BRAND.COLOR_OK : QUIET_BRAND.COLOR_SOFT)
    .setTitle(step.title)
    .setDescription(step.body)
    .setFooter({ text: "A small release exercise • private to this room" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RELEASE_PREFIX}${step.nextStep}`)
      .setLabel(step.nextLabel)
      .setStyle(stepIdx >= 3 ? ButtonStyle.Secondary : ButtonStyle.Primary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
  return true;
}
