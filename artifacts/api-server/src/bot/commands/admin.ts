import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  isAdmin, addAdmin, removeAdmin, listAdmins,
  getOrCreateGuildSettings, updateGuildSettings,
  addCard, removeCard, getAllCards, addShards, catchCard,
} from "../db.js";
import { spawnCard, scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { RARITY_EMOJI, RARITY_LABELS, RARITY_WORTH, RARITY_BURN, type Rarity } from "../cards-data.js";

const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1,
};

// ── Permission check ──────────────────────────────────────────────────────────
async function checkAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

// ── Router ────────────────────────────────────────────────────────────────────
export async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  sub: string,
): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply();

  const ok = await checkAdmin(interaction);
  if (!ok) {
    await interaction.editReply("❌ You don't have permission to use admin commands.");
    return;
  }

  const guildId = interaction.guild.id;
  const opts = interaction.options;

  // ── setchannel ──────────────────────────────────────────────────────────────
  if (sub === "setchannel") {
    const channel = opts.getChannel("channel") ?? interaction.channel;
    if (!channel) { await interaction.editReply("❌ Could not determine the channel."); return; }
    await updateGuildSettings(guildId, { spawnChannelId: channel.id });
    await interaction.editReply(`✅ Spawn channel set to <#${channel.id}>.`);
    scheduleNextSpawn(guildId);
    return;
  }

  // ── setinterval ─────────────────────────────────────────────────────────────
  if (sub === "setinterval") {
    const fixedTime = opts.getString("time");
    const minStr = opts.getString("min");
    const maxStr = opts.getString("max");

    if (minStr && maxStr) {
      const min = parseTime(minStr);
      const max = parseTime(maxStr);
      if (!min || !max) {
        await interaction.editReply("❌ Invalid time format. Use `30m`, `1h`, `90s`, etc.");
        return;
      }
      await updateGuildSettings(guildId, { useRandomInterval: true, spawnIntervalMin: min, spawnIntervalMax: max });
      await interaction.editReply(`✅ Spawn interval → random **${minStr}** – **${maxStr}**.`);
    } else if (fixedTime) {
      const seconds = parseTime(fixedTime);
      if (!seconds) {
        await interaction.editReply("❌ Invalid time format. Use `30m`, `1h`, `90s`, etc.");
        return;
      }
      await updateGuildSettings(guildId, { useRandomInterval: false, spawnIntervalSeconds: seconds });
      await interaction.editReply(`✅ Spawn interval → fixed **${fixedTime}** (${seconds}s).`);
    } else {
      await interaction.editReply("❌ Provide either `time` for a fixed interval, or both `min` and `max` for a random range.");
      return;
    }
    scheduleNextSpawn(guildId);
    return;
  }

  // ── setwindow ───────────────────────────────────────────────────────────────
  if (sub === "setwindow") {
    const timeStr = opts.getString("time", true);
    const seconds = parseTime(timeStr);
    if (!seconds) { await interaction.editReply("❌ Invalid time. Use `2m`, `90s`, `1h`, etc."); return; }
    await updateGuildSettings(guildId, { catchWindowSeconds: seconds });
    await interaction.editReply(`✅ Catch window → **${timeStr}** (${seconds}s).`);
    return;
  }

  // ── enable / disable ────────────────────────────────────────────────────────
  if (sub === "enable") {
    await updateGuildSettings(guildId, { spawnEnabled: true });
    await interaction.editReply("✅ Card spawning **enabled**.");
    scheduleNextSpawn(guildId);
    return;
  }
  if (sub === "disable") {
    await updateGuildSettings(guildId, { spawnEnabled: false });
    clearSpawnTimer(guildId);
    await interaction.editReply("⏸️ Card spawning **disabled**.");
    return;
  }

  // ── drop ────────────────────────────────────────────────────────────────────
  if (sub === "drop") {
    const cardName = opts.getString("name");
    const settings = await getOrCreateGuildSettings(guildId);
    if (!settings.spawnChannelId) {
      await interaction.editReply("❌ No spawn channel set. Run `/card admin setchannel` first.");
      return;
    }
    let forcedCardId: number | undefined;
    if (cardName) {
      const cards = await getAllCards();
      const found = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (!found) {
        await interaction.editReply(`❌ Card "**${cardName}**" not found. Try \`/card list\`.`);
        return;
      }
      forcedCardId = found.id;
    }
    await spawnCard(guildId, forcedCardId, true);
    await interaction.editReply(forcedCardId ? `✅ Force-dropped **${cardName}**!` : "✅ Force-dropped a random card!");
    scheduleNextSpawn(guildId);
    return;
  }

  // ── addcard ─────────────────────────────────────────────────────────────────
  if (sub === "addcard") {
    const rarity = opts.getString("rarity", true) as Rarity;
    const name = opts.getString("name", true);
    const description = opts.getString("description") ?? "";
    const card = await addCard({
      name, description, rarity,
      cardType: "vehicle",
      dropWeight: RARITY_WEIGHTS[rarity],
      worthValue: RARITY_WORTH[rarity],
      burnValue: RARITY_BURN[rarity],
    });
    await interaction.editReply(`✅ Added **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}).`);
    return;
  }

  // ── addlimited ──────────────────────────────────────────────────────────────
  if (sub === "addlimited") {
    const rarity = opts.getString("rarity", true) as Rarity;
    const maxCopies = opts.getInteger("maxcopies", true);
    const name = opts.getString("name", true);
    const description = opts.getString("description") ?? "";
    const card = await addCard({
      name, description, rarity,
      cardType: "limited",
      dropWeight: RARITY_WEIGHTS[rarity],
      worthValue: RARITY_WORTH[rarity] * 4,
      burnValue: RARITY_BURN[rarity] * 4,
      isLimitedEdition: true,
      maxCopies,
      droppable: false,
    });
    await interaction.editReply(
      `💎 Created Limited Edition: **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]})\n` +
      `Max Copies: **${maxCopies}** · Use \`/card admin drop name:${card.name}\` to award copies.`,
    );
    return;
  }

  // ── addevent ────────────────────────────────────────────────────────────────
  if (sub === "addevent") {
    const rarity = opts.getString("rarity", true) as Rarity;
    const name = opts.getString("name", true);
    const description = opts.getString("description") ?? "";
    const card = await addCard({
      name, description, rarity,
      cardType: "event",
      dropWeight: 0,
      worthValue: RARITY_WORTH[rarity] * 3,
      burnValue: RARITY_BURN[rarity] * 3,
      isEventExclusive: true,
      droppable: false,
    });
    await interaction.editReply(
      `🎆 Created Event Exclusive: **${card.name}** (${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]})\n` +
      `Use \`/card admin drop name:${card.name}\` to award it.`,
    );
    return;
  }

  // ── removecard ──────────────────────────────────────────────────────────────
  if (sub === "removecard") {
    const name = opts.getString("name", true);
    await removeCard(name);
    await interaction.editReply(`✅ Removed **${name}** from the card pool.`);
    return;
  }

  // ── give ────────────────────────────────────────────────────────────────────
  if (sub === "give") {
    const target = opts.getUser("user", true);
    const cardName = opts.getString("name", true);
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) { await interaction.editReply(`❌ Card "**${cardName}**" not found.`); return; }
    await catchCard(guildId, target.id, card.id);
    const r = card.rarity as Rarity;
    await interaction.editReply(`✅ Awarded **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}) to <@${target.id}>.`);
    return;
  }

  // ── giveshards ──────────────────────────────────────────────────────────────
  if (sub === "giveshards") {
    const target = opts.getUser("user", true);
    const amount = opts.getInteger("amount", true);
    await addShards(guildId, target.id, amount);
    await interaction.editReply(`✅ Gave <@${target.id}> 💠 **${amount.toLocaleString()} shards**.`);
    return;
  }

  // ── addadmin / removeadmin / listadmins ─────────────────────────────────────
  if (sub === "addadmin") {
    const target = opts.getUser("user", true);
    await addAdmin(guildId, target.id, interaction.user.id);
    await interaction.editReply(`✅ **${target.tag}** added as a DN Cards admin.`);
    return;
  }
  if (sub === "removeadmin") {
    const target = opts.getUser("user", true);
    await removeAdmin(guildId, target.id);
    await interaction.editReply(`✅ **${target.tag}** removed from bot admins.`);
    return;
  }
  if (sub === "listadmins") {
    const admins = await listAdmins(guildId);
    if (admins.length === 0) {
      await interaction.editReply("No custom bot admins set. Server owner and Discord Admins always have access.");
      return;
    }
    const lines = admins.map(a => `<@${a.userId}> — added by <@${a.addedBy}>`);
    await interaction.editReply(`**DN Cards Admins:**\n${lines.join("\n")}`);
    return;
  }

  // ── settings ────────────────────────────────────────────────────────────────
  if (sub === "settings") {
    const s = await getOrCreateGuildSettings(guildId);
    const embed = new EmbedBuilder()
      .setTitle("⚙️ DN Cards — Server Settings")
      .setColor(0x5865f2)
      .addFields(
        { name: "Spawn Channel", value: s.spawnChannelId ? `<#${s.spawnChannelId}>` : "Not set", inline: true },
        { name: "Auto-Spawning", value: s.spawnEnabled ? "✅ Enabled" : "⏸️ Disabled", inline: true },
        {
          name: "Spawn Interval",
          value: s.useRandomInterval
            ? `Random ${formatTime(s.spawnIntervalMin ?? 0)} – ${formatTime(s.spawnIntervalMax ?? 0)}`
            : formatTime(s.spawnIntervalSeconds),
          inline: true,
        },
        { name: "Catch Window", value: formatTime(s.catchWindowSeconds), inline: true },
        { name: "Trading", value: s.tradeEnabled ? "✅ Enabled" : "⏸️ Disabled", inline: true },
        { name: "Trade Channel", value: s.tradeChannelId ? `<#${s.tradeChannelId}>` : "Any channel", inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── trading enable/disable ──────────────────────────────────────────────────
  if (sub === "tradingenable") {
    await updateGuildSettings(guildId, { tradeEnabled: true });
    await interaction.editReply("✅ Trading **enabled**.");
    return;
  }
  if (sub === "tradingdisable") {
    await updateGuildSettings(guildId, { tradeEnabled: false });
    await interaction.editReply("⏸️ Trading **disabled**.");
    return;
  }

  // ── settradechannel ─────────────────────────────────────────────────────────
  if (sub === "settradechannel") {
    const channel = opts.getChannel("channel") ?? interaction.channel;
    if (!channel) { await interaction.editReply("❌ Could not determine the channel."); return; }
    await updateGuildSettings(guildId, { tradeChannelId: channel.id });
    await interaction.editReply(`✅ Trade channel set to <#${channel.id}>.`);
    return;
  }

  await interaction.editReply("❌ Unknown admin command.");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTime(str: string | null | undefined): number | null {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h)$/i);
  if (!match) {
    const n = parseInt(str, 10);
    return isNaN(n) ? null : n;
  }
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "s") return val;
  if (unit === "m") return val * 60;
  if (unit === "h") return val * 3600;
  return null;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
