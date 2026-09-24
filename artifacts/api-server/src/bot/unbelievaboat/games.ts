// UnbelievaBoat mini-games — interactive blackjack + casino table games.
// Bets pull from cash first, then bank. Results post as UnbelievaBoat.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  User,
} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import {
  getOrCreateUbSettings,
  getOrCreateGameState,
  touchGameState,
  writeUbAudit,
} from "../../lib/unbelievaboat/db.js";
import { UNBELIEVABOAT_AUTHOR, UNBELIEVABOAT_COLOR } from "./branding.js";
import {
  CashError, earnCash, spendFunds, getCashBalance, fmtCash, formatSpendNote,
} from "./cash.js";
import {
  assertGameCooldown, assertIncomeCooldown, markGameCooldown, markIncomeCooldown,
  getGuildCooldowns, cdText, DEFAULT_COOLDOWNS,
} from "./cooldowns.js";
import {
  freshDeck, draw, cardLabel, handTotal, isNaturalBlackjack, formatHand,
  isRed, rankValue, type Card,
} from "./cards.js";
import { replyThenPostAsUnbelievaBoat, postAsUnbelievaBoat } from "./webhook.js";
import {
  renderBegGif, renderBlackjackTableGif, renderCoinSpinGif, renderHigherLowerGif,
  renderRedBlackGif, renderRobGif, renderRouletteGif, renderRussianGif,
  renderSlotsGif, renderWorkGif,
} from "./render-games.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type BjSession = {
  guildId: string;
  userId: string;
  bet: number;
  fromCash: number;
  fromBank: number;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  doubled: boolean;
  expires: number;
};

const bjSessions = new Map<string, BjSession>();
const higherSessions = new Map<string, {
  guildId: string; userId: string; bet: number; shown: Card; deck: Card[]; expires: number;
  fromCash: number; fromBank: number;
}>();

const russianChallenges = new Map<string, {
  guildId: string; challengerId: string; targetId: string; bet: number; expires: number;
}>();

function bjKey(guildId: string, userId: string) { return `${guildId}:${userId}`; }

function brandEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(UNBELIEVABOAT_COLOR)
    .setAuthor(UNBELIEVABOAT_AUTHOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Powered by the UnbelievaBoat API you authorized · cash then bank" });
}

async function attachGif(result: Awaited<ReturnType<typeof renderCoinSpinGif>>, name: string) {
  if (!result) return { files: [] as AttachmentBuilder[], imageName: null as string | null };
  return { files: [new AttachmentBuilder(result.buffer, { name })], imageName: name };
}

async function assertGamesOn(guildId: string) {
  const s = await getOrCreateUbSettings(guildId);
  if (!s.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
}

function bjButtons(userId: string, canDouble: boolean) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`unbgame:bj:hit:${userId}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`unbgame:bj:stand:${userId}`).setLabel("Stand").setStyle(ButtonStyle.Secondary),
  );
  if (canDouble) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`unbgame:bj:double:${userId}`).setLabel("Double Down").setStyle(ButtonStyle.Success),
    );
  }
  return [row];
}

// ── Command builders ──────────────────────────────────────────────────────────

export function buildCashCheckCommandJson() {
  return new SlashCommandBuilder()
    .setName("cashcheck")
    .setDescription("Cash Check-In — claim UnbelievaBoat cash (stacks with their rewards)")
    .setDMPermission(false).toJSON();
}

export function buildCashGamesCommandJson() {
  return new SlashCommandBuilder()
    .setName("cashgames")
    .setDescription("UnbelievaBoat casino hub — blackjack, slots, roulette, and more")
    .setDMPermission(false).toJSON();
}

export function buildRouletteCommandJson() {
  return new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("Casino roulette — bet on red, black, or green (cash then bank)")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(100_000))
    .addStringOption(o => o.setName("color").setDescription("Color").setRequired(true)
      .addChoices(
        { name: "Red (2×)", value: "red" },
        { name: "Black (2×)", value: "black" },
        { name: "Green 0 (14×)", value: "green" },
      )).toJSON();
}

export function buildBlackjackCommandJson() {
  return new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Interactive 21 — Hit / Stand / Double Down")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(100_000))
    .toJSON();
}

export function buildHigherLowerCommandJson() {
  return new SlashCommandBuilder()
    .setName("higherlower")
    .setDescription("Higher or Lower — guess the next card")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000))
    .toJSON();
}

export function buildRedBlackCommandJson() {
  return new SlashCommandBuilder()
    .setName("redblack")
    .setDescription("Red or Black — flip a card for 2×")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000))
    .addStringOption(o => o.setName("color").setDescription("Pick a color").setRequired(true)
      .addChoices({ name: "Red", value: "red" }, { name: "Black", value: "black" }))
    .toJSON();
}

export function buildSlotsCommandJson() {
  return new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Slot machine — three in a row pays")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Wager").setRequired(true).setMinValue(10).setMaxValue(50_000))
    .toJSON();
}

export function buildWorkCommandJson() {
  return new SlashCommandBuilder()
    .setName("cashwork")
    .setDescription("Safe work shift — earn UnbelievaBoat cash (no risk)")
    .setDMPermission(false).toJSON();
}

export function buildCrimeCommandJson() {
  return new SlashCommandBuilder()
    .setName("cashcrime")
    .setDescription("Risky crime — bigger payout or a fine")
    .setDMPermission(false).toJSON();
}

export function buildRussianCommandJson() {
  return new SlashCommandBuilder()
    .setName("russian")
    .setDescription("Russian roulette — AI duel or live challenge")
    .setDMPermission(false)
    .addUserOption(o => o.setName("target").setDescription("Target").setRequired(true))
    .addIntegerOption(o => o.setName("bet").setDescription("Stake").setRequired(true).setMinValue(10).setMaxValue(50_000))
    .addStringOption(o => o.setName("mode").setDescription("Mode")
      .addChoices({ name: "AI vs their avatar", value: "ai" }, { name: "Challenge them live", value: "challenge" }))
    .toJSON();
}

export function buildRobCommandJson() {
  return new SlashCommandBuilder()
    .setName("rob")
    .setDescription("Stick-figure stickup for UnbelievaBoat cash")
    .setDMPermission(false)
    .addUserOption(o => o.setName("target").setDescription("Target").setRequired(true))
    .toJSON();
}

export function buildSlutCommandJson() {
  return new SlashCommandBuilder()
    .setName("slut")
    .setDescription("PG dramatic cash beg (name blurred in embeds)")
    .setDMPermission(false).toJSON();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function finishBlackjack(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  session: BjSession,
  playerStood: boolean,
) {
  const key = bjKey(session.guildId, session.userId);
  bjSessions.delete(key);

  // Dealer draws to 17
  while (handTotal(session.dealer).total < 17) {
    session.dealer.push(draw(session.deck));
  }

  const p = handTotal(session.player).total;
  const d = handTotal(session.dealer).total;
  let outcome: "win" | "lose" | "push" = "lose";
  if (p > 21) outcome = "lose";
  else if (d > 21 || p > d) outcome = "win";
  else if (p === d) outcome = "push";

  const payout = outcome === "win" ? session.bet * 2 : outcome === "push" ? session.bet : 0;
  let bal = await getCashBalance(session.guildId, session.userId);
  if (payout > 0) bal = await earnCash(session.guildId, session.userId, payout, `Blackjack ${outcome}`);

  const gif = await renderBlackjackTableGif({
    player: session.player,
    dealer: session.dealer,
    hideDealer: false,
    revealHole: true,
    banner: outcome.toUpperCase(),
  });
  const { files, imageName } = await attachGif(gif, "blackjack.gif");
  const embed = brandEmbed(
    "Blackjack — 21",
    [
      `<@${session.userId}>`,
      `You ${formatHand(session.player)} (**${p}**)`,
      `Dealer ${formatHand(session.dealer)} (**${d}**)`,
      outcome === "win"
        ? `🎉 Win **${fmtCash(payout)}** ${bal.symbol}`
        : outcome === "push"
          ? `🤝 Push — stake returned`
          : `💀 Bust / lose stake **${fmtCash(session.bet)}**`,
      formatSpendNote(session.fromCash, session.fromBank, bal.symbol),
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"),
  );
  if (imageName) embed.setImage(`attachment://${imageName}`);

  // Keep the table public — update the live hand message; optionally mirror via webhook.
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], files, components: [] }).catch(() => {});
  }
  await postAsUnbelievaBoat(interaction as ChatInputCommandInteraction, { embeds: [embed], files });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handleCashCheck(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertIncomeCooldown(interaction.guildId, interaction.user.id, "daily");
    const settings = await getOrCreateUbSettings(interaction.guildId);
    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const now = Date.now();
    const prev = state.lastDailyAt?.getTime() ?? 0;
    const cds = await getGuildCooldowns(interaction.guildId);
    const streak = prev && now - prev < cds.dailySec * 1000 * 2 ? (state.dailyStreak || 0) + 1 : 1;
    const lo = Math.min(settings.dailyMin, settings.dailyMax);
    const hi = Math.max(settings.dailyMin, settings.dailyMax);
    const amount = lo + Math.floor(Math.random() * (hi - lo + 1));
    const bal = await earnCash(interaction.guildId, interaction.user.id, amount, "Cash Check-In");
    await markIncomeCooldown(interaction.guildId, interaction.user.id, "daily");
    await touchGameState(interaction.guildId, interaction.user.id, { dailyStreak: streak });
    const gif = await renderCoinSpinGif({ amount, symbol: bal.symbol, streak });
    const { files, imageName } = await attachGif(gif, "cashcheck.gif");
    const embed = brandEmbed("Cash Check-In", [
      `${interaction.user} claimed **${fmtCash(amount)}** ${bal.symbol}`,
      `Streak **${streak}** · cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      "_Stacks with UnbelievaBoat’s own income/role rewards._",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleCashGamesHub(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const bal = await getCashBalance(interaction.guildId, interaction.user.id);
    const cds = await getGuildCooldowns(interaction.guildId);
    const embed = brandEmbed("Casino Hub", [
      `Wallet: **${fmtCash(bal.cash)}** cash · **${fmtCash(bal.bank)}** bank ${bal.symbol}`,
      `_Bets spend cash first, then bank. Open \`/casino\` for the floor panel._`,
      "",
      "**Floor panel:** `/casino` — wallet · slots · blackjack · roulette · UNO · hustle",
      "**Tables:** Slots (mega) · Blackjack 21 (public) · Roulette · Higher/Lower · Red/Black · UNO",
      "**Income:** Daily · Collect · Work · Crime · Beg",
      "**Chaos:** Rob · Russian",
      "",
      `Game limit: **${cds.gameUses}** / **${cdText(cds.gameWindowSec * 1000)}** (edit in \`/unbelievaboat\`)`,
    ].join("\n"));
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleBlackjack(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  // Public table — everyone on the floor can watch the hand.
  await interaction.deferReply();
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    const key = bjKey(interaction.guildId, interaction.user.id);
    if (bjSessions.has(key)) {
      await interaction.editReply("You already have a hand open — finish Hit/Stand first.");
      return;
    }

    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, "Blackjack bet");
    await markGameCooldown(interaction.guildId, interaction.user.id);

    const deck = freshDeck();
    const player = [draw(deck), draw(deck)];
    const dealer = [draw(deck), draw(deck)];

    // Natural checks
    if (isNaturalBlackjack(dealer) || isNaturalBlackjack(player)) {
      const session: BjSession = {
        guildId: interaction.guildId, userId: interaction.user.id, bet,
        fromCash: spent.fromCash, fromBank: spent.fromBank,
        deck, player, dealer, doubled: false, expires: Date.now() + 120_000,
      };
      await finishBlackjack(interaction, session, true);
      return;
    }

    const session: BjSession = {
      guildId: interaction.guildId, userId: interaction.user.id, bet,
      fromCash: spent.fromCash, fromBank: spent.fromBank,
      deck, player, dealer, doubled: false, expires: Date.now() + 3 * 60_000,
    };
    bjSessions.set(key, session);

    const p = handTotal(player);
    const gif = await renderBlackjackTableGif({ player, dealer, hideDealer: true });
    const { files, imageName } = await attachGif(gif, "bj-deal.gif");
    const embed = brandEmbed("Blackjack — your move", [
      `${interaction.user} · ${formatSpendNote(spent.fromCash, spent.fromBank, spent.balance.symbol)}`,
      `You: ${formatHand(player)} (**${p.total}**${p.soft ? " soft" : ""})`,
      `Dealer: ${formatHand(dealer, true)}`,
      "",
      "Choose **Hit**, **Stand**, or **Double Down**.",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);

    await interaction.editReply({
      embeds: [embed],
      files,
      components: bjButtons(interaction.user.id, true),
    });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRoulette(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    const color = interaction.options.getString("color", true) as "red" | "black" | "green";
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, `Roulette ${color}`);
    await markGameCooldown(interaction.guildId, interaction.user.id);

    const landing = Math.floor(Math.random() * 37);
    const landed: "red" | "black" | "green" =
      landing === 0 ? "green" : landing % 2 === 0 ? "black" : "red";
    const mult = color === "green" ? 14 : 2;
    const win = color === landed;
    const payout = win ? bet * mult : 0;
    let bal = spent.balance;
    if (payout > 0) bal = await earnCash(interaction.guildId, interaction.user.id, payout, "Roulette win");

    const gif = await renderRouletteGif({ landing, color: landed });
    const { files, imageName } = await attachGif(gif, "roulette.gif");
    const embed = brandEmbed("Roulette Table", [
      `${interaction.user} bet **${fmtCash(bet)}** on **${color}**`,
      formatSpendNote(spent.fromCash, spent.fromBank, bal.symbol),
      `Ball → **${landing}** (${landed})`,
      win ? `🎉 Won **${fmtCash(payout)}**` : `💀 Lost stake`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleHigherLower(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    const key = bjKey(interaction.guildId, interaction.user.id);
    if (higherSessions.has(key)) {
      await interaction.editReply("Finish your Higher/Lower round first.");
      return;
    }
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, "Higher/Lower bet");
    await markGameCooldown(interaction.guildId, interaction.user.id);
    const deck = freshDeck();
    const shown = draw(deck);
    higherSessions.set(key, {
      guildId: interaction.guildId, userId: interaction.user.id, bet, shown, deck,
      fromCash: spent.fromCash, fromBank: spent.fromBank, expires: Date.now() + 90_000,
    });
    const gif = await renderHigherLowerGif({ shown: cardLabel(shown) });
    const { files, imageName } = await attachGif(gif, "hl.gif");
    const embed = brandEmbed("Higher or Lower", [
      `${formatSpendNote(spent.fromCash, spent.fromBank, spent.balance.symbol)}`,
      `Showing **${cardLabel(shown)}** — will the next card be higher or lower?`,
      "_(Aces high · ties lose)_",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`unbgame:hl:higher:${interaction.user.id}`).setLabel("Higher").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`unbgame:hl:lower:${interaction.user.id}`).setLabel("Lower").setStyle(ButtonStyle.Danger),
    );
    await interaction.editReply({ embeds: [embed], files, components: [row] });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRedBlack(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    const pick = interaction.options.getString("color", true) as "red" | "black";
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, `Red/Black ${pick}`);
    await markGameCooldown(interaction.guildId, interaction.user.id);
    const card = draw(freshDeck());
    const landed: "red" | "black" = isRed(card) ? "red" : "black";
    const win = pick === landed;
    let bal = spent.balance;
    if (win) bal = await earnCash(interaction.guildId, interaction.user.id, bet * 2, "Red/Black win");
    const gif = await renderRedBlackGif({ pick, landed, win });
    const { files, imageName } = await attachGif(gif, "redblack.gif");
    const embed = brandEmbed("Red or Black", [
      `${interaction.user} picked **${pick}** · card **${cardLabel(card)}** (${landed})`,
      formatSpendNote(spent.fromCash, spent.fromBank, bal.symbol),
      win ? `🎉 Doubled → **${fmtCash(bet * 2)}**` : `💀 Lost **${fmtCash(bet)}**`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleSlots(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  // Public mega-slots spin — long live animation on the floor.
  await interaction.deferReply();
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, "Slots bet");
    await markGameCooldown(interaction.guildId, interaction.user.id);

    // Weighted RNG — jackpot symbols rarer.
    const weightPick = () => {
      const roll = Math.random();
      if (roll < 0.04) return "7️⃣";
      if (roll < 0.10) return "💎";
      if (roll < 0.18) return "💰";
      if (roll < 0.28) return "⭐";
      if (roll < 0.40) return "🔔";
      if (roll < 0.55) return "🃏";
      if (roll < 0.75) return "🍋";
      return "🍒";
    };
    const reels = [0, 1, 2, 3, 4].map(() => weightPick());

    // Scoring — five of a kind jackpot, four, three, or adjacent pairs.
    let mult = 0;
    let tier: "jackpot" | "line" | "pair" | "lose" = "lose";
    const allSame = reels.every(s => s === reels[0]);
    if (allSame) {
      const s = reels[0]!;
      mult = s === "7️⃣" ? 100 : s === "💎" ? 60 : s === "💰" ? 40 : s === "⭐" ? 25 : 15;
      tier = "jackpot";
    } else {
      // Count longest run of identical symbols
      let best = 1;
      let bestSym = reels[0]!;
      let run = 1;
      for (let i = 1; i < reels.length; i++) {
        if (reels[i] === reels[i - 1]) {
          run++;
          if (run > best) { best = run; bestSym = reels[i]!; }
        } else run = 1;
      }
      if (best >= 4) {
        mult = bestSym === "7️⃣" ? 40 : bestSym === "💎" ? 25 : 12;
        tier = "line";
      } else if (best >= 3) {
        mult = bestSym === "7️⃣" ? 18 : bestSym === "💎" ? 12 : bestSym === "⭐" ? 8 : 5;
        tier = "line";
      } else {
        // Any adjacent pair pays small
        const hasPair = reels.some((s, i) => i > 0 && s === reels[i - 1]);
        if (hasPair) {
          mult = 2;
          tier = "pair";
        }
      }
    }

    const win = mult > 0;
    const payout = win ? bet * mult : 0;
    let bal = spent.balance;
    if (payout > 0) bal = await earnCash(interaction.guildId, interaction.user.id, payout, "Slots win");

    const payoutLabel = win ? `${fmtCash(payout)} ${bal.symbol} (${mult}×)` : undefined;
    const gif = await renderSlotsGif({
      reels, win, mult, symbol: bal.symbol, payoutLabel, tier,
    });
    const { files, imageName } = await attachGif(gif, "slots.gif");
    const embed = brandEmbed(
      tier === "jackpot" ? `🎰 MEGA JACKPOT ${bal.symbol}` : "Mega Slot Machine",
      [
        `${interaction.user}`,
        reels.join(" │ "),
        formatSpendNote(spent.fromCash, spent.fromBank, bal.symbol),
        win
          ? `${tier === "jackpot" ? "🏆" : "🎉"} Pays **${fmtCash(payout)}** ${bal.symbol} (**${mult}×**)`
          : `No line — lost **${fmtCash(bet)}** ${bal.symbol}`,
        `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      ].join("\n"),
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await interaction.editReply({ embeds: [embed], files });
    await postAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleCashWork(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertIncomeCooldown(interaction.guildId, interaction.user.id, "work");
    const payout = 20 + Math.floor(Math.random() * 231);
    const bal = await earnCash(interaction.guildId, interaction.user.id, payout, "Cash work");
    await markIncomeCooldown(interaction.guildId, interaction.user.id, "work");
    const gif = await renderWorkGif({ payout });
    const { files, imageName } = await attachGif(gif, "work.gif");
    const embed = brandEmbed("Work Shift", [
      `${interaction.user} finished a shift · **+${fmtCash(payout)}** ${bal.symbol}`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleCashCrime(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertIncomeCooldown(interaction.guildId, interaction.user.id, "crime");
    const fail = Math.random() < 0.55;
    await markIncomeCooldown(interaction.guildId, interaction.user.id, "crime");
    if (fail) {
      const finePct = 0.2 + Math.random() * 0.2;
      const bal0 = await getCashBalance(interaction.guildId, interaction.user.id);
      const fine = Math.max(10, Math.floor((bal0.cash + bal0.bank) * finePct * 0.05));
      const spent = await spendFunds(interaction.guildId, interaction.user.id, Math.min(fine, bal0.cash + bal0.bank), "Crime fine");
      const embed = brandEmbed("Crime — Caught", [
        `${interaction.user} got pinched.`,
        formatSpendNote(spent.fromCash, spent.fromBank, spent.balance.symbol),
        `Cash **${fmtCash(spent.balance.cash)}** · bank **${fmtCash(spent.balance.bank)}**`,
      ].join("\n"));
      await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed] });
      return;
    }
    const payout = 250 + Math.floor(Math.random() * 451);
    const bal = await earnCash(interaction.guildId, interaction.user.id, payout, "Crime payout");
    const embed = brandEmbed("Crime — Clean Getaway", [
      `${interaction.user} pulled it off · **+${fmtCash(payout)}** ${bal.symbol}`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed] });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRussian(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const target = interaction.options.getUser("target", true);
    const bet = interaction.options.getInteger("bet", true);
    const mode = interaction.options.getString("mode") ?? "ai";
    if (target.bot || target.id === interaction.user.id) {
      await interaction.editReply("Pick another real member.");
      return;
    }
    if (mode === "challenge") {
      const key = `${interaction.guildId}:${interaction.user.id}:${target.id}`;
      russianChallenges.set(key, {
        guildId: interaction.guildId, challengerId: interaction.user.id,
        targetId: target.id, bet, expires: Date.now() + 5 * 60_000,
      });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`unbgame:russian:accept:${interaction.user.id}:${bet}`).setLabel("Accept").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`unbgame:russian:decline:${interaction.user.id}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      );
      const embed = brandEmbed("Russian Roulette — Challenge",
        `${interaction.user} challenges ${target} for **${fmtCash(bet)}** (cash then bank).`);
      await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], components: [row] });
      return;
    }
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, `Russian vs ${target.id}`);
    await markGameCooldown(interaction.guildId, interaction.user.id);
    const chamber = Math.floor(Math.random() * 6);
    const survived = Math.floor(Math.random() * 6) !== chamber;
    let bal = spent.balance;
    if (survived) bal = await earnCash(interaction.guildId, interaction.user.id, bet * 2, "Russian win");
    const gif = await renderRussianGif({ survived, chamber });
    const { files, imageName } = await attachGif(gif, "russian.gif");
    const embed = brandEmbed("Russian Roulette", [
      `${interaction.user} vs ${target} (AI)`,
      formatSpendNote(spent.fromCash, spent.fromBank, bal.symbol),
      survived ? `🟢 Click — net win` : `🔴 Bang — lost stake`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (target.displayAvatarURL()) embed.setThumbnail(target.displayAvatarURL({ size: 128 }));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRob(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertIncomeCooldown(interaction.guildId, interaction.user.id, "rob");
    const target = interaction.options.getUser("target", true);
    if (target.bot || target.id === interaction.user.id) {
      await interaction.editReply("Pick someone else.");
      return;
    }

    // Rob immunity — Discord roles configured in /unbelievaboat → Immunity
    const settings = await getOrCreateUbSettings(interaction.guildId);
    const immuneIds = (settings.robImmuneRoleIds ?? []) as string[];
    if (immuneIds.length && interaction.guild) {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member && immuneIds.some(id => member.roles.cache.has(id))) {
        await interaction.editReply(
          `${target} has a **rob immunity** role and can’t be robbed.`,
        );
        return;
      }
    }

    const their = await getCashBalance(interaction.guildId, target.id);
    if ((their.cash ?? 0) + (their.bank ?? 0) < 50) {
      await interaction.editReply(`${target} is too broke to rob.`);
      return;
    }
    const success = Math.random() < 0.4;
    await markIncomeCooldown(interaction.guildId, interaction.user.id, "rob");
    const { logGameEvent } = await import("../logging/channel-log.js");
    if (success) {
      const amount = 25 + Math.floor(Math.random() * Math.min(500, Math.max(25, Math.floor(their.cash * 0.1))));
      await spendFunds(interaction.guildId, target.id, amount, `Robbed by ${interaction.user.id}`);
      const bal = await earnCash(interaction.guildId, interaction.user.id, amount, `Robbed ${target.id}`);
      const gif = await renderRobGif({ success: true });
      const { files, imageName } = await attachGif(gif, "rob.gif");
      const embed = brandEmbed("Stick-up", [
        `${interaction.user} robbed ${target} for **${fmtCash(amount)}** ${bal.symbol}`,
        `Your cash **${fmtCash(bal.cash)}**`,
      ].join("\n"));
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
      void logGameEvent(interaction.client, interaction.guildId, interaction.user, "Rob success",
        `Stole ${fmtCash(amount)} from ${target.tag}`,
        [{ name: "Target", value: `${target}`, inline: true }]);
    } else {
      const fine = 50 + Math.floor(Math.random() * 150);
      const spent = await spendFunds(interaction.guildId, interaction.user.id, fine, `Failed rob`);
      const gif = await renderRobGif({ success: false });
      const { files, imageName } = await attachGif(gif, "rob.gif");
      const embed = brandEmbed("Stick-up failed", [
        `${interaction.user} got fined trying to rob ${target}.`,
        formatSpendNote(spent.fromCash, spent.fromBank, spent.balance.symbol),
      ].join("\n"));
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
      void logGameEvent(interaction.client, interaction.guildId, interaction.user, "Rob failed",
        `Fined trying to rob ${target.tag}`);
    }
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleSlut(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertIncomeCooldown(interaction.guildId, interaction.user.id, "beg");
    const pity = Math.random() < 0.55;
    const amount = pity ? 15 + Math.floor(Math.random() * 90) : 0;
    let bal = await getCashBalance(interaction.guildId, interaction.user.id);
    if (amount > 0) bal = await earnCash(interaction.guildId, interaction.user.id, amount, "PG cash beg");
    await markIncomeCooldown(interaction.guildId, interaction.user.id, "beg");
    const gif = await renderBegGif();
    const { files, imageName } = await attachGif(gif, "beg.gif");
    const embed = brandEmbed("s░░t · dramatic beg", [
      `${interaction.user} puts on a PG drama show…`,
      amount > 0 ? `Pity payout **+${fmtCash(amount)}** ${bal.symbol}` : `Street is cold — **0**`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      "_Wholesome meme beg only — no NSFW._",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Component router ──────────────────────────────────────────────────────────

export async function handleUnbGameComponent(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }

  // Mini UNO
  if (id.startsWith("unbgame:uno:")) {
    const { handleUnoComponent } = await import("./uno.js");
    await handleUnoComponent(interaction);
    return;
  }

  // Blackjack moves
  if (id.startsWith("unbgame:bj:")) {
    const parts = id.split(":");
    const action = parts[2]!;
    const ownerId = parts[3]!;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "Not your hand.", ...EPHEMERAL });
      return;
    }
    const key = bjKey(interaction.guildId, ownerId);
    const session = bjSessions.get(key);
    if (!session || session.expires < Date.now()) {
      bjSessions.delete(key);
      await interaction.reply({ content: "Hand expired — start `/casino` → Blackjack again.", ...EPHEMERAL });
      return;
    }
    await interaction.deferUpdate();

    if (action === "hit") {
      session.player.push(draw(session.deck));
      const p = handTotal(session.player);
      if (p.total > 21) {
        await finishBlackjack(interaction, session, true);
        return;
      }
      const gif = await renderBlackjackTableGif({ player: session.player, dealer: session.dealer, hideDealer: true });
      const { files, imageName } = await attachGif(gif, "bj-hit.gif");
      const embed = brandEmbed("Blackjack — your move", [
        `You: ${formatHand(session.player)} (**${p.total}**${p.soft ? " soft" : ""})`,
        `Dealer: ${formatHand(session.dealer, true)}`,
      ].join("\n"));
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await interaction.editReply({ embeds: [embed], files, components: bjButtons(ownerId, false) });
      return;
    }

    if (action === "double") {
      try {
        const extra = await spendFunds(session.guildId, session.userId, session.bet, "Blackjack double");
        session.bet *= 2;
        session.fromCash += extra.fromCash;
        session.fromBank += extra.fromBank;
        session.doubled = true;
        session.player.push(draw(session.deck));
        await finishBlackjack(interaction, session, true);
      } catch (err) {
        await interaction.followUp({
          content: err instanceof CashError ? err.message : "Can't double.",
          ...EPHEMERAL,
        });
      }
      return;
    }

    if (action === "stand") {
      await finishBlackjack(interaction, session, true);
      return;
    }
  }

  // Higher / lower
  if (id.startsWith("unbgame:hl:")) {
    const parts = id.split(":");
    const pick = parts[2] as "higher" | "lower";
    const ownerId = parts[3]!;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "Not your round.", ...EPHEMERAL });
      return;
    }
    const key = bjKey(interaction.guildId, ownerId);
    const session = higherSessions.get(key);
    if (!session || session.expires < Date.now()) {
      higherSessions.delete(key);
      await interaction.reply({ content: "Round expired.", ...EPHEMERAL });
      return;
    }
    higherSessions.delete(key);
    await interaction.deferUpdate();
    const next = draw(session.deck);
    const shownV = rankValue(session.shown);
    const nextV = rankValue(next);
    const win = pick === "higher" ? nextV > shownV : nextV < shownV;
    let bal = await getCashBalance(session.guildId, session.userId);
    if (win) bal = await earnCash(session.guildId, session.userId, session.bet * 2, "Higher/Lower win");
    const gif = await renderHigherLowerGif({
      shown: cardLabel(session.shown), next: cardLabel(next), result: win ? "win" : "lose",
    });
    const { files, imageName } = await attachGif(gif, "hl-result.gif");
    const embed = brandEmbed("Higher or Lower", [
      `<@${ownerId}> guessed **${pick}**`,
      `${cardLabel(session.shown)} → ${cardLabel(next)}`,
      win ? `🎉 Won **${fmtCash(session.bet * 2)}**` : `💀 Lost **${fmtCash(session.bet)}**`,
      formatSpendNote(session.fromCash, session.fromBank, bal.symbol),
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await interaction.editReply({ content: "✅ Posting as **UnbelievaBoat**…", embeds: [], components: [], files: [] });
    await replyThenPostAsUnbelievaBoat(interaction as unknown as ChatInputCommandInteraction, { embeds: [embed], files });
    return;
  }

  if (id.startsWith("unbgame:russian:decline:")) {
    const challengerId = id.slice("unbgame:russian:decline:".length);
    for (const [k, v] of russianChallenges) {
      if (v.targetId === interaction.user.id && v.challengerId === challengerId) {
        russianChallenges.delete(k);
        await interaction.reply({ content: "Challenge declined.", ...EPHEMERAL });
        return;
      }
    }
    await interaction.reply({ content: "No open challenge.", ...EPHEMERAL });
    return;
  }

  if (id.startsWith("unbgame:russian:accept:")) {
    const parts = id.split(":");
    const challengerId = parts[3]!;
    const bet = Number(parts[4] ?? 0);
    const key = `${interaction.guildId}:${challengerId}:${interaction.user.id}`;
    const ch = russianChallenges.get(key);
    if (!ch || ch.expires < Date.now()) {
      russianChallenges.delete(key);
      await interaction.reply({ content: "Challenge expired.", ...EPHEMERAL });
      return;
    }
    if (interaction.user.id !== ch.targetId) {
      await interaction.reply({ content: "Only the challenged member can accept.", ...EPHEMERAL });
      return;
    }
    russianChallenges.delete(key);
    await interaction.deferReply({ ephemeral: true });
    try {
      const challenger = await interaction.client.users.fetch(challengerId);
      await spendFunds(interaction.guildId, challengerId, bet, "Russian challenge stake");
      await spendFunds(interaction.guildId, interaction.user.id, bet, "Russian challenge stake");
      const chamber = Math.floor(Math.random() * 6);
      const survivorIsChallenger = Math.random() < 0.5;
      const winner = survivorIsChallenger ? challenger : interaction.user;
      const pot = bet * 2;
      const bal = await earnCash(interaction.guildId, winner.id, pot, "Russian challenge pot");
      await writeUbAudit(interaction.guildId, challengerId, "russian_challenge", { bet, winner: winner.id }, interaction.user.id);
      const gif = await renderRussianGif({ survived: true, chamber });
      const { files, imageName } = await attachGif(gif, "russian.gif");
      const embed = brandEmbed("Russian Roulette — Live", [
        `${challenger} vs ${interaction.user} · pot **${fmtCash(pot)}**`,
        `🏆 ${winner} takes the pot.`,
        `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      ].join("\n"));
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await replyThenPostAsUnbelievaBoat(interaction as unknown as ChatInputCommandInteraction, { embeds: [embed], files });
    } catch (err) {
      await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Expose defaults for the admin cooldown panel. */
export { DEFAULT_COOLDOWNS, getGuildCooldowns, cdText } from "./cooldowns.js";
export { readCooldowns } from "./cooldowns.js";
