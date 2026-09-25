// Live Las Vegas slots — insert coins, set BET ×1–×5, pull the lever.
// Credits stay on the machine; cash then bank fund inserts; hard-stop when broke.

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

export const RESPONSIBLE_PLAY =
  "Fun with UnbelievaBoat server cash only — not real-money gambling. Winners do not receive real currency.";

type SlotsSession = {
  guildId: string;
  userId: string;
  /** Denomination of one coin (server currency units). */
  coinValue: number;
  /** Coins sitting in the machine (already paid). */
  credits: number;
  /** Credits staked per spin (1–5). */
  betMult: number;
  spins: number;
  net: number;
  expires: number;
  symbol: string;
  /** Last known wallet totals for button gating. */
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

function stakeOf(session: SlotsSession): number {
  return session.coinValue * session.betMult;
}

function machineButtons(session: SlotsSession, opts: { busy?: boolean } = {}) {
  const uid = session.userId;
  const total = session.cash + session.bank;
  const canInsert = (n: number) => !opts.busy && total >= session.coinValue * n;
  const canSpin = !opts.busy && session.credits >= session.betMult;

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

  const insertRow = new ActionRowBuilder<ButtonBuilder>();
  for (const n of [1, 2, 3, 4, 5] as const) {
    insertRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`unbgame:slots:insert:${n}:${uid}`)
        .setLabel(`+${n} coin${n === 1 ? "" : "s"}`)
        .setEmoji("🪙")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canInsert(n)),
    );
  }

  const betRow = new ActionRowBuilder<ButtonBuilder>();
  for (const m of [1, 2, 3, 4, 5] as const) {
    const selected = session.betMult === m;
    betRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`unbgame:slots:bet:${m}:${uid}`)
        .setLabel(selected ? `● BET ×${m}` : `BET ×${m}`)
        .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(opts.busy),
    );
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`unbgame:slots:spin:${uid}`)
      .setLabel(canSpin ? "SPIN" : "Need credits")
      .setEmoji("🕹️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canSpin),
    new ButtonBuilder()
      .setCustomId(`unbgame:slots:coin:${uid}`)
      .setLabel("Coin value")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`unbgame:slots:leave:${uid}`)
      .setLabel("Cash out / leave")
      .setStyle(ButtonStyle.Secondary),
  );

  return [insertRow, betRow, actionRow];
}

function sessionStatus(session: SlotsSession): string {
  const stake = stakeOf(session);
  return [
    `Coin **${fmtCash(session.coinValue)}** ${session.symbol} · Credits **${session.credits}** · BET **×${session.betMult}** (stake **${fmtCash(stake)}**)`,
    `Wallet: cash **${fmtCash(session.cash)}** · bank **${fmtCash(session.bank)}** ${session.symbol}`,
    `Spins **${session.spins}** · session net **${session.net >= 0 ? "+" : ""}${fmtCash(session.net)}**`,
  ].join("\n");
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
    betMult: session.betMult,
    coinValueLabel: fmtCash(session.coinValue),
    insertCount: extra.insertCount,
    tier: extra.tier,
    payoutLabel: extra.payoutLabel,
  });
}

/** Open the live table (idle machine) after coin value is chosen — does not spend yet. */
export async function handleSlots(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const coinValue = interaction.options.getInteger("bet", true);
    if (coinValue < 10 || coinValue > 50_000) {
      await interaction.editReply("Coin value must be 10–50,000.");
      return;
    }

    const bal = await getCashBalance(interaction.guildId, interaction.user.id);
    const total = (bal.cash ?? 0) + (bal.bank ?? 0);
    if (total < coinValue) {
      await interaction.editReply(
        `Need at least **${fmtCash(coinValue)}** ${bal.symbol} (cash+bank) to insert one coin. ` +
        `You have **${fmtCash(total)}**.`,
      );
      return;
    }

    await markGameCooldown(interaction.guildId, interaction.user.id);
    const k = key(interaction.guildId, interaction.user.id);
    const session: SlotsSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      coinValue,
      credits: 0,
      betMult: 1,
      spins: 0,
      net: 0,
      expires: Date.now() + 30 * 60_000,
      symbol: bal.symbol,
      cash: bal.cash ?? 0,
      bank: bal.bank ?? 0,
    };
    sessions.set(k, session);

    const gif = await renderMachine(session, "idle");
    const { files, imageName } = await attachGif(gif, "slots-idle.gif");
    const embed = brandEmbed("🎰 Vegas Slot Machine", [
      `${interaction.user} walks up to the machine.`,
      sessionStatus(session),
      "",
      `Jackpot face: **${bal.symbol}${bal.symbol}${bal.symbol}**`,
      "**Insert coins** (+1…+5) → set **BET ×1–×5** → **SPIN**.",
      "Keep feeding until cash+bank run dry.",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);

    await openTableAsUnbelievaBoat(interaction, {
      embeds: [embed],
      files,
      components: machineButtons(session),
    }, "✅ Slot machine opened as **UnbelievaBoat** — play on the floor.");
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function runInsert(interaction: ButtonInteraction, session: SlotsSession, count: number) {
  // Instant busy feedback — encode GIF after so the floor doesn't stutter
  await interaction.editReply({ components: machineButtons(session, { busy: true }) }).catch(() => {});

  const cost = session.coinValue * count;
  const spent = await spendFunds(session.guildId, session.userId, cost, `Slots insert ×${count}`);
  session.cash = spent.balance.cash ?? 0;
  session.bank = spent.balance.bank ?? 0;
  session.symbol = spent.balance.symbol;
  session.credits += count;
  session.net -= cost;
  session.expires = Date.now() + 30 * 60_000;

  const insertGif = await renderMachine(session, "insert", { insertCount: count });
  const { files, imageName } = await attachGif(insertGif, "slots-insert.gif");
  const embed = brandEmbed("🎰 Vegas Slot Machine", [
    `${interaction.user} drops **${count}** coin${count === 1 ? "" : "s"} in the slot.`,
    formatSpendNote(spent.fromCash, spent.fromBank, session.symbol),
    sessionStatus(session),
    "",
    session.credits >= session.betMult
      ? "Ready — hit **SPIN** or feed more coins."
      : `Need **${session.betMult}** credit${session.betMult === 1 ? "" : "s"} for BET ×${session.betMult} — insert more.`,
  ].join("\n"));
  if (imageName) embed.setImage(`attachment://${imageName}`);
  await interaction.editReply({
    embeds: [embed],
    files,
    components: machineButtons(session),
  });
}

async function runSpin(interaction: ButtonInteraction, session: SlotsSession) {
  if (session.credits < session.betMult) {
    throw new CashError(
      `Not enough credits on the machine. Have **${session.credits}**, need **${session.betMult}** for BET ×${session.betMult}. Insert more coins.`,
    );
  }

  // Instant busy ack before the long encode
  await interaction.editReply({ components: machineButtons(session, { busy: true }) }).catch(() => {});

  const stake = stakeOf(session);
  session.credits -= session.betMult;
  session.spins += 1;
  session.expires = Date.now() + 30 * 60_000;

  const reels = rollSlotsReels(session.symbol);
  const scored = scoreSlotsReels(reels, session.symbol);
  const win = scored.mult > 0;
  const payout = win ? stake * scored.mult : 0;
  await refreshWallet(session);
  if (payout > 0) {
    const bal = await earnCash(session.guildId, session.userId, payout, "Live slots win");
    session.cash = bal.cash ?? 0;
    session.bank = bal.bank ?? 0;
    session.symbol = bal.symbol;
    session.net += payout;
  }

  const payoutLabel = win ? `${fmtCash(payout)} ${session.symbol} (${scored.mult}×)` : undefined;

  // One GIF: slow spin → land → hopper/lose (no double-edit stutter)
  const spinGif = await renderMachine(session, "spin", {
    reels,
    tier: scored.tier,
    payoutLabel,
  });
  const { files, imageName } = await attachGif(spinGif, win ? "slots-win.gif" : "slots-spin.gif");

  const canAffordCoin = (session.cash + session.bank) >= session.coinValue;
  const canSpin = session.credits >= session.betMult;
  const embed = brandEmbed(
    scored.tier === "jackpot" ? `🎰 JACKPOT ${session.symbol}` : "🎰 Vegas Slot Machine",
    [
      `${interaction.user}`,
      reels.join("  │  "),
      win
        ? `${scored.tier === "jackpot" ? "🏆" : "🎉"} Hopper pays **+${fmtCash(payout)}** ${session.symbol} (**${scored.mult}×**)`
        : `No line — credits spent.`,
      sessionStatus(session),
      canSpin
        ? "Hit **SPIN** again or insert more coins."
        : canAffordCoin
          ? `_Out of machine credits — insert more coins to keep playing._`
          : `_Broke — cash+bank can't cover another coin. Leave the machine._`,
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

  // insert:N:uid | bet:N:uid | spin:uid | coin:uid | leave:uid | busy:uid
  const ownerId = action === "insert" || action === "bet" ? parts[4]! : parts[3]!;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your machine — open `/casino` → Slots.", ...EPHEMERAL });
    return true;
  }

  const k = key(interaction.guildId, ownerId);
  const session = sessions.get(k);

  if (action === "leave") {
    const leftover = session?.credits ?? 0;
    const coinValue = session?.coinValue ?? 0;
    const refund = leftover * coinValue;
    sessions.delete(k);
    let note = "";
    if (refund > 0 && session) {
      try {
        const bal = await earnCash(session.guildId, session.userId, refund, "Slots cash-out");
        note = ` Returned **${leftover}** credit${leftover === 1 ? "" : "s"} → **+${fmtCash(refund)}** ${bal.symbol} cash.`;
      } catch {
        note = ` Couldn't refund **${leftover}** credit${leftover === 1 ? "" : "s"} — ask an admin.`;
      }
    }
    await interaction.update({
      content: `👋 Cashed out of the slot machine.${note}`,
      embeds: [],
      components: [],
      files: [],
    }).catch(async () => {
      await interaction.reply({ content: `Left the machine.${note}`, ...EPHEMERAL });
    });
    return true;
  }

  if (action === "coin") {
    const modal = new ModalBuilder()
      .setCustomId(`unbgame:slots:modal:coin:${ownerId}`)
      .setTitle("Change coin value")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("bet")
            .setLabel("Coin denomination (10–50,000)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(12)
            .setPlaceholder(session ? String(session.coinValue) : "100"),
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
    const mult = Number.parseInt(parts[3]!, 10);
    if (![1, 2, 3, 4, 5].includes(mult)) {
      await interaction.reply({ content: "Invalid bet multiplier.", ...EPHEMERAL });
      return true;
    }
    await interaction.deferUpdate();
    session.betMult = mult;
    session.expires = Date.now() + 30 * 60_000;
    try {
      await refreshWallet(session);
      const gif = await renderMachine(session, "idle");
      const { files, imageName } = await attachGif(gif, "slots-bet.gif");
      const embed = brandEmbed("🎰 Vegas Slot Machine", [
        `${interaction.user} sets BET **×${mult}** · stake **${fmtCash(stakeOf(session))}** ${session.symbol}`,
        sessionStatus(session),
        "",
        session.credits >= session.betMult
          ? "Ready — hit **SPIN**."
          : `Insert at least **${session.betMult - session.credits}** more coin${session.betMult - session.credits === 1 ? "" : "s"}.`,
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

  if (action === "insert") {
    const count = Number.parseInt(parts[3]!, 10);
    if (![1, 2, 3, 4, 5].includes(count)) {
      await interaction.reply({ content: "Invalid insert count.", ...EPHEMERAL });
      return true;
    }
    await interaction.deferUpdate();
    try {
      await assertGamesOn(session.guildId);
      await refreshWallet(session);
      const cost = session.coinValue * count;
      if (session.cash + session.bank < cost) {
        throw new CashError(
          `Not enough funds to insert **${count}** coin${count === 1 ? "" : "s"}. ` +
          `Need **${fmtCash(cost)}** ${session.symbol}, have **${fmtCash(session.cash + session.bank)}** (cash+bank).`,
        );
      }
      await runInsert(interaction, session, count);
    } catch (err) {
      const msg = err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`;
      await refreshWallet(session).catch(() => null);
      await interaction.followUp({ content: msg, ...EPHEMERAL }).catch(() => {});
      await interaction.editReply({ components: machineButtons(session) }).catch(() => {});
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

export async function handleSlotsModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("unbgame:slots:modal:coin:") || !interaction.guildId) return false;
  const ownerId = interaction.customId.slice("unbgame:slots:modal:coin:".length);
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your machine.", ...EPHEMERAL });
    return true;
  }
  const coinValue = Number.parseInt(interaction.fields.getTextInputValue("bet").replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(coinValue) || coinValue < 10 || coinValue > 50_000) {
    await interaction.reply({ content: "Coin value must be 10–50,000.", ...EPHEMERAL });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    const bal = await getCashBalance(interaction.guildId, interaction.user.id);
    if ((bal.cash ?? 0) + (bal.bank ?? 0) < coinValue) {
      await interaction.editReply(
        `Need at least **${fmtCash(coinValue)}** ${bal.symbol} (cash+bank) for one coin.`,
      );
      return true;
    }
    const k = key(interaction.guildId, ownerId);
    const prev = sessions.get(k);
    const session: SlotsSession = {
      guildId: interaction.guildId,
      userId: ownerId,
      coinValue,
      credits: prev?.credits ?? 0,
      betMult: prev?.betMult ?? 1,
      spins: prev?.spins ?? 0,
      net: prev?.net ?? 0,
      expires: Date.now() + 30 * 60_000,
      symbol: bal.symbol,
      cash: bal.cash ?? 0,
      bank: bal.bank ?? 0,
    };
    sessions.set(k, session);
    const gif = await renderMachine(session, "idle");
    const { files, imageName } = await attachGif(gif, "slots-idle.gif");
    const embed = brandEmbed("🎰 Vegas Slot Machine", [
      `${interaction.user} · coin value set to **${fmtCash(coinValue)}** ${bal.symbol}`,
      sessionStatus(session),
      "",
      `Jackpot face: **${bal.symbol}${bal.symbol}${bal.symbol}**`,
      "Insert coins, set BET, then **SPIN**.",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await openTableAsUnbelievaBoat(interaction, {
      embeds: [embed],
      files,
      components: machineButtons(session),
    }, "✅ Coin value updated — play on the floor machine.");
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
  return true;
}
