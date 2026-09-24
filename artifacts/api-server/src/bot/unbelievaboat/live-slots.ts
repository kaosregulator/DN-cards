// Live interactive slots — pull the lever, spin again until broke.
// Public floor table with Discord buttons (not one-shot slash).

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
import { postAsUnbelievaBoat } from "./webhook.js";
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
  bet: number;
  spins: number;
  net: number;
  expires: number;
  symbol: string;
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

function tableButtons(userId: string, opts: { canPull: boolean; canAgain: boolean; spinning?: boolean }) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (opts.spinning) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`unbgame:slots:busy:${userId}`).setLabel("Spinning…").setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
  } else if (opts.canAgain) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`unbgame:slots:again:${userId}`).setLabel("Spin again").setEmoji("🎰").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`unbgame:slots:rebet:${userId}`).setLabel("Change bet").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`unbgame:slots:leave:${userId}`).setLabel("Leave table").setStyle(ButtonStyle.Danger),
    );
  } else if (opts.canPull) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`unbgame:slots:pull:${userId}`).setLabel("PULL LEVER").setEmoji("🕹️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`unbgame:slots:rebet:${userId}`).setLabel("Change bet").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`unbgame:slots:leave:${userId}`).setLabel("Leave table").setStyle(ButtonStyle.Secondary),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`unbgame:slots:rebet:${userId}`).setLabel("Change bet").setEmoji("💵").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`unbgame:slots:leave:${userId}`).setLabel("Leave table").setStyle(ButtonStyle.Danger),
    );
  }
  return [row];
}

/** Open the live table (idle machine) after bet is chosen — does not spend yet. */
export async function handleSlots(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply();
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    if (bet < 10 || bet > 50_000) {
      await interaction.editReply("Bet must be 10–50,000.");
      return;
    }

    const bal = await getCashBalance(interaction.guildId, interaction.user.id);
    const total = bal.cash + bal.bank;
    if (total < bet) {
      await interaction.editReply(`Need **${fmtCash(bet)}** ${bal.symbol} (cash+bank). You have **${fmtCash(total)}**.`);
      return;
    }

    await markGameCooldown(interaction.guildId, interaction.user.id);
    const k = key(interaction.guildId, interaction.user.id);
    sessions.set(k, {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      bet,
      spins: 0,
      net: 0,
      expires: Date.now() + 30 * 60_000,
      symbol: bal.symbol,
    });

    const gif = await renderLiveSlotsMachine({
      mode: "idle",
      symbol: bal.symbol,
      reels: ["🍒", "🍋", "🔔"],
    });
    const { files, imageName } = await attachGif(gif, "slots-idle.gif");
    const embed = brandEmbed("🎰 Live Slot Machine", [
      `${interaction.user} sat down at the machine.`,
      `Stake locked: **${fmtCash(bet)}** ${bal.symbol} per pull`,
      `Wallet: cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      "",
      "**Hit PULL LEVER** to spin — keep playing until you leave or run out of cash.",
      "_Jackpot face uses this server’s economy symbol on the win banner._",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);

    await interaction.editReply({
      embeds: [embed],
      files,
      components: tableButtons(interaction.user.id, { canPull: true, canAgain: false }),
    });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function runSpin(
  interaction: ButtonInteraction,
  session: SlotsSession,
): Promise<void> {
  const spent = await spendFunds(session.guildId, session.userId, session.bet, "Live slots pull");
  session.symbol = spent.balance.symbol;
  session.spins += 1;
  session.net -= session.bet;
  session.expires = Date.now() + 30 * 60_000;

  const reels = rollSlotsReels(session.symbol);
  const { mult, tier } = scoreSlotsReels(reels);
  // All-economy-symbol line also counts as jackpot
  const allSym = reels.every(r => r === session.symbol);
  const finalTier = allSym ? { mult: Math.max(mult, 40), tier: "jackpot" as const } : { mult, tier };
  const win = finalTier.mult > 0;
  const payout = win ? session.bet * finalTier.mult : 0;
  let bal = spent.balance;
  if (payout > 0) {
    bal = await earnCash(session.guildId, session.userId, payout, "Live slots win");
    session.net += payout;
  }

  const payoutLabel = win ? `${fmtCash(payout)} ${bal.symbol} (${finalTier.mult}×)` : undefined;

  // Spin animation first
  const spinGif = await renderLiveSlotsMachine({
    mode: "spin",
    reels,
    symbol: bal.symbol,
    tier: finalTier.tier,
    payoutLabel,
  });
  const spinAttach = await attachGif(spinGif, "slots-spin.gif");
  const spinningEmbed = brandEmbed("🎰 Spinning…", [
    `${interaction.user} pulls the lever · **${fmtCash(session.bet)}** ${bal.symbol}`,
    formatSpendNote(spent.fromCash, spent.fromBank, bal.symbol),
  ].join("\n"));
  if (spinAttach.imageName) spinningEmbed.setImage(`attachment://${spinAttach.imageName}`);
  await interaction.editReply({
    embeds: [spinningEmbed],
    files: spinAttach.files,
    components: tableButtons(session.userId, { canPull: false, canAgain: false, spinning: true }),
  });

  // Brief pause feel — Discord can't truly wait mid-handler long; result follows immediately
  // with the win/lose celebration GIF.
  const resultGif = await renderLiveSlotsMachine({
    mode: win ? "win" : "lose",
    reels,
    symbol: bal.symbol,
    tier: finalTier.tier,
    payoutLabel,
    coinBurst: win,
  });
  const { files, imageName } = await attachGif(resultGif, win ? "slots-win.gif" : "slots-lose.gif");

  const canAgain = (bal.cash + bal.bank) >= session.bet;
  const embed = brandEmbed(
    finalTier.tier === "jackpot" ? `🎰 JACKPOT ${bal.symbol}` : "🎰 Live Slot Machine",
    [
      `${interaction.user}`,
      reels.join("  │  "),
      win
        ? `${finalTier.tier === "jackpot" ? "🏆" : "🎉"} **+${fmtCash(payout)}** ${bal.symbol} (**${finalTier.mult}×**)`
        : `No line — **−${fmtCash(session.bet)}** ${bal.symbol}`,
      `Spins **${session.spins}** · session net **${session.net >= 0 ? "+" : ""}${fmtCash(session.net)}** ${bal.symbol}`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      canAgain ? "" : `_Out of funds for a **${fmtCash(session.bet)}** pull — change bet or leave._`,
    ].filter(Boolean).join("\n"),
  );
  if (imageName) embed.setImage(`attachment://${imageName}`);

  await interaction.editReply({
    embeds: [embed],
    files,
    components: tableButtons(session.userId, {
      canPull: false,
      canAgain,
    }),
  });

  // Mirror big jackpots to the UnbelievaBoat webhook for the floor
  if (finalTier.tier === "jackpot") {
    await postAsUnbelievaBoat(interaction, { embeds: [embed], files });
  }
}

export async function handleSlotsComponent(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith("unbgame:slots:") || !interaction.guildId) return false;

  const parts = id.split(":");
  const action = parts[2]!;
  const ownerId = parts[3]!;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your machine — open `/casino` → Slots.", ...EPHEMERAL });
    return true;
  }

  const k = key(interaction.guildId, ownerId);
  const session = sessions.get(k);

  if (action === "leave") {
    sessions.delete(k);
    await interaction.update({
      content: "👋 Left the slot machine.",
      embeds: [],
      components: [],
      files: [],
    }).catch(async () => {
      await interaction.reply({ content: "Left the table.", ...EPHEMERAL });
    });
    return true;
  }

  if (action === "rebet") {
    const modal = new ModalBuilder()
      .setCustomId(`unbgame:slots:modal:bet:${ownerId}`)
      .setTitle("Change stake")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("bet")
            .setLabel("Coins to stake (10–50,000)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(12)
            .setPlaceholder(session ? String(session.bet) : "500"),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === "busy") {
    await interaction.deferUpdate();
    return true;
  }

  if (action === "pull" || action === "again") {
    if (!session || session.expires < Date.now()) {
      sessions.delete(k);
      await interaction.reply({ content: "Session expired — open `/casino` → Slots again.", ...EPHEMERAL });
      return true;
    }
    await interaction.deferUpdate();
    try {
      await assertGamesOn(session.guildId);
      await runSpin(interaction, session);
    } catch (err) {
      const msg = err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`;
      await interaction.followUp({ content: msg, ...EPHEMERAL }).catch(() => {});
      // If broke mid-session, refresh buttons
      if (session) {
        const bal = await getCashBalance(session.guildId, session.userId).catch(() => null);
        const canAgain = bal ? (bal.cash + bal.bank) >= session.bet : false;
        await interaction.editReply({
          components: tableButtons(session.userId, { canPull: false, canAgain }),
        }).catch(() => {});
      }
    }
    return true;
  }

  return false;
}

export async function handleSlotsModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("unbgame:slots:modal:bet:") || !interaction.guildId) return false;
  const ownerId = interaction.customId.slice("unbgame:slots:modal:bet:".length);
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your machine.", ...EPHEMERAL });
    return true;
  }
  const bet = Number.parseInt(interaction.fields.getTextInputValue("bet").replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(bet) || bet < 10 || bet > 50_000) {
    await interaction.reply({ content: "Bet must be 10–50,000.", ...EPHEMERAL });
    return true;
  }
  await interaction.deferReply();
  try {
    await assertGamesOn(interaction.guildId);
    const bal = await getCashBalance(interaction.guildId, interaction.user.id);
    if (bal.cash + bal.bank < bet) {
      await interaction.editReply(`Need **${fmtCash(bet)}** ${bal.symbol}.`);
      return true;
    }
    const k = key(interaction.guildId, ownerId);
    const prev = sessions.get(k);
    sessions.set(k, {
      guildId: interaction.guildId,
      userId: ownerId,
      bet,
      spins: prev?.spins ?? 0,
      net: prev?.net ?? 0,
      expires: Date.now() + 30 * 60_000,
      symbol: bal.symbol,
    });
    const gif = await renderLiveSlotsMachine({
      mode: "idle",
      symbol: bal.symbol,
      reels: ["7️⃣", "💎", "⭐"],
    });
    const { files, imageName } = await attachGif(gif, "slots-idle.gif");
    const embed = brandEmbed("🎰 Live Slot Machine", [
      `${interaction.user} · new stake **${fmtCash(bet)}** ${bal.symbol}`,
      `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      "",
      "**PULL LEVER** whenever you’re ready — play until you’re done.",
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await interaction.editReply({
      embeds: [embed],
      files,
      components: tableButtons(ownerId, { canPull: true, canAgain: false }),
    });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
  return true;
}
