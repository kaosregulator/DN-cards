import type { Message, GuildMember } from "discord.js";
import {
  isAdmin, addAdmin, removeAdmin, listAdmins,
  getOrCreateGuildSettings, updateGuildSettings,
  loadDefaultCards, unloadDefaultCards,
} from "../db.js";
import { scheduleNextSpawn, clearSpawnTimer } from "../spawn-manager.js";
import { RARITY_EMOJI, RARITY_WEIGHTS, type Rarity } from "../cards-data.js";
import { startSetupWizard } from "./setup-wizard.js";
import { startCardWizard, startEditWizard } from "./card-wizard.js";
import { handleImport } from "./import.js";

// ── Permission check ──────────────────────────────────────────────────────────
async function checkAdmin(msg: Message): Promise<boolean> {
  if (!msg.guild) return false;
  if (msg.guild.ownerId === msg.author.id) return true;
  if ((msg.member as GuildMember | null)?.permissions.has("Administrator")) return true;
  return isAdmin(msg.guild.id, msg.author.id);
}

// ── Channel resolver: accepts #mention or plain name ─────────────────────────
function resolveChannel(msg: Message, arg: string): string | null {
  const mentionId = arg?.match(/^<#(\d+)>$/)?.[1];
  if (mentionId) return mentionId;
  const name = arg?.replace(/^#/, "");
  const found = msg.guild?.channels.cache.find(c => c.name === name && c.isTextBased());
  return found?.id ?? null;
}

// ── Time parser: "30m", "1h", "90s", "2d" or plain number of seconds ─────────
function parseTime(s: string): number | null {
  const m = s.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) { const n = parseInt(s, 10); return isNaN(n) ? null : n; }
  const v = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  if (u === "s") return v;
  if (u === "m") return v * 60;
  if (u === "h") return v * 3600;
  if (u === "d") return v * 86400;
  return null;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) { const m = Math.floor(seconds / 60); const s = seconds % 60; return s > 0 ? `${m}m ${s}s` : `${m}m`; }
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const VALID_RARITIES = new Set(["common", "uncommon", "rare", "epic", "legendary"]);

// ── Main prefix command handler ───────────────────────────────────────────────
export async function handlePrefixCommand(msg: Message): Promise<void> {
  if (!msg.guild) return;
  const content = msg.content.trim();
  if (!content.startsWith("!")) return;

  const [rawCmd, ...args] = content.slice(1).trim().split(/\s+/);
  const cmd = rawCmd?.toLowerCase();
  const guildId = msg.guild.id;

  // ── Public ─────────────────────────────────────────────────────────────────
  if (cmd === "help") {
    await msg.reply(
      "**DN Cards — Setup & Config Commands** (admin only)\n\n" +
      "`!setup` — interactive setup wizard\n" +
      "`!setchannel #channel` — set spawn channel\n" +
      "`!setinterval <time>` — fixed interval (e.g. `30m`, `1h`)\n" +
      "`!setinterval random <min> <max>` — random range (e.g. `10m 60m`)\n" +
      "`!setwindow <time>` — catch window duration\n" +
      "`!setdrops <1|3|5|random>` — cards per spawn batch\n" +
      "`!setrarity <rarity> <weight>` — change drop weight for a rarity\n" +
      "`!spawnenable` / `!spawndisable` — toggle auto-spawning\n" +
      "`!tradingenable` / `!tradingdisable` — toggle trading\n" +
      "`!settradechannel #channel` — set trade channel\n" +
      "`!addcard` — card creation wizard (standard)\n" +
      "`!addlimited` — card creation wizard (limited edition)\n" +
      "`!addevent` — card creation wizard (event exclusive)\n" +
      "`!removecard <Name>` — remove a card\n" +
      "`!addadmin @User` — grant bot admin access\n" +
      "`!removeadmin @User` — revoke bot admin access\n" +
      "`!listadmins` — list bot admins\n" +
      "`!settings` — view current settings\n\n" +
      "*Use slash commands for player actions: `/collection`, `/burn`, `/trade`, etc.*\n" +
      "*Admin quick actions: `/drop`, `/give`, `/takeback`, `/giveshards`, `/takeshards`*",
    );
    return;
  }

  if (cmd === "setup") {
    const ok = await checkAdmin(msg);
    if (!ok) { await msg.reply("❌ Only admins can run the setup wizard."); return; }
    await startSetupWizard(msg);
    return;
  }

  // ── Card creation wizards ──────────────────────────────────────────────────
  if (cmd === "addcard" || cmd === "addlimited" || cmd === "addevent") {
    const ok = await checkAdmin(msg);
    if (!ok) { await msg.reply("❌ You don't have permission to add cards."); return; }
    const kind = cmd === "addcard" ? "standard" : cmd === "addlimited" ? "limited" : "event";
    await startCardWizard(msg, kind as "standard" | "limited" | "event");
    return;
  }

  // ── !editcard <Name> — edit any field of an existing card ──────────────────
  if (cmd === "editcard") {
    const ok = await checkAdmin(msg);
    if (!ok) { await msg.reply("❌ You don't have permission to edit cards."); return; }
    const name = args.join(" ");
    if (!name) { await msg.reply("❌ Usage: `!editcard F-22 Raptor`"); return; }
    await startEditWizard(msg, name);
    return;
  }

  // ── !import — bulk import cards from JSON ──────────────────────────────────
  if (cmd === "import") {
    const ok = await checkAdmin(msg);
    if (!ok) { await msg.reply("❌ You don't have permission to import cards."); return; }
    await handleImport(msg);
    return;
  }

  // ── !unloaddefaults — remove the 27 seeded default cards ──────────────────
  if (cmd === "unloaddefaults") {
    const ok = await checkAdmin(msg);
    if (!ok) { await msg.reply("❌ You don't have permission."); return; }
    const { removed } = await unloadDefaultCards();
    await msg.reply(
      `✅ Removed **${removed}** default cards from the roster.\n` +
      `Your imported cards are untouched. The defaults will **not** come back on restart.\n` +
      `Use \`!loaddefaults\` to add them back if you change your mind.`,
    );
    return;
  }

  // ── !loaddefaults — re-add the 27 default cards ──────────────────────────
  if (cmd === "loaddefaults") {
    const ok = await checkAdmin(msg);
    if (!ok) { await msg.reply("❌ You don't have permission."); return; }
    const { added, skipped } = await loadDefaultCards();
    await msg.reply(
      `✅ Added **${added}** default cards back to the roster.` +
      (skipped > 0 ? `\n⏭️ Skipped **${skipped}** (already in roster).` : ""),
    );
    return;
  }

  // All remaining commands require admin
  const ok = await checkAdmin(msg);
  if (!ok) { await msg.reply("❌ You don't have permission to use admin commands."); return; }

  // ── !setchannel [#channel] ─────────────────────────────────────────────────
  if (cmd === "setchannel") {
    const arg = args[0] ?? `<#${msg.channelId}>`;
    const channelId = resolveChannel(msg, arg);
    if (!channelId) { await msg.reply("❌ Channel not found. Try `!setchannel #general`."); return; }
    await updateGuildSettings(guildId, { spawnChannelId: channelId });
    await msg.reply(`✅ Spawn channel set to <#${channelId}>.`);
    scheduleNextSpawn(guildId);
    return;
  }

  // ── !setinterval ───────────────────────────────────────────────────────────
  if (cmd === "setinterval") {
    if (args[0]?.toLowerCase() === "random") {
      const min = parseTime(args[1] ?? "");
      const max = parseTime(args[2] ?? "");
      if (!min || !max) { await msg.reply("❌ Usage: `!setinterval random 10m 60m`"); return; }
      await updateGuildSettings(guildId, { useRandomInterval: true, spawnIntervalMin: min, spawnIntervalMax: max });
      await msg.reply(`✅ Spawn interval → random **${args[1]}** – **${args[2]}**.`);
    } else {
      const seconds = parseTime(args[0] ?? "");
      if (!seconds) { await msg.reply("❌ Usage: `!setinterval 30m` or `!setinterval 1h`"); return; }
      await updateGuildSettings(guildId, { useRandomInterval: false, spawnIntervalSeconds: seconds });
      await msg.reply(`✅ Spawn interval → fixed **${args[0]}** (${formatTime(seconds)}).`);
    }
    scheduleNextSpawn(guildId);
    return;
  }

  // ── !setwindow ─────────────────────────────────────────────────────────────
  if (cmd === "setwindow") {
    const seconds = parseTime(args[0] ?? "");
    if (!seconds) { await msg.reply("❌ Usage: `!setwindow 2m` or `!setwindow 90s`"); return; }
    await updateGuildSettings(guildId, { catchWindowSeconds: seconds });
    await msg.reply(`✅ Catch window → **${args[0]}** (${formatTime(seconds)}).`);
    return;
  }

  // ── !setdrops ──────────────────────────────────────────────────────────────
  if (cmd === "setdrops") {
    const val = args[0]?.toLowerCase();
    const map: Record<string, number> = { "1": 1, "3": 3, "5": 5, "random": -1 };
    if (!(val in map)) { await msg.reply("❌ Usage: `!setdrops 1` / `!setdrops 3` / `!setdrops 5` / `!setdrops random`"); return; }
    await updateGuildSettings(guildId, { cardsPerSpawn: map[val] });
    const label = val === "random" ? "Random (1–3 per batch)" : `${map[val]} card${map[val] > 1 ? "s" : ""} per batch`;
    await msg.reply(`✅ Cards per spawn → **${label}**.`);
    return;
  }

  // ── !setrarity ─────────────────────────────────────────────────────────────
  if (cmd === "setrarity") {
    const rarity = args[0]?.toLowerCase();
    const weight = parseInt(args[1] ?? "", 10);
    if (!VALID_RARITIES.has(rarity) || isNaN(weight) || weight < 0) {
      await msg.reply("❌ Usage: `!setrarity common 60` — rarity: common/uncommon/rare/epic/legendary, weight: 0+");
      return;
    }
    const colMap: Record<string, Partial<{ rarityWeightCommon: number; rarityWeightUncommon: number; rarityWeightRare: number; rarityWeightEpic: number; rarityWeightLegendary: number }>> = {
      common: { rarityWeightCommon: weight },
      uncommon: { rarityWeightUncommon: weight },
      rare: { rarityWeightRare: weight },
      epic: { rarityWeightEpic: weight },
      legendary: { rarityWeightLegendary: weight },
    };
    await updateGuildSettings(guildId, colMap[rarity]);
    await msg.reply(`✅ ${RARITY_EMOJI[rarity as Rarity]} **${rarity}** drop weight → **${weight}** (default: ${RARITY_WEIGHTS[rarity as Rarity]}).`);
    return;
  }

  // ── Spawn toggle ───────────────────────────────────────────────────────────
  if (cmd === "spawnenable") {
    await updateGuildSettings(guildId, { spawnEnabled: true });
    await msg.reply("✅ Card spawning **enabled**.");
    scheduleNextSpawn(guildId);
    return;
  }
  if (cmd === "spawndisable") {
    await updateGuildSettings(guildId, { spawnEnabled: false });
    clearSpawnTimer(guildId);
    await msg.reply("⏸️ Card spawning **disabled**.");
    return;
  }

  // ── Trading toggle ─────────────────────────────────────────────────────────
  if (cmd === "tradingenable") {
    await updateGuildSettings(guildId, { tradeEnabled: true });
    await msg.reply("✅ Trading **enabled**.");
    return;
  }
  if (cmd === "tradingdisable") {
    await updateGuildSettings(guildId, { tradeEnabled: false });
    await msg.reply("⏸️ Trading **disabled**.");
    return;
  }

  // ── !settradechannel ───────────────────────────────────────────────────────
  if (cmd === "settradechannel") {
    const arg = args[0] ?? `<#${msg.channelId}>`;
    const channelId = resolveChannel(msg, arg);
    if (!channelId) { await msg.reply("❌ Channel not found."); return; }
    await updateGuildSettings(guildId, { tradeChannelId: channelId });
    await msg.reply(`✅ Trade channel set to <#${channelId}>.`);
    return;
  }

  // ── !settings ──────────────────────────────────────────────────────────────
  if (cmd === "settings") {
    const s = await getOrCreateGuildSettings(guildId);
    const cardsPerSpawnLabel = s.cardsPerSpawn === -1 ? "Random (1–3)" : s.cardsPerSpawn.toString();
    const rarityLines = [
      `⚪ Common: **${s.rarityWeightCommon ?? 60}**${s.rarityWeightCommon ? " ✏️" : ""}`,
      `🟢 Uncommon: **${s.rarityWeightUncommon ?? 25}**${s.rarityWeightUncommon ? " ✏️" : ""}`,
      `🔵 Rare: **${s.rarityWeightRare ?? 10}**${s.rarityWeightRare ? " ✏️" : ""}`,
      `🟣 Epic: **${s.rarityWeightEpic ?? 4}**${s.rarityWeightEpic ? " ✏️" : ""}`,
      `🌟 Legendary: **${s.rarityWeightLegendary ?? 1}**${s.rarityWeightLegendary ? " ✏️" : ""}`,
    ].join(" · ");

    await msg.reply(
      "**⚙️ DN Cards — Server Settings**\n" +
      `📢 Spawn Channel: ${s.spawnChannelId ? `<#${s.spawnChannelId}>` : "❌ Not set"}\n` +
      `🔄 Auto-Spawning: ${s.spawnEnabled ? "✅ Enabled" : "⏸️ Disabled"}\n` +
      `⏱️ Interval: ${s.useRandomInterval ? `Random ${formatTime(s.spawnIntervalMin ?? 0)}–${formatTime(s.spawnIntervalMax ?? 0)}` : formatTime(s.spawnIntervalSeconds)}\n` +
      `🪟 Catch Window: ${formatTime(s.catchWindowSeconds)}\n` +
      `📦 Cards per Batch: ${cardsPerSpawnLabel}\n` +
      `🎲 Rarity Weights (✏️ = customised): ${rarityLines}\n` +
      `🔄 Trading: ${s.tradeEnabled ? "✅ Enabled" : "⏸️ Disabled"}\n` +
      `💬 Trade Channel: ${s.tradeChannelId ? `<#${s.tradeChannelId}>` : "Any channel"}`,
    );
    return;
  }

  // ── !removecard ────────────────────────────────────────────────────────────
  if (cmd === "removecard") {
    const { removeCard } = await import("../db.js");
    const name = args.join(" ");
    if (!name) { await msg.reply("❌ Usage: `!removecard F-22 Raptor`"); return; }
    await removeCard(name);
    await msg.reply(`✅ Removed **${name}** from the card pool.`);
    return;
  }

  // ── !addadmin ──────────────────────────────────────────────────────────────
  if (cmd === "addadmin") {
    const userId = msg.mentions.users.first()?.id ?? args[0]?.replace(/[<@!>]/g, "");
    if (!userId) { await msg.reply("❌ Mention a user: `!addadmin @User`"); return; }
    await addAdmin(guildId, userId, msg.author.id);
    await msg.reply(`✅ <@${userId}> added as a DN Cards admin.`);
    return;
  }

  // ── !removeadmin ───────────────────────────────────────────────────────────
  if (cmd === "removeadmin") {
    const userId = msg.mentions.users.first()?.id ?? args[0]?.replace(/[<@!>]/g, "");
    if (!userId) { await msg.reply("❌ Mention a user: `!removeadmin @User`"); return; }
    await removeAdmin(guildId, userId);
    await msg.reply(`✅ <@${userId}> removed from bot admins.`);
    return;
  }

  // ── !listadmins ────────────────────────────────────────────────────────────
  if (cmd === "listadmins") {
    const admins = await listAdmins(guildId);
    if (admins.length === 0) {
      await msg.reply("No custom bot admins. Server owner and Discord Admins always have access.");
      return;
    }
    const lines = admins.map(a => `<@${a.userId}> — added by <@${a.addedBy}>`);
    await msg.reply(`**DN Cards Admins:**\n${lines.join("\n")}`);
    return;
  }
}
