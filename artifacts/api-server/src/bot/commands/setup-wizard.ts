import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
  type Message, type ChatInputCommandInteraction,
  type ButtonInteraction, type StringSelectMenuInteraction,
  type ModalSubmitInteraction, type GuildMember,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";
import {
  isAdmin, getOrCreateGuildSettings, updateGuildSettings, addCard,
  loadDefaultCards, unloadDefaultCards, listSets, DEFAULTS_SET_NAME,
} from "../db.js";
import { spawnCard, scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { DEFAULT_CARDS, RARITY_WEIGHTS, type Rarity } from "../cards-data.js";
import { buildRatesEmbed, buildRatesComponents } from "./config-panel.js";

// The setup wizard is a single ephemeral panel that mirrors the config panel
// but adds first-run conveniences (load defaults, test drop) and bigger
// section labels. Reuses the same data store, so changes persist immediately.

// ── Entry: !setup ─────────────────────────────────────────────────────────────
export async function startSetupWizard(msg: Message): Promise<void> {
  if (!msg.guild) return;
  const settings = await getOrCreateGuildSettings(msg.guild.id);
  const hasDefaults = await defaultsLoaded();
  await msg.reply({
    embeds: [buildSetupEmbed(settings, hasDefaults)],
    components: buildSetupComponents(settings, hasDefaults),
  });
}

// ── Entry: /setup (slash) ─────────────────────────────────────────────────────────────────────────────
export async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdminSlash(interaction);
  if (!ok) return;
  const settings = await getOrCreateGuildSettings(interaction.guild.id);
  const hasDefaults = await defaultsLoaded();
  await interaction.reply({
    embeds: [buildSetupEmbed(settings, hasDefaults)],
    components: buildSetupComponents(settings, hasDefaults),
    flags: MessageFlags.Ephemeral,
  });
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleSetupButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (!(await ensureAdmin(interaction))) return;

  const guildId = interaction.guild.id;
  const [, action, arg] = interaction.customId.split(":");

  if (action === "toggle" && arg === "spawn") {
    const s = await getOrCreateGuildSettings(guildId);
    const next = !s.spawnEnabled;
    await updateGuildSettings(guildId, { spawnEnabled: next });
    if (next) scheduleNextSpawn(guildId); else clearSpawnTimer(guildId);
  } else if (action === "toggle" && arg === "trade") {
    const s = await getOrCreateGuildSettings(guildId);
    await updateGuildSettings(guildId, { tradeEnabled: !s.tradeEnabled });
  } else if (action === "channel" && arg === "spawn") {
    await updateGuildSettings(guildId, { spawnChannelId: interaction.channelId });
    scheduleNextSpawn(guildId);
  } else if (action === "channel" && arg === "trade") {
    await updateGuildSettings(guildId, { tradeChannelId: interaction.channelId });
  } else if (action === "loaddefaults") {
    const { added, skipped } = await loadDefaultCards();
    // Update the panel FIRST (consumes the interaction), then followUp the toast.
    await refreshPanel(interaction, guildId);
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.followUp({
      content: `📦 Loaded the built-in roster — added **${added}** cards` +
        (skipped > 0 ? ` (skipped **${skipped}** already in your roster).` : ".") +
        `\nRemove anytime with the **🗑️ Remove Defaults** button or \`${settings.commandPrefix}unloaddefaults\` / \`/unloadset set:${DEFAULTS_SET_NAME}\`.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
    return;
  } else if (action === "cleardefaults") {
    const { removed } = await unloadDefaultCards();
    await refreshPanel(interaction, guildId);
    await interaction.followUp({
      content: `🗑️ Removed **${removed}** built-in default cards. Your custom cards are untouched.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
    return;
  } else if (action === "rates") {
    // Open the rarity rates sub-panel (re-uses the config-panel helpers; the
    // rates_<rarity> selects already route through handleRatesSelect).
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.reply({
      embeds: [buildRatesEmbed(settings)],
      components: buildRatesComponents(settings),
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
    return;
  } else if (action === "testdrop") {
    // Open a modal to collect a test-card name. Spawning happens on submit.
    const modal = new ModalBuilder()
      .setCustomId("setup_testcard")
      .setTitle("🧪 Test Drop")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("card_name")
            .setLabel("Test card name (will be droppable=false)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Setup Test")
            .setRequired(true)
            .setMaxLength(64),
        ),
      );
    await interaction.showModal(modal).catch(() => { /* ignore */ });
    return;
  } else if (action === "done") {
    const settings = await getOrCreateGuildSettings(guildId);
    if (!settings.spawnChannelId) {
      await interaction.reply({
        content: "❌ Pick a spawn channel first — go to your drops channel and click **📢 Spawn here**.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => { /* ignore */ });
      return;
    }
    await updateGuildSettings(guildId, { spawnEnabled: true });
    scheduleNextSpawn(guildId);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ DN Cards is ready!")
          .setColor(0x57f287)
          .setDescription(
            `Drops are live in <#${settings.spawnChannelId}>.\n\n` +
            `**Next steps**\n` +
            `• Add cards: \`${s.commandPrefix}addcard\` · \`${s.commandPrefix}addlimited\` · \`${s.commandPrefix}addevent\`\n` +
            `• Force a drop: \`/drop\` · Mass drop: \`/massdrop\`\n` +
            `• Re-open this panel anytime with \`${s.commandPrefix}setup\` or \`/config\`\n` +
            `• Player help: \`/help\` · Admin help: \`/adminhelp\``,
          ),
      ],
      components: [],
    }).catch(() => { /* ignore */ });
    return;
  }

  await refreshPanel(interaction, guildId);
}

// ── Select handler ────────────────────────────────────────────────────────────
export async function handleSetupSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (!(await ensureAdmin(interaction))) return;

  const guildId = interaction.guild.id;
  const action = interaction.customId;
  const value = interaction.values[0]!;

  const patch: Partial<GuildSettings> = {};
  if (action === "setup_mode") patch.catchMode = value;
  else if (action === "setup_drops") patch.cardsPerSpawn = parseInt(value, 10);
  else if (action === "setup_interval") {
    patch.useRandomInterval = false;
    patch.spawnIntervalSeconds = parseInt(value, 10);
  } else if (action === "setup_window") patch.catchWindowSeconds = parseInt(value, 10);

  await updateGuildSettings(guildId, patch);
  if (action === "setup_interval") scheduleNextSpawn(guildId);
  await refreshPanel(interaction, guildId);
}

// ── Modal handler (test card creation) ───────────────────────────────────────
export async function handleSetupModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (interaction.customId !== "setup_testcard") return;
  if (!(await ensureAdminModal(interaction))) return;

  const guildId = interaction.guild.id;
  const settings = await getOrCreateGuildSettings(guildId);
  if (!settings.spawnChannelId) {
    await interaction.reply({
      content: "❌ Pick a spawn channel first — click **📢 Spawn here** in your drops channel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
    return;
  }

  const name = interaction.fields.getTextInputValue("card_name").slice(0, 64).trim();
  if (!name) {
    await interaction.reply({ content: "❌ Card name was empty.", flags: MessageFlags.Ephemeral }).catch(() => { /* ignore */ });
    return;
  }

  try {
    const card = await addCard({
      name,
      description: `A test card created during setup. Safe to remove with \`${settings.commandPrefix}removecard ${name}\`.`,
      rarity: "common",
      cardType: "infantry",
      dropWeight: 60,
      worthValue: 10,
      burnValue: 5,
      droppable: false,
    });
    await spawnCard(guildId, card.id, true);
    await interaction.reply({
      content: `🧪 Test card **${name}** dropped in <#${settings.spawnChannelId}>. Go catch it!\nClean up later with \`${settings.commandPrefix}removecard ${name}\`.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  } catch {
    await interaction.reply({
      content: "⚠️ Couldn't create the test card — a card with that name probably exists already. Try a different name.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function defaultsLoaded(): Promise<boolean> {
  const sets = await listSets();
  return sets.some(s => s.setName === DEFAULTS_SET_NAME && s.cardCount > 0);
}

async function refreshPanel(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  guildId: string,
): Promise<void> {
  const settings = await getOrCreateGuildSettings(guildId);
  const hasDefaults = await defaultsLoaded();
  await interaction.update({
    embeds: [buildSetupEmbed(settings, hasDefaults)],
    components: buildSetupComponents(settings, hasDefaults),
  }).catch(() => { /* may already be replied/updated */ });
}

async function ensureAdmin(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<boolean> {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    member.permissions.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    await interaction.reply({
      content: "❌ Only admins can use the setup panel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
  return allowed;
}

async function ensureAdminModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const member = (interaction.member as GuildMember | null);
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    member?.permissions.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    await interaction.reply({
      content: "❌ Admins only.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
  return !!allowed;
}

async function ensureAdminSlash(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const member = interaction.member as GuildMember | null;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    member?.permissions.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    await interaction.reply({
      content: "❌ Only admins can use the setup panel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
  return allowed;
}

function formatSec(sec: number): string {
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

// ── Embed + components ───────────────────────────────────────────────────────
function buildSetupEmbed(s: GuildSettings, hasDefaults: boolean): EmbedBuilder {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";
  const modeLabel = ({
    type: "✍️ Typing",
    button: "🎯 Button (anti-camp)",
    both: "✍️ + 🎯 Both",
  } as Record<string, string>)[catchMode];

  const dropsLabel = s.cardsPerSpawn === -1 ? "Random 1–3" : `${s.cardsPerSpawn} per batch`;
  const intervalLabel = s.useRandomInterval
    ? `Random ${formatSec(s.spawnIntervalMin ?? 0)}–${formatSec(s.spawnIntervalMax ?? 0)}`
    : formatSec(s.spawnIntervalSeconds);

  const defaultsLine = hasDefaults
    ? `✅ Built-in 27-card roster is **loaded** *(use 🗑️ to remove)*`
    : `📦 No built-in defaults loaded *(use 📜 to load all ${DEFAULT_CARDS.length} or skip — your `+
      `\`${s.commandPrefix}addcard\` cards work without them)*`;

  return new EmbedBuilder()
    .setTitle("🃏 DN Cards — Setup Panel")
    .setColor(0x5865f2)
    .setDescription(
      "Configure your server below. **Every change saves instantly** — no need to confirm.\n" +
      "When you're done, click **✅ Finish** to enable spawning and close this panel.",
    )
    .addFields(
      {
        name: "📢 Spawn Channel",
        value: s.spawnChannelId
          ? `<#${s.spawnChannelId}>`
          : "❌ Not set — go to your drops channel and click **📢 Spawn here**",
        inline: true,
      },
      {
        name: "💬 Trade Channel",
        value: s.tradeChannelId ? `<#${s.tradeChannelId}>` : "Any channel",
        inline: true,
      },
      {
        name: "🎯 Catch Mode",
        value: modeLabel ?? "✍️ Typing",
        inline: true,
      },
      { name: "📦 Cards / Drop", value: dropsLabel, inline: true },
      { name: "⏱️ Interval", value: intervalLabel, inline: true },
      { name: "🪟 Catch Window", value: formatSec(s.catchWindowSeconds), inline: true },
      {
        name: "Toggles",
        value:
          `${s.spawnEnabled ? "✅" : "⏸️"} Auto-Spawning · ` +
          `${s.tradeEnabled ? "✅" : "⏸️"} Trading`,
        inline: false,
      },
      { name: "📜 Card Roster", value: defaultsLine, inline: false },
      {
        name: "🎲 Drop Rates",
        value: `Click **🎲 Drop Rates** to fine-tune rarity weights (defaults: ` +
          `Common ${RARITY_WEIGHTS.common} · Uncommon ${RARITY_WEIGHTS.uncommon} · ` +
          `Rare ${RARITY_WEIGHTS.rare} · Epic ${RARITY_WEIGHTS.epic} · ` +
          `Legendary ${RARITY_WEIGHTS.legendary})`,
        inline: false,
      },
    )
    .setFooter({ text: "Only you can see this panel. It stays open until Discord retires it (~15 min)." });
}

function buildSetupComponents(s: GuildSettings, hasDefaults: boolean) {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId("setup_mode")
    .setPlaceholder("🎯 Catch Mode")
    .addOptions(
      { label: "Typing (lag-fair)", value: "type", emoji: "✍️", default: catchMode === "type" },
      { label: "Button (anti-camp)", value: "button", emoji: "🎯", default: catchMode === "button" },
      { label: "Both", value: "both", emoji: "🔀", default: catchMode === "both" },
    );

  const dropsSelect = new StringSelectMenuBuilder()
    .setCustomId("setup_drops")
    .setPlaceholder("📦 Cards per spawn")
    .addOptions(
      { label: "1 card", value: "1", default: s.cardsPerSpawn === 1 },
      { label: "3 cards", value: "3", default: s.cardsPerSpawn === 3 },
      { label: "5 cards", value: "5", default: s.cardsPerSpawn === 5 },
      { label: "Random 1–3", value: "-1", default: s.cardsPerSpawn === -1 },
    );

  const intervalOpts = [
    { label: "Every 5 minutes", sec: 5 * 60 },
    { label: "Every 15 minutes", sec: 15 * 60 },
    { label: "Every 30 minutes", sec: 30 * 60 },
    { label: "Every 1 hour", sec: 60 * 60 },
    { label: "Every 2 hours", sec: 2 * 60 * 60 },
    { label: "Every 6 hours", sec: 6 * 60 * 60 },
  ];
  const intervalSelect = new StringSelectMenuBuilder()
    .setCustomId("setup_interval")
    .setPlaceholder("⏱️ Spawn interval")
    .addOptions(intervalOpts.map(o => ({
      label: o.label, value: String(o.sec),
      default: !s.useRandomInterval && s.spawnIntervalSeconds === o.sec,
    })));

  const windowOpts = [
    { label: "30 seconds", sec: 30 },
    { label: "1 minute", sec: 60 },
    { label: "2 minutes", sec: 120 },
    { label: "5 minutes", sec: 300 },
    { label: "10 minutes", sec: 600 },
  ];
  const windowSelect = new StringSelectMenuBuilder()
    .setCustomId("setup_window")
    .setPlaceholder("🪟 Catch window")
    .addOptions(windowOpts.map(o => ({
      label: o.label, value: String(o.sec),
      default: s.catchWindowSeconds === o.sec,
    })));

  // Row of channel/toggle/utility buttons.
  const channelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("setup:channel:spawn")
      .setLabel("📢 Spawn here")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("setup:channel:trade")
      .setLabel("💬 Trade here")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("setup:toggle:spawn")
      .setLabel(s.spawnEnabled ? "⏸️ Pause Spawns" : "▶️ Enable Spawns")
      .setStyle(s.spawnEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("setup:toggle:trade")
      .setLabel(s.tradeEnabled ? "⏸️ Pause Trading" : "▶️ Enable Trading")
      .setStyle(s.tradeEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("setup:rates")
      .setLabel("🎲 Drop Rates")
      .setStyle(ButtonStyle.Primary),
  );

  // Row of "extras" — load defaults, test, finish.
  const extrasRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    hasDefaults
      ? new ButtonBuilder()
          .setCustomId("setup:cleardefaults")
          .setLabel("🗑️ Remove Defaults")
          .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
          .setCustomId("setup:loaddefaults")
          .setLabel(`📜 Load ${DEFAULT_CARDS.length} Defaults`)
          .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("setup:testdrop")
      .setLabel("🧪 Test Drop")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("setup:done")
      .setLabel("✅ Finish")
      .setStyle(ButtonStyle.Success),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropsSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(intervalSelect),
    channelRow,
    extrasRow,
  ];
  // Note: 5 rows max per Discord message. We dropped the window-select row
  // intentionally — catch window is rarely touched after first setup, and is
  // still editable from /config which has fewer buttons.
  // (windowSelect kept above for future use; unused vars are stripped by tsc.)
  void windowSelect;
}
