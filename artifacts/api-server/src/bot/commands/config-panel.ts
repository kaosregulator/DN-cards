import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings, isAdmin, getActiveSet, getActiveSetSecondary, getRarityDisplayOverrides, createCustomPack, listCustomPacks, getCustomPack, updateCustomPack, deleteCustomPack, getDistinctCardTypes } from "../db.js";
import { scheduleNextSpawn, clearSpawnTimer, scheduleNextSpawnSecondary, clearSpawnTimerSecondary } from "../spawn-manager.js";
import { RARITY_WEIGHTS, RARITY_LABELS, RARITY_EMOJI, rarityLabel, rarityEmoji, getRarityOrder, type Rarity, type RarityDisplayMap } from "../cards-data.js";
import type { CustomPack, GuildSettings } from "@workspace/db";
import { PACK_TIERS, PACK_TIER_META, PACK_DEFAULTS, resolveTierConfig, tierLabel, type PackTier } from "./pack.js";

// Rarity display order defaults to the canonical DB enum key order.
// Admins can reorder it per-guild via `/rarity` → "Order". Use getRarityOrder(settings)
// everywhere the panel needs to enumerate built-in rarities.
const DEFAULT_RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
// Discord caps an action-row count at 5 per message AND 5 per modal, so the
// interactive rate-mix controls can only expose 5 rarities. Mythic is the
// event/admin-only top tier (default weight 0) and is configured via the
// `/rarity` panel or `/event` boosts instead.
function getUiRarityOrder(s: GuildSettings): Rarity[] {
  return getRarityOrder(s).filter(r => r !== "mythic");
}
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
  // Defer immediately — isAdmin() is a DB call, easily past 3s without defer.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ok = await ensureAdmin(interaction);
  if (!ok) return;
  const guildId = interaction.guild.id;
  const [settings, activeSet, activeSetSecondary, displayMap] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getActiveSet(guildId),
    getActiveSetSecondary(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  await interaction.editReply({
    embeds: [buildConfigEmbed(settings, activeSet?.name ?? null, displayMap, activeSetSecondary?.name ?? null)],
    components: buildConfigComponents(settings, displayMap),
  });
}

// ── Router: select-menu interactions on the panel ─────────────────────────────────────────────────────────────────
export async function handleConfigSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  // ACK immediately — DB work comes after, so we never hit the 3s window.
  await interaction.deferUpdate();
  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }

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
  } else if (action === "config_anim_speed") {
    const speed = value as "slow" | "normal" | "fast";
    if (["slow", "normal", "fast"].includes(speed)) {
      patch.packAnimationSpeed = speed;
    }
  } else if (action === "config_recycle_scrap_mult") {
    patch.recycleScrapMultiplier = parseInt(value!, 10);
  } else if (action === "config_recycle_fuse_mult") {
    patch.fuseCostMultiplier = parseInt(value!, 10);
  }

  await updateGuildSettings(guildId, patch);
  if (action === "config_interval") scheduleNextSpawn(guildId);

  const settings = await getOrCreateGuildSettings(guildId);
  if (action === "config_recycle_scrap_mult" || action === "config_recycle_fuse_mult") {
    const displayMap = await getRarityDisplayOverrides(guildId);
    await interaction.editReply({ embeds: [buildRecycleEmbed(settings, displayMap)], components: buildRecycleComponents(settings) });
    return;
  }
  await refreshPanel(interaction, settings);
}

// ── Router: button interactions on the panel ──────────────────────────────────────────────────────────────────
export async function handleConfigButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const parts = interaction.customId.split(":"); // "config:toggle:spawn"
  const action = parts[1]!;
  const arg = parts[2];
  const guildId = interaction.guild.id;

  // ── Modal path: showModal() MUST be the first response — cannot deferUpdate first. ──

  // Custom packs create/edit modals — NO DB call, NO auth check before showModal.
  // The config panel is already admin-gated; authoritative isAdmin() check runs in the
  // modal submit handler (handleCustomPackModal) after deferUpdate, where DB latency is safe.
  if (action === "packs" && arg === "custom") {
    const subAction = parts[3];
    if (subAction === "new") {
      await interaction.showModal(buildCustomPackModal());
      return;
    }
    if (subAction === "edit" && parts[4]) {
      await interaction.showModal(buildCustomPackModal(parts[4]));
      return;
    }
  }

  if (action === "packs" && arg === "names" && parts[3] === "edit") {
    // Rename modal — no DB call before showModal; auth check runs in submit handler.
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.showModal(buildPacksNamesModal(settings));
    return;
  }

  if (action === "packs" && arg === "names" && parts[3] === "desc") {
    // Description modal — no DB call before showModal; auth check runs in submit handler.
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.showModal(buildPacksDescModal(settings));
    return;
  }

  if (action === "rates" && arg === "custom") {
    const ok = await ensureAdmin(interaction);
    if (!ok) return;
    const [settings, displayMap] = await Promise.all([
      getOrCreateGuildSettings(guildId),
      getRarityDisplayOverrides(guildId),
    ]);
    await interaction.showModal(buildCustomMixModal(settings, displayMap));
    return;
  }

  if (action === "recycle" && arg === "values") {
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.showModal(buildRecycleValuesModal(settings));
    return;
  }

  // ── All other paths: ACK immediately, then do DB work. ──
  await interaction.deferUpdate();
  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "toggle" && arg === "spawn") {
    const s = await getOrCreateGuildSettings(guildId);
    const next = !s.spawnEnabled;
    await updateGuildSettings(guildId, { spawnEnabled: next });
    if (next) scheduleNextSpawn(guildId);
    else clearSpawnTimer(guildId);
  } else if (action === "toggle" && arg === "trade") {
    const s = await getOrCreateGuildSettings(guildId);
    await updateGuildSettings(guildId, { tradeEnabled: !s.tradeEnabled });
  } else if (action === "toggle" && arg === "packanim") {
    const s = await getOrCreateGuildSettings(guildId);
    await updateGuildSettings(guildId, { packAnimationEnabled: !s.packAnimationEnabled });
  } else if (action === "channel" && arg === "spawn") {
    await updateGuildSettings(guildId, { spawnChannelId: interaction.channelId });
    scheduleNextSpawn(guildId);
  } else if (action === "toggle" && arg === "spawn2") {
    const s = await getOrCreateGuildSettings(guildId);
    const next = !s.spawnEnabledSecondary;
    await updateGuildSettings(guildId, { spawnEnabledSecondary: next });
    if (next && s.spawnChannelIdSecondary) scheduleNextSpawnSecondary(guildId);
    else clearSpawnTimerSecondary(guildId);
  } else if (action === "channel" && arg === "spawn2") {
    await updateGuildSettings(guildId, { spawnChannelIdSecondary: interaction.channelId });
    const s = await getOrCreateGuildSettings(guildId);
    if (s.spawnEnabledSecondary) scheduleNextSpawnSecondary(guildId);
  } else if (action === "channel" && arg === "trade") {
    await updateGuildSettings(guildId, { tradeChannelId: interaction.channelId });
  } else if (action === "drops") {
    const settings = await getOrCreateGuildSettings(guildId);
    if (arg === "back") {
      await refreshPanel(interaction, settings);
    } else {
      await interaction.editReply({
        embeds: [buildDropsEmbed(settings)],
        components: buildDropsComponents(settings),
      });
    }
    return;
  } else if (action === "rates") {
    if (arg === "reset") {
      const [baseSettings, displayMap] = await Promise.all([
        getOrCreateGuildSettings(guildId),
        getRarityDisplayOverrides(guildId),
      ]);
      const resetPatch: Partial<GuildSettings> = {};
      const order = getRarityOrder(baseSettings);
      for (const r of order) {
        (resetPatch as Record<string, number | null>)[rarityWeightKey(r) as string] = null;
      }
      await updateGuildSettings(guildId, resetPatch);
      const freshSettings = await getOrCreateGuildSettings(guildId);
      await refreshPanel(interaction, freshSettings);
      const orderLabels = getRarityOrder(freshSettings)
        .map(r => `${rarityLabel(r, freshSettings, displayMap)} ${effectiveWeight(freshSettings, r)}%`)
        .join(" · ");
      await interaction.followUp({
        content: `🔄 Rarity setup reset to defaults — ${orderLabels}.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => { /* ignore */ });
      return;
    }
    // rates:open — show rates sub-panel (replaces config panel in-place)
    const [settings, displayMap] = await Promise.all([
      getOrCreateGuildSettings(guildId),
      getRarityDisplayOverrides(guildId),
    ]);
    await interaction.editReply({
      embeds: [buildRatesEmbed(settings, displayMap)],
      components: buildRatesComponents(settings, displayMap),
    });
    return;
  } else if (action === "packs") {
    if (arg === "custom") {
      // Custom packs sub-panel (delete is handled here; new/edit already returned above via modal)
      const subAction = parts[3];
      if (subAction === "back") {
        const settings = await getOrCreateGuildSettings(guildId);
        await interaction.editReply({ embeds: [buildPacksEmbed(settings)], components: buildPacksComponents(settings) });
        return;
      }
      if (subAction === "delete" && parts[4]) {
        const packId = parseInt(parts[4]!, 10);
        const target = await getCustomPack(packId);
        if (target?.guildId === guildId) await deleteCustomPack(packId);
      }
      if (subAction === "types" && parts[4]) {
        const packId = parseInt(parts[4]!, 10);
        const target = await getCustomPack(packId);
        if (!target || target.guildId !== guildId) {
          await interaction.followUp({ content: "❌ Pack not found.", flags: MessageFlags.Ephemeral });
          return;
        }
        const allTypes = await getDistinctCardTypes(guildId);
        if (allTypes.length === 0) {
          await interaction.editReply({
            content: `No card types exist yet in this server. Add a card with \`/addcard\` first, then you can filter **${target.name}** by type.`,
            embeds: [],
            components: buildCustomPacksComponents(await listCustomPacks(guildId, true)),
          });
          return;
        }
        await interaction.editReply({
          content: `Pick the card types for **${target.name}**. Selected types are saved automatically; pick **All** to clear the filter.`,
          embeds: [],
          components: buildCustomPackTypesComponents(target, allTypes),
        });
        return;
      }
      const packs = await listCustomPacks(guildId, true);
      await interaction.editReply({ content: null, embeds: [buildCustomPacksEmbed(packs)], components: buildCustomPacksComponents(packs) });
      return;
    }

    const settings = await getOrCreateGuildSettings(guildId);
    if (arg === "sizes") {
      await interaction.editReply({
        embeds: [buildPacksSizesEmbed(settings)],
        components: buildPacksSizesComponents(settings),
      });
    } else if (arg === "limits") {
      await interaction.editReply({
        embeds: [buildPacksLimitsEmbed(settings)],
        components: buildPacksLimitsComponents(settings),
      });
    } else if (arg === "names") {
      await interaction.editReply({
        embeds: [buildPacksNamesEmbed(settings)],
        components: buildPacksNamesComponents(),
      });
    } else if (arg === "back") {
      await interaction.editReply({
        embeds: [buildPacksEmbed(settings)],
        components: buildPacksComponents(settings),
      });
    } else {
      // Open packs panel (replaces config panel in-place)
      await interaction.editReply({
        embeds: [buildPacksEmbed(settings)],
        components: buildPacksComponents(settings),
      });
    }
    return;
  } else if (action === "anim") {
    const settings = await getOrCreateGuildSettings(guildId);
    if (arg === "back") {
      await refreshPanel(interaction, settings);
    } else {
      // Open animation sub-panel (replaces config panel in-place)
      await interaction.editReply({
        embeds: [buildAnimationEmbed(settings)],
        components: buildAnimationComponents(settings),
      });
    }
    return;
  } else if (action === "recycle") {
    const settings = await getOrCreateGuildSettings(guildId);
    if (arg === "back") {
      await refreshPanel(interaction, settings);
    } else if (arg === "open") {
      const displayMap = await getRarityDisplayOverrides(guildId);
      await interaction.editReply({
        embeds: [buildRecycleEmbed(settings, displayMap)],
        components: buildRecycleComponents(settings),
      });
    } else if (arg === "toggle") {
      await updateGuildSettings(guildId, { recycleEnabled: !settings.recycleEnabled });
      const fresh = await getOrCreateGuildSettings(guildId);
      const displayMap = await getRarityDisplayOverrides(guildId);
      await interaction.editReply({
        embeds: [buildRecycleEmbed(fresh, displayMap)],
        components: buildRecycleComponents(fresh),
      });
    }
    return;
  }

  const settings = await getOrCreateGuildSettings(guildId);
  await refreshPanel(interaction, settings);
}

// ── Router: packs sub-panel selects ──────────────────────────────────────────────────────────────────
export async function handlePacksSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }

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
    await interaction.editReply({ embeds: [buildPacksSizesEmbed(settings)], components: buildPacksSizesComponents(settings) });
  } else if (panel === "limits") {
    await interaction.editReply({ embeds: [buildPacksLimitsEmbed(settings)], components: buildPacksLimitsComponents(settings) });
  } else {
    await interaction.editReply({ embeds: [buildPacksEmbed(settings)], components: buildPacksComponents(settings) });
  }
}

// ── Router: drop-rates sub-panel selects ─────────────────────────────────────────────────────────────────
export async function handleRatesSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guild.id;
  const rarity = interaction.customId.slice("rates_".length) as Rarity;
  const settings = await getOrCreateGuildSettings(guildId);
  if (!getRarityOrder(settings).includes(rarity)) return;

  const raw = interaction.values[0];
  const weight: number | null = raw === "default" ? null : parseInt(raw!, 10);
  await updateGuildSettings(guildId, { [rarityWeightKey(rarity)]: weight } as Partial<GuildSettings>);

  const [freshSettings, displayMap] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  await interaction.editReply({
    embeds: [buildRatesEmbed(freshSettings, displayMap)],
    components: buildRatesComponents(freshSettings, displayMap),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function refreshPanel(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  settings: GuildSettings,
): Promise<void> {
  const guildId = interaction.guild!.id;
  const [activeSet, activeSetSecondary, displayMap] = await Promise.all([
    getActiveSet(guildId),
    getActiveSetSecondary(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  await interaction.editReply({
    embeds: [buildConfigEmbed(settings, activeSet?.name ?? null, displayMap, activeSetSecondary?.name ?? null)],
    components: buildConfigComponents(settings, displayMap),
  });
}

async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
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

function buildConfigEmbed(s: GuildSettings, activeSetName: string | null, displayMap?: RarityDisplayMap | null, activeSetNameSecondary?: string | null): EmbedBuilder {
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

  // Active set status — shown prominently so admins know what's dropping
  const hasActiveSet = !!activeSetName;
  const setField = hasActiveSet
    ? `🟢 **${activeSetName}** — only cards in this set will spawn`
    : "⚠️ **None** — random spawns are disabled until a set is activated (use `/set_hub`)";

  // Warn if spawning is on but there's no active set — drops are silently no-ops
  const spawnWarning = spawnOn && !hasActiveSet
    ? "\n⚠️ **Spawning is ON but no active set is selected — no cards will drop!**"
    : "";

  return new EmbedBuilder()
    .setTitle("⚙️ DN Cards — Config")
    .setColor(spawnOn && !hasActiveSet ? 0xff6b35 : 0x5865f2)
    .setDescription(`Quick config — changes save instantly.${spawnWarning}`)
    .addFields(
      {
        name: "🗂️ Active Spawn Set",
        value: setField,
        inline: false,
      },
      {
        name: "📢 Spawn Channel",
        value: s.spawnChannelId ? `<#${s.spawnChannelId}>` : "Not set — click **📢 Spawn here**",
        inline: false,
      },
      {
        name: "📡 Stream 2",
        value: (() => {
          if (!s.spawnChannelIdSecondary) return "Off — click **📡 Stream 2 here** to set a channel, then enable";
          const channelMention = `<#${s.spawnChannelIdSecondary}>`;
          const status = s.spawnEnabledSecondary ? "🟢" : "🔴";
          const setInfo = activeSetNameSecondary
            ? `set: **${activeSetNameSecondary}**`
            : "⚠️ **no active set** — open `/set_hub` or `/set_admin` to pick one";
          return `${status} ${channelMention} — ${setInfo}`;
        })(),
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
        name: "🎞️ Pack Animation",
        value: s.packAnimationEnabled ? `🟢 ${s.packAnimationSpeed}` : "🔴 OFF",
        inline: true,
      },
    )
    .setFooter({ text: "Ephemeral — only you see this. Use /set_hub to change the active set." });
}

function buildConfigComponents(s: GuildSettings, displayMap?: RarityDisplayMap | null) {
  const catchMode = (s as unknown as { catchMode?: string }).catchMode ?? "type";

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId("config_mode")
    .setPlaceholder("🎯 Catch Mode")
    .addOptions(
      { label: "Typing", value: "type", emoji: "✍️", default: catchMode === "type" },
      { label: "Button", value: "button", emoji: "🎯", default: catchMode === "button" },
      { label: "Both", value: "both", emoji: "🔀", default: catchMode === "both" },
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
      .setCustomId("config:packs:open")
      .setLabel("🎴 Packs")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:recycle:open")
      .setLabel(s.recycleEnabled ? "♻️ Recycle" : "♻️ Recycle OFF")
      .setStyle(s.recycleEnabled ? ButtonStyle.Secondary : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("config:drops:open")
      .setLabel("📤‍📤 Drops")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:toggle:spawn2")
      .setLabel(s.spawnEnabledSecondary ? "🟢 Stream 2 ON" : "🔴 Stream 2 OFF")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:channel:spawn2")
      .setLabel("📡 Stream 2 here")
      .setStyle(ButtonStyle.Primary),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(windowSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(intervalSelect),
    toggleRow,
    subPanelRow,
  ];
}

// ── Animation sub-panel ─────────────────────────────────────────────────────

function buildAnimationEmbed(s: GuildSettings): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🎞️ Pack Animation Settings")
    .setColor(0x5865f2)
    .setDescription(
      "Pack openings use lightweight PNG reveal frames. " +
      "Admins can toggle them off or change the speed to save CPU/bandwidth."
    )
    .addFields(
      {
        name: "🎴 Pack Animations",
        value: s.packAnimationEnabled ? `🟢 ON · ${s.packAnimationSpeed}` : "🔴 OFF",
        inline: true,
      },
    );
}

function buildAnimationComponents(s: GuildSettings) {
  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config:toggle:packanim")
      .setLabel(s.packAnimationEnabled ? "🎴 Pack Anim ON" : "🎴 Pack Anim OFF")
      .setStyle(ButtonStyle.Secondary),
  );
  const speedRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("config_anim_speed")
      .setPlaceholder("🎴 Pack animation speed")
      .addOptions([
        { label: "Slow (cinematic)", value: "slow", emoji: "🐢", default: s.packAnimationSpeed === "slow" },
        { label: "Normal", value: "normal", emoji: "⚖️", default: s.packAnimationSpeed === "normal" },
        { label: "Fast", value: "fast", emoji: "🚀", default: s.packAnimationSpeed === "fast" },
      ]),
  );
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("config:anim:back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [toggleRow, speedRow, backRow];
}

function formatSec(sec: number): string {
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

// ── Recycle / Card Progression Hub sub-panel ──────────────────────────────────

const RECYCLE_MULTIPLIER_OPTIONS = [50, 75, 100, 125, 150, 200, 300];

const RECYCLE_VALUE_KEY: Record<Rarity, keyof GuildSettings> = {
  common: "recycleScrapCommon",
  uncommon: "recycleScrapUncommon",
  rare: "recycleScrapRare",
  epic: "recycleScrapEpic",
  legendary: "recycleScrapLegendary",
  mythic: "recycleScrapMythic",
};

function buildRecycleEmbed(s: GuildSettings, displayMap?: RarityDisplayMap | null): EmbedBuilder {
  const order = getRarityOrder(s);
  const values = order.map(r => {
    const label = rarityLabel(r, s, displayMap);
    const val = s[RECYCLE_VALUE_KEY[r]] as number | null | undefined;
    return `${label}: **${val ?? "default"}** ⚙️`;
  }).join("\n");

  return new EmbedBuilder()
    .setTitle("🔧 Card Fusion / Recycle")
    .setColor(0x2ecc71)
    .setDescription(
      "Tune the Fusion economy: **Recycle** turns duplicates into Scrap; **Fuse** spends duplicates + Scrap to raise a card's Star Rank.\n\n" +
      `**Enabled:** ${s.recycleEnabled ? "🟢 Yes" : "🔴 No"}\n` +
      `**Scrap earn multiplier:** ${s.recycleScrapMultiplier}%\n` +
      `**Fusion cost multiplier:** ${s.fuseCostMultiplier}%\n\n` +
      `**Per-rarity Scrap earn values** (null = default):\n${values}`,
    );
}

function buildRecycleComponents(s: GuildSettings) {
  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config:recycle:toggle")
      .setLabel(s.recycleEnabled ? "🔴 Disable Recycle" : "🟢 Enable Recycle")
      .setStyle(s.recycleEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("config:recycle:values")
      .setLabel("⚙️ Edit Rarity Values")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("config:recycle:back")
      .setLabel("← Back")
      .setStyle(ButtonStyle.Secondary),
  );

  const scrapMultSelect = new StringSelectMenuBuilder()
    .setCustomId("config_recycle_scrap_mult")
    .setPlaceholder("Scrap multiplier")
    .addOptions(RECYCLE_MULTIPLIER_OPTIONS.map(p => ({
      label: `${p}%`,
      value: String(p),
      default: s.recycleScrapMultiplier === p,
    })));

  const fuseMultSelect = new StringSelectMenuBuilder()
    .setCustomId("config_recycle_fuse_mult")
    .setPlaceholder("Fusion cost multiplier")
    .addOptions(RECYCLE_MULTIPLIER_OPTIONS.map(p => ({
      label: `${p}%`,
      value: String(p),
      default: s.fuseCostMultiplier === p,
    })));

  return [
    toggleRow,
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(scrapMultSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(fuseMultSelect),
  ];
}

function buildRecycleValuesModal(s: GuildSettings): ModalBuilder {
  const order = getRarityOrder(s);
  const defaults = [5, 15, 40, 100, 250, 500];
  const current = order.map((r, i) => (s[RECYCLE_VALUE_KEY[r]] as number | null | undefined) ?? defaults[i] ?? 5);
  const placeholder = order.join(", ") + " — e.g. " + current.join(", ");

  return new ModalBuilder()
    .setCustomId("config:recycle:values")
    .setTitle("Per-rarity Scrap values")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("values")
          .setLabel(`Order: ${order.join(", ")}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder(placeholder)
          .setValue(current.join(", ")),
      ),
    );
}

export async function handleRecycleValuesModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  await interaction.deferUpdate().catch(() => {});

  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const raw = interaction.fields.getTextInputValue("values").trim();
  const parts = raw.split(",").map(p => p.trim()).filter(Boolean);
  const settings = await getOrCreateGuildSettings(guildId);
  const order = getRarityOrder(settings);

  if (parts.length !== order.length) {
    await interaction.followUp({
      content: `❌ Provide exactly ${order.length} values separated by commas, in order: ${order.join(", ")}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const patch: Partial<GuildSettings> = {};
  for (let i = 0; i < order.length; i++) {
    const r = order[i]!;
    const val = parseInt(parts[i]!, 10);
    if (!Number.isInteger(val) || val < 0) {
      await interaction.followUp({ content: `❌ "${parts[i]}" is not a valid whole number ≥ 0.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    (patch as Record<string, number | null>)[RECYCLE_VALUE_KEY[r] as string] = val;
  }

  await updateGuildSettings(guildId, patch);
  const fresh = await getOrCreateGuildSettings(guildId);
  const displayMap = await getRarityDisplayOverrides(guildId);
  await interaction.editReply({ embeds: [buildRecycleEmbed(fresh, displayMap)], components: buildRecycleComponents(fresh) }).catch(() => {});
}

// ── Drops per spawn sub-panel ────────────────────────────────────────────────

function buildDropsEmbed(s: GuildSettings): EmbedBuilder {
  const dropsLabel = s.cardsPerSpawn === -1 ? "Random 1–3" : `${s.cardsPerSpawn}`;
  return new EmbedBuilder()
    .setTitle("📤‍📤 Drops per Spawn")
    .setColor(0x5865f2)
    .setDescription(`How many cards appear in each automatic spawn.\n\nCurrent: **${dropsLabel}**`);
}

function buildDropsComponents(s: GuildSettings) {
  const dropsSelect = new StringSelectMenuBuilder()
    .setCustomId("config_drops")
    .setPlaceholder("📤‍📤 Cards per spawn")
    .addOptions(
      { label: "1 card", value: "1", default: s.cardsPerSpawn === 1 },
      { label: "3 cards", value: "3", default: s.cardsPerSpawn === 3 },
      { label: "5 cards", value: "5", default: s.cardsPerSpawn === 5 },
      { label: "Random 1–3", value: "-1", default: s.cardsPerSpawn === -1 },
    );
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("config:drops:back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dropsSelect),
    backRow,
  ];
}

// ── Rarity percentage sub-panel (also reused by the setup wizard) ────────────
export { buildRatesEmbed, buildRatesComponents };

function rarityBar(s: GuildSettings): string {
  const order = getRarityOrder(s);
  const weights = order.map(r => effectiveWeight(s, r));
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
  return order.map((r, i) => blocks[r].repeat(floors[i]!)).join("");
}

function rarityRowsSummary(s: GuildSettings, displayMap?: RarityDisplayMap | null): string {
  const order = getRarityOrder(s);
  const weights = order.map(r => effectiveWeight(s, r));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return order.map((r, i) => {
    const w = weights[i]!;
    const pct = ((w / total) * 100).toFixed(1);
    const tag = getRarityWeight(s, r) === null ? " *(default)*" : "";
    return `${rarityEmoji(r, s, displayMap)} **${rarityLabel(r, s, displayMap)}** — ${pct}%${tag}`;
  }).join("\n");
}

function buildRatesEmbed(s: GuildSettings, displayMap?: RarityDisplayMap | null): EmbedBuilder {
  const order = getRarityOrder(s);
  const weights = order.map(r => effectiveWeight(s, r));
  const total = weights.reduce((a, b) => a + b, 0);
  const balanced = total === 100;
  const note = balanced
    ? "✅ Your values add up to **100%** — what you pick is exactly what players see."
    : `ℹ️ Your values add up to **${total}** — Discord auto-balances them to **100%** below. ` +
      "(Pick numbers that sum to 100 to keep things simple.)";
  const defaultSummary = order
    .filter(r => r !== "mythic")
    .map(r => `${rarityLabel(r, s, displayMap)} ${RARITY_WEIGHTS[r]}`)
    .join(" · ");
  return new EmbedBuilder()
    .setTitle("🎛️ Rarity Setup — Spawn Chance by Rarity")
    .setColor(0xeb459e)
    .setDescription(
      "Set the visible **spawn chance %** for each built-in rarity.\n" +
      `**Defaults:** ${defaultSummary} (= 100%)\n` +
      "_Want exact numbers? Close this and tap **✏️ Exact %** on the main panel._\n\n" +
      `${rarityBar(s)}\n\n` +
      note,
    )
    .addFields({ name: "Current mix", value: rarityRowsSummary(s, displayMap), inline: false })
    .setFooter({ text: "Changes save instantly. To start over, close this and use 🔄 Reset % on the main config panel." });
}

function buildRatesComponents(s: GuildSettings, displayMap?: RarityDisplayMap | null) {
  // Discord caps action rows at 5 — so all 5 non-mythic rarities go here, no room for a button.
  // Reset is exposed via the 🔄 Reset Mix button on the main config panel.
  // Mythic is intentionally excluded; configure it from the dashboard.
  return getUiRarityOrder(s).map(r => {
    const current = getRarityWeight(s, r);
    const opts = RARITY_WEIGHT_OPTIONS[r].map(w => {
      if (w === null) {
        return {
          label: `Default chance (${RARITY_WEIGHTS[r]}%)`,
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
      .setPlaceholder(`${rarityEmoji(r, s, displayMap)} ${rarityLabel(r, s, displayMap)} — spawn %`)
      .addOptions(opts);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  });
}

// ── Exact percentage modal ──────────────────────────────────────────────────────────
// Lets the admin type any % for each rarity. Values can be any non-negative
// integer; if they don't sum to 100, Discord auto-normalises in the spawn engine
// (same behaviour as the preset dropdowns).
function buildCustomMixModal(s: GuildSettings, displayMap?: RarityDisplayMap | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("rates_custom")
    .setTitle("Exact Rarity % (sum to 100)");
  // Modals also cap at 5 rows — mythic is configured via the dashboard.
  const inputs = getUiRarityOrder(s).map(r =>
    new TextInputBuilder()
      .setCustomId(`mix_${r}`)
      .setLabel(`${rarityLabel(r, s, displayMap)} %`)
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

  const displayMap = await getRarityDisplayOverrides(guildId);
  const settings = await getOrCreateGuildSettings(guildId);
  const patch: Partial<GuildSettings> = {};
  const parsed: { r: Rarity; v: number }[] = [];
  for (const r of getUiRarityOrder(settings)) {
    const raw = interaction.fields.getTextInputValue(`mix_${r}`).trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      await interaction.reply({
        content: `❌ **${rarityLabel(r, null, displayMap)}** must be a whole number from 0–100. You entered: \`${raw}\``,
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
  const freshSettings = await getOrCreateGuildSettings(guildId);
  const summary = parsed.map(({ r, v }) => `${rarityEmoji(r, freshSettings, displayMap)} ${rarityLabel(r, freshSettings, displayMap)} **${v}**`).join(" · ");
  const note = sum === 100 ? "✅ Sums to 100%." : `ℹ️ Sums to **${sum}** — Discord will auto-balance to 100%.`;
  await interaction.reply({
    embeds: [buildRatesEmbed(freshSettings, displayMap)],
    content: `✏️ Exact rarity % saved: ${summary}\n${note}`,
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
  return `${meta.emoji} **${tierLabel(s, tier)}** — 💠 ${cfg.cost.toLocaleString()} · ${cfg.size} cards · ${formatLimit(cfg.weeklyLimit)}`;
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
          `**Defaults:** ${tierLabel(s, "basic")} 💠 ${PACK_DEFAULTS.basic.cost} · ${tierLabel(s, "premium")} 💠 ${PACK_DEFAULTS.premium.cost} · ${tierLabel(s, "legendary")} 💠 ${PACK_DEFAULTS.legendary.cost}\n` +
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
      .setPlaceholder(`${meta.emoji} ${tierLabel(s, tier)} cost`)
      .addOptions(opts);
  };

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("config:packs:sizes").setLabel("📐 Cards / Pack").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("config:packs:limits").setLabel("📅 Weekly Limits").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("config:packs:custom").setLabel("🎁 Custom Packs").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("config:packs:names").setLabel("🏷️ Rename Tiers").setStyle(ButtonStyle.Secondary),
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
      .setPlaceholder(`${meta.emoji} ${tierLabel(s, tier)} size`)
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
      .setPlaceholder(`${meta.emoji} ${tierLabel(s, tier)} weekly cap`)
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

// ── Rename built-in pack tiers sub-panel ─────────────────────────────────────

function buildPacksNamesEmbed(s: GuildSettings): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🏷️ Rename Pack Tiers")
    .setColor(0x57f287)
    .setDescription(
      "Change the visible names of the three built-in pack tiers. " +
      "Internal values stay the same, so `/pack tier:basic` still works even if you rename it to **Recruit**.\n\n" +
      "Leave a field blank to reset that tier to its default name.",
    )
    .addFields({
      name: "Current display names",
      value: PACK_TIERS.map(t => {
        const meta = PACK_TIER_META[t];
        const name = tierLabel(s, t);
        const isDefault = name === meta.label;
        return `${meta.emoji} **${name}**${isDefault ? " *(default)*" : ""}`;
      }).join("\n"),
    });
}

function buildPacksNamesComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("config:packs:names:edit").setLabel("✏️ Edit Names").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("config:packs:names:desc").setLabel("📝 Descriptions").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("config:packs:back").setLabel("← Back to Packs").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildPacksDescModal(s: GuildSettings): ModalBuilder {
  const input = (tier: PackTier, label: string, current: string | null | undefined) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(`desc_${tier}`)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(current ?? "")
        .setPlaceholder("Leave blank to remove"),
    );
  return new ModalBuilder()
    .setCustomId("packs_desc_modal")
    .setTitle("Edit Pack Descriptions")
    .addComponents(
      input("basic",     `🥉 ${tierLabel(s, "basic")} description`,     s.packBasicDesc),
      input("premium",   `🥈 ${tierLabel(s, "premium")} description`,   s.packPremiumDesc),
      input("legendary", `🥇 ${tierLabel(s, "legendary")} description`, s.packLegendaryDesc),
    );
}

export async function handlePacksDescModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  await interaction.deferUpdate();

  const perms = interaction.memberPermissions;
  const authorized =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(guildId, interaction.user.id));
  if (!authorized) {
    await interaction.followUp({ content: "❌ Only admins can edit pack descriptions.", flags: MessageFlags.Ephemeral });
    return;
  }

  const normalize = (raw: string): string | null => {
    const v = raw.trim();
    return v.length > 0 ? v.slice(0, 100) : null;
  };

  const patch: Partial<GuildSettings> = {
    packBasicDesc:     normalize(interaction.fields.getTextInputValue("desc_basic")),
    packPremiumDesc:   normalize(interaction.fields.getTextInputValue("desc_premium")),
    packLegendaryDesc: normalize(interaction.fields.getTextInputValue("desc_legendary")),
  };

  await updateGuildSettings(guildId, patch);
  const settings = await getOrCreateGuildSettings(guildId);
  await interaction.editReply({
    embeds: [buildPacksNamesEmbed(settings)],
    components: buildPacksNamesComponents(),
  });
}

function buildPacksNamesModal(s: GuildSettings): ModalBuilder {
  const input = (tier: PackTier, label: string) => new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(`name_${tier}`)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(30)
      .setValue(tierLabel(s, tier))
      // Placeholder intentionally shows the immutable default name so clearing
      // the field reverts to the original label.
      .setPlaceholder(PACK_TIER_META[tier].label),
  );
  return new ModalBuilder()
    .setCustomId("packs_names_modal")
    .setTitle("Rename Pack Tiers")
    .addComponents(
      input("basic", `🥉 ${tierLabel(s, "basic")} display name`),
      input("premium", `🥈 ${tierLabel(s, "premium")} display name`),
      input("legendary", `🥇 ${tierLabel(s, "legendary")} display name`),
    );
}

export async function handlePacksNamesModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  await interaction.deferUpdate();

  // Authoritative admin check after ACK — consistent with other config modals.
  const perms = interaction.memberPermissions;
  const authorized =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(guildId, interaction.user.id));
  if (!authorized) {
    await interaction.followUp({ content: "❌ Only admins can rename pack tiers.", flags: MessageFlags.Ephemeral });
    return;
  }

  const normalize = (raw: string): string | null => {
    const v = raw.trim();
    return v.length > 0 ? v.slice(0, 30) : null;
  };

  const patch: Partial<GuildSettings> = {};
  const basicName = normalize(interaction.fields.getTextInputValue("name_basic"));
  const premiumName = normalize(interaction.fields.getTextInputValue("name_premium"));
  const legendaryName = normalize(interaction.fields.getTextInputValue("name_legendary"));
  // Blank = reset to default (NULL). Non-blank = use custom name.
  patch.packBasicName = basicName;
  patch.packPremiumName = premiumName;
  patch.packLegendaryName = legendaryName;

  await updateGuildSettings(guildId, patch);
  const settings = await getOrCreateGuildSettings(guildId);
  await interaction.editReply({
    embeds: [buildPacksNamesEmbed(settings)],
    components: buildPacksNamesComponents(),
  });
}

// ── Custom Packs sub-panel ────────────────────────────────────────────────────
// Rate presets for new custom packs (mirrors TIER_RATES in pack.ts).
const CUSTOM_PACK_RATE_PRESETS: Record<string, Record<string, number>> = {
  basic:     { common: 0.60, uncommon: 0.25, rare: 0.110, epic: 0.035, legendary: 0.005, mythic: 0.000 },
  premium:   { common: 0.40, uncommon: 0.25, rare: 0.220, epic: 0.100, legendary: 0.030, mythic: 0.000 },
  legendary: { common: 0.00, uncommon: 0.30, rare: 0.345, epic: 0.250, legendary: 0.100, mythic: 0.005 },
};
const DEFAULT_CUSTOM_PACK_RATES = CUSTOM_PACK_RATE_PRESETS.basic!;

function buildCustomPacksEmbed(packs: CustomPack[]): EmbedBuilder {
  const desc =
    packs.length === 0
      ? "No custom packs yet. Click **➕ New Pack** to create one.\n\n" +
        "Custom packs let you create themed pulls — e.g. a **\"Nuke Pack\"** that only draws nuclear-themed cards.\n" +
        "Each pack has its own cost, size, weekly limit, and card-type filter."
      : packs
          .map(
            (p, i) =>
              `**${i + 1}. ${p.name}** — 💠 ${p.cost.toLocaleString()} · ${p.size} card/open · ${formatLimit(p.weeklyLimit)}\n` +
              (p.description ? `*${p.description}*\n` : "") +
              `Types: ${p.cardTypes.length > 0 ? p.cardTypes.join(", ") : "*All*"} · ${p.isActive ? "🟢 Active" : "🔴 Inactive"}`,
          )
          .join("\n\n");
  return new EmbedBuilder()
    .setTitle("🎁 Custom Packs")
    .setColor(0x57f287)
    .setDescription(desc)
    .setFooter({
      text:
        packs.length > 4
          ? `Controls shown for first 4 packs. ${packs.length - 4} more exist — manage via delete + recreate.`
          : "← Back returns to Pack Store settings.",
    });
}

function buildCustomPacksComponents(packs: CustomPack[]): ActionRowBuilder<ButtonBuilder>[] {
  const topRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("config:packs:custom:back")
      .setLabel("← Back to Packs")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("config:packs:custom:new")
      .setLabel("➕ New Pack")
      .setStyle(ButtonStyle.Success),
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [topRow];
  for (const pack of packs.slice(0, 4)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`config:packs:custom:edit:${pack.id}`)
          .setLabel(`✏️ ${pack.name}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`config:packs:custom:types:${pack.id}`)
          .setLabel("📋 Types")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`config:packs:custom:delete:${pack.id}`)
          .setLabel("🗑️ Delete")
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }
  return rows;
}

// packIdStr is passed for edit mode; undefined for create mode.
// No DB call is made here — the modal-open path must stay inside Discord's 3s window.
// For edit mode all numeric fields are optional (blank = keep current value); the submit
// handler loads the existing pack and merges after ACK.
function buildCustomPackModal(packIdStr?: string): ModalBuilder {
  const isEdit = !!packIdStr;
  const modal = new ModalBuilder()
    .setCustomId(isEdit ? `packs_custom_modal:edit:${packIdStr}` : "packs_custom_modal:new")
    .setTitle(isEdit ? "Edit Custom Pack" : "Create Custom Pack");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel(isEdit ? "New pack name (blank = keep current)" : "Pack name (shown in /pack autocomplete)")
        .setStyle(TextInputStyle.Short)
        .setRequired(!isEdit)
        .setMaxLength(50)
        .setPlaceholder("e.g. Nuke Pack"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cost")
        .setLabel(isEdit ? "Cost in 💠 Shards (blank = keep current)" : "Cost in 💠 Shards")
        .setStyle(TextInputStyle.Short)
        .setRequired(!isEdit)
        .setMaxLength(7)
        .setPlaceholder(isEdit ? "e.g. 500 — leave blank to keep" : "500"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("size")
        .setLabel(isEdit ? "Cards per open 1–10 (blank = keep)" : "Cards per open (1–10)")
        .setStyle(TextInputStyle.Short)
        .setRequired(!isEdit)
        .setMaxLength(2)
        .setPlaceholder(isEdit ? "e.g. 5 — leave blank to keep" : "5"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("limit")
        .setLabel(isEdit ? "Weekly limit (blank = keep; 0 = unlimited)" : "Weekly limit (0 = unlimited)")
        .setStyle(TextInputStyle.Short)
        .setRequired(!isEdit)
        .setMaxLength(5)
        .setPlaceholder(isEdit ? "e.g. 10 — leave blank to keep" : "10"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel(isEdit ? "Description (blank = keep current)" : "Description (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setPlaceholder("e.g. Only OG vehicle cards — shown when pack is opened"),
    ),
  );
  return modal;
}

function buildCustomPackTypesComponents(pack: CustomPack, allTypes: string[]): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const selected = new Set(pack.cardTypes.map(t => t.toLowerCase().trim()));
  const options = allTypes.map(type => ({
    label: type[0]!.toUpperCase() + type.slice(1),
    value: type,
    default: selected.has(type.toLowerCase()),
  }));
  // Discord select menus support up to 25 options; cap just in case.
  const capped = options.slice(0, 25);
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`custompack:types:${pack.id}`)
        .setPlaceholder("Pick card types (multi-select)")
        .setMinValues(0)
        .setMaxValues(Math.max(capped.length, 1))
        .addOptions(capped),
    ),
    new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("config:packs:custom:back")
        .setLabel("← Back to Custom Packs")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
  return rows;
}

export async function handleCustomPackTypesSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  await interaction.deferUpdate();
  const ok = await ensureAdmin(interaction);
  if (!ok) {
    await interaction.followUp({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral });
    return;
  }

  const parts = interaction.customId.split(":");
  const packId = parseInt(parts[2]!, 10);
  const target = await getCustomPack(packId);
  if (!target || target.guildId !== guildId) {
    await interaction.followUp({ content: "❌ Pack not found.", flags: MessageFlags.Ephemeral });
    return;
  }

  await updateCustomPack(packId, { cardTypes: interaction.values });
  const packs = await listCustomPacks(guildId, true);
  await interaction.editReply({
    content: `✅ Updated types for **${target.name}**: ${interaction.values.length > 0 ? interaction.values.join(", ") : "*All*"}.`,
    embeds: [buildCustomPacksEmbed(packs)],
    components: buildCustomPacksComponents(packs),
  });
}

// Exported so bot/index.ts can wire the modal route.
export async function handleCustomPackModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;

  const modalParts = interaction.customId.split(":");
  const isEdit = modalParts[1] === "edit";
  const packId = isEdit ? parseInt(modalParts[2]!, 10) : NaN;

  const nameRaw  = interaction.fields.getTextInputValue("name").trim();
  const costRaw  = interaction.fields.getTextInputValue("cost").trim();
  const sizeRaw  = interaction.fields.getTextInputValue("size").trim();
  const limitRaw = interaction.fields.getTextInputValue("limit").trim();
  const descRaw  = interaction.fields.getTextInputValue("description").trim();

  // Only name is validated synchronously before ACK (to avoid "interaction failed" toast
  // in Discord for the most obvious create-mode error). Numeric fields can be blank on
  // edit mode (blank = keep current), so they're validated post-ACK with mode awareness.
  if (!isEdit && !nameRaw) {
    await interaction.reply({ content: "❌ Pack name is required.", flags: MessageFlags.Ephemeral });
    return;
  }

  // ACK first — update the ephemeral config-panel message in-place.
  await interaction.deferUpdate();

  // Parse numeric fields after ACK (safe for edit mode blank values → NaN handled in merge).
  const cost  = parseInt(costRaw.replace(/,/g, ""), 10);
  const size  = parseInt(sizeRaw, 10);
  const limit = parseInt(limitRaw, 10);

  // Authoritative admin check after ACK — safe here, no 3s constraint on this side.
  // Includes DB-backed bot-admins via isAdmin(), covering all admin persona types.
  const perms = interaction.memberPermissions;
  const authorized =
    interaction.guild.ownerId === interaction.user.id ||
    perms?.has("Administrator") ||
    (await isAdmin(guildId, interaction.user.id));
  if (!authorized) {
    await interaction.followUp({ content: "❌ Only admins can manage custom packs.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    let successMsg: string;
    if (isEdit && !isNaN(packId)) {
      const existing = await getCustomPack(packId);
      if (!existing || existing.guildId !== guildId) {
        await interaction.followUp({ content: "❌ Pack not found.", flags: MessageFlags.Ephemeral });
        return;
      }
      // Merge: blank/unprovided fields keep their existing values.
      const finalName  = nameRaw  || existing.name;
      const finalCost  = costRaw  ? cost  : existing.cost;
      const finalSize  = sizeRaw  ? size  : existing.size;
      const finalLimit = limitRaw ? limit : existing.weeklyLimit;
      const finalDesc  = descRaw !== "" ? descRaw : existing.description;

      // Re-validate merged values that came from user input
      if (costRaw && (!Number.isInteger(finalCost) || finalCost < 0)) {
        await interaction.followUp({ content: "❌ Cost must be a whole number ≥ 0.", flags: MessageFlags.Ephemeral }); return;
      }
      if (sizeRaw && (!Number.isInteger(finalSize) || finalSize < 1 || finalSize > 10)) {
        await interaction.followUp({ content: "❌ Cards per open must be 1–10.", flags: MessageFlags.Ephemeral }); return;
      }
      if (limitRaw && (!Number.isInteger(finalLimit) || finalLimit < 0)) {
        await interaction.followUp({ content: "❌ Weekly limit must be ≥ 0 (0 = unlimited).", flags: MessageFlags.Ephemeral }); return;
      }

      await updateCustomPack(packId, {
        name: finalName, cost: finalCost, size: finalSize,
        weeklyLimit: finalLimit, description: finalDesc,
      });
      successMsg = `✅ Updated **${finalName}**.`;
    } else {
      // Create — all fields were required in the modal for new packs
      if (!Number.isInteger(cost) || cost < 0) {
        await interaction.followUp({ content: "❌ Cost must be a whole number ≥ 0.", flags: MessageFlags.Ephemeral }); return;
      }
      if (!Number.isInteger(size) || size < 1 || size > 10) {
        await interaction.followUp({ content: "❌ Cards per open must be 1–10.", flags: MessageFlags.Ephemeral }); return;
      }
      if (!Number.isInteger(limit) || limit < 0) {
        await interaction.followUp({ content: "❌ Weekly limit must be ≥ 0 (0 = unlimited).", flags: MessageFlags.Ephemeral }); return;
      }
      const created = await createCustomPack(guildId, nameRaw, cost, size, limit, DEFAULT_CUSTOM_PACK_RATES, [], descRaw);
      successMsg = `✅ Created **${created.name}**! It now appears in \`/pack\` autocomplete for this server.`;
    }
    const packs = await listCustomPacks(guildId, true);
    await interaction.editReply({
      content: successMsg,
      embeds: [buildCustomPacksEmbed(packs)],
      components: buildCustomPacksComponents(packs),
    });
  } catch {
    await interaction.followUp({
      content: "❌ Failed to save the pack. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
