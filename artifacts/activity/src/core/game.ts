import Phaser from "phaser";
import { CONTEXT_KEY, createContext } from "./context";
import type { DiscordSession } from "../discord/sdk";
import { BootScene } from "../scenes/BootScene";
import { HandshakeScene } from "../scenes/HandshakeScene";
import { HqScene } from "../scenes/HqScene";
import { BattleScene } from "../scenes/BattleScene";
import { RaidScene } from "../scenes/RaidScene";
import { PackScene } from "../scenes/PackScene";

// Core Game Runtime bootstrap. Creates ONE Phaser game that hosts every
// experience as a scene (Phase 1 ships Boot + Handshake; HQ / Battle / Raid /
// Pack scenes register here in later phases). The shared GameContext is placed
// in the registry before the first scene runs so scenes can rely on it.
export function startGame(session: DiscordSession): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0b0f1a",
    // Multi-touch: mouse + up to two fingers, so pinch-to-zoom and two-finger
    // pan work on phones inside Discord.
    input: { activePointers: 3, smoothFactor: 0.2 },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: "100%",
      height: "100%",
    },
    // No physics/heavy plugins yet — HQ world systems opt in when they land.
    scene: [BootScene, HandshakeScene, HqScene, BattleScene, RaidScene, PackScene],
  });

  const ctx = createContext(session, game.events);
  game.registry.set(CONTEXT_KEY, ctx);

  return game;
}
