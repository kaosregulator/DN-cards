// ─────────────────────────────────────────────────────────────────────────────
// Wild Mini-Games — shared types.
//
// A mini-game is a short, single-player encounter that stands between "the user
// caught a card" and "the card is granted". Each game implements the
// MiniGameDefinition template, so adding a new game is a drop-in file under
// ./games. The manager (manager.ts) owns the session lifecycle and calls these
// hooks; the games themselves stay pure UI + resolution logic.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionRowBuilder, ButtonBuilder, Message } from "discord.js";
import type { Card } from "@workspace/db";

// Every implemented game key. The admin's `miniGameSelection` is either
// "shuffle" or one of these.
export type GameKey =
  | "reaction" | "choose" | "dice" | "aim" | "code"
  | "chase" | "memory" | "battle" | "puzzle" | "map"
  | "radar" | "mission" | "crate" | "firstreact" | "auction";

// Rendered screen (embed + optional canvas attachment) for a game step.
export interface MiniGameRender {
  // Markdown for the embed description (fallback text when the canvas is null).
  description: string;
  title: string;
  color: number;
  // Optional canvas image (PNG or animated GIF). Best-effort — null just means
  // the embed renders without an image, exactly like every other canvas here.
  image: Buffer | null;
  imageName: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

// A live mini-game session. Mutable `state` is owned by the individual game.
export interface MiniGameSession {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  card: Card;
  rarityLabel: string;
  rarityColor: number;
  cardArtUrl: string | null;
  gameKey: GameKey;
  animate: boolean;
  // "encounter" = the Pokémon-style wild opener + joke menu is showing;
  // "playing" = the actual game is running. The opener transitions to the game
  // on any menu click (or on encounter timeout).
  phase: "encounter" | "playing";
  // The catcher's Discord avatar URL, drawn into the wild-encounter intro.
  avatarUrl: string | null;
  // Real card art from the guild pool (excludes the caught card) — used by games
  // that show decoy/other cards (Memory Match, Choose-a-Card). May be empty.
  decoyArt: { name: string; url: string | null }[];
  logId: number | null;
  message: Message | null;
  // Per-game scratch state (answer index, roll target, sequence, …).
  state: Record<string, unknown>;
  // Step-timeout timer — cleared/rearmed by the manager on each interaction.
  timer: ReturnType<typeof setTimeout> | null;
  resolved: boolean;
  onWin: () => Promise<void>;
  onLose: () => Promise<void>;
}

// The outcome a game returns from an interaction or timeout.
export type MiniGameOutcome =
  | { done: false; render: MiniGameRender }        // keep playing (re-render)
  | { done: true; win: boolean; render: MiniGameRender };

// The template every game implements.
export interface MiniGameDefinition {
  key: GameKey;
  name: string;
  // Human blurb shown in the admin panel game picker.
  blurb: string;
  // Called once when the game starts: seed session.state and return the opening
  // screen (intro/menu + first interactive components).
  start(session: MiniGameSession): Promise<MiniGameRender> | MiniGameRender;
  // Called on each button click for this session. `action` is the trailing part
  // of the customId after `mg:<sessionId>:`.
  handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> | MiniGameOutcome;
  // Called when the step timer expires with no valid action → the card escapes.
  onTimeout(session: MiniGameSession): Promise<MiniGameRender> | MiniGameRender;
  // How long (ms) the player has to act before the encounter times out.
  timeoutMs: number;
}
