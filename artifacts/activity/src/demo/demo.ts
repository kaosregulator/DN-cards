// ─────────────────────────────────────────────────────────────────────────────
// Local demo harness (opt-in via `?demo`). Boots the REAL HqScene/Battle/Raid/
// Pack scenes with a mock world + generated placeholder textures, so the world,
// editor, camera and responsive HUD can be exercised WITHOUT Discord or the
// backend — used for desktop/mobile viewport testing. Never runs in the normal
// (Discord) path; it only activates when the URL contains `?demo`.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { CONTEXT_KEY, createContext } from "../core/context";
import { HqScene } from "../scenes/HqScene";
import { BattleScene } from "../scenes/BattleScene";
import { RaidScene } from "../scenes/RaidScene";
import { PackScene } from "../scenes/PackScene";
import type { HqWorld, CatalogAsset } from "../net/api";

export function isDemo(): boolean {
  return typeof location !== "undefined" && /(?:\?|&)demo\b/.test(location.search);
}

function mockCatalog(): CatalogAsset[] {
  const mk = (id: string, name: string, sprite: string, category: string, w = 1, h = 1): CatalogAsset =>
    ({ id, name, sprite, category, footprint: { w, h }, rotatable: true, unlock: "always", owned: true });
  return [
    mk("wall-stone", "Stone Wall", "roomwall/plain", "structure"),
    mk("door", "Door", "roomwall/door", "door"),
    mk("command-rug", "Command Rug", "deco/command-rug", "rug", 2, 2),
    mk("briefing-table", "Briefing Table", "deco/table-short-chairs", "table", 2, 1),
    mk("chair", "Chair", "deco/chair", "seating"),
    mk("supply-crate", "Supply Crate", "deco/supply-crate", "storage"),
    mk("treasure-chest", "Treasure Chest", "deco/treasure-chest", "storage"),
    mk("yard-tree", "Pine Tree", "deco/yard-tree", "nature"),
    mk("yard-rock", "Boulder", "deco/yard-rock", "nature"),
    mk("npc-aide", "Aide", "deco/npc-aide", "npc"),
    mk("figure-knight", "Knight", "deco/figure-knight", "npc"),
    mk("sovereign-crown", "Crown", "deco/sovereign-crown", "trophy"),
  ];
}

function mockWorld(): HqWorld {
  return {
    worldTiles: 40,
    ground: "base/square-grass",
    user: { id: "demo", username: "Demo Commander" },
    hq: { level: 7, themeId: "command", shards: 12500 },
    shield: { active: true, strength: 75 },
    rooms: [
      { id: "entrance", name: "Command Center", emoji: "🎛️", kind: "command", category: "military" },
      { id: "trophy-hall", name: "Trophy Hall", emoji: "🏆", kind: "trophy", category: "decorative" },
    ],
    floors: [
      { id: "stone", name: "Stone", sprite: "base/square-stone" },
      { id: "wood", name: "Wood", sprite: "base/square-wood" },
      { id: "marble", name: "Marble", sprite: "base/square-stone-detail" },
      { id: "slate", name: "Slate", sprite: "base/square-stone-high" },
      { id: "grass", name: "Grass", sprite: "base/square-grass" },
    ],
    catalog: mockCatalog(),
    layout: {
      version: 1,
      rooms: [
        { id: "r-command", roomId: "entrance", x: 12, y: 8, w: 9, h: 9, floorId: "marble" },
        { id: "r-armory", roomId: "trophy-hall", x: 23, y: 9, w: 7, h: 7, floorId: "wood" },
      ],
      objects: [
        { uid: "o1", assetId: "command-rug", x: 15, y: 11, rot: 0 },
        { uid: "o2", assetId: "briefing-table", x: 15, y: 11, rot: 0 },
        { uid: "o3", assetId: "chair", x: 14, y: 11, rot: 1 },
        { uid: "o4", assetId: "figure-knight", x: 13, y: 9, rot: 0 },
        { uid: "o5", assetId: "npc-aide", x: 18, y: 14, rot: 0 },
        { uid: "o6", assetId: "supply-crate", x: 24, y: 11, rot: 0 },
        { uid: "o7", assetId: "treasure-chest", x: 26, y: 12, rot: 0 },
        { uid: "o8", assetId: "sovereign-crown", x: 25, y: 10, rot: 0 },
        { uid: "o9", assetId: "yard-tree", x: 6, y: 10, rot: 0 },
        { uid: "o10", assetId: "yard-rock", x: 5, y: 16, rot: 0 },
      ],
    },
    revision: 1,
  };
}

// Deterministic colour from a key so placeholders are stable + distinguishable.
function keyColor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  return Phaser.Display.Color.HSVToRGB(hue / 360, 0.45, 0.85).color;
}

// Draw a placeholder that matches the real pack's geometry (256×512, tile
// diamond low, object rising above) so anchoring/depth read correctly.
function generatePlaceholder(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const W = 256, H = 512, cx = 128, baseY = 448, dw = 210, dh = 104;
  const color = keyColor(key);
  const isTile = key.startsWith("base/") || key.startsWith("floor");
  // tile diamond
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(cx, baseY - dh / 2);
  g.lineTo(cx + dw / 2, baseY);
  g.lineTo(cx, baseY + dh / 2);
  g.lineTo(cx - dw / 2, baseY);
  g.closePath();
  g.fillPath();
  g.lineStyle(3, 0x000000, 0.18);
  g.strokePath();
  if (!isTile) {
    // an object body rising from the tile
    const bh = 150;
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(12).color, 1);
    g.fillRoundedRect(cx - 46, baseY - bh, 92, bh, 12);
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(cx - 46, baseY - bh, 92, 26, 12);
  }
  g.generateTexture(key, W, H);
  g.destroy();
}

class DemoLauncher extends Phaser.Scene {
  constructor() {
    super("DemoLauncher");
  }
  create(): void {
    this.scene.start("Hq", { world: mockWorld() });
  }
}

export function startDemo(): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0b0f1a",
    input: { activePointers: 3, smoothFactor: 0.2 },
    scale: {
      mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: "100%", height: "100%",
    },
    scene: [DemoLauncher, HqScene, BattleScene, RaidScene, PackScene],
  });

  const ctx = createContext({ accessToken: "demo", inDiscord: false }, game.events);
  // Replace the asset manager with a placeholder generator (no network).
  ctx.assets.ensure = async (scene: Phaser.Scene, keys: string[]) => {
    for (const k of keys) generatePlaceholder(scene, k);
  };
  ctx.assets.urlFor = () => null;
  ctx.assets.has = () => true;
  // Battle/Raid/Pack call the API; stub those to mock data so the demo nav works.
  ctx.api.battle = async () => ({
    backdrops: [], player: [{ name: "Patriot", rarity: "Legendary", color: 0xffb020, hp: 1200, atk: 140, sprite: "deco/figure-knight" }],
    opponent: [{ name: "Marauder", rarity: "Epic", color: 0xb060ff, hp: 1150, atk: 145, sprite: "deco/figure-ranger" }],
  });
  ctx.api.raid = async () => ({
    backdrops: [],
    bosses: [
      { id: 1, name: "Gate Warden", rarity: "epic", color: 0xb060ff, maxHealth: 6000, enrageTurn: 8, sprite: "building/keep", defeated: true },
      { id: 2, name: "Iron Colossus", rarity: "mythic", color: 0xff2d92, maxHealth: 9000, enrageTurn: 6, sprite: "building/castle", defeated: false },
    ],
    progress: { defeated: 1, total: 2, nextName: "Iron Colossus", complete: false },
    team: [{ name: "Patriot", rarity: "Legendary", color: 0xffb020, hp: 1200, atk: 140, sprite: "deco/figure-knight" }],
  });
  ctx.api.packs = async () => ({
    tiers: [
      { id: "basic", label: "Basic", cost: 250, size: 5, emoji: "🥉" },
      { id: "premium", label: "Premium", cost: 750, size: 5, emoji: "🥈" },
      { id: "legendary", label: "Legendary", cost: 2000, size: 5, emoji: "🥇" },
    ],
    rarities: [
      { key: "common", label: "Common", color: 0x9aa4b2, weight: 60 },
      { key: "rare", label: "Rare", color: 0x3b82f6, weight: 25 },
      { key: "epic", label: "Epic", color: 0xa855f7, weight: 10 },
      { key: "legendary", label: "Legendary", color: 0xf59e0b, weight: 5 },
    ],
  });
  ctx.api.saveLayout = async (layout) => ({ ok: true, layout, revision: 2 });

  game.registry.set(CONTEXT_KEY, ctx);
  return game;
}
