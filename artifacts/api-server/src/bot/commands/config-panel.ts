import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings, isAdmin } from "../db.js";
import { scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { RARITY_WEIGHTS, RARITY_LABELS, type Rarity } from "../cards-data.js";
import type { GuildSettings } from "@workspace/db";
import { PACK_TIERS, PACK_TIER_META, PACK_DEFAULTS, resolveTierConfig, type PackTier } from "./pack.js";

// Rarity display order in the panel (least → most rare).
// DB enum key "epic" is labelled "Exotic" via RARITY_LABELS — Rare is the rarest tier.
const RARITY_ORDER: Rarity[] = ["common", "uncommon", "epic", "legendary", "rare", "mythic"];
// Discord caps an action-row count at 5 per message AND 5 per modal, so the
// interactive rate-mix controls can only expose 5 rarities. Mythic is the
// admin-only top tier (default weight 0) and is configured via the dashboard
// or `/event` boosts instead — see replit.md > Mythic tier.
const UI_RARITY_ORDER: Rarity[] = ["common", "uncommon", "epic", "legendary", "rare"];
const RARITY_EMOJI: Record<Rarity, string> = {
  common: "⚪", uncommon: "🟢", epic: "🟣", legendary: "🟡", rare: "🔴", mythic: "🔮",
};
// Percentage options offered per rarity (preset menu). `null` = "Default" (use card's default).
// Stored internally as weights — when the values sum to 100, weight == percent exactly.
const RARITY_WEIGHT_OPTIONS: Record<Rarity, (number | null)[]> = {
  common:    [null, 80, 70, 60, 50, 40, 30, 20, 10, 5],
  uncommon:  [null, 40, 30, 25, 20, 15, 10, 5,  1],
  epic:      [null, 20, 15, 10, 8,  5,  3,  2,  1],     // Exotic — mid tier
  legendary: [null, 15, 10, 8,  6,  4,  3,  2,  1, 0],
  rare:      [null, 10, 5,  3,  2,  1,  0],              // Rare — second-rarest
  mythic:    [null, 5,  3,  2,  1,  0],                  // Mythic — admin-only by default (0)
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

// ── Public entry: /config command opens the ephemeral panel ───────────────────────────────────────────
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

// ── Router: select-menu interactions on the panel ─────────────────────────────────────────────────────────────────
export async function handleConfigSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const guildId = interaction.guild.id;
  const action = interaction.customId;
  const value = interaction.values[0];

  const patch: Partial<GuildSettings> = {};
  if (action === "config_mode") {
    patch.catchMode = value;
  } else if (action === "config_drops") {
    patch.cardsPerSpawn = parseInt(value!, 10);
  } else if (action === "config_interval") {
    patch.useRandomInterval = false;
    patch.spawnIntervalSeconds = parseInt(value!, 10);
  } else if (action === "config_window") {
    patch.catchWindowSeconds = parseInt(value!, 10);
  }

  await updateGuildSettings(guildId, patch);
  if (action === "config_interval") scheduleNextSpawn(guildId);

  await refreshPanel(interaction, guildId);
}

// ── Router: button interactions on the panel ──────────────────────────────────────────────────────────────────
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
    if (arg === "reset") {
      const resetPatch: Partial<GuildSettings> = {};
      for (const r of RARITY_ORDER) {
        (resetPatch as Record<string, number | null>)[rarityWeightKey(r) as string] = null;
      }
      await updateGuildSettings(guildId, resetPatch);
      await refreshPanel(interaction, guildId);
      await interaction.followUp({
        content: "🔄 Rarity Mix reset to defaults — Common 60% · Uncommon 25% · Exotic 10% · Legendary 4% · Rare 1%.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => { /* ignore */ });
      return;
    }
    if (arg === "custom") {
      const settings = await getOrCreateGuildSettings(guildId);
      await interaction.showModal(buildCustomMixModal(settings));
      return;
    }
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.reply({
      embeds: [buildRatesEmbed(settings)],
      components: buildRatesComponents(settings),
      flags: MessageFlags.Ephemeral,
    });
    return;
  } else if (action === "packs") {
    const settings = await getOrCreateGuildSettings(guildId);
    if (arg === "sizes") {
      await interaction.update({
        embeds: [buildPacksSizesEmbed(settings)],
        components: buildPacksSizesComponents(settings),
      });
    } else if (arg === "limits") {
      await interaction.update({
        embeds: [buildPacksLimitsEmbed(settings)],
        components: buildPacksLimitsComponents(settings),
      });
    } else if (arg === "back") {
      await interaction.update({
        embeds: [buildPacksEmbed(settings)],
        components: buildPacksComponents(settings),
      });
    } else {
      await interaction.reply({
        embeds: [buildPacksEmbed(settings)],
        components: buildPacksComponents(settings),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  await refreshPanel(interaction, guildId);
}

// ── Router: packs sub-panel selects ──────────────────────────────────────────────────────────────────
export async function handlePacksSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const ok = await ensureAdmin(interaction);
  if (!ok) return;

  const guildId = interaction.guild.id;
  const id = interaction.customId;
  const value = parseInt(interaction.values[0]!, 10);

  let panel: "main" | "sizes" | "limits" = "main";
  const patch: Partial<GuildSettings> = {};
  if (id === "packs_cooldown") {
    patch.packCooldownSeconds = value;
  } else if (id.startsWith("packs_cost_")) {
    const tier = id.slice("packs_cost_".length) as PackTier;
    if (tier === "basic")     patch.packBasicCost = value;
    if (tier === "premium")   patch.packPremiumCost = value;
    if (tier === "legendary") patch.packLegendaryCost = value;
  } else if (id.startsWith("packs_size_")) {
    panel = "sizes";
    const tier = id.slice("packs_size_".length) as PackTier;
    if (tier === "basic")     patch.packBasicSize = value;
    if (tier === "premium")   patch.packPremiumSize = value;
    if (tier === "legendary") patch.packLegendarySize = value;
  } else if (id.startsWith("packs_limit_")) {
    panel = "limits";
    const tier = id.slice("packs_limit_".length) as PackTier;
    if (tier === "basic")     patch.packBasicWeeklyLimit = value;
    if (tier === "premium")   patch.packPremiumWeeklyLimit = value;
    if (tier === "legendary") patch.packLegendaryWeeklyLimit = value;
  } else {
    return;
  }

  await updateGuildSettings(guildId, patch);
  const settings = await getOrCreateGuildSettings(guildId);
  if (panel === "sizes") {
    await interaction.update({ embeds: [buildPacksSizesEmbed(settings)], components: buildPacksSizesComponents(settings) });
  } else if (panel === "limits") {
    await interaction.update({ embeds: [buildPacksLimitsEmbed(settings)], components: buildPacksLimitsComponents(settings) });
  } else {
    await interaction.update({ embeds: [buildPacksEmbed(settings)], components: buildPacksComponents(settings) });
  }
}

// ── Router: drop-rates sub-panel selects ─────────────────────────────────────────────────────────────────
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

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
  // IMPORTANT: do NOT call interaction.guild.members.fetch() here. That's a
  // network round-trip that under cold-start latency can push us past
  // Discord's 3s interaction window → DiscordAPIError[10062] "Unknown
  // interaction" → user sees "something went wrong". memberPermissions
  // is delivered inline in the interaction payload, zero RTT.
  if (!interaction.guild) return false;
  const perms = interaction.memberPermissions;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    await interaction.reply({
      content: "❌ Only admins can use the config panel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => { /* ignore */ });
  }
  return !!allowed;
}

function buildConfigEmbed(s: GuildSettings): EmbedBuilder {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";
  const modeLabel = ({
    type: "Typing",
    button: "Button",
    both: "Both",
  } as Record<string, string>)[catchMode];

  const dropsLabel = s.cardsPerSpawn === -1 ? "Random 1–3" : `${s.cardsPerSpawn}`;
  const intervalLabel = s.useRandomInterval
    ? `${formatSec(s.spawnIntervalMin ?? 0)}–${formatSec(s.spawnIntervalMax ?? 0)}`
    : formatSec(s.spawnIntervalSeconds);

  const spawnOn = s.spawnEnabled && s.spawnChannelId;

  return new EmbedBuilder()
    .setTitle("⚙️ DN Cards — Config")
    .setColor(0x5865f2)
    .setDescription("Quick config — changes save instantly.")
    .addFields(
      {
        name: "📢 Spawn Channel",
        value: s.spawnChannelId ? `<#${s.spawnChannelId}>` : "Not set — click **📢 Spawn here**",
        inline: false,
      },
      {
        name: "⏱️ Channel Drop Rate",
        value: `Every ${intervalLabel}`,
        inline: true,
      },
      {
        name: "🎯 Catch Mode",
        value: modeLabel ?? "Typing",
        inline: true,
      },
      {
        name: "🛑 Catch Window",
        value: formatSec(s.catchWindowSeconds),
        inline: true,
      },
      {
        name: "📤‍📤 Drops",
        value: dropsLabel,
        inline: true,
      },
      {
        name: "👥 Trading",
        value: s.tradeEnabled ? "🟢 ON" : "🔴 OFF",
        inline: true,
      },
      {
        name: "📢 Spawning",
        value: spawnOn ? "🟢 ON" : "🔴 OFF",
        inline: true,
      },
      {
        name: "🎲 Rarity Mix (chance of each rarity when a card drops)",
        value: rarityRowsSummary(s),
        inline: false,
      },
    )
    .setFooter({ text: "Ephemeral — only you see this." });
}

function buildConfigComponents(s: GuildSettings) {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId("config_mode")
    .setPlaceholder("🎯 Catch Mode")
    .addOptions(
      { label: "Typing", value: "type", emoji: "✍️", default: catchMode === "type" },
      { label: "Button", value: "button", emoji: "🎯", default: catchMode === "button" },
      { label: "Both", value: "both", emoji: "🔀", default: catchMode === "both" },
    );

  const dropsSelect = new StringSelectMenuBuilder()
    .setCustomId("config_drops")
    .setPlaceholder("📤‍📤 Cards per spawn")
    .addOptions(
      { label: "1 card", value: "1", default: s.cardsPerSpawn === 1 },
      { label: "3 cards", value: "3", default: s.cardsPerSpawn === 3 },
      { label: "5 cards", value: "5", default: s.cardsPerSpawn === 5 },
      { label: "Random 1–3", value: "-1", default: s.cardsPerSpawn === -1 },
    );

  const intervalOpts: { label: string; sec: number }[] = [
    { label: "1 minute", sec: 1 * 60 },
    { label: "5 minutes", sec: 5 * 60 },
    { label: "10 minutes", sec: 10 * 60 },
    { label: "15 minutes", sec: 15 * 60 },
    { label: "30 minutes", sec: 30 * 60 },
    { label: "1 hour", sec: 60 * 60 },
    { label: "2 hours", sec: 2 * 60 * 60 },
    { label: "6 hours", sec: 6 * 60 * 60 },
  ];
  const intervalSelect = new StringSelectMenuBuilder()
    .setCustomId("config_interval")
    .setPlaceholder("⏱️ Channel Drop Rate — how often cards spawn")
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
    .setPlaceholder("🛑 Catch window")
    .addOptions(
      windowOpts.map(o => ({
        label: o.label, value: String(o.sec),
        default: s.catchWindowSeconds === o.sec,
      })),
    );

  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config:toggle:spawn")
      .setLabel(s.spawnEnabled ? "🟢 Spawning ON" : "🔴 Spawning OFF")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:toggle:trade")
      .setLabel(s.tradeEnabled ? "🟢 Trading ON" : "🔴 Trading OFF")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:channel:spawn")
      .setLabel("📢 Spawn here")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("config:channel:trade")
      .setLabel("💬 Trade here")
      .setStyle(ButtonStyle.Primary),
  );
  const subPanelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config:rates:open")
      .setLabel("🎲 Rarity Mix")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:rates:custom")
      .setLabel("✏️ Custom Mix")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("config:rates:reset")
      .setLabel("🔄 Reset Mix")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("config:packs:open")
      .setLabel("🎴 Packs")
      .setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropsSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(intervalSelect),
    toggleRow,
    subPanelRow,
  ];
}

function formatSec(sec: number): string {
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

// ── Drop rates sub-panel (also reused by the !setup wizard) ────────────────────────────────
export { buildRatesEmbed, buildRatesComponents };

function rarityBar(s: GuildSettings): string {
  const weights = RARITY_ORDER.map(r => effectiveWeight(s, r));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const SLOTS = 20;
  // Allocate bar slots proportional to weight; guarantee any nonzero rarity gets ≥1 slot if it fits.
  const raw = weights.map(w => (w / total) * SLOTS);
  const floors = raw.map(x => Math.floor(x));
  let used = floors.reduce((a, b) => a + b, 0);
  const remainders = raw.map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (used < SLOTS && k < remainders.length) {
    floors[remainders[k]!.i]!++;
    used++;
    k++;
  }
  const blocks: Record<Rarity, string> = {
    common: "⬜", uncommon: "🟩", rare: "🟦", epic: "🟪", legendary: "🟨", mythic: "🟥",
  };
  return RARITY_ORDER.map((r, i) => blocks[r].repeat(floors[i]!)).join("");
}

function rarityRowsSummary(s: GuildSettings): string {
  const weights = RARITY_ORDER.map(r => effectiveWeight(s, r));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return RARITY_ORDER.map((r, i) => {
    const w = weights[i]!;
    const pct = ((w / total) * 100).toFixed(1);
    const tag = getRarityWeight(s, r) === null ? " *(default)*" : "";
    return `${RARITY_EMOJI[r]} **${RARITY_LABELS[r]}** — ${pct}%${tag}`;
  }).join("\n");
}

function buildRatesEmbed(s: GuildSettings): EmbedBuilder {
  const weights = RARITY_ORDER.map(r => effectiveWeight(s, r));
  const total = weights.reduce((a, b) => a + b, 0);
  const balanced = total === 100;
  const note = balanced
    ? "✅ Your values add up to **100%** — what you pick is exactly what players see."
    : `ℹ️ Your values add up to **${total}** — Discord auto-balances them to **100%** below. ` +
      "(Pick numbers that sum to 100 to keep things simple.)";
  return new EmbedBuilder()
    .setTitle("🎲 Rarity Mix — How often each rarity drops")
    .setColor(0xeb459e)
    .setDescription(
      "Set the **% chance** for each rarity when a card spawns.\n" +
      "**Defaults:** Common 60 · Uncommon 25 · Exotic 10 · Legendary 4 · Rare 1 (= 100%)\n" +
      "_Want exact numbers? Close this and tap **✏️ Custom Mix** on the main panel._\n\n" +
      `${rarityBar(s)}\n\n` +
      note,
    )
    .addFields({ name: "Current mix", value: rarityRowsSummary(s), inline: false })
    .setFooter({ text: "Changes save instantly. To start over, close this and use 🔄 Reset Mix on the main config panel." });
}

function buildRatesComponents(s: GuildSettings) {
  // Discord caps action rows at 5 — so all 5 rarities go here, no room for a button.
  // Reset is exposed via the 🔄 Reset Mix button on the main config panel.
  // Mythic is intentionally excluded; configure it from the dashboard.
  return UI_RARITY_ORDER.map(r => {
    const current = getRarityWeight(s, r);
    const opts = RARITY_WEIGHT_OPTIONS[r].map(w => {
      if (w === null) {
        return {
          label: `Default (${RARITY_WEIGHTS[r]}%)`,
          value: "default",
          default: current === null,
        };
      }
      return {
        label: `${w}%`,
        value: String(w),
        default: current === w,
      };
    });
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rates_${r}`)
      .setPlaceholder(`${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} — % chance`)
      .addOptions(opts);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  });
}

// ── Custom Mix modal ──────────────────────────────────────────────────────────
// Lets the admin type any % for each rarity. Values can be any non-negative
// integer; if they don't sum to 100, Discord auto-normalises in the spawn engine
// (same behaviour as the preset dropdowns).
function buildCustomMixModal(s: GuildSettings): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("rates_custom")
    .setTitle("Custom Rarity Mix (sum to 100)");
  // Modals also cap at 5 rows — mythic is configured via the dashboard.
  const inputs = UI_RARITY_ORDER.map(r =>
    new TextInputBuilder()
      .setCustomId(`mix_${r}`)
      .setLabel(`${RARITY_LABELS[r]} %`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)
      .setValue(String(effectiveWeight(s, r))),
  );
  modal.addComponents(
    inputs.map(i => new ActionRowBuilder<TextInputBuilder>().addComponents(i)),
  );
  return modal;
}

export async function handleRatesCustomModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  // Use interaction.memberPermissions (inline in payload) instead of members.fetch
  // to stay inside Discord's 3s interaction window — see ensureAdmin above.
  const perms = interaction.memberPermissions;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(guildId, interaction.user.id));
  if (!allowed) {
    await interaction.reply({ content: "❌ Only admins can change the rarity mix.", flags: MessageFlags.Ephemeral });
    return;
  }

  const patch: Partial<GuildSettings> = {};
  const parsed: { r: Rarity; v: number }[] = [];
  for (const r of UI_RARITY_ORDER) {
    const raw = interaction.fields.getTextInputValue(`mix_${r}`).trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      await interaction.reply({
        content: `❌ **${RARITY_LABELS[r]}** must be a whole number from 0–100. You entered: \`${raw}\``,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    parsed.push({ r, v: n });
    (patch as Record<string, number>)[rarityWeightKey(r) as string] = n;
  }

  const sum = parsed.reduce((a, b) => a + b.v, 0);
  if (sum === 0) {
    await interaction.reply({
      content: "❌ At least one rarity must be above 0 — otherwise nothing can spawn.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await updateGuildSettings(guildId, patch);
  const settings = await getOrCreateGuildSettings(guildId);
  const summary = parsed.map(({ r, v }) => `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} **${v}**`).join(" · ");
  const note = sum === 100 ? "✅ Sums to 100%." : `ℹ️ Sums to **${sum}** — Discord will auto-balance to 100%.`;
  await interaction.reply({
    embeds: [buildRatesEmbed(settings)],
    content: `✏️ Custom Mix saved: ${summary}\n${note}`,
    flags: MessageFlags.Ephemeral,
  });
}

// ── Packs sub-panel ────────────────────────────────────────────────────────────────────────────────────────
const COOLDOWN_OPTS: { label: string; sec: number }[] = [
  { label: "No cooldown",      sec: 0 },
  { label: "30 seconds",       sec: 30 },
  { label: "1 minute (default)", sec: 60 },
  { label: "5 minutes",        sec: 300 },
  { label: "30 minutes",       sec: 1800 },
  { label: "1 hour",           sec: 3600 },
];

const COST_OPTS: Record<PackTier, number[]> = {
  basic:     [100, 250, 400, 600, 1000],
  premium:   [400, 750, 1000, 1500, 2500],
  legendary: [1000, 1500, 2000, 3000, 5000],
};

const SIZE_OPTS: number[] = [1, 3, 5, 7, 10];

const LIMIT_OPTS: { label: string; n: number }[] = [
  { label: "Unlimited", n: 0 },
  { label: "5 / week",  n: 5 },
  { label: "10 / week", n: 10 },
  { label: "20 / week", n: 20 },
  { label: "50 / week", n: 50 },
  { label: "100 / week", n: 100 },
];

function formatLimit(n: number): string {
  return n === 0 ? "Unlimited" : `${n} / week`;
}

function tierSummaryLine(s: GuildSettings, tier: PackTier): string {
  const cfg = resolveTierConfig(s, tier);
  const meta = PACK_TIER_META[tier];
  return `${meta.emoji} **${meta.label}** — 💠 ${cfg.cost.toLocaleString()} · ${cfg.size} cards · ${formatLimit(cfg.weeklyLimit)}`;
}

export function buildPacksEmbed(s: GuildSettings): EmbedBuilder {
  const cd = s.packCooldownSeconds;
  return new EmbedBuilder()
    .setTitle("🎴 Pack Store — Pricing & Limits")
    .setColor(0xfee75c)
    .setDescription(
      "Tune what `/pack` charges and how often players can open.\n" +
      "*Weekly counters reset every Monday 00:00 UTC.*",
    )
    .addFields(
      { name: "⏱️ Cooldown", value: cd === 0 ? "No cooldown" : formatSec(cd), inline: false },
      {
        name: "Current setup",
        value: PACK_TIERS.map(t => tierSummaryLine(s, t)).join("\n"),
        inline: false,
      },
      {
        name: "Tips",
        value:
          `**Defaults:** Basic 💠 ${PACK_DEFAULTS.basic.cost} · Premium 💠 ${PACK_DEFAULTS.premium.cost} · Legendary 💠 ${PACK_DEFAULTS.legendary.cost}\n` +
          "Click **📐 Cards/Pack** or **📅 Weekly Limits** for more options.",
        inline: false,
      },
    )
    .setFooter({ text: "Only you see this panel." });
}

export function buildPacksComponents(s: GuildSettings) {
  const cooldownSelect = new StringSelectMenuBuilder()
    .setCustomId("packs_cooldown")
    .setPlaceholder("⏱️ Cooldown between opens")
    .addOptions(COOLDOWN_OPTS.map(o => ({
      label: o.label, value: String(o.sec), default: s.packCooldownSeconds === o.sec,
    })));

  const costSelect = (tier: PackTier, current: number) => {
    const meta = PACK_TIER_META[tier];
    const opts = COST_OPTS[tier].map(c => ({
      label: `💠 ${c.toLocaleString()}`,
      value: String(c),
      default: current === c,
    }));
    return new StringSelectMenuBuilder()
      .setCustomId(`packs_cost_${tier}`)
      .setPlaceholder(`${meta.emoji} ${meta.label} cost`)
      .addOptions(opts);
  };

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("config:packs:sizes").setLabel("📐 Cards / Pack").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("config:packs:limits").setLabel("📅 Weekly Limits").setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(cooldownSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(costSelect("basic", s.packBasicCost)),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(costSelect("premium", s.packPremiumCost)),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(costSelect("legendary", s.packLegendaryCost)),
    buttons,
  ];
}

export function buildPacksSizesEmbed(s: GuildSettings): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📐 Cards per Pack")
    .setColor(0xfee75c)
    .setDescription(
      "How many cards each tier hands out per `/pack` open. Default is **5** for all tiers.",
    )
    .addFields({
      name: "Current sizes",
      value: PACK_TIERS.map(t => tierSummaryLine(s, t)).join("\n"),
    });
}

export function buildPacksSizesComponents(s: GuildSettings) {
  const sizeSelect = (tier: PackTier, current: number) => {
    const meta = PACK_TIER_META[tier];
    const opts = SIZE_OPTS.map(n => ({
      label: `${n} ${n === 1 ? "card" : "cards"}`,
      value: String(n),
      default: current === n,
    }));
    return new StringSelectMenuBuilder()
      .setCustomId(`packs_size_${tier}`)
      .setPlaceholder(`${meta.emoji} ${meta.label} size`)
      .addOptions(opts);
  };
  const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("config:packs:back").setLabel("← Back to Packs").setStyle(ButtonStyle.Secondary),
  );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sizeSelect("basic", s.packBasicSize)),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sizeSelect("premium", s.packPremiumSize)),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sizeSelect("legendary", s.packLegendarySize)),
    back,
  ];
}

export function buildPacksLimitsEmbed(s: GuildSettings): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📅 Weekly Pack Limits")
    .setColor(0xfee75c)
    .setDescription(
      "Each tier has its **own** weekly cap. Hitting one doesn't block the others.\n" +
      "*Resets every Monday 00:00 UTC. Pick \"Unlimited\" to disable.*",
    )
    .addFields({
      name: "Current caps",
      value: PACK_TIERS.map(t => tierSummaryLine(s, t)).join("\n"),
    });
}

export function buildPacksLimitsComponents(s: GuildSettings) {
  const limitSelect = (tier: PackTier, current: number) => {
    const meta = PACK_TIER_META[tier];
    const opts = LIMIT_OPTS.map(o => ({
      label: o.label, value: String(o.n), default: current === o.n,
    }));
    return new StringSelectMenuBuilder()
      .setCustomId(`packs_limit_${tier}`)
      .setPlaceholder(`${meta.emoji} ${meta.label} weekly cap`)
      .addOptions(opts);
  };
  const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("config:packs:back").setLabel("← Back to Packs").setStyle(ButtonStyle.Secondary),
  );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(limitSelect("basic", s.packBasicWeeklyLimit)),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(limitSelect("premium", s.packPremiumWeeklyLimit)),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(limitSelect("legendary", s.packLegendaryWeeklyLimit)),
    back,
  ];
}
