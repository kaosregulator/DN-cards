import Phaser from "phaser";
import { CONTEXT_KEY, createContext } from "./context";
import type { DiscordSession } from "../discord/sdk";
import { BootScene } from "../scenes/BootScene";
import { MenuScene } from "../scenes/MenuScene";
import { DuelScene } from "../scenes/DuelScene";
import { WorldScene } from "../scenes/WorldScene";

// Core Game Runtime bootstrap. Creates ONE Phaser 4 game hosting every
// experience as a scene:
//   Boot  → loads the real player snapshot
//   Menu  → choose the duel or the open world
//   Duel  → the true Yu-Gi-Oh style duel (real cards, real art)
//   World → top-down Battle City exploration + duelist challenges
// The shared GameContext is placed in the registry before the first scene runs.
export function startGame(session: DiscordSession): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0a0d16",
    // Multi-touch: mouse + up to two fingers so on-screen controls and taps work
    // on phones inside Discord.
    input: { activePointers: 3, smoothFactor: 0.2 },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: "100%",
      height: "100%",
    },
    scene: [BootScene, MenuScene, DuelScene, WorldScene],
  });

  const ctx = createContext(session, game.events);
  game.registry.set(CONTEXT_KEY, ctx);

  return game;
}
