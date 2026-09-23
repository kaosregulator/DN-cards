// Mini UNO — 1v1 vs the house bot. Playable cards as buttons; earn UnbelievaBoat cash.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
} from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import { UNBELIEVABOAT_AUTHOR, UNBELIEVABOAT_COLOR } from "./branding.js";
import {
  CashError, spendFunds, earnCash, getCashBalance, fmtCash, formatSpendNote,
} from "./cash.js";
import { assertGameCooldown, markGameCooldown } from "./cooldowns.js";
import { getOrCreateUbSettings } from "../../lib/unbelievaboat/db.js";
import { replyThenPostAsUnbelievaBoat } from "./webhook.js";
import { encodeAnimation, type Ctx } from "../animations/engine.js";
import { logGameEvent } from "../logging/channel-log.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type UnoColor = "R" | "Y" | "G" | "B";
type UnoCard = { color: UnoColor | "W"; rank: number | "skip" | "rev" | "draw2" | "wild" | "wild4"; id: string };

type UnoSession = {
  guildId: string;
  userId: string;
  bet: number;
  fromCash: number;
  fromBank: number;
  deck: UnoCard[];
  discard: UnoCard[];
  player: UnoCard[];
  bot: UnoCard[];
  color: UnoColor;
  turn: "player" | "bot";
  expires: number;
};

const sessions = new Map<string, UnoSession>();
let cardSeq = 0;

const COLORS: UnoColor[] = ["R", "Y", "G", "B"];
const COLOR_EMOJI: Record<UnoColor | "W", string> = {
  R: "🔴", Y: "🟡", G: "🟢", B: "🔵", W: "⬛",
};
const COLOR_HEX: Record<UnoColor, number> = {
  R: 0xef4444, Y: 0xeab308, G: 0x22c55e, B: 0x3b82f6,
};

function key(g: string, u: string) { return `${g}:${u}`; }

function makeDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  for (const c of COLORS) {
    for (let n = 0; n <= 9; n++) {
      deck.push({ color: c, rank: n, id: `c${cardSeq++}` });
      if (n > 0) deck.push({ color: c, rank: n, id: `c${cardSeq++}` });
    }
    for (const special of ["skip", "rev", "draw2"] as const) {
      deck.push({ color: c, rank: special, id: `c${cardSeq++}` });
      deck.push({ color: c, rank: special, id: `c${cardSeq++}` });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: "W", rank: "wild", id: `c${cardSeq++}` });
    deck.push({ color: "W", rank: "wild4", id: `c${cardSeq++}` });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

function draw(deck: UnoCard[], n = 1): UnoCard[] {
  const out: UnoCard[] = [];
  for (let i = 0; i < n; i++) {
    if (deck.length === 0) break;
    out.push(deck.pop()!);
  }
  return out;
}

function label(c: UnoCard): string {
  const e = COLOR_EMOJI[c.color];
  if (c.rank === "wild") return `${e} WILD`;
  if (c.rank === "wild4") return `${e} +4`;
  if (c.rank === "draw2") return `${e} +2`;
  if (c.rank === "skip") return `${e} Skip`;
  if (c.rank === "rev") return `${e} Rev`;
  return `${e} ${c.rank}`;
}

function canPlay(card: UnoCard, top: UnoCard, color: UnoColor): boolean {
  if (card.color === "W") return true;
  if (card.color === color) return true;
  // Same rank (number or action), as long as the discard isn't a wild face.
  if (top.color !== "W" && card.rank === top.rank) return true;
  return false;
}

function brandEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(UNBELIEVABOAT_COLOR)
    .setAuthor(UNBELIEVABOAT_AUTHOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Mini UNO · cash then bank · powered by UnbelievaBoat" });
}

async function renderUnoGif(opts: {
  top: UnoCard;
  color: UnoColor;
  playerCount: number;
  botCount: number;
  banner: string;
}): Promise<{ buffer: Buffer; name: string } | null> {
  const result = await encodeAnimation({
    width: 480, height: 260, durationMs: 1200, speed: "normal", maxFrames: 14, quality: 12,
    render: async ({ ctx, t }: { ctx: Ctx; t: number }) => {
      ctx.fillStyle = "#0d3b2e";
      ctx.fillRect(0, 0, 480, 260);
      ctx.fillStyle = "#0a2f24";
      ctx.fillRect(14, 14, 452, 232);

      // Top card
      const col = opts.top.color === "W" ? opts.color : (opts.top.color as UnoColor);
      ctx.fillStyle = `#${COLOR_HEX[col].toString(16).padStart(6, "0")}`;
      const bob = Math.sin(t * Math.PI * 2) * 4;
      ctx.fillRect(190, 70 + bob, 100, 140);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label(opts.top).replace(/[🔴🟡🟢🔵⬛]\s?/, ""), 240, 145 + bob);

      ctx.fillStyle = "#fde68a";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(opts.banner, 240, 40);
      ctx.fillStyle = "#a7f3d0";
      ctx.font = "14px sans-serif";
      ctx.fillText(`You ${opts.playerCount}  ·  House ${opts.botCount}`, 240, 230);
    },
  });
  if (!result) return null;
  return { buffer: result.buffer, name: "uno.gif" };
}

function playButtons(session: UnoSession): ActionRowBuilder<ButtonBuilder>[] {
  const top = session.discard[session.discard.length - 1]!;
  const playable = session.player.filter(c => canPlay(c, top, session.color));
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunk = playable.slice(0, 20);
  for (let i = 0; i < chunk.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const c of chunk.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`unbgame:uno:play:${session.userId}:${c.id}`)
          .setLabel(label(c).slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`unbgame:uno:draw:${session.userId}`)
        .setLabel("Draw")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`unbgame:uno:quit:${session.userId}`)
        .setLabel("Fold")
        .setStyle(ButtonStyle.Danger),
    ),
  );
  // Color pick when needed — shown only via wild play path
  return rows.slice(0, 5);
}

function colorPickRow(userId: string, cardId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...COLORS.map(c =>
      new ButtonBuilder()
        .setCustomId(`unbgame:uno:color:${userId}:${cardId}:${c}`)
        .setLabel(c === "R" ? "Red" : c === "Y" ? "Yellow" : c === "G" ? "Green" : "Blue")
        .setEmoji(COLOR_EMOJI[c])
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

async function assertGamesOn(guildId: string) {
  const s = await getOrCreateUbSettings(guildId);
  if (!s.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
}

function applySpecial(session: UnoSession, card: UnoCard, who: "player" | "bot") {
  if (card.rank === "draw2") {
    const victim = who === "player" ? "bot" : "player";
    const drawn = draw(session.deck, 2);
    if (victim === "bot") session.bot.push(...drawn);
    else session.player.push(...drawn);
  }
  if (card.rank === "wild4") {
    const victim = who === "player" ? "bot" : "player";
    const drawn = draw(session.deck, 4);
    if (victim === "bot") session.bot.push(...drawn);
    else session.player.push(...drawn);
  }
  // skip / rev just pass turn back to same player in 1v1 → we skip bot/player once
  if (card.rank === "skip" || card.rank === "rev") {
    session.turn = who; // play again
    return;
  }
  session.turn = who === "player" ? "bot" : "player";
}

async function finish(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  session: UnoSession,
  winner: "player" | "bot" | "fold",
) {
  sessions.delete(key(session.guildId, session.userId));
  let bal = await getCashBalance(session.guildId, session.userId);
  let payout = 0;
  if (winner === "player") {
    payout = session.bet * 2;
    bal = await earnCash(session.guildId, session.userId, payout, "Mini UNO win");
  }
  const gif = await renderUnoGif({
    top: session.discard[session.discard.length - 1]!,
    color: session.color,
    playerCount: session.player.length,
    botCount: session.bot.length,
    banner: winner === "player" ? "YOU WIN!" : winner === "bot" ? "HOUSE WINS" : "FOLDED",
  });
  const files = gif ? [new AttachmentBuilder(gif.buffer, { name: gif.name })] : [];
  const embed = brandEmbed("Mini UNO — Result", [
    `<@${session.userId}>`,
    winner === "player"
      ? `🎉 Cleared your hand · won **${fmtCash(payout)}**`
      : winner === "fold"
        ? `Folded — stake kept by the house.`
        : `💀 House cleared first — lost stake **${fmtCash(session.bet)}**`,
    formatSpendNote(session.fromCash, session.fromBank, bal.symbol),
    `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
  ].join("\n"));
  if (gif) embed.setImage(`attachment://${gif.name}`);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: "✅ Posting as **UnbelievaBoat**…", embeds: [], components: [], files: [] });
  }
  await replyThenPostAsUnbelievaBoat(
    interaction as ChatInputCommandInteraction,
    { embeds: [embed], files },
    "✅ Mini UNO result posted as **UnbelievaBoat**.",
  );
  void logGameEvent(
    interaction.client,
    session.guildId,
    interaction.user,
    "Mini UNO",
    winner === "player" ? `Won ${fmtCash(payout)}` : `Lost ${fmtCash(session.bet)} (${winner})`,
    [
      { name: "Bet", value: fmtCash(session.bet), inline: true },
      { name: "Cash", value: fmtCash(bal.cash), inline: true },
    ],
  );
}

function botPlay(session: UnoSession): void {
  const top = session.discard[session.discard.length - 1]!;
  const playable = session.bot.filter(c => canPlay(c, top, session.color));
  let card: UnoCard | undefined;
  if (playable.length) {
    // Prefer non-wild
    card = playable.find(c => c.color !== "W") ?? playable[0];
  }
  if (!card) {
    const drawn = draw(session.deck, 1);
    if (drawn[0] && canPlay(drawn[0], top, session.color)) {
      card = drawn[0];
    } else {
      session.bot.push(...drawn);
      session.turn = "player";
      return;
    }
  }
  session.bot = session.bot.filter(c => c.id !== card!.id);
  session.discard.push(card);
  if (card.color !== "W") session.color = card.color;
  else session.color = COLORS[Math.floor(Math.random() * 4)]!;
  applySpecial(session, card, "bot");
}

export async function handleUno(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const bet = interaction.options.getInteger("bet", true);
    const k = key(interaction.guildId, interaction.user.id);
    if (sessions.has(k)) {
      await interaction.editReply("You already have a Mini UNO hand open.");
      return;
    }
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, "Mini UNO bet");
    await markGameCooldown(interaction.guildId, interaction.user.id);

    const deck = makeDeck();
    const player = draw(deck, 7);
    const bot = draw(deck, 7);
    let starter = draw(deck, 1)[0]!;
    while (starter.color === "W") {
      deck.unshift(starter);
      starter = draw(deck, 1)[0]!;
    }
    const session: UnoSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      bet,
      fromCash: spent.fromCash,
      fromBank: spent.fromBank,
      deck,
      discard: [starter],
      player,
      bot,
      color: starter.color as UnoColor,
      turn: "player",
      expires: Date.now() + 5 * 60_000,
    };
    sessions.set(k, session);

    const gif = await renderUnoGif({
      top: starter,
      color: session.color,
      playerCount: player.length,
      botCount: bot.length,
      banner: "YOUR TURN",
    });
    const files = gif ? [new AttachmentBuilder(gif.buffer, { name: gif.name })] : [];
    const embed = brandEmbed("Mini UNO vs House", [
      formatSpendNote(spent.fromCash, spent.fromBank, spent.balance.symbol),
      `Top: **${label(starter)}** · color ${COLOR_EMOJI[session.color]}`,
      `Your hand: ${player.map(label).join(" · ")}`,
      `House: **${bot.length}** cards`,
      "",
      "Play a matching color/rank, or **Draw**. First to empty hand wins **2×**.",
    ].join("\n"));
    if (gif) embed.setImage(`attachment://${gif.name}`);
    await interaction.editReply({ embeds: [embed], files, components: playButtons(session) });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleUnoComponent(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith("unbgame:uno:") || !interaction.guildId) return false;

  const parts = id.split(":");
  const action = parts[2]!;
  const ownerId = parts[3]!;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Not your hand.", ...EPHEMERAL });
    return true;
  }
  const k = key(interaction.guildId, ownerId);
  const session = sessions.get(k);
  if (!session || session.expires < Date.now()) {
    sessions.delete(k);
    await interaction.reply({ content: "Hand expired — start `/casino uno` again.", ...EPHEMERAL });
    return true;
  }

  if (action === "quit") {
    await interaction.deferUpdate();
    await finish(interaction, session, "fold");
    return true;
  }

  if (action === "color") {
    const cardId = parts[4]!;
    const color = parts[5] as UnoColor;
    const card = session.player.find(c => c.id === cardId);
    if (!card || (card.rank !== "wild" && card.rank !== "wild4")) {
      await interaction.reply({ content: "Invalid wild.", ...EPHEMERAL });
      return true;
    }
    await interaction.deferUpdate();
    session.player = session.player.filter(c => c.id !== cardId);
    session.discard.push(card);
    session.color = color;
    applySpecial(session, card, "player");
    if (session.player.length === 0) {
      await finish(interaction, session, "player");
      return true;
    }
    // Bot turns until player again
    while (session.turn === "bot" && session.bot.length > 0 && session.player.length > 0) {
      botPlay(session);
      if (session.bot.length === 0) {
        await finish(interaction, session, "bot");
        return true;
      }
    }
    const top = session.discard[session.discard.length - 1]!;
    const gif = await renderUnoGif({
      top, color: session.color, playerCount: session.player.length, botCount: session.bot.length, banner: "YOUR TURN",
    });
    const files = gif ? [new AttachmentBuilder(gif.buffer, { name: gif.name })] : [];
    const embed = brandEmbed("Mini UNO vs House", [
      `Top: **${label(top)}** · color ${COLOR_EMOJI[session.color]}`,
      `Your hand: ${session.player.map(label).join(" · ")}`,
      `House: **${session.bot.length}** cards`,
    ].join("\n"));
    if (gif) embed.setImage(`attachment://${gif.name}`);
    await interaction.editReply({ embeds: [embed], files, components: playButtons(session) });
    return true;
  }

  if (action === "draw") {
    await interaction.deferUpdate();
    const drawn = draw(session.deck, 1);
    session.player.push(...drawn);
    session.turn = "bot";
    while (session.turn === "bot" && session.bot.length > 0) {
      botPlay(session);
      if (session.bot.length === 0) {
        await finish(interaction, session, "bot");
        return true;
      }
    }
    const top = session.discard[session.discard.length - 1]!;
    const gif = await renderUnoGif({
      top, color: session.color, playerCount: session.player.length, botCount: session.bot.length, banner: "YOUR TURN",
    });
    const files = gif ? [new AttachmentBuilder(gif.buffer, { name: gif.name })] : [];
    const embed = brandEmbed("Mini UNO vs House", [
      drawn[0] ? `Drew **${label(drawn[0])}**` : "Deck empty",
      `Top: **${label(top)}** · color ${COLOR_EMOJI[session.color]}`,
      `Your hand: ${session.player.map(label).join(" · ")}`,
      `House: **${session.bot.length}** cards`,
    ].join("\n"));
    if (gif) embed.setImage(`attachment://${gif.name}`);
    await interaction.editReply({ embeds: [embed], files, components: playButtons(session) });
    return true;
  }

  if (action === "play") {
    const cardId = parts[4]!;
    const card = session.player.find(c => c.id === cardId);
    const top = session.discard[session.discard.length - 1]!;
    if (!card || !canPlay(card, top, session.color)) {
      await interaction.reply({ content: "Can't play that card.", ...EPHEMERAL });
      return true;
    }
    if (card.rank === "wild" || card.rank === "wild4") {
      await interaction.deferUpdate();
      const embed = brandEmbed("Mini UNO — pick a color", `Playing **${label(card)}** — choose the new color.`);
      await interaction.editReply({ embeds: [embed], components: [colorPickRow(ownerId, cardId)], files: [] });
      return true;
    }
    await interaction.deferUpdate();
    session.player = session.player.filter(c => c.id !== cardId);
    session.discard.push(card);
    session.color = card.color as UnoColor;
    applySpecial(session, card, "player");
    if (session.player.length === 0) {
      await finish(interaction, session, "player");
      return true;
    }
    while (session.turn === "bot" && session.bot.length > 0 && session.player.length > 0) {
      botPlay(session);
      if (session.bot.length === 0) {
        await finish(interaction, session, "bot");
        return true;
      }
    }
    const newTop = session.discard[session.discard.length - 1]!;
    const gif = await renderUnoGif({
      top: newTop, color: session.color, playerCount: session.player.length, botCount: session.bot.length, banner: "YOUR TURN",
    });
    const files = gif ? [new AttachmentBuilder(gif.buffer, { name: gif.name })] : [];
    const embed = brandEmbed("Mini UNO vs House", [
      `Played **${label(card)}**`,
      `Top: **${label(newTop)}** · color ${COLOR_EMOJI[session.color]}`,
      `Your hand: ${session.player.map(label).join(" · ")}`,
      `House: **${session.bot.length}** cards`,
    ].join("\n"));
    if (gif) embed.setImage(`attachment://${gif.name}`);
    await interaction.editReply({ embeds: [embed], files, components: playButtons(session) });
    return true;
  }

  return true;
}
