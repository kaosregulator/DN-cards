// ─────────────────────────────────────────────────────────────────────────────
// /begin — the one-time interactive onboarding adventure (Chapter 1).
//
// This is the opening chapter, not a help menu: the player WATCHES the bot
// demonstrate a real command (a scripted-Discord GIF rendered live on canvas),
// then TAKES the action themselves and earns real progression — shards, real
// cards (a free pack via the live economy), and the exclusive 🎓 First Steps
// achievement. Completion is tracked permanently, so the rewards are granted
// exactly once per player — new and existing alike.
//
// The flow is a tiny ephemeral state machine driven by onboarding:* buttons:
//   demo  →  "your turn"  →  claim (grant + record)  →  done
// Future chapters slot in as more scenes + steps without new infrastructure.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AttachmentBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getAchievement, grantAchievement } from "../achievements.js";
import { addShards, getOrCreateCurrency } from "../db.js";
import { grantFreePack } from "../battle/pack-grant.js";
import { renderDailyDemo } from "./scenes.js";
import { hasCompletedOnboarding, startOnboarding, advanceChapter, claimCompletion } from "./db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const DEMO_FILE = "onboarding-chapter1.gif";
const BRAND = 0xe63946;
const GOLD = 0xf1c40f;

// Starter grant (on first completion only). Real progression the player keeps.
const STARTER_SHARDS = 1000;
const STARTER_PACK_TIER = "basic";

// ── Entry: /begin ─────────────────────────────────────────────────────────────
export async function handleOnboardingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Onboarding runs inside a server.", ...EPHEMERAL }); return; }
  await interaction.deferReply(EPHEMERAL);
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (await hasCompletedOnboarding(guildId, userId)) {
    const ach = getAchievement("onboarding");
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(GOLD)
        .setTitle("🎓 Adventure Complete")
        .setDescription(
          "You've already completed the onboarding adventure — your **First Steps** are behind you.\n\n" +
          "Jump back in any time: catch cards in the drop channel, open `/pack`s, and challenge someone to `/battle`.",
        )
        .setFooter({ text: ach ? `${ach.emoji} ${ach.name} earned` : "" })],
    });
    return;
  }

  await startOnboarding(guildId, userId);
  await getOrCreateCurrency(guildId, userId);

  // Render the Chapter 1 demonstration GIF (best-effort — falls back to text).
  const demo = await renderDailyDemo(interaction.user.username).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🎴 Welcome to DN Cards — Chapter 1: First Steps")
    .setDescription(
      "Every collector starts somewhere. **Watch** how earning works — then you'll do it yourself for real rewards.\n\n" +
      "Above, the bot runs `/daily` to claim shards. Commands, autocomplete, and buttons all work just like this.\n\n" +
      "**Ready?** Hit **Continue** when you've watched.",
    )
    .setFooter({ text: "Chapter 1 of your adventure · rewards are real and yours to keep" });

  const files: AttachmentBuilder[] = [];
  if (demo) {
    embed.setImage(`attachment://${DEMO_FILE}`);
    files.push(new AttachmentBuilder(demo.buffer, { name: DEMO_FILE }));
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("onboarding:continue").setLabel("Continue").setEmoji("▶️").setStyle(ButtonStyle.Primary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files });
}

// ── Component router (onboarding:*) ───────────────────────────────────────────
export async function handleOnboardingComponent(interaction: ButtonInteraction): Promise<void> {
  const action = interaction.customId.split(":")[1];
  try {
    if (action === "continue") return void await onContinue(interaction);
    if (action === "claim") return void await onClaim(interaction);
    await interaction.reply({ content: "Unknown onboarding action.", ...EPHEMERAL }).catch(() => {});
  } catch (err) {
    logger.error({ err, action }, "onboarding component error");
    await interaction.reply({ content: "Something went wrong — try `/begin` again.", ...EPHEMERAL }).catch(() => {});
  }
}

// Demo → "your turn": hand control to the player.
async function onContinue(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  await advanceChapter(interaction.guild.id, interaction.user.id, 1);
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🕹️ Your Turn — Claim Your Starter Rewards")
    .setDescription(
      "Now it's real. Tap the button below to claim your **starter pack** and get set up:\n\n" +
      `• 💠 **${STARTER_SHARDS.toLocaleString()} shards** to spend on packs\n` +
      "• 🎴 A **free pack** of real cards straight into your collection\n" +
      "• 🎓 The exclusive **First Steps** achievement\n\n" +
      "After this, watch the drop channel and **type a card's name** to catch it — that's the heart of the game.",
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("onboarding:claim").setLabel("Claim My Starter Rewards").setEmoji("🎁").setStyle(ButtonStyle.Success),
  );
  await interaction.update({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

// Claim: the real, one-time grant. claimCompletion() guarantees single-grant.
async function onClaim(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id, userId = interaction.user.id;
  await interaction.deferUpdate().catch(() => {});

  const won = await claimCompletion(guildId, userId);
  if (!won) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(GOLD).setTitle("🎓 Already Claimed")
        .setDescription("You've already earned your onboarding rewards — they can only be claimed once. Go catch some cards!")],
      components: [], files: [],
    }).catch(() => {});
    return;
  }

  // Grant the real progression. Order: shards, then a real pack, then the
  // achievement (which adds its own shard reward). All best-effort so a partial
  // failure never blocks the others — completion is already recorded.
  await addShards(guildId, userId, STARTER_SHARDS).catch(() => {});
  const cardIds = await grantFreePack(guildId, userId, STARTER_PACK_TIER).catch(() => [] as number[]);
  const ach = await grantAchievement(guildId, userId, "onboarding").catch(() => null);

  const lines = [
    `💠 **+${STARTER_SHARDS.toLocaleString()} shards**`,
    cardIds.length > 0
      ? `🎴 **${cardIds.length} card${cardIds.length === 1 ? "" : "s"}** added to your collection`
      : "🎴 Free pack queued — an admin still needs to load a card set on this server",
  ];
  if (ach) lines.push(`${ach.emoji} **${ach.name}** unlocked (+💠 ${ach.reward.toLocaleString()})`);

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("🎉 Chapter 1 Complete — Welcome, Collector!")
    .setDescription(
      "Your adventure has begun and the rewards are yours:\n\n" + lines.join("\n") + "\n\n" +
      "**What's next**\n" +
      "• Watch the drop channel and **type a card's name** to catch it\n" +
      "• Open `/pack` · check your `/collection` · run `/user-hub`\n" +
      "• Challenge someone to a `/battle` when you're ready",
    )
    .setFooter({ text: "🎓 First Steps · onboarding complete" });
  await interaction.editReply({ embeds: [embed], components: [], files: [] }).catch(() => {});
}
