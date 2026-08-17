// ─────────────────────────────────────────────────────────────────────────────
// Local demo harness (opt-in via `?demo`). Boots the new Menu / Duel / World
// scenes with a MOCK duel deck and no Discord/backend, so the board, the world,
// touch controls and the responsive HUD can be exercised on desktop and mobile
// viewports. Never runs in the normal (Discord) path — only when the URL has
// `?demo`. Append `?demo=duel` to jump straight into a duel.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { CONTEXT_KEY, createContext } from "../core/context";
import { MenuScene } from "../scenes/MenuScene";
import { DuelScene } from "../scenes/DuelScene";
import { WorldScene } from "../scenes/WorldScene";
import type { DuelSetup, DuelCard, DuelAttribute } from "../duel/types";

export function isDemo(): boolean {
  return typeof location !== "undefined" && /(?:\?|&)demo\b/.test(location.search);
}

const ATTRS: DuelAttribute[] = ["EARTH", "WIND", "WATER", "FIRE", "LIGHT", "DARK"];
const NAMES = [
  "Steel Vanguard", "Ashen Ranger", "Storm Reaver", "Iron Colossus", "Night Stalker",
  "Solar Paladin", "Frost Wyrm", "Blaze Trooper", "Void Sentinel", "Thunder Ace",
];

function mockMonster(i: number): DuelCard {
  const level = 1 + (i % 8);
  const atk = 800 + level * 220;
  return {
    uid: `demo-m${i}`, cardId: null, name: NAMES[i % NAMES.length]!, kind: "monster",
    art: null, rarity: "Common", color: 0xcaa24a, attribute: ATTRS[i % ATTRS.length]!,
    level, atk, def: Math.round(atk * 0.8),
    desc: "A mock unit for local testing.",
    effect: level >= 6 ? { kind: "pierce" } : (i % 3 === 0 ? { kind: "gainAtk", amount: 300 } : null),
  };
}
function mockDeck(): DuelCard[] {
  const d: DuelCard[] = [];
  for (let i = 0; i < 34; i++) d.push({ ...mockMonster(i), uid: `demo-${Math.random()}` });
  d.push({ uid: "s1", cardId: null, name: "Card of Fortune", kind: "spell", art: null, rarity: "Spell", color: 0x1e9e5a, attribute: "DIVINE", level: 0, atk: 0, def: 0, desc: "Draw 2.", effect: { kind: "spell:draw", count: 2 } });
  d.push({ uid: "t1", cardId: null, name: "Mirror Barrier", kind: "trap", art: null, rarity: "Trap", color: 0x8a2be2, attribute: "DIVINE", level: 0, atk: 0, def: 0, desc: "Destroy attackers.", effect: { kind: "trap:mirror" } });
  return d;
}
function mockSetup(): DuelSetup {
  return {
    startingLp: 8000, handSize: 5,
    player: { name: "Demo Duelist", deck: mockDeck() },
    opponent: { name: "Rival Kaiser", deck: mockDeck() },
  };
}

class DemoLauncher extends Phaser.Scene {
  constructor() { super("DemoLauncher"); }
  create(): void {
    if (/demo=pvp/.test(location.search)) this.scene.start("Duel", { setup: { ...mockSetup(), player: { name: "Player 1", deck: mockDeck() }, opponent: { name: "Player 2", deck: mockDeck() } }, returnTo: "Menu", pvp: true });
    else if (/demo=duel/.test(location.search)) this.scene.start("Duel", { setup: mockSetup(), returnTo: "Menu" });
    else if (/demo=world/.test(location.search)) this.scene.start("World");
    else this.scene.start("Menu");
  }
}

export function startDemo(): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0a0d16",
    input: { activePointers: 3, smoothFactor: 0.2 },
    scale: {
      mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: "100%", height: "100%",
    },
    scene: [DemoLauncher, MenuScene, DuelScene, WorldScene],
  });

  const ctx = createContext({ accessToken: "demo", inDiscord: false }, game.events);
  // Serve the mock duel setup instead of hitting the backend.
  ctx.api.duel = async () => mockSetup();
  ctx.api.cardArtUrl = () => "";

  game.registry.set(CONTEXT_KEY, ctx);
  return game;
}
