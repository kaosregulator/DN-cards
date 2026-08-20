import Phaser from "phaser";
import { CONTEXT_KEY, createContext } from "./context";
import type { DiscordSession } from "../discord/sdk";
import { BootScene } from "../scenes/BootScene";
import { MenuScene } from "../scenes/MenuScene";
import { DuelScene } from "../scenes/DuelScene";
import { WorldScene } from "../scenes/WorldScene";
import { ShopScene } from "../scenes/ShopScene";
import { MatchmakingScene } from "../scenes/MatchmakingScene";

// Core Game Runtime bootstrap. Creates ONE Phaser 4 game hosting every
// experience as a scene:
//   Boot  → loads the real player snapshot
//   Menu  → title screen: adventure, duel, PvP, 3D world
//   World → tile-based overworld (rooms, doors, NPCs, duelist encounters)
//   Shop  → the Card Shop counter screen (browse the server's real cards)
//   Matchmaking → finds an online opponent
//   Duel  → the true Yu-Gi-Oh style duel (real cards, real art)
// The shared GameContext is placed in the registry before the first scene runs.
export function startGame(session: DiscordSession): Phaser.Game {
  const coarse =
    (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0a0d16",
    pixelArt: true,
    // Cap FPS on phones/tablets so thermal throttling doesn't tank input latency.
    fps: { target: coarse ? 50 : 60, smoothStep: true },
    render: {
      antialias: false,
      powerPreference: coarse ? "high-performance" : "default",
      roundPixels: true,
      // Prefer a desynchronized canvas when available — lower input lag on Safari/Chrome.
      desynchronized: true,
    },
    // Multi-touch: mouse + up to two fingers so on-screen controls and taps work
    // on phones / iPads / Android tablets inside Discord. Lower smoothFactor on
    // touch so taps register closer to the finger instead of lagging behind.
    input: { activePointers: 3, smoothFactor: coarse ? 0 : 0.15 },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: "100%",
      height: "100%",
    },
    // Arcade physics drives the tile-based overworld (movement + tile collisions).
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false, fps: coarse ? 50 : 60 } },
    scene: [BootScene, MenuScene, WorldScene, ShopScene, MatchmakingScene, DuelScene],
  });

  const ctx = createContext(session, game.events);
  game.registry.set(CONTEXT_KEY, ctx);

  return game;
}
