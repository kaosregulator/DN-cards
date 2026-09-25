// Mini Vegas slots — simple credit machine.
// 1) Buy credits with UB (what you type = credits on the machine)
// 2) Pick BET (how much to risk per spin)
// 3) SPIN until empty — wins stay on the machine as credits
// 4) Cash out moves leftover credits back to UB cash
// 5) + Add more buys more credits anytime

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { UNBELIEVABOAT_AUTHOR, UNBELIEVABOAT_COLOR } from "./branding.js";
import {
  CashError, earnCash, spendFunds, getCashBalance, fmtCash, formatSpendNote,
} from "./cash.js";
import { assertGameCooldown, markGameCooldown } from "./cooldowns.js";
import { getOrCreateUbSettings } from "../../lib/unbelievaboat/db.js";
import { openTableAsUnbelievaBoat } from "./webhook.js";
import {
  renderLiveSlotsMachine,
  rollSlotsReels,
  scoreSlotsReels,
} from "./render-live-slots.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const MIN_BUY = 10;
const MAX_BUY = 100_000;
const MIN_BET = 10;

export const RESPONSIBLE_PLAY =
  "Fun with UnbelievaBoat server cash only — not real-money gambling. Winners do not receive real currency.";

type SlotsSession = {
  guildId: string;
  userId: string;
  /** Credits on the machine (1 credit = 1 UB unit). Wins add here; cash-out pays this back. */
  credits: number;
  /** Stake per spin (taken from credits). */
  bet: number;
  spins: number;
  /** Session P/L in UB units (buy-ins negative, cash-out tracked separately). */
  net: number;
  expires: number;
  symbol: string;
  cash: number;
  bank: number;
};

const sessions = new Map<string, SlotsSession>();
function key(g: string, u: string) { return `${g}:${u}`; }

function brandEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(UNBELIEVABOAT_COLOR)
    .setAuthor(UNBELIEVABOAT_AUTHOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: RESPONSIBLE_PLAY });
}

async function attachGif(result: { buffer: Buffer } | null, name: string) {
  if (!result) return { files: [] as AttachmentBuilder[], imageName: null as string | null };
  return { files: [new AttachmentBuilder(result.buffer, { name })], imageName: name };
}

async function assertGamesOn(guildId: string) {
  const s = await getOrCreateUbSettings(guildId);
  if (!s.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
}

/** Up to 5 simple stake choices from what's on the machine. */
export function betPresets(credits: number): number[] {
  if (credits < MIN_BET) return [MIN_BET];
  const raw = [
    MIN_BET,
    Math.min(credits, 50),
    Math.min(credits, 100),
    Math.min(credits, 500),
    Math.min(credits, 1_000),
    Math.min(credits, Math.max(MIN_BET, Math.floor(credits * 0.1))),
    credits, // MAX
  ];
  const uniq = [...new Set(raw.map((n) => Math.max(MIN_BET, Math.floor(n))))]
    .filter((n) => n <= credits)
    .sort((a, b) => a - b);
  if (uniq.length <= 5) return uniq;
  // Keep min, a couple mids, near-max, and MAX
  return [uniq[0]!, uniq[1]!, uniq[Math.floor(uniq.length / 2)]!, uniq[uniq.length - 2]!, uniq[uniq.length - 1]!];
}

function defaultBet(credits: number): number {
  const presets = betPresets(credits);
  // Prefer ~10% of buy-in, else lowest preset
  const prefer = Math.min(credits, Math.max(MIN_BET, Math.floor(credits * 0.1)));
  return presets.find((p) => p >= prefer) ?? presets[0] ?? MIN_BET;
}

function clampBet(session: SlotsSession) {
  if (session.credits < MIN_BET) {
    session.bet = MIN_BET;
    return;
  }
  const presets = betPresets(session.credits);
  if (!presets.includes(session.bet)) {
    session.bet = presets.find((p) => p <= session.credits) ?? presets[0]!;
  }
  session.bet = Math.min(session.bet, session.credits);
}

function sessionStatus(session: SlotsSession): string {
  return [
    `**CREDITS** ${fmtCash(session.credits)} ${session.symbol}  ·  **BET** ${fmtCash(session.bet)} ${session.symbol}/spin`,
    `_Credits stay on the machine. Wins add credits. **Cash out** sends them to your UB wallet._`,
    `Wallet: cash **${fmtCash(session.cash)}** · bank **${fmtCash(session.bank)}** ${session.symbol}`,
    `Spins **${session.spins}** · session net **${session.net >= 0 ? "+" : ""}${fmtCash(session.net)}**`,
  ].join("\n");
}

function machineButtons(session: SlotsSession, opts: { busy?: boolean } = {}) {
  const uid = session.userId;
  const canSpin = !opts.busy && session.credits >= session.bet && session.bet >= MIN_BET;

  if (opts.busy) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`unbgame:slots:busy:${uid}`)
          .setLabel("Working…")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      ),
    ];
  }

  const presets = betPresets(session.credits);
  const betRow = new ActionRowBuilder<ButtonBuilder>();
  for (const amount of presets) {
    const selected = session.bet === amount;
    const isMax = amount === session.credits && session.credits > MIN_BET;
    betRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`unbgame:slots:bet:${amount}:${uid}`)
        .setLabel(selected ? `● ${isMax ? "MAX" : fmtCash(amount)}` : (isMax ? "MAX" : fmtCash(amount)))
        .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(session.credits < MIN_BET),
    );
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`unbgame:slots:spin:${uid}`)
      .setLabel(canSpin ? "SPIN" : (session.credits < MIN_BET ? "Empty — add credits" : "SPIN"))
      .setEmoji("🕹️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canSpin),
    new ButtonBuilder()
      .setCustomId(`unbgame:slots:add:${uid}`)
      .setLabel("+ Add credits")
      .setEmoji("🪙")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`unbgame:slots:leave:${uid}`)
      .setLabel("Cash out")
      .setStyle(ButtonStyle.Secondary),
  );

  return [betRow, actionRow];
}

async function refreshWallet(session: SlotsSession) {
  const bal = await getCashBalance(session.guildId, session.userId);
  session.cash = bal.cash ?? 0;
  session.bank = bal.bank ?? 0;
  session.symbol = bal.symbol;
  return bal;
}

async function renderMachine(
  session: SlotsSession,
  mode: "idle" | "insert" | "spin" | "win" | "lose",
  extra: {
    reels?: string[];
    tier?: "jackpot" | "line" | "pair" | "lose";
    payoutLabel?: string;
    insertCount?: number;
  } = {},
) {
  return renderLiveSlotsMachine({
    mode,
    reels: extra.reels ?? ["🍒", "🍋", "🔔"],
    symbol: session.symbol,
    credits: session.credits,
    betAmount: session.bet,
    insertCount: extra.insertCount,
    tier: extra.tier,
    payoutLabel: extra.payoutLabel,
  });
}

/** Open machine: buy-in amount becomes credits 1:1. */
export async function handleSlots(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const buyIn = interaction.options.getInteger("bet", true);
    if (buyIn < MIN_BUY || buyIn > MAX_BUY) {
      await interaction.editReply(`Buy credits between **${fmtCash(MIN_BUY)}** and **${fmtCash(MAX_BUY)}**.`);
      return;
    }

    const bal = await getCashBalance(interaction.guildId, interaction.user.id);
    const total = (bal.cash ?? 0) + (bal.bank ?? 0);
    if (total < buyIn) {
      await interaction.editReply(
        `Need **${fmtCash(buyIn)}** ${bal.symbol} (cash+bank) to load the machine. You have **${fmtCash(total)}**.`,
      );
      return;
    }

    await markGameCooldown(interaction.guildId, interaction.user.id);
    const spent = await spendFunds(interaction.guildId, interaction.user.id, buyIn, "Slots buy credits");

    const session: SlotsSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      credits: buyIn,
      bet: defaultBet(buyIn),
      spins: 0,
      net: -buyIn,
      expires: Date.now() + 30 * 60_000,
      symbol: spent.balance.symbol,
      cash: spent.balance.cash ?? 0,
      bank: spent.balance.bank ?? 0,
    };
    sessions.set(key(interaction.guildId, interaction.user.id), session);

    const gif = await renderMachine(session, "insert", { insertCount: 3 });
    const { files, imageName } = await attachGif(gif, "slots-idle.gif");
    const embed = brandEmbed("🎰 Vegas Slots", [
      `${interaction.user} loaded **${fmtCash(buyIn)}** ${session.symbol} onto the machine.`,
      formatSpendNote(spent.fromCash, spent.fromBank, session.symbol),
      "",
      sessionStatus(session),
      "",
      `Jackpot: **${session.symbol}${session.symbol}${session.symbol}** pays big — wins stay as credits until you **Cash out**.`,
      "Pick a **BET** → hit **SPIN** → play until empty or cash out.",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);

    await openTableAsUnbelievaBoat(interaction, {
      embeds: [embed],
      files,
      components: machineButtons(session),
    }, "✅ Slots opened as **UnbelievaBoat** — play on the floor.");
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function runAddCredits(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: SlotsSession,
  amount: number,
) {
  await interaction.editReply({ components: machineButtons(session, { busy: true }) }).catch(() => {});

  const spent = await spendFunds(session.guildId, session.userId, amount, "Slots add credits");
  session.cash = spent.balance.cash ?? 0;
  session.bank = spent.balance.bank ?? 0;
  session.symbol = spent.balance.symbol;
  session.credits += amount;
  session.net -= amount;
  clampBet(session);
  session.expires = Date.now() + 30 * 60_000;

  const gif = await renderMachine(session, "insert", { insertCount: Math.min(5, Math.ceil(amount / 100)) });
  const { files, imageName } = await attachGif(gif, "slots-add.gif");
  const embed = brandEmbed("🎰 Vegas Slots", [
    `${interaction.user} added **${fmtCash(amount)}** ${session.symbol} credits.`,
    formatSpendNote(spent.fromCash, spent.fromBank, session.symbol),
    sessionStatus(session),
    "",
    "Pick a **BET** and hit **SPIN**.",
  ].join("\n"));
  if (imageName) embed.setImage(`attachment://${imageName}`);
  await interaction.editReply({ embeds: [embed], files, components: machineButtons(session) });
}

async function runSpin(interaction: ButtonInteraction, session: SlotsSession) {
  clampBet(session);
  if (session.credits < session.bet || session.bet < MIN_BET) {
    throw new CashError(
      session.credits < MIN_BET
        ? `Machine is empty. Hit **+ Add credits** or **Cash out**.`
        : `Not enough credits for this bet. Have **${fmtCash(session.credits)}**, bet **${fmtCash(session.bet)}**.`,
    );
  }

  await interaction.editReply({ components: machineButtons(session, { busy: true }) }).catch(() => {});

  const stake = session.bet;
  session.credits -= stake;
  session.spins += 1;
  session.expires = Date.now() + 30 * 60_000;

  const reels = rollSlotsReels(session.symbol);
  const scored = scoreSlotsReels(reels, session.symbol);
  const win = scored.mult > 0;
  const payout = win ? stake * scored.mult : 0;

  // Wins stay ON the machine as credits (true Vegas meter) — cash out later.
  if (payout > 0) {
    session.credits += payout;
    session.net += payout;
  }
  clampBet(session);
  await refreshWallet(session);

  const payoutLabel = win ? `+${fmtCash(payout)} credits (${scored.mult}×)` : undefined;
  const spinGif = await renderMachine(session, "spin", {
    reels,
    tier: scored.tier,
    payoutLabel,
  });
  const { files, imageName } = await attachGif(spinGif, win ? "slots-win.gif" : "slots-spin.gif");

  const canSpin = session.credits >= session.bet && session.bet >= MIN_BET;
  const canBuy = (session.cash + session.bank) >= MIN_BUY;
  const embed = brandEmbed(
    scored.tier === "jackpot" ? `🎰 JACKPOT ${session.symbol}` : "🎰 Vegas Slots",
    [
      `${interaction.user} bet **${fmtCash(stake)}**`,
      reels.join("  │  "),
      win
        ? `${scored.tier === "jackpot" ? "🏆" : "🎉"} **+${fmtCash(payout)}** credits back on the machine (**${scored.mult}×**)`
        : `No line — lost **${fmtCash(stake)}** credits.`,
      sessionStatus(session),
      canSpin
        ? "Hit **SPIN** again anytime."
        : canBuy
          ? `_Out of credits — **+ Add credits** to keep playing, or **Cash out**._`
          : `_Broke — cash+bank can't reload. **Cash out** (nothing left) or earn more UB._`,
    ].join("\n"),
  );
  if (imageName) embed.setImage(`attachment://${imageName}`);

  await interaction.editReply({
    embeds: [embed],
    files,
    components: machineButtons(session),
  });
}

export async function handleSlotsComponent(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith("unbgame:slots:") || !interaction.guildId) return false;

  const parts = id.split(":");
  const action = parts[2]!;

  // bet:amount:uid | spin:uid | add:uid | leave:uid | busy:uid
  const ownerId = action === "bet" ? parts[4]! : parts[3]!;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your machine — open `/casino` → Slots.", ...EPHEMERAL });
    return true;
  }

  const k = key(interaction.guildId, ownerId);
  const session = sessions.get(k);

  if (action === "leave") {
    const leftover = session?.credits ?? 0;
    sessions.delete(k);
    let note = "";
    if (leftover > 0 && session) {
      try {
        const bal = await earnCash(session.guildId, session.userId, leftover, "Slots cash-out");
        note = ` Cashed out **${fmtCash(leftover)}** ${bal.symbol} → your cash.`;
      } catch {
        note = ` Couldn't cash out **${fmtCash(leftover)}** — ask an admin.`;
      }
    } else {
      note = " Machine was empty.";
    }
    await interaction.update({
      content: `👋 Left the slots.${note}`,
      embeds: [],
      components: [],
      files: [],
    }).catch(async () => {
      await interaction.reply({ content: `Left the slots.${note}`, ...EPHEMERAL });
    });
    return true;
  }

  if (action === "add") {
    const modal = new ModalBuilder()
      .setCustomId(`unbgame:slots:modal:add:${ownerId}`)
      .setTitle("Add credits")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("bet")
            .setLabel(`How much to add (${MIN_BUY}–${MAX_BUY})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(12)
            .setPlaceholder("e.g. 500"),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === "busy") {
    await interaction.deferUpdate();
    return true;
  }

  if (!session || session.expires < Date.now()) {
    sessions.delete(k);
    await interaction.reply({ content: "Session expired — open `/casino` → Slots again.", ...EPHEMERAL });
    return true;
  }

  if (action === "bet") {
    const amount = Number.parseInt(parts[3]!, 10);
    if (!Number.isFinite(amount) || amount < MIN_BET) {
      await interaction.reply({ content: "Invalid bet.", ...EPHEMERAL });
      return true;
    }
    await interaction.deferUpdate();
    if (amount > session.credits) {
      await interaction.followUp({
        content: `Bet **${fmtCash(amount)}** is more than your **${fmtCash(session.credits)}** credits.`,
        ...EPHEMERAL,
      }).catch(() => {});
      return true;
    }
    session.bet = amount;
    session.expires = Date.now() + 30 * 60_000;
    try {
      await refreshWallet(session);
      const gif = await renderMachine(session, "idle");
      const { files, imageName } = await attachGif(gif, "slots-bet.gif");
      const embed = brandEmbed("🎰 Vegas Slots", [
        `${interaction.user} set BET to **${fmtCash(amount)}** ${session.symbol} per spin.`,
        sessionStatus(session),
        "",
        "Hit **SPIN** — that amount comes off your credits.",
      ].join("\n"));
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await interaction.editReply({ embeds: [embed], files, components: machineButtons(session) });
    } catch (err) {
      await interaction.followUp({
        content: err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`,
        ...EPHEMERAL,
      }).catch(() => {});
    }
    return true;
  }

  if (action === "spin") {
    await interaction.deferUpdate();
    try {
      await assertGamesOn(session.guildId);
      await refreshWallet(session);
      await runSpin(interaction, session);
    } catch (err) {
      const msg = err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`;
      await refreshWallet(session).catch(() => null);
      await interaction.followUp({ content: msg, ...EPHEMERAL }).catch(() => {});
      await interaction.editReply({ components: machineButtons(session) }).catch(() => {});
    }
    return true;
  }

  return false;
}

/** Add more credits while seated (or legacy coin-value modal id → treat as add). */
export async function handleSlotsModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const id = interaction.customId;
  const isAdd = id.startsWith("unbgame:slots:modal:add:");
  const isLegacyCoin = id.startsWith("unbgame:slots:modal:coin:");
  if ((!isAdd && !isLegacyCoin) || !interaction.guildId) return false;

  const ownerId = id.slice(isAdd ? "unbgame:slots:modal:add:".length : "unbgame:slots:modal:coin:".length);
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your machine.", ...EPHEMERAL });
    return true;
  }

  const amount = Number.parseInt(interaction.fields.getTextInputValue("bet").replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(amount) || amount < MIN_BUY || amount > MAX_BUY) {
    await interaction.reply({ content: `Enter **${fmtCash(MIN_BUY)}–${fmtCash(MAX_BUY)}** to add.`, ...EPHEMERAL });
    return true;
  }

  const k = key(interaction.guildId, ownerId);
  const session = sessions.get(k);
  if (!session || session.expires < Date.now()) {
    sessions.delete(k);
    await interaction.reply({ content: "Session expired — open `/casino` → Slots and buy in again.", ...EPHEMERAL });
    return true;
  }

  await interaction.deferUpdate();
  try {
    await assertGamesOn(session.guildId);
    await refreshWallet(session);
    if (session.cash + session.bank < amount) {
      throw new CashError(
        `Need **${fmtCash(amount)}** ${session.symbol} (cash+bank). Have **${fmtCash(session.cash + session.bank)}**.`,
      );
    }
    await runAddCredits(interaction, session, amount);
  } catch (err) {
    const msg = err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`;
    await refreshWallet(session).catch(() => null);
    await interaction.followUp({ content: msg, ...EPHEMERAL }).catch(() => {});
    await interaction.editReply({ components: machineButtons(session) }).catch(() => {});
  }
  return true;
}
