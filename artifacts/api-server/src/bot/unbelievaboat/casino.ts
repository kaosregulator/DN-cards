// /casino — UnbelievaBoat casino hub (folds many top-level slash cmds under Discord's 100 limit).

import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import {
  getOrCreateUbSettings,
  listRoleLinks,
  writeUbAudit,
} from "../../lib/unbelievaboat/db.js";
import { isUbConfigured, ubApi } from "../../lib/unbelievaboat/client.js";
import { UNBELIEVABOAT_AUTHOR, UNBELIEVABOAT_COLOR, UNBELIEVABOAT_NAME } from "./branding.js";
import {
  CashError,
  depositCash,
  withdrawCash,
  earnCash,
  getCashBalance,
  fmtCash,
} from "./cash.js";
import {
  assertIncomeCooldown,
  markIncomeCooldown,
  getGuildCooldowns,
} from "./cooldowns.js";
import { replyThenPostAsUnbelievaBoat } from "./webhook.js";
import { renderCoinCollectGif, renderDepositGif, renderWithdrawGif } from "./render-collect.js";
import { renderUbLeaderboardGif } from "./render-leaderboard.js";
import { brandAsset, BRAND_LOGO_FILE, BRAND_NAME } from "../help-banners.js";
import { logEconomyEvent, logGameEvent } from "../logging/channel-log.js";
import {
  handleCashGamesHub,
  handleBlackjack,
  handleRoulette,
  handleHigherLower,
  handleRedBlack,
  handleSlots,
  handleCashWork,
  handleCashCrime,
  handleRussian,
  handleRob,
  handleSlut,
} from "./games.js";
import { handleCashStore } from "./store.js";
import { handleUno } from "./uno.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export function buildCasinoCommandJson() {
  return new SlashCommandBuilder()
    .setName("casino")
    .setDescription("UnbelievaBoat casino — deposit, games, collect, leaderboard & more")
    .setDMPermission(false)
    .addSubcommand(sc => sc.setName("balance").setDescription("Show your UnbelievaBoat cash & bank")
      .addUserOption(o => o.setName("user").setDescription("Check another member")))
    .addSubcommand(sc => sc.setName("deposit").setDescription("Move cash into the bank (casino vault)")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to deposit").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc.setName("withdraw").setDescription("Move bank back to cash")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc.setName("daily").setDescription("Animated Cash Check-In — claim daily cash"))
    .addSubcommand(sc => sc.setName("collect").setDescription("Collect income from your owned perk roles"))
    .addSubcommand(sc => sc.setName("work").setDescription("Safe work shift — earn cash"))
    .addSubcommand(sc => sc.setName("crime").setDescription("Risky crime — bigger payout or a fine"))
    .addSubcommand(sc => sc.setName("beg").setDescription("PG dramatic cash beg"))
    .addSubcommand(sc => sc.setName("rob").setDescription("Stick-up for cash (honors immunity roles)")
      .addUserOption(o => o.setName("target").setDescription("Target").setRequired(true)))
    .addSubcommand(sc => sc.setName("blackjack").setDescription("Interactive 21 — Hit / Stand / Double")
      .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(100_000)))
    .addSubcommand(sc => sc.setName("higherlower").setDescription("Guess the next card")
      .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000)))
    .addSubcommand(sc => sc.setName("redblack").setDescription("Red or Black — flip for 2×")
      .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000))
      .addStringOption(o => o.setName("color").setDescription("Pick a color").setRequired(true)
        .addChoices({ name: "Red", value: "red" }, { name: "Black", value: "black" })))
    .addSubcommand(sc => sc.setName("roulette").setDescription("Bet on red, black, or green")
      .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(100_000))
      .addStringOption(o => o.setName("color").setDescription("Color").setRequired(true)
        .addChoices(
          { name: "Red (2×)", value: "red" },
          { name: "Black (2×)", value: "black" },
          { name: "Green 0 (14×)", value: "green" },
        )))
    .addSubcommand(sc => sc.setName("slots").setDescription("Three-reel slot machine")
      .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000)))
    .addSubcommand(sc => sc.setName("russian").setDescription("Russian roulette — AI or live challenge")
      .addUserOption(o => o.setName("target").setDescription("Target").setRequired(true))
      .addIntegerOption(o => o.setName("bet").setDescription("Stake").setRequired(true).setMinValue(10).setMaxValue(50_000))
      .addStringOption(o => o.setName("mode").setDescription("Mode")
        .addChoices({ name: "AI vs their avatar", value: "ai" }, { name: "Challenge them live", value: "challenge" })))
    .addSubcommand(sc => sc.setName("uno").setDescription("Mini UNO vs the house — first to empty hand wins 2×")
      .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000)))
    .addSubcommand(sc => sc.setName("store").setDescription("Perk role storefront"))
    .addSubcommand(sc => sc.setName("top").setDescription("Dex N Cards × UnbelievaBoat cash leaderboard"))
    .addSubcommand(sc => sc.setName("games").setDescription("Casino menu — what you can play"))
    .toJSON();
}

function brandEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(UNBELIEVABOAT_COLOR)
    .setAuthor(UNBELIEVABOAT_AUTHOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${BRAND_NAME} × ${UNBELIEVABOAT_NAME}` });
}

async function attachGif(
  result: { buffer: Buffer } | null,
  name: string,
): Promise<{ files: AttachmentBuilder[]; imageName: string | null }> {
  if (!result) return { files: [], imageName: null };
  return { files: [new AttachmentBuilder(result.buffer, { name })], imageName: name };
}

/** Proxy helpers so subcommand options map onto the old flat-command handlers. */
function withOpts(interaction: ChatInputCommandInteraction): ChatInputCommandInteraction {
  return interaction;
}

export async function handleCasinoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  const sub = interaction.options.getSubcommand(true);

  switch (sub) {
    case "balance":
      await handleBalance(interaction);
      return;
    case "deposit":
      await handleDeposit(interaction);
      return;
    case "withdraw":
      await handleWithdraw(interaction);
      return;
    case "daily":
      await handleAnimatedDaily(interaction);
      return;
    case "collect":
      await handleCollect(interaction);
      return;
    case "work":
      await handleCashWork(withOpts(interaction));
      return;
    case "crime":
      await handleCashCrime(withOpts(interaction));
      return;
    case "beg":
      await handleSlut(withOpts(interaction));
      return;
    case "rob":
      await handleRob(withOpts(interaction));
      return;
    case "blackjack":
      await handleBlackjack(withOpts(interaction));
      return;
    case "higherlower":
      await handleHigherLower(withOpts(interaction));
      return;
    case "redblack":
      await handleRedBlack(withOpts(interaction));
      return;
    case "roulette":
      await handleRoulette(withOpts(interaction));
      return;
    case "slots":
      await handleSlots(withOpts(interaction));
      return;
    case "russian":
      await handleRussian(withOpts(interaction));
      return;
    case "uno":
      await handleUno(withOpts(interaction));
      return;
    case "store":
      await handleCashStore(withOpts(interaction));
      return;
    case "top":
      await handleCasinoTop(interaction);
      return;
    case "games":
      await handleCashGamesHub(withOpts(interaction));
      return;
    default:
      await interaction.reply({ content: "Unknown casino action.", ...EPHEMERAL });
  }
}

async function handleBalance(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const bal = await getCashBalance(interaction.guildId!, target.id);
    const embed = brandEmbed("Casino Wallet", [
      `${target}`,
      `💵 Cash **${fmtCash(bal.cash)}** ${bal.symbol}`,
      `🏦 Bank **${fmtCash(bal.bank)}** ${bal.symbol}`,
      `Σ Total **${fmtCash(bal.cash + bal.bank)}**`,
      "",
      `_Deposit with \`/casino deposit\` · withdraw with \`/casino withdraw\`._`,
    ].join("\n"));
    embed.setThumbnail(target.displayAvatarURL({ size: 128 }));
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function handleDeposit(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const amount = interaction.options.getInteger("amount", true);
    const bal = await depositCash(interaction.guildId!, interaction.user.id, amount);
    await writeUbAudit(interaction.guildId!, interaction.user.id, "casino_deposit", { amount });
    const gif = await renderDepositGif({
      amount, symbol: bal.symbol, newCash: bal.cash, newBank: bal.bank,
    });
    const { files, imageName } = await attachGif(gif, "deposit.gif");
    const embed = brandEmbed("Casino Deposit", [
      `${interaction.user} deposited **${fmtCash(amount)}** ${bal.symbol} into the bank.`,
      `💵 Cash **${fmtCash(bal.cash)}** · 🏦 Bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
    void logEconomyEvent(
      interaction.client, interaction.guildId!, interaction.user,
      "Deposit", `Deposited ${fmtCash(amount)} ${bal.symbol}`,
      [
        { name: "Cash", value: fmtCash(bal.cash), inline: true },
        { name: "Bank", value: fmtCash(bal.bank), inline: true },
      ],
    );
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function handleWithdraw(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const amount = interaction.options.getInteger("amount", true);
    const bal = await withdrawCash(interaction.guildId!, interaction.user.id, amount);
    await writeUbAudit(interaction.guildId!, interaction.user.id, "casino_withdraw", { amount });
    const gif = await renderWithdrawGif({
      amount, symbol: bal.symbol, newCash: bal.cash, newBank: bal.bank,
    });
    const { files, imageName } = await attachGif(gif, "withdraw.gif");
    const embed = brandEmbed("Casino Withdraw", [
      `${interaction.user} withdrew **${fmtCash(amount)}** ${bal.symbol} to cash.`,
      `💵 Cash **${fmtCash(bal.cash)}** · 🏦 Bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
    void logEconomyEvent(
      interaction.client, interaction.guildId!, interaction.user,
      "Withdraw", `Withdrew ${fmtCash(amount)} ${bal.symbol}`,
      [
        { name: "Cash", value: fmtCash(bal.cash), inline: true },
        { name: "Bank", value: fmtCash(bal.bank), inline: true },
      ],
    );
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Animated daily — reverse coin collect into wallet (Sonic/Mario energy). */
async function handleAnimatedDaily(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const settings = await getOrCreateUbSettings(interaction.guildId!);
    if (!settings.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
    await assertIncomeCooldown(interaction.guildId!, interaction.user.id, "daily");
    const { getOrCreateGameState, touchGameState } = await import("../../lib/unbelievaboat/db.js");
    const state = await getOrCreateGameState(interaction.guildId!, interaction.user.id);
    const now = Date.now();
    const prev = state.lastDailyAt?.getTime() ?? 0;
    const cds = await getGuildCooldowns(interaction.guildId!);
    const streak = prev && now - prev < cds.dailySec * 1000 * 2 ? (state.dailyStreak || 0) + 1 : 1;
    const lo = Math.min(settings.dailyMin, settings.dailyMax);
    const hi = Math.max(settings.dailyMin, settings.dailyMax);
    const amount = lo + Math.floor(Math.random() * (hi - lo + 1));
    const bal = await earnCash(interaction.guildId!, interaction.user.id, amount, "Cash Check-In");
    await markIncomeCooldown(interaction.guildId!, interaction.user.id, "daily");
    await touchGameState(interaction.guildId!, interaction.user.id, { dailyStreak: streak });

    const gif = await renderCoinCollectGif({
      amount,
      symbol: bal.symbol,
      newCash: bal.cash,
      newBank: bal.bank,
      title: `DAILY · STREAK ${streak}`,
    });
    const { files, imageName } = await attachGif(gif, "daily-collect.gif");
    const embed = brandEmbed("Cash Check-In", [
      `${interaction.user} collected **${fmtCash(amount)}** ${bal.symbol}`,
      `Streak **${streak}** · cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      "_Stacks with UnbelievaBoat’s own income rewards._",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
    void logEconomyEvent(
      interaction.client, interaction.guildId!, interaction.user,
      "Daily Check-In", `Claimed ${fmtCash(amount)} (streak ${streak})`,
      [{ name: "Cash", value: fmtCash(bal.cash), inline: true }],
    );
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Collect role income from owned perk roles (UnbelievaBoat-style). */
async function handleCollect(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const settings = await getOrCreateUbSettings(interaction.guildId!);
    if (!settings.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
    await assertIncomeCooldown(interaction.guildId!, interaction.user.id, "collect");

    const member = interaction.member as GuildMember | null;
    if (!member?.roles) {
      await interaction.editReply("Could not read your roles.");
      return;
    }
    const roleIds = new Set(member.roles.cache.keys());
    const links = await listRoleLinks(interaction.guildId!);
    const owned = links.filter(l =>
      l.enabled && l.discordRoleId && roleIds.has(l.discordRoleId) && (l.incomeAmount ?? 0) > 0,
    );
    if (!owned.length) {
      await interaction.editReply(
        "You don’t own any income perk roles yet. Buy one in `/casino store` (admins set **income** on role links).",
      );
      return;
    }

    const total = owned.reduce((s, r) => s + (r.incomeAmount || 0), 0);
    const bal = await earnCash(interaction.guildId!, interaction.user.id, total, "Role income collect");
    await markIncomeCooldown(interaction.guildId!, interaction.user.id, "collect");
    await writeUbAudit(interaction.guildId!, interaction.user.id, "role_collect", {
      total,
      roles: owned.map(r => ({ id: r.discordRoleId, name: r.name, income: r.incomeAmount })),
    });

    const roleLines = owned.map(r =>
      `${r.emoji ? `${r.emoji} ` : ""}${r.name} +${fmtCash(r.incomeAmount)}`,
    );
    const gif = await renderCoinCollectGif({
      amount: total,
      symbol: bal.symbol,
      newCash: bal.cash,
      newBank: bal.bank,
      title: "ROLE INCOME",
      roleLines,
    });
    const { files, imageName } = await attachGif(gif, "collect.gif");
    const embed = brandEmbed("Role Income Collected", [
      `${interaction.user} swept **${fmtCash(total)}** ${bal.symbol} from perk roles:`,
      ...roleLines.map(l => `• ${l}`),
      "",
      `💵 Cash **${fmtCash(bal.cash)}** · 🏦 Bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
    void logEconomyEvent(
      interaction.client, interaction.guildId!, interaction.user,
      "Role Collect", `Collected ${fmtCash(total)} from ${owned.length} role(s)`,
      roleLines.slice(0, 5).map(l => ({ name: "Role", value: l, inline: true })),
    );
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function handleCasinoTop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const settings = await getOrCreateUbSettings(interaction.guildId!);
    if (!isUbConfigured() || !settings.enabled) {
      await interaction.editReply("UnbelievaBoat API link is not configured or disabled.");
      return;
    }
    const raw = await ubApi.getLeaderboard(settings.ubGuildId || interaction.guildId!, {
      sort: (settings.leaderboardSort as "cash" | "bank" | "total") || "total",
      limit: 10,
      page: 1,
    });
    const users = Array.isArray(raw) ? raw : raw.users ?? [];
    const guild = interaction.guild;
    const rows = [];
    for (let i = 0; i < users.length; i++) {
      const u = users[i]!;
      let name = u.user_id;
      let avatarUrl: string | null = null;
      try {
        const member = await guild?.members.fetch(u.user_id).catch(() => null);
        if (member) {
          name = member.displayName;
          avatarUrl = member.user.displayAvatarURL({ size: 128, extension: "png" });
        } else {
          const user = await interaction.client.users.fetch(u.user_id).catch(() => null);
          if (user) {
            name = user.username;
            avatarUrl = user.displayAvatarURL({ size: 128, extension: "png" });
          }
        }
      } catch { /* keep id */ }
      rows.push({
        rank: i + 1,
        userId: u.user_id,
        name,
        avatarUrl,
        cash: u.cash ?? 0,
        bank: u.bank ?? 0,
        total: u.total ?? ((u.cash ?? 0) + (u.bank ?? 0)),
      });
    }

    let symbol = settings.currencyLabel ?? "💵";
    try {
      const g = await ubApi.getGuild(settings.ubGuildId || interaction.guildId!);
      if (g.symbol) symbol = g.symbol;
    } catch { /* keep */ }

    const gif = await renderUbLeaderboardGif({
      rows,
      sort: settings.leaderboardSort,
      symbol,
    });
    const files: AttachmentBuilder[] = [];
    const embed = brandEmbed(
      `${BRAND_NAME} × ${UNBELIEVABOAT_NAME} Leaderboard`,
      rows.length
        ? rows.map(r =>
          `**${r.rank}.** <@${r.userId}> — cash ${fmtCash(r.cash)} · bank ${fmtCash(r.bank)} · **${fmtCash(r.total)}**`,
        ).join("\n")
        : "_No balances yet._",
    );
    const logo = brandAsset(BRAND_LOGO_FILE);
    if (logo) {
      files.push(new AttachmentBuilder(logo, { name: BRAND_LOGO_FILE }));
      embed.setThumbnail(`attachment://${BRAND_LOGO_FILE}`);
    }
    if (gif) {
      files.push(new AttachmentBuilder(gif.buffer, { name: "ub-leaderboard.gif" }));
      embed.setImage("attachment://ub-leaderboard.gif");
    }
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
    void logGameEvent(
      interaction.client, interaction.guildId!, interaction.user,
      "Leaderboard viewed", `${interaction.user.username} opened the cash board`,
    );
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Legacy flat `/cashcheck` still routes here if re-enabled. */
export { handleCashCheck } from "./games.js";
