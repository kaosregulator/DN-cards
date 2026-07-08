// /battleadmin — the graphical Admin Battle Hub + first-time Setup Wizard.
//
// One ephemeral, button-driven control panel where an admin configures the whole
// per-guild battle system: enable/disable, channels, combat rules & formulas,
// card eligibility + per-card edits, rewards, and management (leaderboard/season
// resets, global-leaderboard opt-in). Everything is saved to battle_settings
// (per guild). The Setup Wizard is a one-click "sensible defaults + mark ready"
// path so a fresh server can start battling immediately.

import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { isAdmin, getAllCards, getCardByName } from "../db.js";
import { getBattleSettings, updateBattleSettings, RARITY_ORDER } from "../battle/config-engine.js";
import { resetSeason } from "../battle/season-engine.js";
import { upsertBattleCardConfig } from "../battle/db.js";
import { db, battleProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SPECIAL_EFFECT_KEYS } from "../battle/special-cards.js";
import { RARITY_LABELS, RARITY_EMOJI } from "../cards-data.js";
import type { Rarity } from "../cards-data.js";

// ── Entry ────────────────────────────────────────────────────────────────────
export async function handleBattleAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await ensureAdmin(interaction))) return;
  await interaction.editReply({ embeds: [await buildHubEmbed(interaction.guild.id)], components: buildHubComponents() });
}

// ── Button router ────────────────────────────────────────────────────────────
export async function handleBattleAdminButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const action = interaction.customId.split(":")[1];

  // Modal-opening actions must call showModal FIRST (can't defer).
  if (["rules", "formulas", "rewards", "editcard"].includes(action)) {
    if (!ensureAdminInline(interaction)) { await interaction.reply({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral }); return; }
    const settings = await getBattleSettings(interaction.guild.id);
    if (action === "rules") await interaction.showModal(buildRulesModal(settings));
    if (action === "formulas") await interaction.showModal(buildFormulasModal(settings));
    if (action === "rewards") await interaction.showModal(buildRewardsModal(settings));
    if (action === "editcard") await interaction.showModal(buildEditCardModal());
    return;
  }

  await interaction.deferUpdate().catch(() => {});
  if (!(await ensureAdmin(interaction, true))) return;
  const guildId = interaction.guild.id;

  switch (action) {
    case "wizard": {
      await updateBattleSettings(guildId, {
        enabled: true, setupComplete: true,
        battleChannelId: null,      // allow any channel by default (minimal setup)
        logChannelId: interaction.channelId,
      });
      await interaction.followUp({
        content: "✅ **Setup complete!** Battles are now live. Players can use `/battle fight`. "
          + "Battles are allowed in any channel (set a dedicated one under **Channels**), and results log here. "
          + "Fine-tune rules, rewards, and card eligibility with the buttons above.",
        flags: MessageFlags.Ephemeral,
      });
      break;
    }
    case "toggle": {
      const s = await getBattleSettings(guildId);
      await updateBattleSettings(guildId, { enabled: !s.enabled });
      break;
    }
    case "globaltoggle": {
      const s = await getBattleSettings(guildId);
      await updateBattleSettings(guildId, { globalLeaderboardOptIn: !s.globalLeaderboardOptIn });
      break;
    }
    case "specialtoggle": {
      const s = await getBattleSettings(guildId);
      await updateBattleSettings(guildId, { specialCardsEnabled: !s.specialCardsEnabled });
      break;
    }
    case "staketoggle": {
      const s = await getBattleSettings(guildId);
      await updateBattleSettings(guildId, { stakingEnabled: !s.stakingEnabled });
      break;
    }
    case "aitoggle": {
      const s = await getBattleSettings(guildId);
      await updateBattleSettings(guildId, { aiEnabled: !s.aiEnabled });
      break;
    }
    case "cards": {
      await interaction.editReply({ embeds: [await buildCardsEmbed(guildId)], components: await buildCardsComponents(guildId) });
      return;
    }
    case "channels": {
      await interaction.editReply({ embeds: [await buildChannelsEmbed(guildId)], components: buildChannelsComponents() });
      return;
    }
    case "resetlb": {
      await interaction.followUp({
        content: "⚠️ Reset the leaderboard? This zeroes everyone's **rank points & current streak** (lifetime W/L and stats are kept).",
        components: [confirmRow("resetlb_confirm")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case "resetlb_confirm": {
      await db.update(battleProfilesTable).set({ rankPoints: 1000, currentStreak: 0, updatedAt: new Date() })
        .where(eq(battleProfilesTable.guildId, guildId));
      await interaction.followUp({ content: "🏆 Leaderboard reset — everyone starts fresh at 1000 RP.", flags: MessageFlags.Ephemeral });
      break;
    }
    case "season": {
      await interaction.followUp({
        content: "⚠️ Start a new season? The current season ends, ranks soft-reset to 1000, and lifetime stats are preserved.",
        components: [confirmRow("season_confirm")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case "season_confirm": {
      const res = await resetSeason(guildId);
      const podium = res.topThree.length
        ? res.topThree.map((p, i) => `${["🥇", "🥈", "🥉"][i]} <@${p.userId}> — ${p.rankPoints} RP`).join("\n")
        : "_No ranked players last season._";
      await interaction.followUp({
        content: `🔄 **${res.newSeason.name}** has begun!\n\n**Previous season podium:**\n${podium}`,
        allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
      });
      break;
    }
    case "hub":
    default:
      break;
  }
  await interaction.editReply({ embeds: [await buildHubEmbed(guildId)], components: buildHubComponents() }).catch(() => {});
}

// ── Select router (rarity min/max + allowed types) ───────────────────────────
export async function handleBattleAdminSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate().catch(() => {});
  if (!(await ensureAdmin(interaction, true))) return;
  const action = interaction.customId.split(":")[1];
  const guildId = interaction.guild.id;

  if (action === "minrarity") await updateBattleSettings(guildId, { minRarity: interaction.values[0] });
  else if (action === "maxrarity") await updateBattleSettings(guildId, { maxRarity: interaction.values[0] });
  else if (action === "types") {
    const values = interaction.values.includes("__all__") ? null : interaction.values;
    await updateBattleSettings(guildId, { allowedTypes: values });
  }
  await interaction.editReply({ embeds: [await buildCardsEmbed(guildId)], components: await buildCardsComponents(guildId) }).catch(() => {});
}

// ── Channel select router ────────────────────────────────────────────────────
export async function handleBattleAdminChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate().catch(() => {});
  if (!(await ensureAdmin(interaction, true))) return;
  const action = interaction.customId.split(":")[1];
  const guildId = interaction.guild.id;
  const channelId = interaction.values[0] ?? null;
  if (action === "battlechan") await updateBattleSettings(guildId, { battleChannelId: channelId });
  else if (action === "logchan") await updateBattleSettings(guildId, { logChannelId: channelId });
  await interaction.editReply({ embeds: [await buildChannelsEmbed(guildId)], components: buildChannelsComponents() }).catch(() => {});
}

// ── Modal router ─────────────────────────────────────────────────────────────
export async function handleBattleAdminModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await ensureAdmin(interaction))) return;
  const action = interaction.customId.split(":")[1];
  const guildId = interaction.guild.id;

  const num = (id: string, min: number, max: number, cur: number): number => {
    const raw = interaction.fields.getTextInputValue(id).trim();
    if (raw === "") return cur;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return cur;
    return Math.max(min, Math.min(max, n));
  };
  const settings = await getBattleSettings(guildId);

  if (action === "rules") {
    await updateBattleSettings(guildId, {
      turnTimerSeconds: num("turn", 10, 300, settings.turnTimerSeconds),
      critChancePct: num("crit", 0, 100, settings.critChancePct),
      missChancePct: num("miss", 0, 90, settings.missChancePct),
      dodgeChancePct: num("dodge", 0, 90, settings.dodgeChancePct),
      shieldStrengthPct: num("shield", 0, 100, settings.shieldStrengthPct),
    });
    await interaction.editReply("✅ Combat rules updated.");
  } else if (action === "formulas") {
    await updateBattleSettings(guildId, {
      hpBase: num("hp", 100, 100000, settings.hpBase),
      attackBase: num("atk", 10, 100000, settings.attackBase),
      defenseBase: num("def", 0, 100000, settings.defenseBase),
      energyGainPerTurn: num("energy", 0, 100, settings.energyGainPerTurn),
      ultimateChargePerTurn: num("ult", 1, 100, settings.ultimateChargePerTurn),
    });
    await interaction.editReply("✅ Stat formulas updated. (New battles use the new numbers.)");
  } else if (action === "rewards") {
    await updateBattleSettings(guildId, {
      rewardWinShards: num("winshards", 0, 1000000, settings.rewardWinShards),
      rewardLossShards: num("lossshards", 0, 1000000, settings.rewardLossShards),
      rewardWinXp: num("winxp", 0, 100000, settings.rewardWinXp),
      dailyRewardLimit: num("dailylimit", 0, 10000, settings.dailyRewardLimit),
      freePackStreak: num("packstreak", 0, 1000, settings.freePackStreak),
    });
    await interaction.editReply("✅ Rewards updated.");
  } else if (action === "editcard") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const card = await getCardByName(name);
    if (!card) { await interaction.editReply(`❌ No card named **${name}** found.`); return; }
    const enabledRaw = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
    const enabled = enabledRaw === "" ? true : ["yes", "y", "true", "on", "1"].includes(enabledRaw);
    const effect = interaction.fields.getTextInputValue("special").trim().toLowerCase();
    const validEffect = effect === "" ? null : (SPECIAL_EFFECT_KEYS as string[]).includes(effect) ? effect : undefined;
    if (validEffect === undefined) {
      await interaction.editReply(`❌ Unknown special effect \`${effect}\`. Valid: ${SPECIAL_EFFECT_KEYS.join(", ")}`);
      return;
    }
    const stats = parseStatList(interaction.fields.getTextInputValue("stats"));
    await upsertBattleCardConfig(guildId, card.id, {
      enabled, specialEffect: validEffect,
      health: stats.health ?? null, attack: stats.attack ?? null, defense: stats.defense ?? null,
    }, interaction.user.id);
    await interaction.editReply(
      `✅ **${card.name}** updated for battles — ${enabled ? "enabled" : "**disabled**"}`
      + (validEffect ? ` · special: \`${validEffect}\`` : "")
      + (stats.health || stats.attack || stats.defense ? ` · overrides applied` : ""));
  }
}

// `health,attack,defense` (any subset, blank entries skipped)
function parseStatList(raw: string): { health?: number; attack?: number; defense?: number } {
  const parts = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  const keys: Array<"health" | "attack" | "defense"> = ["health", "attack", "defense"];
  const out: { health?: number; attack?: number; defense?: number } = {};
  parts.forEach((p, i) => {
    const n = Math.round(Number(p));
    if (keys[i] && Number.isFinite(n) && n > 0) out[keys[i]!] = n;
  });
  return out;
}

// ── Embeds ───────────────────────────────────────────────────────────────────
async function buildHubEmbed(guildId: string): Promise<EmbedBuilder> {
  const s = await getBattleSettings(guildId);
  const onoff = (b: boolean) => b ? "✅ On" : "⏸️ Off";
  return new EmbedBuilder()
    .setColor(s.setupComplete ? 0xed4245 : 0xfaa61a)
    .setTitle("🛡️ Battle Admin Hub")
    .setDescription(s.setupComplete
      ? "Battles are configured. Adjust anything below — every change saves for **this server only**."
      : "⚠️ **Battles aren't active yet.** Click **Setup Wizard** to enable them with sensible defaults.")
    .addFields(
      { name: "Status", value: `${onoff(s.enabled)} · Setup ${s.setupComplete ? "✅ complete" : "❌ pending"}`, inline: true },
      { name: "Battle Channel", value: s.battleChannelId ? `<#${s.battleChannelId}>` : "Any channel", inline: true },
      { name: "Log Channel", value: s.logChannelId ? `<#${s.logChannelId}>` : "None", inline: true },
      { name: "Rules", value: `⏱️ ${s.turnTimerSeconds}s · 💥 ${s.critChancePct}% crit · 💨 ${s.missChancePct}% miss · 🌀 ${s.dodgeChancePct}% dodge`, inline: false },
      { name: "Cards", value: `${RARITY_LABELS[s.minRarity as Rarity]} → ${RARITY_LABELS[s.maxRarity as Rarity]} · Types: ${s.allowedTypes?.length ? s.allowedTypes.join(", ") : "All"} · Special ${onoff(s.specialCardsEnabled)} · Stake ${onoff(s.stakingEnabled)}`, inline: false },
      { name: "Rewards", value: `💠 Win ${s.rewardWinShards} / Loss ${s.rewardLossShards} · ✨ ${s.rewardWinXp} XP · Daily cap ${s.dailyRewardLimit} · 🎁 pack every ${s.freePackStreak || "—"} streak`, inline: false },
      { name: "Toggles", value: `AI ${onoff(s.aiEnabled)} · Global LB ${onoff(s.globalLeaderboardOptIn)}`, inline: false },
    );
}

function buildHubComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("battleadmin:wizard").setLabel("Setup Wizard").setEmoji("🚀").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("battleadmin:toggle").setLabel("Enable/Disable").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("battleadmin:channels").setLabel("Channels").setEmoji("📡").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("battleadmin:rules").setLabel("Rules").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("battleadmin:formulas").setLabel("Formulas").setEmoji("🧮").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("battleadmin:rewards").setLabel("Rewards").setEmoji("🎁").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("battleadmin:cards").setLabel("Cards").setEmoji("🎴").setStyle(ButtonStyle.Primary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("battleadmin:resetlb").setLabel("Reset Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("battleadmin:season").setLabel("New Season").setEmoji("🔄").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("battleadmin:globaltoggle").setLabel("Global LB").setEmoji("🌐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("battleadmin:hub").setLabel("Refresh").setEmoji("♻️").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

async function buildCardsEmbed(guildId: string): Promise<EmbedBuilder> {
  const s = await getBattleSettings(guildId);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎴 Battle Card Settings")
    .setDescription("Choose which cards can battle by rarity + type, toggle special cards & staking, and fine-tune individual cards with **Edit Card**.")
    .addFields(
      { name: "Rarity Window", value: `${RARITY_EMOJI[s.minRarity as Rarity]} ${RARITY_LABELS[s.minRarity as Rarity]} → ${RARITY_EMOJI[s.maxRarity as Rarity]} ${RARITY_LABELS[s.maxRarity as Rarity]}`, inline: false },
      { name: "Allowed Types", value: s.allowedTypes?.length ? s.allowedTypes.join(", ") : "All types", inline: false },
      { name: "Special Cards", value: s.specialCardsEnabled ? "✅ Enabled" : "⏸️ Disabled", inline: true },
      { name: "Staking", value: s.stakingEnabled ? "✅ Enabled" : "⏸️ Disabled", inline: true },
    );
}

async function buildCardsComponents(guildId: string): Promise<ActionRowBuilder<any>[]> {
  const s = await getBattleSettings(guildId);
  const rarityOptions = (selected: string) => RARITY_ORDER.map(r => ({
    label: RARITY_LABELS[r], emoji: RARITY_EMOJI[r], value: r, default: selected === r,
  }));

  const minRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("battleadmin:minrarity").setPlaceholder("Minimum rarity").addOptions(rarityOptions(s.minRarity)),
  );
  const maxRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("battleadmin:maxrarity").setPlaceholder("Maximum rarity").addOptions(rarityOptions(s.maxRarity)),
  );

  // Distinct card types present in the roster.
  const cards = await getAllCards();
  const types = Array.from(new Set(cards.map(c => (c.cardType ?? "").toLowerCase()).filter(Boolean))).slice(0, 24);
  const selected = new Set((s.allowedTypes ?? []).map(t => t.toLowerCase()));
  const typeOptions = [
    { label: "All types", value: "__all__", default: !s.allowedTypes || s.allowedTypes.length === 0 },
    ...types.map(t => ({ label: t, value: t, default: selected.has(t) })),
  ];
  const typeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("battleadmin:types").setPlaceholder("Allowed card types")
      .setMinValues(1).setMaxValues(typeOptions.length).addOptions(typeOptions),
  );

  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("battleadmin:editcard").setLabel("Edit Card").setEmoji("✏️").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("battleadmin:specialtoggle").setLabel("Toggle Special Cards").setEmoji("✨").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("battleadmin:staketoggle").setLabel("Toggle Staking").setEmoji("💰").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("battleadmin:hub").setLabel("Back").setStyle(ButtonStyle.Secondary),
  );
  return [minRow, maxRow, typeRow, btnRow];
}

async function buildChannelsEmbed(guildId: string): Promise<EmbedBuilder> {
  const s = await getBattleSettings(guildId);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📡 Battle Channels")
    .setDescription("Pick where battles can start and where results are logged. Leave the battle channel empty to allow battles anywhere.")
    .addFields(
      { name: "Battle Channel", value: s.battleChannelId ? `<#${s.battleChannelId}>` : "Any channel", inline: true },
      { name: "Log Channel", value: s.logChannelId ? `<#${s.logChannelId}>` : "None", inline: true },
    );
}

function buildChannelsComponents(): ActionRowBuilder<any>[] {
  return [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder().setCustomId("battleadmin:battlechan").setPlaceholder("⚔️ Battle channel (optional)")
        .addChannelTypes(ChannelType.GuildText),
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder().setCustomId("battleadmin:logchan").setPlaceholder("📜 Log channel")
        .addChannelTypes(ChannelType.GuildText),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("battleadmin:hub").setLabel("Back").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function confirmRow(confirmAction: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`battleadmin:${confirmAction}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("battleadmin:noop").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

// ── Modals ───────────────────────────────────────────────────────────────────
function shortInput(id: string, label: string, value: string | number, ph?: string): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
      .setRequired(false).setValue(String(value)).setPlaceholder(ph ?? String(value)),
  );
}

function buildRulesModal(s: Awaited<ReturnType<typeof getBattleSettings>>): ModalBuilder {
  return new ModalBuilder().setCustomId("battleadmin:rules").setTitle("Combat Rules").addComponents(
    shortInput("turn", "Turn timer (seconds, 10-300)", s.turnTimerSeconds),
    shortInput("crit", "Critical chance % (0-100)", s.critChancePct),
    shortInput("miss", "Miss chance % (0-90)", s.missChancePct),
    shortInput("dodge", "Dodge chance % (0-90)", s.dodgeChancePct),
    shortInput("shield", "Shield strength % of max HP (0-100)", s.shieldStrengthPct),
  );
}

function buildFormulasModal(s: Awaited<ReturnType<typeof getBattleSettings>>): ModalBuilder {
  return new ModalBuilder().setCustomId("battleadmin:formulas").setTitle("Stat Formulas").addComponents(
    shortInput("hp", "Base HP", s.hpBase),
    shortInput("atk", "Base Attack", s.attackBase),
    shortInput("def", "Base Defense", s.defenseBase),
    shortInput("energy", "Energy gain / turn", s.energyGainPerTurn),
    shortInput("ult", "Ultimate charge / turn", s.ultimateChargePerTurn),
  );
}

function buildRewardsModal(s: Awaited<ReturnType<typeof getBattleSettings>>): ModalBuilder {
  return new ModalBuilder().setCustomId("battleadmin:rewards").setTitle("Rewards").addComponents(
    shortInput("winshards", "Shards on win", s.rewardWinShards),
    shortInput("lossshards", "Shards on loss", s.rewardLossShards),
    shortInput("winxp", "XP on win", s.rewardWinXp),
    shortInput("dailylimit", "Daily rewarded-battles cap", s.dailyRewardLimit),
    shortInput("packstreak", "Free pack every N win streak (0=off)", s.freePackStreak),
  );
}

function buildEditCardModal(): ModalBuilder {
  return new ModalBuilder().setCustomId("battleadmin:editcard").setTitle("Edit Battle Card").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Card name").setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("enabled").setLabel("Usable in battle? (yes/no)").setStyle(TextInputStyle.Short)
        .setRequired(false).setPlaceholder("yes")),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("special").setLabel("Special effect (blank = none)").setStyle(TextInputStyle.Short)
        .setRequired(false).setPlaceholder("heal, shield, nuke, poison, …")),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("stats").setLabel("Stat overrides: health,attack,defense").setStyle(TextInputStyle.Short)
        .setRequired(false).setPlaceholder("e.g. 1200,140,90 (blank = auto)")),
  );
}

// ── Admin gating ─────────────────────────────────────────────────────────────
function ensureAdminInline(interaction: ButtonInteraction): boolean {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return !!interaction.memberPermissions?.has("Administrator");
}

async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | ModalSubmitInteraction,
  useFollowUp = false,
): Promise<boolean> {
  if (!interaction.guild) return false;
  const allowed =
    interaction.guild.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has("Administrator") ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!allowed) {
    const msg = "❌ Only admins can use the Battle Admin Hub.";
    if (useFollowUp) await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    else if ("editReply" in interaction) await interaction.editReply(msg).catch(() => {});
  }
  return !!allowed;
}
