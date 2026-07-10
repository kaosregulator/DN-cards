// /giveaway_admin — admin creation & management for the Giveaway System.
//
//   create   — build and launch a giveaway (compact prize/requirement syntax)
//   edit     — change any field of an existing giveaway
//   end      — close a giveaway early and draw winners now
//   winners  — view a giveaway's winners + claim state
//   list     — active + past giveaways on this server
//   reroll   — replace a winner (auto-picks a fresh eligible player)
//
// Prizes and requirements are entered as short, human strings so a whole
// giveaway fits in one command. Everything is per-guild and self-contained.

import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import type {
  Giveaway, GiveawayPrize, GiveawayRequirement, GiveawayReqType,
  GiveawayDifficulty, GiveawayWinnerMode, GiveawayAnnounceMode,
} from "@workspace/db";
import {
  createGiveaway, updateGiveaway, getGiveaway, listGiveaways, listWinners, countEntrants,
} from "./db.js";
import { postGiveawayMessage, endGiveaway, rerollWinner, refreshGiveawayMessage } from "./manager.js";
import { invalidateActiveCache } from "./engine.js";
import { invalidateMessageReqCache } from "./message-hook.js";
import { DIFFICULTY_META, formatPrizeList } from "./embeds.js";
import { getCardByName } from "../db.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

function isAdmin(member: GuildMember | null): boolean {
  return !!member?.permissions.has(PermissionFlagsBits.Administrator);
}

export async function handleGiveawayAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "❌ Server only.", ...EPHEMERAL }); return; }
  if (!isAdmin(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "❌ You need the **Administrator** permission for `/giveaway_admin`.", ...EPHEMERAL });
    return;
  }
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply(EPHEMERAL);
  try {
    switch (sub) {
      case "create": return await doCreate(interaction);
      case "edit": return await doEdit(interaction);
      case "end": return await doEnd(interaction);
      case "winners": return await doWinners(interaction);
      case "list": return await doList(interaction);
      case "reroll": return await doReroll(interaction);
      default: await interaction.editReply("Unknown giveawayadmin action.");
    }
  } catch (err) {
    logger.error({ err, sub }, "giveawayadmin failed");
    await interaction.editReply("❌ Something went wrong running that command. Check the values and try again.");
  }
}

// ── create ───────────────────────────────────────────────────────────────────
async function doCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const title = interaction.options.getString("title", true).trim();
  const durationStr = interaction.options.getString("duration", true);
  const durationMs = parseDuration(durationStr);
  if (!durationMs) { await interaction.editReply(`❌ Couldn't read duration "${durationStr}". Try \`24h\`, \`3d\`, \`45m\`, or \`1w\`.`); return; }

  const prizesRaw = interaction.options.getString("prizes", true);
  const prizes = await parsePrizes(prizesRaw, interaction);
  if (prizes.length === 0) { await interaction.editReply("❌ No valid prizes parsed. Example: `shards:50000; nitro:1 Month Nitro; card:Dragon Lord x10`"); return; }

  const reqRaw = interaction.options.getString("requirements") ?? "";
  const requirements = parseRequirements(reqRaw);

  const winnerCount = clampInt(interaction.options.getInteger("winners") ?? 1, 1, 50);
  const difficulty = (interaction.options.getString("difficulty") ?? "medium") as GiveawayDifficulty;
  const winnerMode = (interaction.options.getString("mode") ?? (requirements.length ? "completion" : "entry")) as GiveawayWinnerMode;
  const announceMode = (interaction.options.getString("announce") ?? "channel") as GiveawayAnnounceMode;
  const channel = interaction.options.getChannel("channel") ?? interaction.channel;
  const description = interaction.options.getString("description") ?? null;
  const image = interaction.options.getString("image") ?? null;
  const claimTimerMs = parseDuration(interaction.options.getString("claimtimer") ?? "24h") ?? 24 * 3600_000;

  const now = new Date();
  const g = await createGiveaway({
    guildId, title, createdBy: interaction.user.id,
    channelId: (channel && "id" in channel) ? channel.id : interaction.channelId!,
    description, imageUrl: image,
    difficulty, status: "active", winnerCount, winnerMode,
    requirements, prizes,
    startsAt: now, endsAt: new Date(now.getTime() + durationMs),
    claimTimerMinutes: Math.round(claimTimerMs / 60_000),
    announceMode,
  });

  const posted = await postGiveawayMessage(g, interaction.client);
  invalidateActiveCache(guildId);
  invalidateMessageReqCache(guildId);

  const d = DIFFICULTY_META[difficulty];
  await interaction.editReply({
    content: `✅ Launched giveaway **${title}** (#${posted.id})` + (posted.messageId ? ` in <#${posted.channelId}>.` : "."),
    embeds: [new EmbedBuilder().setColor(d.color).setDescription(
      `${d.emoji} **${d.label}** · ${winnerCount} winner(s) · ${winnerMode === "entry" ? "entry-based" : "completion"}\n\n` +
      `**Prizes**\n${formatPrizeList(prizes)}\n\n` +
      `**Requirements**\n${requirements.length ? requirements.map(r => `${r.emoji} ${r.label}`).join("\n") : "None"}\n\n` +
      `Ends <t:${Math.floor((now.getTime() + durationMs) / 1000)}:R>.`,
    )],
  });
}

// ── edit ─────────────────────────────────────────────────────────────────────
async function doEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const g = await requireGiveaway(interaction);
  if (!g) return;
  const patch: Partial<Giveaway> = {};

  const title = interaction.options.getString("title"); if (title) patch.title = title.trim();
  const description = interaction.options.getString("description"); if (description !== null) patch.description = description;
  const image = interaction.options.getString("image"); if (image !== null) patch.imageUrl = image || null;
  const difficulty = interaction.options.getString("difficulty"); if (difficulty) patch.difficulty = difficulty as GiveawayDifficulty;
  const mode = interaction.options.getString("mode"); if (mode) patch.winnerMode = mode as GiveawayWinnerMode;
  const announce = interaction.options.getString("announce"); if (announce) patch.announceMode = announce as GiveawayAnnounceMode;
  const winners = interaction.options.getInteger("winners"); if (winners != null) patch.winnerCount = clampInt(winners, 1, 50);

  const claimtimer = interaction.options.getString("claimtimer");
  if (claimtimer) { const ms = parseDuration(claimtimer); if (ms) patch.claimTimerMinutes = Math.round(ms / 60_000); }

  const duration = interaction.options.getString("duration");
  if (duration) { const ms = parseDuration(duration); if (ms) patch.endsAt = new Date(Date.now() + ms); }

  const prizesRaw = interaction.options.getString("prizes");
  if (prizesRaw) { const p = await parsePrizes(prizesRaw, interaction); if (p.length) patch.prizes = p; }

  const reqRaw = interaction.options.getString("requirements");
  if (reqRaw !== null) patch.requirements = parseRequirements(reqRaw);

  if (Object.keys(patch).length === 0) { await interaction.editReply("Nothing to change — pass at least one field."); return; }

  const updated = await updateGiveaway(g.id, patch);
  invalidateActiveCache(g.guildId);
  invalidateMessageReqCache(g.guildId);
  if (updated) await refreshGiveawayMessage(updated, interaction.client);
  await interaction.editReply(`✅ Updated giveaway **${updated?.title ?? g.title}** (#${g.id}). The live message has been refreshed.`);
}

// ── end ──────────────────────────────────────────────────────────────────────
async function doEnd(interaction: ChatInputCommandInteraction): Promise<void> {
  const g = await requireGiveaway(interaction);
  if (!g) return;
  if (g.status !== "active") { await interaction.editReply(`Giveaway #${g.id} is already **${g.status}**.`); return; }
  const winners = await endGiveaway(g, interaction.client, { manual: true });
  await interaction.editReply(winners.length
    ? `🎊 Ended **${g.title}** — winners: ${winners.map(w => `<@${w.userId}>`).join(", ")}.`
    : `🎊 Ended **${g.title}** — no eligible entrants, so no winners were drawn.`);
}

// ── winners ──────────────────────────────────────────────────────────────────
async function doWinners(interaction: ChatInputCommandInteraction): Promise<void> {
  const g = await requireGiveaway(interaction);
  if (!g) return;
  const winners = await listWinners(g.id);
  if (winners.length === 0) { await interaction.editReply(`No winners recorded for **${g.title}** (#${g.id}) yet.`); return; }
  const lines = winners.map(w => {
    const badge = w.claimStatus === "claimed" ? "✅ claimed"
      : w.claimStatus === "expired" ? "⌛ expired"
      : w.claimStatus === "rerolled" ? "🔁 rerolled"
      : "🎁 pending";
    return `• <@${w.userId}> — ${badge}` + (w.claimedAt ? ` (<t:${Math.floor(w.claimedAt.getTime() / 1000)}:R>)` : "");
  });
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle(`🏆 Winners — ${g.title} (#${g.id})`)
    .setColor(DIFFICULTY_META[g.difficulty].color)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Use /giveaway_admin reroll id:<id> user:<@winner> to replace a winner." })] });
}

// ── list ─────────────────────────────────────────────────────────────────────
async function doList(interaction: ChatInputCommandInteraction): Promise<void> {
  const all = await listGiveaways(interaction.guild!.id);
  if (all.length === 0) { await interaction.editReply("No giveaways created on this server yet. Make one with `/giveaway_admin create`."); return; }
  const active = all.filter(g => g.status === "active");
  const past = all.filter(g => g.status !== "active").slice(0, 10);
  const fmt = async (g: Giveaway) => {
    const stats = await countEntrants(g.id);
    const ends = g.endsAt ? `<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>` : "—";
    const st = g.status === "active" ? `ends ${ends}` : g.status;
    return `\`#${g.id}\` ${DIFFICULTY_META[g.difficulty].emoji} **${g.title}** — ${g.winnerCount}w · 👥 ${stats.entrants} · ${st}`;
  };
  const activeLines = await Promise.all(active.map(fmt));
  const pastLines = await Promise.all(past.map(fmt));
  const embed = new EmbedBuilder().setTitle("🎉 Giveaways").setColor(0xf1c40f).setDescription(
    (activeLines.length ? `**Active**\n${activeLines.join("\n")}\n\n` : "") +
    (pastLines.length ? `**Past**\n${pastLines.join("\n")}` : ""),
  );
  await interaction.editReply({ embeds: [embed] });
}

// ── reroll ───────────────────────────────────────────────────────────────────
async function doReroll(interaction: ChatInputCommandInteraction): Promise<void> {
  const g = await requireGiveaway(interaction);
  if (!g) return;
  const target = interaction.options.getUser("user");
  const winners = await listWinners(g.id);
  const old = target
    ? winners.find(w => w.userId === target.id)
    : winners.find(w => w.claimStatus === "pending");
  if (!old) { await interaction.editReply(target ? "That user isn't a current winner of this giveaway." : "No pending winner to reroll."); return; }
  const fresh = await rerollWinner(g, old, interaction.client, "manual");
  await interaction.editReply(fresh
    ? `🔁 Rerolled — <@${fresh.userId}> is the new winner of **${g.title}**.`
    : `Rerolled <@${old.userId}>, but there were no other eligible entrants to pick.`);
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function requireGiveaway(interaction: ChatInputCommandInteraction): Promise<Giveaway | null> {
  const id = interaction.options.getInteger("id", true);
  const g = await getGiveaway(id);
  if (!g || g.guildId !== interaction.guild!.id) {
    await interaction.editReply(`No giveaway \`#${id}\` on this server. See \`/giveaway_admin list\`.`);
    return null;
  }
  return g;
}

function clampInt(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, Math.round(n))); }

// "1w2d3h45m30s" / "24h" / "3d" → milliseconds (null if nothing parsed).
export function parseDuration(input: string): number | null {
  const re = /(\d+)\s*([wdhms])/gi;
  let ms = 0; let matched = false; let m: RegExpExecArray | null;
  const unit: Record<string, number> = { w: 604800_000, d: 86400_000, h: 3600_000, m: 60_000, s: 1000 };
  while ((m = re.exec(input)) !== null) {
    matched = true;
    ms += Number(m[1]) * (unit[m[2]!.toLowerCase()] ?? 0);
  }
  return matched && ms > 0 ? ms : null;
}

// Prize string: semicolon-separated tokens.
//   shards:50000
//   pack:legendary x2        pack:premium
//   card:Dragon Lord x10     (resolves the DN Cards card by name)
//   nitro:1 Month Discord Nitro
//   role:<@&123> | role:123
//   custom:VIP shoutout  |  any plain text → custom
const PRIZE_EMOJI: Record<string, string> = { cards: "🃏", pack: "📦", shards: "💠", nitro: "🚀", role: "🎭", custom: "🎁" };

async function parsePrizes(raw: string, interaction: ChatInputCommandInteraction): Promise<GiveawayPrize[]> {
  const out: GiveawayPrize[] = [];
  for (const tokenRaw of raw.split(";").map(s => s.trim()).filter(Boolean)) {
    const colon = tokenRaw.indexOf(":");
    const kind = (colon >= 0 ? tokenRaw.slice(0, colon) : tokenRaw).trim().toLowerCase();
    let rest = (colon >= 0 ? tokenRaw.slice(colon + 1) : "").trim();
    const qty = extractQty(rest); if (qty.qty) rest = qty.rest;

    switch (kind) {
      case "shard": case "shards": {
        const amount = parseInt(rest.replace(/[^\d]/g, ""), 10);
        if (amount > 0) out.push({ type: "shards", qty: amount, label: `${amount.toLocaleString()} DN Shards`, emoji: PRIZE_EMOJI.shards });
        break;
      }
      case "pack": case "packs": {
        const tier = (rest || "basic").toLowerCase();
        out.push({ type: "pack", packTier: tier, qty: qty.qty ?? 1, label: `${qty.qty ?? 1}× ${tier} pack`, emoji: PRIZE_EMOJI.pack });
        break;
      }
      case "card": case "cards": {
        const card = await getCardByName(rest).catch(() => undefined);
        const n = qty.qty ?? 1;
        if (card) out.push({ type: "cards", cardId: card.id, cardName: card.name, qty: n, label: `${n}× ${card.name}`, emoji: PRIZE_EMOJI.cards });
        else out.push({ type: "cards", qty: n, label: rest ? `${n}× ${rest}` : `${n} cards`, emoji: PRIZE_EMOJI.cards }); // admin-fulfilled
        break;
      }
      case "nitro": out.push({ type: "nitro", label: rest || "Discord Nitro", emoji: PRIZE_EMOJI.nitro }); break;
      case "role": {
        const roleId = rest.match(/\d{5,}/)?.[0];
        const name = interaction.guild?.roles.cache.get(roleId ?? "")?.name;
        out.push({ type: "role", roleId, label: name ? `${name} role` : (rest || "a role"), emoji: PRIZE_EMOJI.role });
        break;
      }
      case "custom": out.push({ type: "custom", label: rest || "Custom prize", emoji: PRIZE_EMOJI.custom }); break;
      default: out.push({ type: "custom", label: tokenRaw, emoji: PRIZE_EMOJI.custom }); break;
    }
  }
  return out;
}

// Pull a trailing "xN" / "×N" quantity off a token body.
function extractQty(rest: string): { qty?: number; rest: string } {
  const m = rest.match(/[x×]\s*(\d+)\s*$/i);
  if (m) return { qty: parseInt(m[1]!, 10), rest: rest.slice(0, m.index).trim() };
  return { rest };
}

// Requirement string: semicolon-separated tokens `type:goal[:flags…]`.
//   catch:50                 catch 50 cards
//   catch:3:legendary:+5     catch 3 legendary-or-better, +5 entries on complete
//   battlewin:10:*1          win 10 battles, +1 entry each
//   message:100              send 100 messages
//   raiddamage:5000:*1
// Flags: a rarity word → rarityMin; `+N` → entriesOnComplete; `*N` → entriesPerUnit.
const TYPE_ALIAS: Record<string, GiveawayReqType> = {
  catch: "catch", catches: "catch",
  burn: "burn", burns: "burn",
  pack: "pack_open", packs: "pack_open", packopen: "pack_open",
  win: "battle_win", wins: "battle_win", battlewin: "battle_win", battlewins: "battle_win",
  battle: "battle_played", battles: "battle_played", battleplayed: "battle_played",
  raid: "raid_join", raidjoin: "raid_join", raids: "raid_join",
  raiddamage: "raid_damage", raiddmg: "raid_damage",
  echo: "echo_use", echouse: "echo_use",
  message: "message", messages: "message", msg: "message",
};
const REQ_EMOJI: Record<GiveawayReqType, string> = {
  catch: "🎯", burn: "🔥", pack_open: "📦", battle_win: "⚔️", battle_played: "🛡️",
  raid_join: "🐉", raid_damage: "💥", echo_use: "🔊", message: "💬",
};

export function parseRequirements(raw: string): GiveawayRequirement[] {
  const out: GiveawayRequirement[] = [];
  let i = 0;
  for (const tokenRaw of raw.split(";").map(s => s.trim()).filter(Boolean)) {
    const parts = tokenRaw.split(":").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const type = TYPE_ALIAS[parts[0]!.toLowerCase()];
    const goal = parseInt(parts[1]!.replace(/[^\d]/g, ""), 10);
    if (!type || !goal || goal <= 0) continue;

    let rarityMin: string | undefined;
    let entriesOnComplete: number | undefined;
    let entriesPerUnit: number | undefined;
    for (const flag of parts.slice(2)) {
      const f = flag.toLowerCase();
      if (RARITIES.includes(f)) rarityMin = f;
      else if (f.startsWith("+")) entriesOnComplete = parseInt(f.slice(1), 10) || undefined;
      else if (f.startsWith("*")) entriesPerUnit = parseInt(f.slice(1), 10) || undefined;
    }
    out.push({
      key: `${type}_${i++}`,
      type, goal, rarityMin, entriesPerUnit, entriesOnComplete,
      emoji: REQ_EMOJI[type],
      label: requirementLabel(type, goal, rarityMin),
    });
  }
  return out;
}

function requirementLabel(type: GiveawayReqType, goal: number, rarityMin?: string): string {
  const rar = rarityMin ? `${cap(rarityMin)}-or-better ` : "";
  switch (type) {
    case "catch": return `Catch ${goal} ${rar}card${goal === 1 ? "" : "s"}`;
    case "burn": return `Burn ${goal} ${rar}card${goal === 1 ? "" : "s"}`;
    case "pack_open": return `Open ${goal} pack${goal === 1 ? "" : "s"}`;
    case "battle_win": return `Win ${goal} battle${goal === 1 ? "" : "s"}`;
    case "battle_played": return `Play ${goal} battle${goal === 1 ? "" : "s"}`;
    case "raid_join": return `Join ${goal} co-op raid${goal === 1 ? "" : "s"}`;
    case "raid_damage": return `Deal ${goal.toLocaleString()} raid damage`;
    case "echo_use": return `Use Echo ${goal} time${goal === 1 ? "" : "s"}`;
    case "message": return `Send ${goal} message${goal === 1 ? "" : "s"}`;
    default: return `${type} ${goal}`;
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
