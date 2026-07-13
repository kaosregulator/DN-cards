// ─────────────────────────────────────────────────────────────────────────────
// Squad Hub — a /help-style ephemeral hub for squads, launched from /squad or
// the 🤝 button on /user-hub. Every /squad subcommand's action lives here as a
// dropdown entry; create opens a modal, join uses a squad picker, leave/disband
// use confirm buttons. All actions reuse the same core functions as the /squad
// slash command.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction, ModalSubmitInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from "discord.js";
import {
  buildSquadInfoEmbed, buildSquadListEmbed, squadChoices,
  createSquadAction, joinSquadAction, leaveSquadAction, disbandSquadAction,
} from "../squad/commands.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type Action = "info" | "list" | "create" | "join" | "leave" | "disband";

const ACTIONS: { id: Action; label: string; emoji: string; description: string }[] = [
  { id: "info",    label: "My Squad",     emoji: "🎖️", description: "Your squad's stats & roster" },
  { id: "list",    label: "Leaderboard",  emoji: "🏆", description: "Top squads on this server" },
  { id: "create",  label: "Create Squad", emoji: "➕", description: "Found a new squad" },
  { id: "join",    label: "Join Squad",   emoji: "🤝", description: "Join an existing squad" },
  { id: "leave",   label: "Leave Squad",  emoji: "👋", description: "Leave your current squad" },
  { id: "disband", label: "Disband",      emoji: "💥", description: "Leader only — delete the squad" },
];

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleSquadHub(
  interaction: ChatInputCommandInteraction, opening: Action = "info",
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }
  const view = await buildView(interaction, opening);
  await interaction.editReply(view);
}

export async function openSquadHubFromButton(interaction: ButtonInteraction): Promise<void> {
  const view = await buildView(interaction, "info");
  await interaction.update(view).catch(() => {});
}

// ── Component + modal router ──────────────────────────────────────────────────
export async function handleSquadHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // squad-hub:<action>[:arg]
  const action = parts[1] ?? "select";
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  if (action === "select" && interaction.isStringSelectMenu()) {
    const chosen = interaction.values[0] as Action;
    if (chosen === "create") { await showCreateModal(interaction); return; }
    if (chosen === "leave") { await confirmLeave(interaction); return; }
    if (chosen === "disband") { await confirmDisband(interaction); return; }
    const view = await buildView(interaction, chosen);
    await interaction.update(view).catch(() => {});
    return;
  }

  // Join: a squad was picked.
  if (action === "join-pick" && interaction.isStringSelectMenu()) {
    const name = interaction.values[0]!;
    const text = await joinSquadAction(guildId, userId, name);
    const view = await buildView(interaction, "info");
    await interaction.update(view).catch(() => {});
    await interaction.followUp({ content: text, ...EPHEMERAL }).catch(() => {});
    return;
  }

  // Leave / disband confirm buttons.
  if (action === "leave-confirm" && interaction.isButton()) {
    const text = await leaveSquadAction(guildId, userId);
    const view = await buildView(interaction, "list");
    await interaction.update(view).catch(() => {});
    await interaction.followUp({ content: text, ...EPHEMERAL }).catch(() => {});
    return;
  }
  if (action === "disband-confirm" && interaction.isButton()) {
    const text = await disbandSquadAction(guildId, userId);
    const view = await buildView(interaction, "list");
    await interaction.update(view).catch(() => {});
    await interaction.followUp({ content: text, ...EPHEMERAL }).catch(() => {});
    return;
  }

  if (action === "back" && interaction.isButton()) {
    const { openUserHubFromButton } = await import("./user-hub.js");
    await openUserHubFromButton(interaction);
    return;
  }
}

export async function handleSquadHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":"); // squad-hub:modal:create
  if (parts[2] !== "create") return;
  const text = await createSquadAction(interaction.guildId!, interaction.user.id, {
    name: interaction.fields.getTextInputValue("name"),
    tag: interaction.fields.getTextInputValue("tag") || null,
    description: interaction.fields.getTextInputValue("description") || null,
  });
  await interaction.reply({ content: text, ...EPHEMERAL });
}

// ── View builder ──────────────────────────────────────────────────────────────
type AnyInteraction = ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction;

function actionRow(current: Action) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("squad-hub:select")
    .setPlaceholder("🤝 Choose a squad action…")
    .addOptions(ACTIONS.map(a => ({ label: a.label, value: a.id, description: a.description, emoji: a.emoji, default: a.id === current })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function backRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("squad-hub:back").setLabel("Back to Hub").setEmoji("⬅️").setStyle(ButtonStyle.Secondary),
  );
}

async function buildView(interaction: AnyInteraction, action: Action) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const rows: ActionRowBuilder<any>[] = [actionRow(action)];
  let embeds: EmbedBuilder[];

  switch (action) {
    case "info": {
      const res = await buildSquadInfoEmbed(guildId, userId);
      embeds = ["error" in res
        ? [new EmbedBuilder().setTitle("🎖️ My Squad").setColor(0x2c3e50).setDescription(res.error)][0]
        : res];
      break;
    }
    case "list": {
      const embed = await buildSquadListEmbed(guildId);
      embeds = [embed ?? new EmbedBuilder().setTitle("🏆 Squad Leaderboard").setColor(0xf1c40f).setDescription("No squads yet. Found the first with **Create Squad**!")];
      break;
    }
    case "join": {
      const choices = await squadChoices(guildId);
      if (choices.length === 0) {
        embeds = [new EmbedBuilder().setTitle("🤝 Join a Squad").setColor(0x2c3e50).setDescription("No squads to join yet. Create one!")];
      } else {
        embeds = [new EmbedBuilder().setTitle("🤝 Join a Squad").setColor(0x2c3e50).setDescription("Pick a squad below to join it.")];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("squad-hub:join-pick").setPlaceholder("Pick a squad to join…")
            .addOptions(choices.slice(0, 25).map(c => ({ label: c.label, value: c.name, description: `${c.members} member${c.members === 1 ? "" : "s"}` }))),
        ));
      }
      break;
    }
    default:
      embeds = [new EmbedBuilder().setTitle("🤝 Squad Hub").setColor(0x2c3e50)];
  }

  rows.push(backRow());
  return { embeds, components: rows };
}

// ── Modal + confirms ──────────────────────────────────────────────────────────
async function showCreateModal(interaction: StringSelectMenuInteraction) {
  const modal = new ModalBuilder().setCustomId("squad-hub:modal:create").setTitle("Create a Squad");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Squad name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40).setPlaceholder("At least 2 characters"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("tag").setLabel("Tag (optional, max 6)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(6),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("Description (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200),
    ),
  );
  await interaction.showModal(modal);
}

async function confirmLeave(interaction: StringSelectMenuInteraction) {
  await interaction.update({
    embeds: [new EmbedBuilder().setTitle("👋 Leave Squad").setColor(0xe67e22).setDescription("Are you sure you want to leave your squad? If you're the leader, leadership passes to the next member (or the squad disbands if you're the last one).")],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("squad-hub:leave-confirm").setLabel("Yes, leave").setEmoji("👋").setStyle(ButtonStyle.Danger),
      ),
      actionRow("leave"),
      backRow(),
    ],
  }).catch(() => {});
}

async function confirmDisband(interaction: StringSelectMenuInteraction) {
  await interaction.update({
    embeds: [new EmbedBuilder().setTitle("💥 Disband Squad").setColor(0xe74c3c).setDescription("**Leader only.** This permanently deletes the squad for everyone. Are you sure?")],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("squad-hub:disband-confirm").setLabel("Yes, disband").setEmoji("💥").setStyle(ButtonStyle.Danger),
      ),
      actionRow("disband"),
      backRow(),
    ],
  }).catch(() => {});
}
