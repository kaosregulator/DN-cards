// ─────────────────────────────────────────────────────────────────────────────
// /hqadmin — admin editor for a player's Headquarters & siege state.
//
// Part of the HQ addon: lets a server admin fix or reset a member's HQ without
// touching the base game. Everything here only reads/writes the HQ's own tables
// (via bot/hq/db.ts) — grant/revoke earned cosmetics, set the cached HQ level,
// reset a stuck base capture, and clear defenders/placements. Admin-gated the
// same way as /admin and /edit-user.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { isAdmin } from "../db.js";
import {
  getOrCreateHq, updateHq, getUnlockedItemIds, grantUnlock,
  clearUnlocks, clearAllDefenders, clearAllPlacements, resetBaseState, getBaseState,
} from "../hq/db.js";
import { reconcileUnlocks } from "../hq/engine.js";
import { HQ_DECORATIONS } from "../hq/defs/decorations.js";
import { HQ_ROOMS } from "../hq/defs/rooms.js";
import { HQ_THEMES } from "../hq/defs/themes.js";
import { HQ_WALLS } from "../hq/defs/walls.js";
import { HQ_FLOORS } from "../hq/defs/floors.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

async function checkAdmin(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

// Grant every cosmetic (each registry item) to the target — a fast "unlock all".
async function grantEverything(guildId: string, userId: string): Promise<void> {
  for (const d of HQ_DECORATIONS) await grantUnlock(guildId, userId, d.id, "decoration", "admin").catch(() => {});
  for (const r of HQ_ROOMS) await grantUnlock(guildId, userId, r.id, "room", "admin").catch(() => {});
  for (const t of HQ_THEMES) await grantUnlock(guildId, userId, t.id, "theme", "admin").catch(() => {});
  for (const w of HQ_WALLS) await grantUnlock(guildId, userId, w.id, "wall", "admin").catch(() => {});
  for (const f of HQ_FLOORS) await grantUnlock(guildId, userId, f.id, "floor", "admin").catch(() => {});
}

// ── Slash entry ───────────────────────────────────────────────────────────────
export async function handleHqAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ Server only.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  if (!(await checkAdmin(interaction))) {
    await interaction.reply({ content: "❌ Admins only.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const target = interaction.options.getUser("user", true);
  await interaction.reply({ ...(await buildPanel(interaction.guildId, target.id, target.username)), ...EPHEMERAL }).catch(() => {});
}

async function buildPanel(guildId: string, targetId: string, targetName: string, notice?: string) {
  const hq = await getOrCreateHq(guildId, targetId);
  const owned = await getUnlockedItemIds(guildId, targetId);
  const state = await getBaseState(guildId, targetId);
  const held = state?.heldByUserId ? `🚩 held by ${state.heldByName ?? "a rival"}` : "not captured";
  const totalItems = HQ_DECORATIONS.length + HQ_ROOMS.length + HQ_THEMES.length + HQ_WALLS.length + HQ_FLOORS.length;

  const embed = new EmbedBuilder()
    .setColor(0xb5382c)
    .setTitle(`🛠️ HQ Admin — ${targetName}`)
    .setDescription(`Editing **${targetName}**'s Headquarters. Changes touch only HQ data.${notice ? `\n\n✅ ${notice}` : ""}`)
    .addFields(
      { name: "HQ Level", value: `**${hq.hqLevel}**`, inline: true },
      { name: "Unlocks", value: `**${owned.size}** / ${totalItems}`, inline: true },
      { name: "Theme / Wall / Floor", value: `${hq.themeId} · ${hq.wallId} · ${hq.floorId}`, inline: false },
      { name: "Base", value: held, inline: true },
    );

  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hqadmin:level:${targetId}`).setLabel("Set HQ Level").setEmoji("🔢").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hqadmin:grantall:${targetId}`).setLabel("Unlock everything").setEmoji("🔓").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hqadmin:reconcile:${targetId}`).setLabel("Re-sync from progress").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hqadmin:resetbase:${targetId}`).setLabel("Reset base capture").setEmoji("🏳️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`hqadmin:cleardef:${targetId}`).setLabel("Clear defenders").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hqadmin:revokeall:${targetId}`).setLabel("Revoke all unlocks").setEmoji("🧹").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`hqadmin:wipe:${targetId}`).setLabel("Wipe layout").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    ),
  ];
  return { embeds: [embed], components: rows };
}

// ── Component router ────────────────────────────────────────────────────────────
export async function handleHqAdminComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.guildId) return;
  if (!(await checkAdmin(interaction))) { await interaction.reply({ content: "❌ Admins only.", ...EPHEMERAL }).catch(() => {}); return; }
  const [, action, targetId] = interaction.customId.split(":");
  const guildId = interaction.guildId;
  const targetName = (await interaction.guild?.members.fetch(targetId!).catch(() => null))?.user.username ?? "player";

  if (action === "level") {
    const hq = await getOrCreateHq(guildId, targetId!);
    const modal = new ModalBuilder().setCustomId(`hqadmin:setlevel:${targetId}`).setTitle("Set HQ Level")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("level").setLabel("HQ level (1–100)").setStyle(TextInputStyle.Short)
          .setRequired(true).setMaxLength(3).setValue(String(hq.hqLevel))));
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  let notice = "";
  if (action === "grantall") { await grantEverything(guildId, targetId!); notice = "Unlocked every theme, room, wall, floor & decoration."; }
  else if (action === "revokeall") { await clearUnlocks(guildId, targetId!); notice = "Revoked all earned unlocks (they re-earn on next /hq)."; }
  else if (action === "reconcile") { await reconcileUnlocks(guildId, targetId!).catch(() => {}); notice = "Re-synced unlocks & HQ level from real progress."; }
  else if (action === "resetbase") { await resetBaseState(guildId, targetId!); notice = "Cleared base capture & shield."; }
  else if (action === "cleardef") { await clearAllDefenders(guildId, targetId!); notice = "Removed all base defenders."; }
  else if (action === "wipe") { await clearAllPlacements(guildId, targetId!); await clearAllDefenders(guildId, targetId!); notice = "Wiped placements & defenders (layout reset)."; }
  else return;

  await interaction.update(await buildPanel(guildId, targetId!, targetName, notice)).catch(() => {});
}

// ── Modal (set level) ───────────────────────────────────────────────────────────
export async function handleHqAdminModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId) return;
  if (!(await checkAdmin(interaction))) return;
  const [, , targetId] = interaction.customId.split(":"); // hqadmin:setlevel:<id>
  const raw = Number(interaction.fields.getTextInputValue("level"));
  const level = Math.max(1, Math.min(100, Number.isFinite(raw) ? Math.round(raw) : 1));
  await updateHq(interaction.guildId, targetId!, { hqLevel: level }).catch(() => {});
  const targetName = (await interaction.guild?.members.fetch(targetId!).catch(() => null))?.user.username ?? "player";
  const panel = await buildPanel(interaction.guildId, targetId!, targetName, `Set HQ level to ${level}.`);
  if (interaction.isFromMessage()) await interaction.update(panel).catch(() => {});
  else await interaction.reply({ ...panel, ...EPHEMERAL }).catch(() => {});
}
