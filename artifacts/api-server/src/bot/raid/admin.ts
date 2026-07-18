// /raid_admin — boss management for server admins. Create, edit, list, delete,
// and enable/disable the co-op raid bosses players can fight.

import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags, PermissionFlagsBits, type GuildMember } from "discord.js";
import type { RaidBoss } from "@workspace/db";
import { createBoss, updateBoss, deleteBoss, getAllBosses, getBossByName } from "./db.js";
import { starString, levelForStars } from "../cards/leveling.js";
import { getRaidFrames } from "../cards/frames.js";
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
  const frame = b.rewardFrameId ? getRaidFrames().find(f => f.id === b.rewardFrameId) : null;
  return `\`#${b.id}\` **${b.name}** ${b.enabled ? "🟢" : "⚪"} · seq ${b.sequence}\n` +
    `HP ${b.baseHealth.toLocaleString()} · ATK ${b.baseAttack} · DEF ${b.baseDefense} · ` +
    `gate ${starString(b.minStars)} (Lv ${levelForStars(b.minStars)}) · ${b.minPlayers}-${b.maxPlayers}p · ` +
    `enrage r${b.enrageTurn || "—"} · 💠 ${b.rewardShards}/+${b.rewardCardXp}xp\n` +
    `🎁 reward: ${frame ? `${frame.emoji} ${frame.name}` : "🐉 Raid Champion"}` +
    (b.cardId != null ? ` · 🃏 boss card #${b.cardId}` : " · no boss card");
}

// Resolve the reward-related options (boss card LINK, exclusive frame, ladder
// sequence) into a boss patch. Returns an error string on a bad value. Does NOT
// auto-create a card — that's ensureBossCard, called separately once the caller
// knows whether a card still needs to exist.
async function resolveRewardFields(
  interaction: ChatInputCommandInteraction, guildId: string,
): Promise<{ patch: Partial<RaidBoss> } | { error: string }> {
  const patch: Partial<RaidBoss> = {};
  const cardName = interaction.options.getString("cardname");
  if (cardName) {
    const { getCardByName } = await import("../db.js");
    const card = await getCardByName(cardName, guildId);
    if (!card) return { error: `❌ No card named "**${cardName}**" to link as the boss card. Check \`/list\`.` };
    patch.cardId = card.id;
    // Linking an existing card as a boss card marks it untradeable (unless the
    // server opts in) just like an auto-created one.
    const { markCardAsBoss } = await import("../db.js");
    await markCardAsBoss(card.id);
  }
  const frame = interaction.options.getString("frame");
  if (frame) {
    const f = getRaidFrames().find(rf => rf.id === frame);
    if (!f) return { error: `❌ Unknown raid frame. Options: ${getRaidFrames().map(x => x.name).join(", ")}.` };
    patch.rewardFrameId = f.id;
  }
  const seq = interaction.options.getInteger("sequence");
  if (seq != null) patch.sequence = seq;
  return { patch };
}

// Every boss needs a real, rewardable card. If nothing was explicitly linked
// (via `cardname`), auto-create one in the boss's own image: same name,
// description, rarity, and art — admin-drop-only (never spawns/packs), flagged
// isBossCard so it's untradeable by default and usable in battle.
async function ensureBossCard(
  guildId: string, createdBy: string,
  name: string, description: string | null, rarity: string, imageUrl: string | null,
): Promise<number> {
  const { addCard } = await import("../db.js");
  const { RARITY_WORTH, RARITY_BURN } = await import("../cards-data.js");
  const r = (VALID_RARITIES.includes(rarity) ? rarity : "mythic") as keyof typeof RARITY_WORTH;
  const card = await addCard({
    name, description: description ?? `The boss card for **${name}**.`,
    rarity: r, cardType: "boss",
    dropWeight: 0, worthValue: RARITY_WORTH[r], burnValue: RARITY_BURN[r],
    imageUrl: imageUrl ?? undefined,
    droppable: false, inPacks: false, isBossCard: true, isLimitedEdition: true,
  }, guildId);
  void createdBy; // reserved for future createdBy tracking on cards
  return card.id;
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

    const reward = await resolveRewardFields(interaction, guildId);
    if ("error" in reward) { await interaction.editReply(reward.error); return; }
    const description = interaction.options.getString("description") ?? null;

    // Every boss needs a rewardable card. If the admin didn't link an existing
    // one via `cardname`, auto-create one now in the boss's own image.
    if (reward.patch.cardId == null) {
      reward.patch.cardId = await ensureBossCard(guildId, interaction.user.id, name, description, rarity, imageUrl);
    }

    const boss = await createBoss({
      ...reward.patch,
      guildId, name, createdBy: interaction.user.id,
      description,
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

  if (sub === "bosscardtrades") {
    const on = interaction.options.getBoolean("enabled", true);
    const { updateGuildSettings } = await import("../db.js");
    await updateGuildSettings(guildId, { allowBossCardTrades: on });
    await interaction.editReply(
      on
        ? "✅ Boss cards can now be **traded** on this server."
        : "🐉 Boss cards are now **untradeable** again — only earned through raids.",
    );
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
    const reward = await resolveRewardFields(interaction, guildId);
    if ("error" in reward) { await interaction.editReply(reward.error); return; }
    Object.assign(patch, reward.patch);

    // Backfill: a boss created before boss-cards existed (or otherwise missing
    // one) gets one auto-created the next time it's edited — no extra flags
    // needed, this alone is enough to "fix" an old boss.
    let backfilled = false;
    if (boss.cardId == null && patch.cardId == null) {
      patch.cardId = await ensureBossCard(
        guildId, interaction.user.id, boss.name,
        patch.description ?? boss.description, boss.rarity, patch.imageUrl ?? boss.imageUrl,
      );
      backfilled = true;
    }

    if (Object.keys(patch).length === 0) { await interaction.editReply("Nothing to change — pass at least one field to edit."); return; }
    const updated = await updateBoss(boss.id, patch);
    await interaction.editReply({
      content: `✅ Updated **${boss.name}**.` + (backfilled ? " (Auto-created its missing boss card.)" : ""),
      embeds: [new EmbedBuilder().setColor(0x3498db).setDescription(bossSummary(updated!))],
    });
    return;
  }

  await interaction.editReply("Unknown raidadmin action.");
}

async function getBossByNameExact(guildId: string, name: string): Promise<RaidBoss | null> {
  const all = await getAllBosses(guildId);
  const q = name.toLowerCase();
  return all.find(b => b.name.toLowerCase() === q) ?? null;
}
