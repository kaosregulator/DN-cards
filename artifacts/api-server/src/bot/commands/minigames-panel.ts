// ─────────────────────────────────────────────────────────────────────────────
// /minigames — admin panel for Wild Mini-Games.
//
// Controls the schedule (cadence + interval), which game spawns (a specific game
// or Shuffle), enable/disable, the animated-intro toggle, and a "Trigger now"
// test button. Mirrors the /config panel structure (config-panel.ts): an
// ephemeral embed + button/select rows, self-routing its own `minigames:` custom
// IDs. Every change recomputes the schedule via applyMiniGameChange.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ModalSubmitInteraction,
  type Interaction,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings, isAdmin } from "../db.js";
import { applyMiniGameChange, armMiniGameNow } from "../minigame/scheduler.js";
import { GAMES, GAME_KEYS } from "../minigame/registry.js";
import type { GuildSettings } from "@workspace/db";

const CADENCES: { value: string; label: string; emoji: string }[] = [
  { value: "minutes", label: "Every N minutes", emoji: "⏱️" },
  { value: "hourly", label: "Hourly", emoji: "🕐" },
  { value: "daily", label: "Daily", emoji: "📅" },
  { value: "weekly", label: "Weekly", emoji: "🗓️" },
];

async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.guild) return false;
  const perms = interaction.memberPermissions;
  if (interaction.guild.ownerId === interaction.user.id || perms?.has("Administrator") || perms?.has("ManageGuild")) {
    return true;
  }
  return isAdmin(interaction.guild.id, interaction.user.id).catch(() => false);
}

function cadenceLabel(s: GuildSettings): string {
  if (s.miniGameCadence === "minutes") return `Every ${s.miniGameIntervalMinutes} min`;
  return CADENCES.find(c => c.value === s.miniGameCadence)?.label ?? s.miniGameCadence;
}

function selectionLabel(s: GuildSettings): string {
  if (s.miniGameSelection === "shuffle") return "🔀 Shuffle (random each time)";
  const g = GAMES[s.miniGameSelection as keyof typeof GAMES];
  return g ? g.name : s.miniGameSelection;
}

function buildEmbed(s: GuildSettings): EmbedBuilder {
  const enabled = s.miniGameEnabled;
  const status = enabled
    ? s.miniGameArmed
      ? "🟢 **Enabled** — a game is **armed**; the next catch triggers it."
      : s.miniGameNextArmAt
        ? `🟢 **Enabled** — next game arms <t:${Math.floor(s.miniGameNextArmAt.getTime() / 1000)}:R>.`
        : "🟢 **Enabled**."
    : "⚪ **Disabled** — catches award cards instantly (default).";

  return new EmbedBuilder()
    .setTitle("🎮 Wild Mini-Games")
    .setColor(enabled ? 0x8b5cf6 : 0x636e72)
    .setDescription(
      "When a wild mini-game is **armed**, the next successful catch doesn't award the card " +
      "immediately — a mini-game pops out (like a wild encounter). **Win → the card is yours. " +
      "Lose → it escapes.** Normal spawns resume until the next scheduled game.\n\n" +
      `${status}`,
    )
    .addFields(
      { name: "Cadence", value: cadenceLabel(s), inline: true },
      { name: "Game", value: selectionLabel(s), inline: true },
      { name: "Animated intro", value: s.miniGameAnimationEnabled ? "On" : "Off", inline: true },
    )
    .setFooter({ text: "Changes apply immediately. Use “Trigger now” to arm the next catch." });
}

function buildComponents(s: GuildSettings): ActionRowBuilder<any>[] {
  const cadenceSelect = new StringSelectMenuBuilder()
    .setCustomId("minigames:cadence")
    .setPlaceholder("Cadence — how often a game arms")
    .addOptions(CADENCES.map(c => ({
      label: c.label, value: c.value, emoji: c.emoji, default: s.miniGameCadence === c.value,
    })));

  const gameSelect = new StringSelectMenuBuilder()
    .setCustomId("minigames:game")
    .setPlaceholder("Game — a specific game or Shuffle")
    .addOptions([
      { label: "🔀 Shuffle (random each time)", value: "shuffle", default: s.miniGameSelection === "shuffle" },
      ...GAME_KEYS.map(k => ({
        label: GAMES[k].name,
        description: GAMES[k].blurb.slice(0, 90),
        value: k,
        default: s.miniGameSelection === k,
      })),
    ]);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("minigames:toggle:enabled")
      .setLabel(s.miniGameEnabled ? "Disable" : "Enable")
      .setStyle(s.miniGameEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("minigames:toggle:anim")
      .setLabel(s.miniGameAnimationEnabled ? "Animation: On" : "Animation: Off")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("minigames:modal:interval")
      .setLabel("Set interval (min)")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("minigames:trigger")
      .setLabel("⚡ Trigger now")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!s.miniGameEnabled),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(cadenceSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gameSelect),
    buttons,
  ];
}

async function render(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, guildId: string): Promise<void> {
  const s = await getOrCreateGuildSettings(guildId);
  await interaction.editReply({ embeds: [buildEmbed(s)], components: buildComponents(s) });
}

// ── Command entry ────────────────────────────────────────────────────────────
export async function handleMiniGamesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!await ensureAdmin(interaction)) {
    await interaction.editReply({ content: "❌ Admins only." });
    return;
  }
  const s = await getOrCreateGuildSettings(interaction.guild.id);
  await interaction.editReply({ embeds: [buildEmbed(s)], components: buildComponents(s) });
}

// ── Unified interaction router (buttons, selects, modals) ────────────────────
export async function handleMiniGamesInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;

  // Interval modal must be shown BEFORE any defer.
  if (interaction.isButton() && interaction.customId === "minigames:modal:interval") {
    if (!await ensureAdmin(interaction)) {
      await interaction.reply({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
      return;
    }
    const s = await getOrCreateGuildSettings(guildId);
    const modal = new ModalBuilder()
      .setCustomId("minigames:modal_submit:interval")
      .setTitle("Mini-game interval")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("minutes")
            .setLabel("Minutes between games (min 1)")
            .setStyle(TextInputStyle.Short)
            .setValue(String(s.miniGameIntervalMinutes))
            .setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === "minigames:modal_submit:interval") {
    await interaction.deferUpdate();
    if (!await ensureAdmin(interaction)) return;
    const raw = interaction.fields.getTextInputValue("minutes").trim();
    const mins = Math.max(1, Math.min(100_000, parseInt(raw, 10) || 1));
    await updateGuildSettings(guildId, { miniGameCadence: "minutes", miniGameIntervalMinutes: mins });
    await applyMiniGameChange(guildId);
    await render(interaction, guildId);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    if (!await ensureAdmin(interaction)) return;
    const value = interaction.values[0]!;
    if (interaction.customId === "minigames:cadence") {
      await updateGuildSettings(guildId, { miniGameCadence: value });
    } else if (interaction.customId === "minigames:game") {
      await updateGuildSettings(guildId, { miniGameSelection: value });
    }
    await applyMiniGameChange(guildId);
    await render(interaction, guildId);
    return;
  }

  if (interaction.isButton()) {
    await interaction.deferUpdate();
    if (!await ensureAdmin(interaction)) return;
    const s = await getOrCreateGuildSettings(guildId);
    if (interaction.customId === "minigames:toggle:enabled") {
      await updateGuildSettings(guildId, { miniGameEnabled: !s.miniGameEnabled });
      await applyMiniGameChange(guildId);
    } else if (interaction.customId === "minigames:toggle:anim") {
      await updateGuildSettings(guildId, { miniGameAnimationEnabled: !s.miniGameAnimationEnabled });
    } else if (interaction.customId === "minigames:trigger") {
      await armMiniGameNow(guildId);
    }
    await render(interaction, guildId);
    return;
  }
}
