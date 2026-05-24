import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  isAdmin,
  addAdmin,
  removeAdmin,
  listAdmins,
  getOrCreateGuildSettings,
  updateGuildSettings,
  addCard,
  removeCard,
  getAllCards,
} from "../db.js";
import { spawnCard, scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";

// ── Permission check ──────────────────────────────────────────────────────────
async function checkAdmin(msg: Message): Promise<boolean> {
  if (!msg.guild) return false;
  if (msg.guild.ownerId === msg.author.id) return true;
  if (msg.member?.permissions.has("Administrator")) return true;
  return isAdmin(msg.guild.id, msg.author.id);
}

// ── Command router ────────────────────────────────────────────────────────────
export async function handleAdminCommand(msg: Message, args: string[]): Promise<void> {
  if (!msg.guild) return;

  const ok = await checkAdmin(msg);
  if (!ok) {
    await msg.reply("❌ You don't have permission to use admin commands.");
    return;
  }

  const sub = args[0]?.toLowerCase();
  const guildId = msg.guild.id;

  if (sub === "setchannel") {
    const channel = msg.mentions.channels.first() ?? msg.channel;
    await updateGuildSettings(guildId, { spawnChannelId: channel.id });
    await msg.reply(`✅ Spawn channel set to <#${channel.id}>.`);
    scheduleNextSpawn(guildId);
    return;
  }

  if (sub === "setinterval") {
    const rest = args.slice(1);
    if (rest[0] === "random") {
      const min = parseTime(rest[1]);
      const max = parseTime(rest[2]);
      if (!min || !max) {
        await msg.reply("❌ Usage: `!card setinterval random <min> <max>` e.g. `!card setinterval random 10m 60m`");
        return;
      }
      await updateGuildSettings(guildId, { useRandomInterval: true, spawnIntervalMin: min, spawnIntervalMax: max });
      await msg.reply(`✅ Spawn interval set to random between **${rest[1]}** and **${rest[2]}**.`);
    } else {
      const seconds = parseTime(rest[0]);
      if (!seconds) {
        await msg.reply("❌ Usage: `!card setinterval <time>` e.g. `!card setinterval 30m` or `!card setinterval 1h`");
        return;
      }
      await updateGuildSettings(guildId, { useRandomInterval: false, spawnIntervalSeconds: seconds });
      await msg.reply(`✅ Spawn interval set to **${rest[0]}** (${seconds}s).`);
    }
    scheduleNextSpawn(guildId);
    return;
  }

  if (sub === "setwindow") {
    const seconds = parseTime(args[1]);
    if (!seconds) {
      await msg.reply("❌ Usage: `!card setwindow <time>` e.g. `!card setwindow 2m`");
      return;
    }
    await updateGuildSettings(guildId, { catchWindowSeconds: seconds });
    await msg.reply(`✅ Catch window set to **${args[1]}** (${seconds}s).`);
    return;
  }

  if (sub === "enable") {
    await updateGuildSettings(guildId, { spawnEnabled: true });
    await msg.reply("✅ Card spawning **enabled**.");
    scheduleNextSpawn(guildId);
    return;
  }

  if (sub === "disable") {
    await updateGuildSettings(guildId, { spawnEnabled: false });
    clearSpawnTimer(guildId);
    await msg.reply("⏸️ Card spawning **disabled**.");
    return;
  }

  if (sub === "drop") {
    const cardName = args.slice(1).join(" ");
    let forcedCardId: number | undefined;
    if (cardName) {
      const cards = await getAllCards();
      const found = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (!found) {
        await msg.reply(`❌ Card "**${cardName}**" not found. Use \`!card list\` to see all cards.`);
        return;
      }
      forcedCardId = found.id;
    }
    await spawnCard(guildId, forcedCardId, true);
    await msg.reply(forcedCardId ? `✅ Force-dropped **${cardName}**!` : "✅ Force-dropped a random card!");
    scheduleNextSpawn(guildId);
    return;
  }

  if (sub === "addcard") {
    const rarities = ["common", "uncommon", "rare", "epic", "legendary"];
    const rarity = args[1]?.toLowerCase() ?? "";
    if (!rarities.includes(rarity)) {
      await msg.reply(`❌ Usage: \`!card addcard <rarity> <Name> | <description>\`\nRarities: ${rarities.join(", ")}`);
      return;
    }
    const rest = args.slice(2).join(" ");
    const [namePart, descPart] = rest.split("|").map(s => s.trim());
    if (!namePart) {
      await msg.reply("❌ Card name is required.");
      return;
    }
    const rarityWeights: Record<string, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
    const card = await addCard({ name: namePart, description: descPart ?? "", rarity, dropWeight: rarityWeights[rarity] ?? 10 });
    await msg.reply(`✅ Added card **${card.name}** (${RARITY_EMOJI[rarity as Rarity]} ${RARITY_LABELS[rarity as Rarity]}).`);
    return;
  }

  if (sub === "removecard") {
    const cardName = args.slice(1).join(" ");
    if (!cardName) {
      await msg.reply("❌ Usage: `!card removecard <Card Name>`");
      return;
    }
    await removeCard(cardName);
    await msg.reply(`✅ Removed card **${cardName}** from the pool.`);
    return;
  }

  if (sub === "addadmin") {
    const target = msg.mentions.users.first();
    if (!target) {
      await msg.reply("❌ Usage: `!card addadmin @User`");
      return;
    }
    await addAdmin(guildId, target.id, msg.author.id);
    await msg.reply(`✅ **${target.tag}** has been added as a bot admin.`);
    return;
  }

  if (sub === "removeadmin") {
    const target = msg.mentions.users.first();
    if (!target) {
      await msg.reply("❌ Usage: `!card removeadmin @User`");
      return;
    }
    await removeAdmin(guildId, target.id);
    await msg.reply(`✅ **${target.tag}** has been removed from bot admins.`);
    return;
  }

  if (sub === "listadmins") {
    const admins = await listAdmins(guildId);
    if (admins.length === 0) {
      await msg.reply("No custom bot admins set. Server owner and Discord Admins always have access.");
      return;
    }
    const lines = admins.map(a => `<@${a.userId}> (added by <@${a.addedBy}>)`);
    await msg.reply(`**Bot Admins:**\n${lines.join("\n")}`);
    return;
  }

  if (sub === "settings") {
    const settings = await getOrCreateGuildSettings(guildId);
    const embed = new EmbedBuilder()
      .setTitle("⚙️ Bot Settings")
      .setColor(0x5865f2)
      .addFields(
        { name: "Spawn Channel", value: settings.spawnChannelId ? `<#${settings.spawnChannelId}>` : "Not set", inline: true },
        { name: "Spawning", value: settings.spawnEnabled ? "✅ Enabled" : "⏸️ Disabled", inline: true },
        {
          name: "Spawn Interval",
          value: settings.useRandomInterval
            ? `Random ${formatTime(settings.spawnIntervalMin ?? 0)} – ${formatTime(settings.spawnIntervalMax ?? 0)}`
            : formatTime(settings.spawnIntervalSeconds),
          inline: true,
        },
        { name: "Catch Window", value: formatTime(settings.catchWindowSeconds), inline: true },
      );
    await msg.reply({ embeds: [embed] });
    return;
  }

  // Default: show admin help
  await msg.reply(
    "**Admin Commands:**\n" +
    "`!card setchannel [#channel]` — set spawn channel\n" +
    "`!card setinterval <time>` — fixed interval (e.g. `30m`, `1h`, `90s`)\n" +
    "`!card setinterval random <min> <max>` — random interval range\n" +
    "`!card setwindow <time>` — how long a card stays before expiring\n" +
    "`!card enable` / `!card disable` — toggle spawning\n" +
    "`!card drop [Card Name]` — force-spawn a card (random or specific)\n" +
    "`!card addcard <rarity> <Name> | <description>` — add a new card\n" +
    "`!card removecard <Name>` — remove a card from the pool\n" +
    "`!card addadmin @User` — grant admin access\n" +
    "`!card removeadmin @User` — revoke admin access\n" +
    "`!card listadmins` — list bot admins\n" +
    "`!card settings` — view current settings\n",
  );
}

// ── Time parser: 30s, 5m, 2h → seconds ───────────────────────────────────────
function parseTime(str: string | undefined): number | null {
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
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
