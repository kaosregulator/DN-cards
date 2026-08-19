import Phaser from "phaser";
import { CONTEXT_KEY, createContext } from "./context";
import type { DiscordSession } from "../discord/sdk";
import { BootScene } from "../scenes/BootScene";
import { MenuScene } from "../scenes/MenuScene";
import { DuelScene } from "../scenes/DuelScene";
import { WorldScene } from "../scenes/WorldScene";
import { ShopScene } from "../scenes/ShopScene";
import { MatchmakingScene } from "../scenes/MatchmakingScene";
import { CityScene } from "../scenes/CityScene";
import { InteriorScene } from "../scenes/InteriorScene";

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
    scene: [BootScene, MenuScene, CityScene, InteriorScene, WorldScene, ShopScene, MatchmakingScene, DuelScene],
  });

  const ctx = createContext(session, game.events);
  game.registry.set(CONTEXT_KEY, ctx);

  return game;
}
