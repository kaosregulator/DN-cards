// UnbelievaBoat mini-games slash commands — cash games posted as UnbelievaBoat.

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
import { getOrCreateUbSettings, getOrCreateGameState, touchGameState, writeUbAudit } from "../../lib/unbelievaboat/db.js";
import { UNBELIEVABOAT_AUTHOR, UNBELIEVABOAT_COLOR } from "./branding.js";
import { CashError, earnCash, spendCash, getCashBalance, fmtCash } from "./cash.js";
import { replyThenPostAsUnbelievaBoat } from "./webhook.js";
import {
  renderBegGif,
  renderBlackjackGif,
  renderCoinSpinGif,
  renderRobGif,
  renderRouletteGif,
  renderRussianGif,
} from "./render-games.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const DAILY_CD_MS = 20 * 60 * 60 * 1000;
const ROB_CD_MS = 10 * 60 * 1000;
const BEG_CD_MS = 15 * 60 * 1000;
const GAME_CD_MS = 8 * 1000;

/** Pending Russian Roulette challenges: key = `${guild}:${challenger}:${target}` */
const russianChallenges = new Map<string, {
  guildId: string;
  challengerId: string;
  targetId: string;
  bet: number;
  expires: number;
}>();

function cdLeft(at: Date | null | undefined, ms: number): number {
  if (!at) return 0;
  return Math.max(0, at.getTime() + ms - Date.now());
}

function cdText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return `${m}m`;
}

async function assertGamesOn(guildId: string) {
  const s = await getOrCreateUbSettings(guildId);
  if (!s.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
}

function brandEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(UNBELIEVABOAT_COLOR)
    .setAuthor(UNBELIEVABOAT_AUTHOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Powered by the UnbelievaBoat API you authorized" });
}

async function attachGif(result: Awaited<ReturnType<typeof renderCoinSpinGif>>, name: string) {
  if (!result) return { files: [] as AttachmentBuilder[], imageName: null as string | null };
  const file = new AttachmentBuilder(result.buffer, { name });
  return { files: [file], imageName: name };
}

// ── Command builders ──────────────────────────────────────────────────────────

export function buildCashCheckCommandJson() {
  return new SlashCommandBuilder()
    .setName("cashcheck")
    .setDescription("Cash Check-In — claim UnbelievaBoat cash here too (on top of their rewards)")
    .setDMPermission(false)
    .toJSON();
}

export function buildCashGamesCommandJson() {
  return new SlashCommandBuilder()
    .setName("cashgames")
    .setDescription("UnbelievaBoat mini-games hub — roulette, blackjack, rob, and more")
    .setDMPermission(false)
    .toJSON();
}

export function buildRouletteCommandJson() {
  return new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("UnbelievaBoat roulette — bet cash on red, black, or green")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Cash to wager").setRequired(true).setMinValue(10).setMaxValue(100_000))
    .addStringOption(o => o.setName("color").setDescription("Pick a color").setRequired(true)
      .addChoices(
        { name: "Red (2×)", value: "red" },
        { name: "Black (2×)", value: "black" },
        { name: "Green (14×)", value: "green" },
      ))
    .toJSON();
}

export function buildBlackjackCommandJson() {
  return new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("UnbelievaBoat blackjack — beat the dealer for cash")
    .setDMPermission(false)
    .addIntegerOption(o => o.setName("bet").setDescription("Cash to wager").setRequired(true).setMinValue(10).setMaxValue(100_000))
    .toJSON();
}

export function buildRussianCommandJson() {
  return new SlashCommandBuilder()
    .setName("russian")
    .setDescription("UnbelievaBoat Russian roulette — AI duel with their avatar or challenge them")
    .setDMPermission(false)
    .addUserOption(o => o.setName("target").setDescription("Who to aim at").setRequired(true))
    .addIntegerOption(o => o.setName("bet").setDescription("Cash stake").setRequired(true).setMinValue(10).setMaxValue(50_000))
    .addStringOption(o => o.setName("mode").setDescription("AI simulation or live challenge")
      .addChoices(
        { name: "AI vs their avatar", value: "ai" },
        { name: "Challenge them live", value: "challenge" },
      ))
    .toJSON();
}

export function buildRobCommandJson() {
  return new SlashCommandBuilder()
    .setName("rob")
    .setDescription("Attempt a stick-figure stickup for UnbelievaBoat cash")
    .setDMPermission(false)
    .addUserOption(o => o.setName("target").setDescription("Who to rob").setRequired(true))
    .toJSON();
}

export function buildSlutCommandJson() {
  // Command name kept as requested; embeds blur it and keep content PG.
  return new SlashCommandBuilder()
    .setName("slut")
    .setDescription("Dramatic PG cash beg (name blurred in embeds) — UnbelievaBoat currency")
    .setDMPermission(false)
    .toJSON();
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handleCashCheck(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const settings = await getOrCreateUbSettings(interaction.guildId);
    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const left = cdLeft(state.lastDailyAt, DAILY_CD_MS);
    if (left > 0) {
      await interaction.editReply(`Cash Check-In cools down in **${cdText(left)}**. Come back later.`);
      return;
    }
    const now = Date.now();
    const prev = state.lastDailyAt?.getTime() ?? 0;
    const streak = prev && now - prev < DAILY_CD_MS * 2 ? (state.dailyStreak || 0) + 1 : 1;
    const lo = Math.min(settings.dailyMin, settings.dailyMax);
    const hi = Math.max(settings.dailyMin, settings.dailyMax);
    const amount = lo + Math.floor(Math.random() * (hi - lo + 1));
    const bal = await earnCash(interaction.guildId, interaction.user.id, amount, "Cash Check-In");
    await touchGameState(interaction.guildId, interaction.user.id, {
      lastDailyAt: new Date(),
      dailyStreak: streak,
    });
    const gif = await renderCoinSpinGif({ amount, symbol: bal.symbol, streak });
    const { files, imageName } = await attachGif(gif, "cashcheck.gif");
    const embed = brandEmbed(
      "Cash Check-In",
      [
        `${interaction.user} claimed **${fmtCash(amount)}** ${bal.symbol}`,
        `Streak **${streak}** · wallet now **${fmtCash(bal.cash)}** ${bal.symbol}`,
        "",
        "_This is our addon check-in — it stacks with UnbelievaBoat’s own role/income rewards._",
      ].join("\n"),
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files }, "✅ Cash Check-In posted as **UnbelievaBoat**.");
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
    const embed = brandEmbed(
      "Mini-Games",
      [
        `Your cash: **${fmtCash(bal.cash)}** ${bal.symbol} · bank **${fmtCash(bal.bank)}**`,
        "",
        "`/cashcheck` — Cash Check-In (daily spin)",
        "`/roulette` · `/blackjack` · `/russian` · `/rob`",
        "`/slut` — PG dramatic beg (name blurred)",
        "`/cashstore` — role perk storefront",
        "",
        "Wins & losses settle on the **UnbelievaBoat** leaderboard via the API.",
      ].join("\n"),
    );
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRoulette(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const bet = interaction.options.getInteger("bet", true);
    const color = interaction.options.getString("color", true) as "red" | "black" | "green";
    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const left = cdLeft(state.lastRouletteAt, GAME_CD_MS);
    if (left > 0) { await interaction.editReply(`Roulette cools down **${cdText(left)}**.`); return; }

    await spendCash(interaction.guildId, interaction.user.id, bet, `Roulette bet ${color}`);
    const landing = Math.floor(Math.random() * 37); // 0..36
    const landed: "red" | "black" | "green" =
      landing === 0 ? "green" : landing % 2 === 0 ? "black" : "red";
    const mult = color === "green" ? 14 : 2;
    const win = color === landed;
    const payout = win ? bet * mult : 0;
    let bal = await getCashBalance(interaction.guildId, interaction.user.id);
    if (payout > 0) bal = await earnCash(interaction.guildId, interaction.user.id, payout, `Roulette win ${landed}`);
    await touchGameState(interaction.guildId, interaction.user.id, { lastRouletteAt: new Date() });

    const gif = await renderRouletteGif({ landing, color: landed });
    const { files, imageName } = await attachGif(gif, "roulette.gif");
    const embed = brandEmbed(
      "Roulette",
      [
        `${interaction.user} bet **${fmtCash(bet)}** on **${color}**`,
        `Ball landed **${landing}** (${landed})`,
        win
          ? `🎉 Won **${fmtCash(payout)}** ${bal.symbol} · cash **${fmtCash(bal.cash)}**`
          : `💀 Lost **${fmtCash(bet)}** ${bal.symbol} · cash **${fmtCash(bal.cash)}**`,
      ].join("\n"),
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

function drawHand(): number {
  // Simplified blackjack total 12–21 weighted
  const r = Math.random();
  if (r < 0.08) return 21;
  if (r < 0.2) return 20;
  return 12 + Math.floor(Math.random() * 8);
}

export async function handleBlackjack(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const bet = interaction.options.getInteger("bet", true);
    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const left = cdLeft(state.lastBlackjackAt, GAME_CD_MS);
    if (left > 0) { await interaction.editReply(`Blackjack cools down **${cdText(left)}**.`); return; }

    await spendCash(interaction.guildId, interaction.user.id, bet, "Blackjack bet");
    const player = drawHand();
    let dealer = drawHand();
    if (dealer < 17) dealer = Math.min(21, dealer + 1 + Math.floor(Math.random() * 4));
    let outcome: "win" | "lose" | "push" = "lose";
    if (player > 21) outcome = "lose";
    else if (dealer > 21 || player > dealer) outcome = "win";
    else if (player === dealer) outcome = "push";

    let bal = await getCashBalance(interaction.guildId, interaction.user.id);
    if (outcome === "win") bal = await earnCash(interaction.guildId, interaction.user.id, bet * 2, "Blackjack win");
    else if (outcome === "push") bal = await earnCash(interaction.guildId, interaction.user.id, bet, "Blackjack push");
    await touchGameState(interaction.guildId, interaction.user.id, { lastBlackjackAt: new Date() });

    const gif = await renderBlackjackGif({ playerTotal: player, dealerTotal: dealer, outcome });
    const { files, imageName } = await attachGif(gif, "blackjack.gif");
    const embed = brandEmbed(
      "Blackjack",
      [
        `${interaction.user} · bet **${fmtCash(bet)}** ${bal.symbol}`,
        `You **${player}** vs dealer **${dealer}** → **${outcome.toUpperCase()}**`,
        `Cash now **${fmtCash(bal.cash)}** ${bal.symbol}`,
      ].join("\n"),
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function runRussianRound(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  guildId: string,
  actor: User,
  target: User,
  bet: number,
  label: string,
) {
  await spendCash(guildId, actor.id, bet, `Russian roulette vs ${target.id}`);
  // Target also risked in challenge mode — AI mode only actor pays.
  const chamber = Math.floor(Math.random() * 6);
  const click = Math.floor(Math.random() * 6);
  const actorSurvived = click !== chamber;
  // 50/50 narrative for who "holds" the gun last — AI uses target avatar flavor.
  const survivor = actorSurvived ? actor : target;
  const loser = actorSurvived ? target : actor;

  let bal = await getCashBalance(guildId, actor.id);
  if (actorSurvived) {
    bal = await earnCash(guildId, actor.id, bet * 2, "Russian roulette win");
  }
  await touchGameState(guildId, actor.id, { lastRussianAt: new Date() });

  const gif = await renderRussianGif({ survived: actorSurvived, chamber });
  const { files, imageName } = await attachGif(gif, "russian.gif");
  const embed = brandEmbed(
    "Russian Roulette",
    [
      `${label}`,
      `${actor} vs ${target}`,
      actorSurvived
        ? `🟢 Click — ${survivor} keeps cool. **+${fmtCash(bet)}** net for ${actor}`
        : `🔴 Bang (sim) — ${loser} flinches. ${actor} loses the stake.`,
      `Cash **${fmtCash(bal.cash)}** ${bal.symbol}`,
    ].join("\n"),
  );
  if (target.displayAvatarURL()) embed.setThumbnail(target.displayAvatarURL({ size: 128 }));
  if (imageName) embed.setImage(`attachment://${imageName}`);
  await replyThenPostAsUnbelievaBoat(interaction as ChatInputCommandInteraction, { embeds: [embed], files });
}

export async function handleRussian(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const target = interaction.options.getUser("target", true);
    const bet = interaction.options.getInteger("bet", true);
    const mode = interaction.options.getString("mode") ?? "ai";
    if (target.bot) { await interaction.editReply("Pick a real member, not a bot."); return; }
    if (target.id === interaction.user.id) { await interaction.editReply("You can't spin on yourself."); return; }

    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const left = cdLeft(state.lastRussianAt, GAME_CD_MS);
    if (left > 0) { await interaction.editReply(`Russian roulette cools down **${cdText(left)}**.`); return; }

    if (mode === "challenge") {
      const key = `${interaction.guildId}:${interaction.user.id}:${target.id}`;
      russianChallenges.set(key, {
        guildId: interaction.guildId,
        challengerId: interaction.user.id,
        targetId: target.id,
        bet,
        expires: Date.now() + 5 * 60_000,
      });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`unbgame:russian:accept:${interaction.user.id}:${bet}`).setLabel("Accept").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`unbgame:russian:decline:${interaction.user.id}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      );
      const embed = brandEmbed(
        "Russian Roulette — Challenge",
        `${interaction.user} challenges ${target} for **${fmtCash(bet)}** cash.\n${target} — accept within 5 minutes.`,
      );
      await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], components: [row] }, "✅ Challenge posted as **UnbelievaBoat**.");
      return;
    }

    await runRussianRound(interaction, interaction.guildId, interaction.user, target, bet, "AI duel (avatar flavor)");
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRob(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const target = interaction.options.getUser("target", true);
    if (target.bot || target.id === interaction.user.id) {
      await interaction.editReply("Pick someone else (not yourself / not a bot).");
      return;
    }
    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const left = cdLeft(state.lastRobAt, ROB_CD_MS);
    if (left > 0) { await interaction.editReply(`Rob cools down **${cdText(left)}**.`); return; }

    const their = await getCashBalance(interaction.guildId, target.id);
    const takeMax = Math.min(500, Math.max(25, Math.floor((their.cash ?? 0) * 0.08)));
    if ((their.cash ?? 0) < 50) {
      await interaction.editReply(`${target} is too broke to rob (need ≥50 cash on them).`);
      return;
    }
    const success = Math.random() < 0.42;
    let embed: EmbedBuilder;
    let files: AttachmentBuilder[] = [];
    if (success) {
      const amount = 25 + Math.floor(Math.random() * takeMax);
      await spendCash(interaction.guildId, target.id, amount, `Robbed by ${interaction.user.id}`);
      const bal = await earnCash(interaction.guildId, interaction.user.id, amount, `Robbed ${target.id}`);
      const gif = await renderRobGif({ success: true });
      const att = await attachGif(gif, "rob.gif");
      files = att.files;
      embed = brandEmbed(
        "Stick-up",
        `${interaction.user} robbed ${target} for **${fmtCash(amount)}** ${bal.symbol}!\nYour cash **${fmtCash(bal.cash)}**`,
      );
      if (att.imageName) embed.setImage(`attachment://${att.imageName}`);
    } else {
      const fine = 40 + Math.floor(Math.random() * 120);
      const bal = await spendCash(interaction.guildId, interaction.user.id, fine, `Failed rob of ${target.id}`);
      const gif = await renderRobGif({ success: false });
      const att = await attachGif(gif, "rob.gif");
      files = att.files;
      embed = brandEmbed(
        "Stick-up failed",
        `${interaction.user} tried to rob ${target} and got fined **${fmtCash(fine)}** ${bal.symbol}.\nCash **${fmtCash(bal.cash)}**`,
      );
      if (att.imageName) embed.setImage(`attachment://${att.imageName}`);
    }
    await touchGameState(interaction.guildId, interaction.user.id, { lastRobAt: new Date() });
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleSlut(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const state = await getOrCreateGameState(interaction.guildId, interaction.user.id);
    const left = cdLeft(state.lastBegAt, BEG_CD_MS);
    if (left > 0) { await interaction.editReply(`That cools down **${cdText(left)}**.`); return; }

    // Blur the command name in public copy; keep the ask PG.
    const blurred = "s░░t";
    const pity = Math.random() < 0.55;
    const amount = pity ? 15 + Math.floor(Math.random() * 90) : 0;
    let bal = await getCashBalance(interaction.guildId, interaction.user.id);
    if (amount > 0) bal = await earnCash(interaction.guildId, interaction.user.id, amount, "PG cash beg");
    await touchGameState(interaction.guildId, interaction.user.id, { lastBegAt: new Date() });

    const gif = await renderBegGif();
    const { files, imageName } = await attachGif(gif, "beg.gif");
    const embed = brandEmbed(
      `${blurred} · dramatic beg`,
      [
        `${interaction.user} puts on a PG drama show for spare cash…`,
        amount > 0
          ? `Someone took pity — **+${fmtCash(amount)}** ${bal.symbol}`
          : `The street is cold tonight — **0** this time.`,
        `Cash **${fmtCash(bal.cash)}** ${bal.symbol}`,
        "",
        "_Wholesome meme beg only — no NSFW._",
      ].join("\n"),
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleUnbGameComponent(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }

  if (id.startsWith("unbgame:russian:decline:")) {
    const challengerId = id.slice("unbgame:russian:decline:".length);
    if (interaction.user.id !== interaction.message.mentions.users.first()?.id &&
        interaction.user.id !== challengerId &&
        !interaction.message.content.includes(interaction.user.id)) {
      // Allow target: we stored target in challenge map
    }
    // Find challenge where this user is target
    let foundKey: string | null = null;
    for (const [k, v] of russianChallenges) {
      if (v.targetId === interaction.user.id && v.challengerId === challengerId) {
        foundKey = k;
        break;
      }
    }
    if (!foundKey) {
      await interaction.reply({ content: "No open challenge for you.", ...EPHEMERAL });
      return;
    }
    russianChallenges.delete(foundKey);
    await interaction.reply({ content: "Challenge declined.", ...EPHEMERAL });
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
      // Both pay stake; winner takes pot
      await spendCash(interaction.guildId, challengerId, bet, "Russian challenge stake");
      await spendCash(interaction.guildId, interaction.user.id, bet, "Russian challenge stake");
      const chamber = Math.floor(Math.random() * 6);
      const survivorIsChallenger = Math.random() < 0.5;
      const winner = survivorIsChallenger ? challenger : interaction.user;
      const pot = bet * 2;
      const bal = await earnCash(interaction.guildId, winner.id, pot, "Russian challenge pot");
      await writeUbAudit(interaction.guildId, challengerId, "russian_challenge", { bet, winner: winner.id }, interaction.user.id);
      const gif = await renderRussianGif({ survived: true, chamber });
      const { files, imageName } = await attachGif(gif, "russian.gif");
      const embed = brandEmbed(
        "Russian Roulette — Live",
        [
          `${challenger} vs ${interaction.user} · pot **${fmtCash(pot)}**`,
          `🏆 ${winner} walks away with the pot.`,
          `Their cash **${fmtCash(bal.cash)}** ${bal.symbol}`,
        ].join("\n"),
      );
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await replyThenPostAsUnbelievaBoat(interaction as unknown as ChatInputCommandInteraction, { embeds: [embed], files });
    } catch (err) {
      await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
