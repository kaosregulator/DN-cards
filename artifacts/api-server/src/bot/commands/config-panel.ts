import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings, isAdmin } from "../db.js";
import { scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { RARITY_WEIGHTS, type Rarity } from "../cards-data.js";
import type { GuildSettings } from "@workspace/db";

const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const RARITY_EMOJI: Record<Rarity, string> = {
  common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡",
};
// Weight options offered per rarity (preset menu). `null` = "Default" (use card's default).
const RARITY_WEIGHT_OPTIONS: Record<Rarity, (number | null)[]> = {
  common:    [null, 80, 60, 40, 20, 5],
  uncommon:  [null, 40, 25, 15, 5,  1],
  rare:      [null, 20, 10, 5,  2,  1],
  epic:      [null, 10, 4,  2,  1,  0],
  legendary: [null, 5,  3,  1,  0],
};

function rarityWeightKey(r: Rarity): keyof GuildSettings {
  return (`rarityWeight${r[0]!.toUpperCase()}${r.slice(1)}` as keyof GuildSettings);
}
function getRarityWeight(s: GuildSettings, r: Rarity): number | null {
  return (s[rarityWeightKey(r)] as number | null) ?? null;
}
function effectiveWeight(s: GuildSettings, r: Rarity): number {
  return getRarityWeight(s, r) ?? RARITY_WEIGHTS[r];
}

// ── Public entry: /config command opens the ephemeral panel ──────────────────
export async function handleConfigCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const settings = await getOrCreateGuildSettings(interaction.guild.id);
  await interaction.reply({
    embeds: [buildConfigEmbed(settings)],
    components: buildConfigComponents(settings),
    flags: MessageFlags.Ephemeral,
  });
}

// ── Router: select-menu interactions on the panel ────────────────────────────
export async function handleConfigSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const guildId = interaction.guild.id;
  const action = interaction.customId; // "config_mode" | "config_drops" | "config_interval" | "config_window"
  const value = interaction.values[0];

  const patch: Partial<GuildSettings> = {};
  if (action === "config_mode") {
    patch.catchMode = value;
  } else if (action === "config_drops") {
    patch.cardsPerSpawn = parseInt(value, 10);
  } else if (action === "config_interval") {
    patch.useRandomInterval = false;
    patch.spawnIntervalSeconds = parseInt(value, 10);
  } else if (action === "config_window") {
    patch.catchWindowSeconds = parseInt(value, 10);
  }

  await updateGuildSettings(guildId, patch);
  // Interval change → reschedule timer
  if (action === "config_interval") scheduleNextSpawn(guildId);

  await refreshPanel(interaction, guildId);
}

// ── Router: button interactions on the panel ─────────────────────────────────
export async function handleConfigButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const guildId = interaction.guild.id;
  const [, action, arg] = interaction.customId.split(":"); // "config:toggle:spawn"

  if (action === "toggle" && arg === "spawn") {
    const s = await getOrCreateGuildSettings(guildId);
    const next = !s.spawnEnabled;
    await updateGuildSettings(guildId, { spawnEnabled: next });
    if (next) scheduleNextSpawn(guildId);
    else clearSpawnTimer(guildId);
  } else if (action === "toggle" && arg === "trade") {
    const s = await getOrCreateGuildSettings(guildId);
    await updateGuildSettings(guildId, { tradeEnabled: !s.tradeEnabled });
  } else if (action === "channel" && arg === "spawn") {
    await updateGuildSettings(guildId, { spawnChannelId: interaction.channelId });
    scheduleNextSpawn(guildId);
  } else if (action === "channel" && arg === "trade") {
    await updateGuildSettings(guildId, { tradeChannelId: interaction.channelId });
  } else if (action === "rates") {
    // Open the drop-rates sub-panel as a *new* ephemeral message so the
    // main config panel stays open underneath.
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.reply({
      embeds: [buildRatesEmbed(settings)],
      components: buildRatesComponents(settings),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await refreshPanel(interaction, guildId);
}

// ── Router: drop-rates sub-panel selects ─────────────────────────────────────
export async function handleRatesSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const guildId = interaction.guild.id;
  const rarity = interaction.customId.slice("rates_".length) as Rarity;
  if (!RARITY_ORDER.includes(rarity)) return;

  const raw = interaction.values[0];
  const weight: number | null = raw === "default" ? null : parseInt(raw!, 10);
  await updateGuildSettings(guildId, { [rarityWeightKey(rarity)]: weight } as Partial<GuildSettings>);

  const settings = await getOrCreateGuildSettings(guildId);
  await interaction.update({
    embeds: [buildRatesEmbed(settings)],
    components: buildRatesComponents(settings),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function refreshPanel(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  guildId: string,
): Promise<void> {
  const settings = await getOrCreateGuildSettings(guildId);
  await interaction.update({
    embeds: [buildConfigEmbed(settings)],
    components: buildConfigComponents(settings),
  });
}

async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
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
      content: "❌ Only admins can use the config panel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
  return allowed;
}

function buildConfigEmbed(s: GuildSettings): EmbedBuilder {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";
  const modeLabel = ({
    type: "✍️ **Typing** — type the card name (lag-fair, earliest sent wins)",
    button: "🎯 **Button** — click 🎯 Claim (position randomizes each spawn)",
    both: "✍️ + 🎯 **Both** — typing OR button, whichever lands first",
  } as Record<string, string>)[catchMode];

  const dropsLabel = s.cardsPerSpawn === -1 ? "Random 1–3" : `${s.cardsPerSpawn} per batch`;
  const intervalLabel = s.useRandomInterval
    ? `Random ${formatSec(s.spawnIntervalMin ?? 0)}–${formatSec(s.spawnIntervalMax ?? 0)}`
    : formatSec(s.spawnIntervalSeconds);

  return new EmbedBuilder()
    .setTitle("⚙️ DN Cards — Server Config")
    .setColor(0x5865f2)
    .setDescription("Pick options below — changes save instantly.")
    .addFields(
      { name: "🎯 Catch Mode", value: modeLabel, inline: false },
      { name: "📦 Cards per Spawn", value: dropsLabel, inline: true },
      { name: "⏱️ Spawn Interval", value: intervalLabel, inline: true },
      { name: "🪟 Catch Window", value: formatSec(s.catchWindowSeconds), inline: true },
      {
        name: "📢 Spawn Channel",
        value: s.spawnChannelId ? `<#${s.spawnChannelId}>` : "❌ Not set — click **Set spawn here**",
        inline: true,
      },
      {
        name: "💬 Trade Channel",
        value: s.tradeChannelId ? `<#${s.tradeChannelId}>` : "Any channel",
        inline: true,
      },
      {
        name: "🎲 Drop Rates (weight, % chance)",
        value: rarityWeightsSummary(s),
        inline: false,
      },
      {
        name: "Toggles",
        value:
          `${s.spawnEnabled ? "✅" : "⏸️"} Auto-Spawning · ` +
          `${s.tradeEnabled ? "✅" : "⏸️"} Trading`,
        inline: false,
      },
    )
    .setFooter({ text: "Only you can see this panel. It stays open as long as Discord keeps it." });
}

function buildConfigComponents(s: GuildSettings) {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId("config_mode")
    .setPlaceholder("🎯 Catch Mode")
    .addOptions(
      { label: "Typing (lag-fair)", value: "type", description: "Type the card name; earliest sent wins", emoji: "✍️", default: catchMode === "type" },
      { label: "Button (anti-camp)", value: "button", description: "Click 🎯 Claim; position randomizes", emoji: "🎯", default: catchMode === "button" },
      { label: "Both", value: "both", description: "Type OR click — whichever first", emoji: "🔀", default: catchMode === "both" },
    );

  const dropsSelect = new StringSelectMenuBuilder()
    .setCustomId("config_drops")
    .setPlaceholder("📦 Cards per spawn")
    .addOptions(
      { label: "1 card", value: "1", default: s.cardsPerSpawn === 1 },
      { label: "3 cards", value: "3", default: s.cardsPerSpawn === 3 },
      { label: "5 cards", value: "5", default: s.cardsPerSpawn === 5 },
      { label: "Random 1–3", value: "-1", default: s.cardsPerSpawn === -1 },
    );

  const intervalOpts: { label: string; sec: number }[] = [
    { label: "Every 15 minutes", sec: 15 * 60 },
    { label: "Every 30 minutes", sec: 30 * 60 },
    { label: "Every 1 hour", sec: 60 * 60 },
    { label: "Every 2 hours", sec: 2 * 60 * 60 },
    { label: "Every 3 hours", sec: 3 * 60 * 60 },
    { label: "Every 6 hours", sec: 6 * 60 * 60 },
  ];
  const intervalSelect = new StringSelectMenuBuilder()
    .setCustomId("config_interval")
    .setPlaceholder("⏱️ Spawn interval")
    .addOptions(
      intervalOpts.map(o => ({
        label: o.label, value: String(o.sec),
        default: !s.useRandomInterval && s.spawnIntervalSeconds === o.sec,
      })),
    );

  const windowOpts: { label: string; sec: number }[] = [
    { label: "30 seconds", sec: 30 },
    { label: "1 minute", sec: 60 },
    { label: "2 minutes", sec: 120 },
    { label: "5 minutes", sec: 300 },
    { label: "10 minutes", sec: 600 },
  ];
  const windowSelect = new StringSelectMenuBuilder()
    .setCustomId("config_window")
    .setPlaceholder("🪟 Catch window")
    .addOptions(
      windowOpts.map(o => ({
        label: o.label, value: String(o.sec),
        default: s.catchWindowSeconds === o.sec,
      })),
    );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config:toggle:spawn")
      .setLabel(s.spawnEnabled ? "⏸️ Pause Spawning" : "▶️ Start Spawning")
      .setStyle(s.spawnEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("config:toggle:trade")
      .setLabel(s.tradeEnabled ? "⏸️ Pause Trading" : "▶️ Enable Trading")
      .setStyle(s.tradeEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("config:channel:spawn")
      .setLabel("📢 Spawn here")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("config:channel:trade")
      .setLabel("💬 Trade here")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("config:rates:open")
      .setLabel("🎲 Drop Rates")
      .setStyle(ButtonStyle.Primary),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropsSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(intervalSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(windowSelect),
    buttons,
  ];
}

function formatSec(sec: number): string {
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

// ── Drop rates sub-panel (also reused by the !setup wizard) ─────────────────
export { buildRatesEmbed, buildRatesComponents };
function rarityWeightsSummary(s: GuildSettings): string {
  const weights = RARITY_ORDER.map(r => effectiveWeight(s, r));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return RARITY_ORDER.map((r, i) => {
    const w = weights[i]!;
    const pct = ((w / total) * 100).toFixed(1);
    const override = getRarityWeight(s, r) !== null ? "" : " *(default)*";
    return `${RARITY_EMOJI[r]} **${capitalize(r)}** — weight ${w} · **${pct}%**${override}`;
  }).join("\n");
}

function buildRatesEmbed(s: GuildSettings): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🎲 Drop Rates — Per-Rarity Weights")
    .setColor(0xeb459e)
    .setDescription(
      "Pick a weight for each rarity. Higher weight = more common.\n" +
      "**Defaults:** Common 60 · Uncommon 25 · Rare 10 · Epic 4 · Legendary 1.\n" +
      "Percentages below are calculated relative to the totals.",
    )
    .addFields({ name: "Current rates", value: rarityWeightsSummary(s), inline: false })
    .setFooter({ text: "Only you can see this. Changes save instantly." });
}

function buildRatesComponents(s: GuildSettings) {
  const rows = RARITY_ORDER.map(r => {
    const current = getRarityWeight(s, r);
    const opts = RARITY_WEIGHT_OPTIONS[r].map(w => {
      if (w === null) {
        return {
          label: `Default (${RARITY_WEIGHTS[r]})`,
          value: "default",
          description: "Use the card's default weight",
          default: current === null,
        };
      }
      return {
        label: `Weight ${w}`,
        value: String(w),
        description: w === 0 ? "Disable this rarity from random drops" : undefined,
        default: current === w,
      };
    });
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rates_${r}`)
      .setPlaceholder(`${RARITY_EMOJI[r]} ${capitalize(r)} weight`)
      .addOptions(opts);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  });
  return rows;
}

function capitalize(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}
