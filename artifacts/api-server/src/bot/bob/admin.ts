// /bob_admin — configure Bob per server. Subcommands: settings (view), toggle,
// odds, rewards, cooldown, ai, channels, testevent.

import { EmbedBuilder, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { getBobSettings, updateBobSettings } from "./db.js";
import { GAME_KEYS } from "./games.js";
import { triggerBobEvent } from "./events.js";
import type { BobSettings } from "@workspace/db";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const TOGGLE_KEYS = ["bob", "events", "ai", "dex", ...GAME_KEYS, "roulette", "roast", "duel"];

function isAdmin(member: GuildMember | null): boolean {
  return !!member?.permissions.has(PermissionFlagsBits.Administrator);
}

function overview(s: BobSettings): EmbedBuilder {
  const games = [...GAME_KEYS, "roulette", "roast", "duel"].map(k => `${s.gamesEnabled[k] === false ? "🚫" : "✅"} ${k}`).join(" · ");
  return new EmbedBuilder().setColor(0xf1c40f).setTitle("🟡 Bob — Server Settings").setDescription(
    `**Enabled:** ${s.enabled ? "yes" : "no"}\n` +
    `**Random events:** ${s.eventsEnabled ? "on" : "off"} · **AI talk:** ${s.aiTalking ? "on" : "off"} · **DN Cards rewards:** ${s.dexIntegration ? "on" : "off"}\n` +
    `**Blue Bob:** ${s.blueBobPct}% · **Upside-Down Bob:** ${s.upsideBobPct}%\n` +
    `**Reward multiplier:** ${s.rewardMultiplierPct}% · **Cooldown:** ${s.cooldownSeconds}s\n` +
    `**Event channels:** ${s.channels.length ? s.channels.map(c => `<#${c}>`).join(", ") : "*none set — random events won't fire*"}\n\n` +
    `**Games:** ${games}`,
  ).setFooter({ text: "Change with /bob_admin toggle | odds | rewards | cooldown | ai | channels | testevent" });
}

export async function handleBobAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "❌ Server only.", ...EPHEMERAL }); return; }
  if (!isAdmin(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "❌ You need **Administrator** for `/bob_admin`.", ...EPHEMERAL }); return;
  }
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply(EPHEMERAL);
  const s = await getBobSettings(guildId);

  switch (sub) {
    case "settings":
      await interaction.editReply({ embeds: [overview(s)] });
      return;

    case "toggle": {
      const key = interaction.options.getString("feature", true).toLowerCase();
      const on = interaction.options.getBoolean("enabled", true);
      if (!TOGGLE_KEYS.includes(key)) { await interaction.editReply(`❌ Unknown feature. One of: ${TOGGLE_KEYS.join(", ")}`); return; }
      if (key === "bob") await updateBobSettings(guildId, { enabled: on });
      else if (key === "events") await updateBobSettings(guildId, { eventsEnabled: on });
      else if (key === "ai") await updateBobSettings(guildId, { aiTalking: on });
      else if (key === "dex") await updateBobSettings(guildId, { dexIntegration: on });
      else await updateBobSettings(guildId, { gamesEnabled: { ...s.gamesEnabled, [key]: on } });
      await interaction.editReply(`✅ **${key}** is now **${on ? "on" : "off"}**.`);
      return;
    }

    case "odds": {
      const blue = interaction.options.getInteger("blue");
      const upside = interaction.options.getInteger("upside");
      const patch: Partial<BobSettings> = {};
      if (blue != null) patch.blueBobPct = Math.max(0, Math.min(100, blue));
      if (upside != null) patch.upsideBobPct = Math.max(0, Math.min(100, upside));
      if (Object.keys(patch).length === 0) { await interaction.editReply("Pass `blue:` and/or `upside:` percentages."); return; }
      const u = await updateBobSettings(guildId, patch);
      await interaction.editReply(`✅ Blue Bob **${u.blueBobPct}%** · Upside-Down Bob **${u.upsideBobPct}%**.`);
      return;
    }

    case "rewards": {
      const pct = interaction.options.getInteger("multiplier", true);
      const u = await updateBobSettings(guildId, { rewardMultiplierPct: Math.max(0, Math.min(1000, pct)) });
      await interaction.editReply(`✅ Reward multiplier set to **${u.rewardMultiplierPct}%**.`);
      return;
    }

    case "cooldown": {
      const secs = interaction.options.getInteger("seconds", true);
      const u = await updateBobSettings(guildId, { cooldownSeconds: Math.max(0, Math.min(120, secs)) });
      await interaction.editReply(`✅ Action cooldown set to **${u.cooldownSeconds}s**.`);
      return;
    }

    case "channels": {
      const action = interaction.options.getString("action", true);
      const channel = interaction.options.getChannel("channel");
      let channels = [...s.channels];
      if (action === "clear") channels = [];
      else if (channel) {
        if (action === "add" && !channels.includes(channel.id)) channels.push(channel.id);
        if (action === "remove") channels = channels.filter(c => c !== channel.id);
      } else { await interaction.editReply("Pass a `channel:` for add/remove (or use `clear`)."); return; }
      const u = await updateBobSettings(guildId, { channels });
      await interaction.editReply(`✅ Event channels: ${u.channels.length ? u.channels.map(c => `<#${c}>`).join(", ") : "none"}.`);
      return;
    }

    case "avatar": {
      const form = interaction.options.getString("form", true);
      const url = interaction.options.getString("url"); // empty/omitted clears
      if (url && !/^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(url)) {
        await interaction.editReply("❌ That doesn't look like a direct image URL (must end in .png/.jpg/.gif/.webp). Upload the image to Discord, right-click → Copy Link.");
        return;
      }
      const col = form === "blue" ? "avatarBlue" : form === "upside" ? "avatarUpside" : "avatarNormal";
      await updateBobSettings(guildId, { [col]: url || null } as Partial<BobSettings>);
      await interaction.editReply(url ? `✅ ${form} Bob avatar set. It'll show as the thumbnail on his embeds.` : `✅ Cleared the ${form} Bob avatar (back to the emoji face).`);
      return;
    }

    case "testevent": {
      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      const chId = channel && "id" in channel ? channel.id : interaction.channelId!;
      const ok = await triggerBobEvent(guildId, chId);
      await interaction.editReply(ok ? `✅ Spawned a Bob event in <#${chId}>.` : "❌ Couldn't spawn an event there.");
      return;
    }

    default:
      await interaction.editReply({ embeds: [overview(s)] });
  }
}
