import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  isAdmin, addAdmin, removeAdmin, listAdmins,
  getOrCreateGuildSettings, updateGuildSettings,
  addCard, removeCard, getAllCards, addShards,
} from "../db.js";
import { spawnCard, scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { RARITY_EMOJI, RARITY_LABELS, RARITY_WORTH, RARITY_BURN, type Rarity } from "../cards-data.js";

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

  // ── Spawn channel ─────────────────────────────────────────────────────────
  if (sub === "setchannel") {
    const channel = msg.mentions.channels.first() ?? msg.channel;
    await updateGuildSettings(guildId, { spawnChannelId: channel.id });
    await msg.reply(`✅ Spawn channel set to <#${channel.id}>.`);
    scheduleNextSpawn(guildId);
    return;
  }

  // ── Spawn interval ────────────────────────────────────────────────────────
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
      await msg.reply(`✅ Spawn interval → random **${rest[1]}** – **${rest[2]}**.`);
    } else {
      const seconds = parseTime(rest[0]);
      if (!seconds) {
        await msg.reply("❌ Usage: `!card setinterval <time>` e.g. `30m`, `1h`, `90s`");
        return;
      }
      await updateGuildSettings(guildId, { useRandomInterval: false, spawnIntervalSeconds: seconds });
      await msg.reply(`✅ Spawn interval → fixed **${rest[0]}** (${seconds}s).`);
    }
    scheduleNextSpawn(guildId);
    return;
  }

  // ── Catch window ──────────────────────────────────────────────────────────
  if (sub === "setwindow") {
    const seconds = parseTime(args[1]);
    if (!seconds) {
      await msg.reply("❌ Usage: `!card setwindow <time>` e.g. `!card setwindow 2m`");
      return;
    }
    await updateGuildSettings(guildId, { catchWindowSeconds: seconds });
    await msg.reply(`✅ Catch window → **${args[1]}** (${seconds}s).`);
    return;
  }

  // ── Enable/Disable ────────────────────────────────────────────────────────
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

  // ── Force drop ────────────────────────────────────────────────────────────
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
    const settings = await getOrCreateGuildSettings(guildId);
    if (!settings.spawnChannelId) {
      await msg.reply("❌ No spawn channel set. Use `!card setchannel #channel` first.");
      return;
    }
    await spawnCard(guildId, forcedCardId, true);
    await msg.reply(forcedCardId ? `✅ Force-dropped **${cardName}**!` : "✅ Force-dropped a random card!");
    scheduleNextSpawn(guildId);
    return;
  }

  // ── Add card ──────────────────────────────────────────────────────────────
  if (sub === "addcard") {
    const rarities = ["common", "uncommon", "rare", "epic", "legendary"];
    const rarity = args[1]?.toLowerCase() ?? "";
    if (!rarities.includes(rarity)) {
      await msg.reply(
        `❌ Usage: \`!card addcard <rarity> <Name> | <description>\`\n` +
        `Rarities: ${rarities.join(", ")}\n` +
        `Example: \`!card addcard epic F-117 Nighthawk | The original stealth jet.\``,
      );
      return;
    }
    const rest = args.slice(2).join(" ");
    const pipeIdx = rest.indexOf("|");
    const namePart = (pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest).trim();
    const descPart = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : "";
    if (!namePart) {
      await msg.reply("❌ Card name is required.");
      return;
    }
    const r = rarity as Rarity;
    const card = await addCard({
      name: namePart,
      description: descPart,
      rarity,
      cardType: "vehicle",
      dropWeight: RARITY_WEIGHTS[r],
      worthValue: RARITY_WORTH[r],
      burnValue: RARITY_BURN[r],
    });
    await msg.reply(`✅ Added **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}).`);
    return;
  }

  // ── Add Limited Edition card ───────────────────────────────────────────────
  if (sub === "addlimited") {
    // !card addlimited <rarity> <maxCopies> <Name> | <description>
    const rarity = args[1]?.toLowerCase() ?? "";
    const maxCopies = parseInt(args[2] ?? "", 10);
    const rarities = ["common", "uncommon", "rare", "epic", "legendary"];
    if (!rarities.includes(rarity) || isNaN(maxCopies) || maxCopies < 1) {
      await msg.reply(
        "❌ Usage: `!card addlimited <rarity> <maxCopies> <Name> | <description>`\n" +
        "Example: `!card addlimited legendary 50 Season 1 Champion | Event winner exclusive.`",
      );
      return;
    }
    const rest = args.slice(3).join(" ");
    const pipeIdx = rest.indexOf("|");
    const namePart = (pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest).trim();
    const descPart = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : "";
    if (!namePart) {
      await msg.reply("❌ Card name is required.");
      return;
    }
    const r = rarity as Rarity;
    const card = await addCard({
      name: namePart, description: descPart,
      rarity, cardType: "limited",
      dropWeight: RARITY_WEIGHTS[r],
      worthValue: RARITY_WORTH[r] * 4, // limited editions worth 4× more
      burnValue: RARITY_BURN[r] * 4,
      isLimitedEdition: true, maxCopies, droppable: false,
    });
    await msg.reply(
      `💎 Created Limited Edition: **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]})\n` +
      `Max Copies: **${maxCopies}** · Use \`!card drop ${card.name}\` to award copies.`,
    );
    return;
  }

  // ── Add Event Exclusive card ───────────────────────────────────────────────
  if (sub === "addevent") {
    // !card addevent <rarity> <Name> | <description>
    const rarity = args[1]?.toLowerCase() ?? "";
    const rarities = ["common", "uncommon", "rare", "epic", "legendary"];
    if (!rarities.includes(rarity)) {
      await msg.reply(
        "❌ Usage: `!card addevent <rarity> <Name> | <description>`\n" +
        "Creates an event-exclusive card (admin-drop only).\n" +
        "Example: `!card addevent epic Roblox Raid Winner | Won the server raid event.`",
      );
      return;
    }
    const rest = args.slice(2).join(" ");
    const pipeIdx = rest.indexOf("|");
    const namePart = (pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest).trim();
    const descPart = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : "";
    if (!namePart) {
      await msg.reply("❌ Card name is required.");
      return;
    }
    const r = rarity as Rarity;
    const card = await addCard({
      name: namePart, description: descPart,
      rarity, cardType: "event",
      dropWeight: 0, // won't appear in random draws
      worthValue: RARITY_WORTH[r] * 3,
      burnValue: RARITY_BURN[r] * 3,
      isEventExclusive: true, droppable: false,
    });
    await msg.reply(
      `🎆 Created Event Exclusive: **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]})\n` +
      `Use \`!card drop ${card.name}\` to award it.`,
    );
    return;
  }

  // ── Give card to user ─────────────────────────────────────────────────────
  if (sub === "give") {
    // !card give @User <Card Name>
    const target = msg.mentions.users.first();
    if (!target) {
      await msg.reply("❌ Usage: `!card give @User <Card Name>`");
      return;
    }
    const cardName = args.slice(2).join(" ");
    if (!cardName) {
      await msg.reply("❌ Usage: `!card give @User <Card Name>`");
      return;
    }
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) {
      await msg.reply(`❌ Card "**${cardName}**" not found.`);
      return;
    }
    // Import catchCard here to award
    const { catchCard } = await import("../db.js");
    await catchCard(guildId, target.id, card.id);
    const r = card.rarity as Rarity;
    await msg.reply(
      `✅ Awarded **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}) to <@${target.id}>.`,
    );
    return;
  }

  // ── Give shards to user ───────────────────────────────────────────────────
  if (sub === "giveshards") {
    // !card giveshards @User <amount>
    const target = msg.mentions.users.first();
    const amount = parseInt(args[2] ?? "", 10);
    if (!target || isNaN(amount) || amount < 1) {
      await msg.reply("❌ Usage: `!card giveshards @User <amount>` e.g. `!card giveshards @John 500`");
      return;
    }
    await addShards(guildId, target.id, amount);
    await msg.reply(`✅ Gave <@${target.id}> 💠 **${amount.toLocaleString()} shards**.`);
    return;
  }

  // ── Remove card ───────────────────────────────────────────────────────────
  if (sub === "removecard") {
    const cardName = args.slice(1).join(" ");
    if (!cardName) {
      await msg.reply("❌ Usage: `!card removecard <Card Name>`");
      return;
    }
    await removeCard(cardName);
    await msg.reply(`✅ Removed **${cardName}** from the card pool.`);
    return;
  }

  // ── Enable/Disable trading ────────────────────────────────────────────────
  if (sub === "tradingenable") {
    await updateGuildSettings(guildId, { tradeEnabled: true });
    await msg.reply("✅ Trading **enabled**.");
    return;
  }
  if (sub === "tradingdisable") {
    await updateGuildSettings(guildId, { tradeEnabled: false });
    await msg.reply("⏸️ Trading **disabled**.");
    return;
  }

  // ── Set trade channel ─────────────────────────────────────────────────────
  if (sub === "settradechannel") {
    const channel = msg.mentions.channels.first() ?? msg.channel;
    await updateGuildSettings(guildId, { tradeChannelId: channel.id });
    await msg.reply(`✅ Trade channel set to <#${channel.id}>.`);
    return;
  }

  // ── Add/Remove bot admin ──────────────────────────────────────────────────
  if (sub === "addadmin") {
    const target = msg.mentions.users.first();
    if (!target) {
      await msg.reply("❌ Usage: `!card addadmin @User`");
      return;
    }
    await addAdmin(guildId, target.id, msg.author.id);
    await msg.reply(`✅ **${target.tag}** added as a DN Cards admin.`);
    return;
  }
  if (sub === "removeadmin") {
    const target = msg.mentions.users.first();
    if (!target) {
      await msg.reply("❌ Usage: `!card removeadmin @User`");
      return;
    }
    await removeAdmin(guildId, target.id);
    await msg.reply(`✅ **${target.tag}** removed from bot admins.`);
    return;
  }
  if (sub === "listadmins") {
    const admins = await listAdmins(guildId);
    if (admins.length === 0) {
      await msg.reply("No custom bot admins. Server owner and Discord Admins always have full access.");
      return;
    }
    const lines = admins.map(a => `<@${a.userId}> — added by <@${a.addedBy}>`);
    await msg.reply(`**DN Cards Admins:**\n${lines.join("\n")}`);
    return;
  }

  // ── Settings overview ─────────────────────────────────────────────────────
  if (sub === "settings") {
    const s = await getOrCreateGuildSettings(guildId);
    const embed = new EmbedBuilder()
      .setTitle("⚙️ DN Cards Server Settings")
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
    await msg.reply({ embeds: [embed] });
    return;
  }

  // ── Help fallthrough ──────────────────────────────────────────────────────
  await msg.reply(
    "**⚙️ DN Cards Admin Commands:**\n" +
    "\n**Spawning**\n" +
    "`!card setchannel [#channel]` — set card spawn channel\n" +
    "`!card setinterval <time>` — fixed interval (`30m`, `1h`, `90s`)\n" +
    "`!card setinterval random <min> <max>` — random range\n" +
    "`!card setwindow <time>` — catch window duration\n" +
    "`!card enable` / `!card disable` — toggle auto-spawning\n" +
    "`!card drop [Card Name]` — force-drop a card (event drops)\n" +
    "\n**Card Management**\n" +
    "`!card addcard <rarity> <Name> | <desc>` — add a standard card\n" +
    "`!card addlimited <rarity> <maxCopies> <Name> | <desc>` — limited edition\n" +
    "`!card addevent <rarity> <Name> | <desc>` — event exclusive\n" +
    "`!card removecard <Name>` — remove a card\n" +
    "`!card give @User <Card Name>` — give a card to a user\n" +
    "`!card giveshards @User <amount>` — give DN Shards to a user\n" +
    "\n**Trading**\n" +
    "`!card tradingenable` / `!card tradingdisable` — toggle trading\n" +
    "`!card settradechannel [#channel]` — set trade channel\n" +
    "\n**Access Control**\n" +
    "`!card addadmin @User` / `!card removeadmin @User` / `!card listadmins`\n" +
    "\n**Info**\n" +
    "`!card settings` — view current server settings\n",
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1,
};

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
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60 > 0 ? `${seconds % 60}s` : ""}`.trim();
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
