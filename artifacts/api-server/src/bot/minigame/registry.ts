// Registry of all implemented Wild Mini-Games. Adding a game = import its
// definition and drop it in GAMES; the admin picker and shuffle read from here.

import type { GameKey, MiniGameDefinition } from "./types.js";
import { reactionGame } from "./games/reaction.js";
import { chooseCardGame } from "./games/choose-card.js";
import { diceGame } from "./games/dice.js";
import { aimGame } from "./games/aim-radar.js";
import { codeBreakGame } from "./games/code-break.js";
import { chaseGame } from "./games/chase.js";
import { memoryGame } from "./games/memory.js";
import { battleGame } from "./games/battle-to-claim.js";
import { puzzleGame } from "./games/puzzle.js";
import { mapGame } from "./games/map.js";
import { radarGame } from "./games/radar-scan.js";
import { missionGame } from "./games/mission.js";
import { crateGame } from "./games/mystery-crate.js";
import { firstReactGame } from "./games/first-to-react.js";
import { auctionGame } from "./games/auction.js";

export const GAMES: Record<GameKey, MiniGameDefinition> = {
  reaction: reactionGame,
  choose: chooseCardGame,
  dice: diceGame,
  aim: aimGame,
  code: codeBreakGame,
  chase: chaseGame,
  memory: memoryGame,
  battle: battleGame,
  puzzle: puzzleGame,
  map: mapGame,
  radar: radarGame,
  mission: missionGame,
  crate: crateGame,
  firstreact: firstReactGame,
  auction: auctionGame,
};

export const GAME_KEYS = Object.keys(GAMES) as GameKey[];

export function isGameKey(v: string): v is GameKey {
  return Object.prototype.hasOwnProperty.call(GAMES, v);
}

// Resolve the admin's selection ("shuffle" or a specific key) to a concrete
// game. Unknown keys fall back to shuffle so a removed game never wedges a spawn.
export function pickGame(selection: string): MiniGameDefinition {
  if (selection !== "shuffle" && isGameKey(selection)) return GAMES[selection];
  const key = GAME_KEYS[Math.floor(Math.random() * GAME_KEYS.length)]!;
  return GAMES[key];
}
