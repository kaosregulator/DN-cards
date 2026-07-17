// /raid_admin — boss management for server admins. Create, edit, list, delete,
// and enable/disable the co-op raid bosses players can fight.

import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags, PermissionFlagsBits, type GuildMember } from "discord.js";
import type { RaidBoss } from "@workspace/db";
import { createBoss, updateBoss, deleteBoss, getAllBosses, getBossByName } from "./db.js";
import { starString, levelForStars } from "../cards/leveling.js";
import { persistBotImage } from "../commands/edit-card.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const VALID_ARCHETYPES = ["boss", "tank", "ship", "aircraft", "vehicle", "infantry", "community"];
const VALID_RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const VALID_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function isAdmin(member: GuildMember | null): boolean {
  return !!member?.permissions.has(PermissionFlagsBits.Administrator);
}

function validateImageAttachment(att: import("discord.js").Attachment | null): { ok: true } | { ok: false; reason: string } {
  if (!att) return { ok: true };
  const ct = att.contentType ?? "application/octet-stream";
  if (!VALID_IMAGE_MIME_TYPES.includes(ct)) {
    return { ok: false, reason: `❌ Image must be one of: PNG, JPEG, WebP, GIF (got ${ct}).` };
  }
  return { ok: true };
}

function isEphemeralImage(savedUrl: string, originalUrl: string): boolean {
  return savedUrl === originalUrl && !savedUrl.includes("storage.googleapis.com");
}

// Persist an optional named attachment. Returns the stored URL, "" when the
// option was omitted, or false when persistence failed (caller should abort).
async function persistOptionalImage(
  interaction: ChatInputCommandInteraction, optName: string,
): Promise<string | false> {
  const att = interaction.options.getAttachment(optName);
  if (!att) return "";
  const validation = validateImageAttachment(att);
  if (!validation.ok) return false;
  const persisted = await persistBotImage(att.url, att.contentType ?? undefined);
  if (isEphemeralImage(persisted, att.url)) return false;
  return persisted;
}

function bossSummary(b: RaidBoss): string {
  return `\`#${b.id}\` **${b.name}** ${b.enabled ? "🟢" : "⚪"}\n` +
    `HP ${b.baseHealth.toLocaleString()} · ATK ${b.baseAttack} · DEF ${b.baseDefense} · ` +
    `gate ${starString(b.minStars)} (Lv ${levelForStars(b.minStars)}) · ${b.minPlayers}-${b.maxPlayers}p · ` +
    `enrage r${b.enrageTurn || "—"} · 💠 ${b.rewardShards}/+${b.rewardCardXp}xp`;
}

export async function handleRaidAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "❌ Server only.", ...EPHEMERAL }); return; }
  if (!isAdmin(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "❌ You need the **Administrator** permission for `/raid_admin`.", ...EPHEMERAL });
    return;
  }
  const guildId = guild.id;
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply(EPHEMERAL);

  if (sub === "list") {
    const bosses = await getAllBosses(guildId);
    if (bosses.length === 0) {
      await interaction.editReply("No raid bosses yet. Create one with `/raid_admin create name:<name>`.");
      return;
    }
    const embed = new EmbedBuilder().setTitle("🐉 Raid Bosses").setColor(0xc0392b)
      .setDescription(bosses.map(bossSummary).join("\n\n").slice(0, 4000));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "create") {
    const name = interaction.options.getString("name", true).trim();
    if (await getBossByNameExact(guildId, name)) {
      await interaction.editReply(`❌ A boss called "**${name}**" already exists. Use \`/raid_admin edit\`.`);
      return;
    }
    const archetype = (interaction.options.getString("archetype") ?? "boss").toLowerCase();
    const rarity = (interaction.options.getString("rarity") ?? "mythic").toLowerCase();
    if (!VALID_ARCHETYPES.includes(archetype)) { await interaction.editReply(`❌ Archetype must be one of: ${VALID_ARCHETYPES.join(", ")}.`); return; }
    if (!VALID_RARITIES.includes(rarity)) { await interaction.editReply(`❌ Rarity must be one of: ${VALID_RARITIES.join(", ")}.`); return; }

    const imageAttachment = interaction.options.getAttachment("image");
    const validation = validateImageAttachment(imageAttachment);
    if (!validation.ok) { await interaction.editReply(validation.reason); return; }
    let imageUrl: string | null = null;
    if (imageAttachment) {
      const persisted = await persistBotImage(imageAttachment.url, imageAttachment.contentType ?? undefined);
      if (isEphemeralImage(persisted, imageAttachment.url)) {
        await interaction.editReply({ content: "⚠️ Image could not be saved permanently. Boss was not created — try again or check storage setup.", embeds: [] });
        return;
      }
      imageUrl = persisted;
    }

    const battlefieldUrl = await persistOptionalImage(interaction, "battlefield");
    if (battlefieldUrl === false) { await interaction.editReply("⚠️ Battlefield image could not be saved. Boss was not created — try again."); return; }

    const boss = await createBoss({
      guildId, name, createdBy: interaction.user.id,
      description: interaction.options.getString("description") ?? null,
      imageUrl,
      battlefieldUrl: battlefieldUrl || null,
      archetype, rarity,
      baseHealth: interaction.options.getInteger("health") ?? undefined,
      baseAttack: interaction.options.getInteger("attack") ?? undefined,
      baseDefense: interaction.options.getInteger("defense") ?? undefined,
      minStars: interaction.options.getInteger("minstars") ?? undefined,
      minPlayerLevel: interaction.options.getInteger("minlevel") ?? undefined,
      minPlayers: interaction.options.getInteger("minplayers") ?? undefined,
      maxPlayers: interaction.options.getInteger("maxplayers") ?? undefined,
      enrageTurn: interaction.options.getInteger("enrage") ?? undefined,
      healthScalingPct: interaction.options.getInteger("healthscaling") ?? undefined,
      rewardShards: interaction.options.getInteger("reward") ?? undefined,
      rewardCardXp: interaction.options.getInteger("cardxp") ?? undefined,
    });
    await interaction.editReply({
      content: `✅ Created raid boss **${boss.name}**. Players fight it with \`/raid start boss:${boss.name}\`.`,
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(bossSummary(boss))],
    });
    return;
  }

  // edit / delete / enable all target an existing boss by name.
  const targetName = interaction.options.getString("name", true);
  const boss = await getBossByName(guildId, targetName);
  if (!boss) { await interaction.editReply(`❌ No boss called "**${targetName}**". See \`/raid_admin list\`.`); return; }

  if (sub === "delete") {
    await deleteBoss(boss.id);
    await interaction.editReply(`🗑️ Deleted raid boss **${boss.name}**.`);
    return;
  }

  if (sub === "enable") {
    const on = interaction.options.getBoolean("enabled", true);
    await updateBoss(boss.id, { enabled: on });
    await interaction.editReply(`✅ **${boss.name}** is now **${on ? "enabled" : "disabled"}**.`);
    return;
  }

  if (sub === "edit") {
    const patch: Partial<RaidBoss> = {};
    const setInt = (opt: string, key: keyof RaidBoss) => { const v = interaction.options.getInteger(opt); if (v != null) (patch as Record<string, unknown>)[key] = v; };
    const setStr = (opt: string, key: keyof RaidBoss) => { const v = interaction.options.getString(opt); if (v != null) (patch as Record<string, unknown>)[key] = v; };
    setStr("description", "description");
    setInt("health", "baseHealth"); setInt("attack", "baseAttack"); setInt("defense", "baseDefense");
    setInt("minstars", "minStars"); setInt("minlevel", "minPlayerLevel");
    setInt("minplayers", "minPlayers"); setInt("maxplayers", "maxPlayers");
    setInt("enrage", "enrageTurn"); setInt("healthscaling", "healthScalingPct"); setInt("reward", "rewardShards"); setInt("cardxp", "rewardCardXp");
    const arch = interaction.options.getString("archetype");
    if (arch) { if (!VALID_ARCHETYPES.includes(arch.toLowerCase())) { await interaction.editReply(`❌ Bad archetype.`); return; } patch.archetype = arch.toLowerCase(); }
    const imageAttachment = interaction.options.getAttachment("image");
    if (imageAttachment) {
      const validation = validateImageAttachment(imageAttachment);
      if (!validation.ok) { await interaction.editReply(validation.reason); return; }
      const persistedUrl = await persistBotImage(imageAttachment.url, imageAttachment.contentType ?? undefined);
      if (isEphemeralImage(persistedUrl, imageAttachment.url)) {
        await interaction.editReply({ content: `⚠️ Image could not be saved permanently. Boss image was not updated.`, embeds: [] });
        return;
      }
      patch.imageUrl = persistedUrl;
    }
    const bf = await persistOptionalImage(interaction, "battlefield");
    if (bf === false) { await interaction.editReply("⚠️ Battlefield image could not be saved — nothing changed."); return; }
    if (bf) patch.battlefieldUrl = bf;
    if (Object.keys(patch).length === 0) { await interaction.editReply("Nothing to change — pass at least one field to edit."); return; }
    const updated = await updateBoss(boss.id, patch);
    await interaction.editReply({ content: `✅ Updated **${boss.name}**.`, embeds: [new EmbedBuilder().setColor(0x3498db).setDescription(bossSummary(updated!))] });
    return;
  }

  await interaction.editReply("Unknown raidadmin action.");
}

async function getBossByNameExact(guildId: string, name: string): Promise<RaidBoss | null> {
  const all = await getAllBosses(guildId);
  const q = name.toLowerCase();
  return all.find(b => b.name.toLowerCase() === q) ?? null;
}
