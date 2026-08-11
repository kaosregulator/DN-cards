// ─────────────────────────────────────────────────────────────────────────────
// Wild Mini-Game session manager — owns the live encounter between "caught" and
// "granted". startMiniGame() takes over the spawn message, posts the animated
// intro + interactive buttons, routes the catcher's clicks to the game, and on
// resolution calls back into the spawn-manager's grant (win) or escape (lose).
//
// Sessions are in-memory (like raid/manager.ts). A per-encounter step timer
// escapes the card if the player never acts. Only the catcher can interact.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmbedBuilder, AttachmentBuilder, MessageFlags,
  type Message, type ButtonInteraction,
} from "discord.js";
import { nanoid } from "nanoid";
import type { Card } from "@workspace/db";
import { pickGame, GAMES } from "./registry.js";
import { logMiniGameStart, logMiniGameResolve } from "./db.js";
import { rearmAfterResolve } from "./scheduler.js";
import { logger } from "../../lib/logger.js";
import type { MiniGameSession, MiniGameRender } from "./types.js";

const sessions = new Map<string, MiniGameSession>();

export interface StartMiniGameOpts {
  guildId: string;
  channelId: string;
  userId: string;
  card: Card;
  rarityLabel: string;
  rarityColor: number;
  cardArtUrl: string | null;
  decoyArt?: { name: string; url: string | null }[];
  spawnMessage: Message;
  animate: boolean;
  selection: string;
  onWin: () => Promise<void>;
  onLose: () => Promise<void>;
}

function payloadFor(render: MiniGameRender): {
  embeds: EmbedBuilder[]; files: AttachmentBuilder[]; components: MiniGameRender["components"];
} {
  const embed = new EmbedBuilder()
    .setTitle(render.title)
    .setDescription(render.description)
    .setColor(render.color)
    .setTimestamp();
  const files: AttachmentBuilder[] = [];
  if (render.image) {
    files.push(new AttachmentBuilder(render.image, { name: render.imageName }));
    embed.setImage(`attachment://${render.imageName}`);
  }
  return { embeds: [embed], files, components: render.components };
}

function armTimeout(session: MiniGameSession, timeoutMs: number): void {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => { void resolveTimeout(session.id); }, timeoutMs);
}

// Launch a mini-game on the caught card. Returns true if a game actually started
// (false → caller should grant the card normally, e.g. no game available).
export async function startMiniGame(opts: StartMiniGameOpts): Promise<boolean> {
  const game = pickGame(opts.selection);
  const session: MiniGameSession = {
    id: nanoid(10),
    guildId: opts.guildId,
    channelId: opts.channelId,
    userId: opts.userId,
    card: opts.card,
    rarityLabel: opts.rarityLabel,
    rarityColor: opts.rarityColor,
    cardArtUrl: opts.cardArtUrl,
    gameKey: game.key,
    animate: opts.animate,
    decoyArt: opts.decoyArt ?? [],
    logId: null,
    message: opts.spawnMessage,
    state: {},
    timer: null,
    resolved: false,
    onWin: opts.onWin,
    onLose: opts.onLose,
  };

  try {
    session.logId = await logMiniGameStart(opts.guildId, opts.channelId, opts.userId, opts.card.id, game.key);
    const render = await game.start(session);
    const { embeds, files, components } = payloadFor(render);
    // Take over the spawn message: it already showed the catch; now it becomes
    // the encounter. Clear the old reveal attachment first.
    await opts.spawnMessage.edit({ embeds, files, components, attachments: [] });
    sessions.set(session.id, session);
    armTimeout(session, game.timeoutMs);
    logger.info({ guildId: opts.guildId, userId: opts.userId, game: game.key }, "Wild mini-game started");
    return true;
  } catch (err) {
    logger.warn({ err, guildId: opts.guildId }, "startMiniGame failed — granting card normally");
    // If we couldn't even start, don't punish the catcher: grant the card.
    try { await opts.onWin(); } catch { /* already logged */ }
    return false;
  }
}

// Route a `mg:<sessionId>:<action>` button click.
export async function handleMiniGameInteraction(interaction: ButtonInteraction): Promise<void> {
  const [, sessionId, ...rest] = interaction.customId.split(":");
  const action = rest.join(":");
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session || session.resolved) {
    await interaction.reply({ content: "⌛ This encounter has already ended.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (interaction.user.id !== session.userId) {
    await interaction.reply({ content: "🚫 This isn't your encounter — you didn't catch this card.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const game = pickGameForSession(session);
  if (!game) {
    await interaction.reply({ content: "⚠️ This game is no longer available.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  // Stop the timeout while we process this action.
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }

  try {
    const outcome = await game.handle(session, action);
    const { embeds, files, components } = payloadFor(outcome.render);
    // Clear the previous frame's attachment before adding the new one so the
    // intro GIF and the result frame never stack on the message.
    await interaction.update({ embeds, files, components, attachments: [] });
    if (outcome.done) {
      await finalize(session, outcome.win);
    } else {
      // Still playing — re-arm the step timer.
      session.message = interaction.message as Message;
      armTimeout(session, game.timeoutMs);
    }
  } catch (err) {
    logger.warn({ err, sessionId }, "mini-game interaction failed");
    // On an unexpected error, don't strand the catcher — grant the card.
    await finalize(session, true).catch(() => {});
  }
}

async function resolveTimeout(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session || session.resolved) return;
  const game = pickGameForSession(session);
  try {
    const render = game ? await game.onTimeout(session) : null;
    if (render && session.message) {
      const { embeds, files, components } = payloadFor(render);
      await session.message.edit({ embeds, files, components, attachments: [] }).catch(() => {});
    }
  } catch (err) {
    logger.debug({ err, sessionId }, "mini-game timeout render failed");
  }
  await finalize(session, false, "timeout");
}

// Resolve a session: grant (win) or escape (lose), log, and re-arm the schedule.
async function finalize(session: MiniGameSession, win: boolean, logResult?: "timeout"): Promise<void> {
  if (session.resolved) return;
  session.resolved = true;
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }
  sessions.delete(session.id);

  await logMiniGameResolve(session.logId, logResult ?? (win ? "win" : "lose"));
  try {
    if (win) await session.onWin();
    else await session.onLose();
  } catch (err) {
    logger.warn({ err, sessionId: session.id }, "mini-game onWin/onLose callback failed");
  }
  await rearmAfterResolve(session.guildId).catch(() => {});
}

// The registry maps key → definition; a session stores its key, so we can look
// the definition back up without holding a function reference on the session.
function pickGameForSession(session: MiniGameSession) {
  return GAMES[session.gameKey];
}
