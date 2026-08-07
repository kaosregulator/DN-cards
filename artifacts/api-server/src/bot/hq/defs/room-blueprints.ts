// ─────────────────────────────────────────────────────────────────────────────
// HQ — furnished room blueprints.
//
// Every room tells a story through furniture. Empty rooms with bare tiles are
 // not acceptable — when a player has few/no placements, the renderer merges
 // these blueprint props so the room still reads as a lived-in space.
 // ─────────────────────────────────────────────────────────────────────────────

import { HQ_GRID } from "../grid.js";
import type { PropKind } from "../props.js";
import type { DecoCategory } from "./decorations.js";

const WALL_SLOT_BASE = 100;
function floorSlot(gx: number, gy: number): number { return gy * HQ_GRID + gx; }
function wallSlot(i: number): number { return WALL_SLOT_BASE + i; }

export interface BlueprintProp {
  /** Floor tile (gx,gy) or wall anchor index when `wall` is true. */
  gx: number;
  gy: number;
  wall?: boolean;
  wallIndex?: number;
  kind: PropKind;
  /** Display name for tooltips / debug. */
  name: string;
  tint?: number;
  scale?: number;
  seed?: number;
}

/** Dense default furniture layout per room id. */
export function roomBlueprint(roomId: string): BlueprintProp[] {
  switch (roomId) {
    case "entrance": return commandCenter();
    case "trophy-hall": return trophyHall();
    case "atrium": return researchLab();
    case "hall-of-fame": return warRoom();
    case "armory": return armory();
    case "barracks": return barracks();
    case "treasury": return treasury();
    case "workshop": return workshop();
    case "storage": return storageRoom();
    case "arcane-vault": return arcaneVault();
    case "hallway": return hallway();
    default: return roomId.startsWith("hallway") ? hallway() : commandCenter();
  }
}

function hallway(): BlueprintProp[] {
  return [
    { gx: 2, gy: 3, kind: "lamp", name: "Hall Lamp", tint: 0xf0c060, scale: 0.85 },
    { gx: 5, gy: 3, kind: "plant", name: "Hall Plant", scale: 0.8 },
    { gx: 3, gy: 4, kind: "rug", name: "Runner", tint: 0x5a3a2a, scale: 0.9 },
  ];
}

function commandCenter(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Command Rug", tint: 0x8b1e2d, scale: 1.15 },
    { gx: 3, gy: 4, kind: "table", name: "Strategy Table", scale: 1.2 },
    { gx: 1, gy: 5, kind: "couch", name: "Briefing Sofa", tint: 0x8b1e2d },
    { gx: 5, gy: 5, kind: "chair", name: "Officer Chair", tint: 0x8b1e2d },
    { gx: 6, gy: 2, kind: "bookshelf", name: "Ops Shelves" },
    { gx: 1, gy: 2, kind: "cabinet", name: "Comms Cabinet" },
    { gx: 6, gy: 5, kind: "lamp", name: "Floor Lamp", tint: 0xf0c060 },
    { gx: 2, gy: 1, kind: "banner", name: "House Banner", tint: 0xc0392b, scale: 0.95 },
    { gx: 5, gy: 1, kind: "banner", name: "War Banner", tint: 0x3f78c8, scale: 0.95 },
    { gx: 4, gy: 6, kind: "plant", name: "Corner Fern" },
    { gx: 0, gy: 4, kind: "npc", name: "Aide", seed: 1 },
    { gx: 6, gy: 6, kind: "npc", name: "Scout", seed: 2 },
    { wall: true, wallIndex: 0, gx: 0, gy: 0, kind: "banner", name: "Wall Banner", tint: 0xc0392b },
    { wall: true, wallIndex: 3, gx: 0, gy: 0, kind: "emblem", name: "Crest", tint: 0xd4af37 },
  ];
}

function trophyHall(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Hall Runner", tint: 0x6b2d8b, scale: 1.2 },
    { gx: 1, gy: 2, kind: "trophy", name: "Gold Cup", tint: 0xd4af37 },
    { gx: 5, gy: 2, kind: "trophy", name: "Silver Cup", tint: 0xc0c8d0 },
    { gx: 2, gy: 5, kind: "statue", name: "Champion Bust", tint: 0xd0c8b8 },
    { gx: 5, gy: 5, kind: "statue", name: "Hero Bust", tint: 0xd0c8b8 },
    { gx: 6, gy: 3, kind: "case", name: "Display Case", tint: 0xd4af37 },
    { gx: 0, gy: 3, kind: "case", name: "Relic Case", tint: 0xd4af37 },
    { gx: 3, gy: 6, kind: "plant", name: "Palm" },
    { gx: 4, gy: 1, kind: "lamp", name: "Spotlight", tint: 0xffe080 },
    { wall: true, wallIndex: 1, gx: 0, gy: 0, kind: "banner", name: "Victory Banner", tint: 0xd4af37 },
    { wall: true, wallIndex: 4, gx: 0, gy: 0, kind: "emblem", name: "Laurels", tint: 0x2ecc71 },
  ];
}

function researchLab(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Lab Mat", tint: 0x2a5a6a },
    { gx: 2, gy: 3, kind: "table", name: "Workbench", scale: 1.1 },
    { gx: 5, gy: 3, kind: "table", name: "Analysis Desk" },
    { gx: 1, gy: 1, kind: "bookshelf", name: "Codex Shelves" },
    { gx: 6, gy: 1, kind: "bookshelf", name: "Sample Shelves" },
    { gx: 6, gy: 5, kind: "crystal", name: "Sample Crystal", tint: 0x50d0ff },
    { gx: 1, gy: 5, kind: "cabinet", name: "Reagent Cabinet" },
    { gx: 4, gy: 5, kind: "chair", name: "Lab Stool", tint: 0x4a6a7a },
    { gx: 3, gy: 6, kind: "lamp", name: "Arc Lamp", tint: 0x70e0ff },
    { gx: 5, gy: 6, kind: "npc", name: "Researcher", seed: 3 },
    { wall: true, wallIndex: 2, gx: 0, gy: 0, kind: "emblem", name: "Research Seal", tint: 0x2fd4d4 },
  ];
}

function warRoom(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "War Rug", tint: 0x5a1a1a, scale: 1.15 },
    { gx: 3, gy: 4, kind: "table", name: "War Table", scale: 1.25 },
    { gx: 1, gy: 5, kind: "chair", name: "General Chair", tint: 0x8b1e2d },
    { gx: 5, gy: 5, kind: "chair", name: "Captain Chair", tint: 0x8b1e2d },
    { gx: 6, gy: 2, kind: "weapon-rack", name: "Arm Rack" },
    { gx: 1, gy: 2, kind: "banner", name: "Legion Banner", tint: 0xc0392b },
    { gx: 5, gy: 1, kind: "banner", name: "Scout Banner", tint: 0x3f78c8 },
    { gx: 0, gy: 4, kind: "cabinet", name: "Maps Cabinet" },
    { gx: 6, gy: 6, kind: "npc", name: "Strategist", seed: 4 },
    { gx: 2, gy: 6, kind: "lamp", name: "War Lamp", tint: 0xff9030 },
    { wall: true, wallIndex: 0, gx: 0, gy: 0, kind: "banner", name: "Wall Standard", tint: 0xc0392b },
  ];
}

function armory(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Armory Mat", tint: 0x4a4a4a },
    { gx: 1, gy: 2, kind: "weapon-rack", name: "Sword Rack" },
    { gx: 5, gy: 2, kind: "weapon-rack", name: "Spear Rack" },
    { gx: 1, gy: 5, kind: "weapon-rack", name: "Axe Rack" },
    { gx: 5, gy: 5, kind: "chest", name: "Armor Chest", tint: 0xc0392b },
    { gx: 3, gy: 5, kind: "table", name: "Polish Bench" },
    { gx: 6, gy: 3, kind: "statue", name: "Guardian", tint: 0xa0a8b0 },
    { gx: 3, gy: 1, kind: "banner", name: "Armory Banner", tint: 0x8b7355 },
    { gx: 4, gy: 6, kind: "npc", name: "Smith", seed: 5 },
    { wall: true, wallIndex: 5, gx: 0, gy: 0, kind: "emblem", name: "Steel Crest", tint: 0x95a5a6 },
  ];
}

function barracks(): BlueprintProp[] {
  return [
    { gx: 1, gy: 2, kind: "bed", name: "Bunk A", tint: 0x3a5a8b },
    { gx: 4, gy: 2, kind: "bed", name: "Bunk B", tint: 0x3a5a8b },
    { gx: 1, gy: 5, kind: "bed", name: "Bunk C", tint: 0x8b3a3a },
    { gx: 4, gy: 5, kind: "bed", name: "Bunk D", tint: 0x8b3a3a },
    { gx: 6, gy: 3, kind: "chest", name: "Footlocker", tint: 0x8a6a3f },
    { gx: 3, gy: 3, kind: "rug", name: "Barracks Rug", tint: 0x5a6a4a },
    { gx: 6, gy: 1, kind: "weapon-rack", name: "Ready Rack" },
    { gx: 6, gy: 6, kind: "npc", name: "Recruit", seed: 1 },
    { gx: 2, gy: 6, kind: "npc", name: "Sergeant", seed: 2 },
    { gx: 0, gy: 3, kind: "lamp", name: "Bunk Lamp", tint: 0xf0c060 },
  ];
}

function treasury(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Vault Rug", tint: 0xd4af37, scale: 1.1 },
    { gx: 2, gy: 2, kind: "chest", name: "Gold Chest", tint: 0xd4af37 },
    { gx: 4, gy: 2, kind: "chest", name: "Shard Chest", tint: 0x50d0ff },
    { gx: 2, gy: 5, kind: "chest", name: "Gem Chest", tint: 0x9b59b6 },
    { gx: 4, gy: 5, kind: "crystal", name: "Hoard Crystal", tint: 0xd4af37, scale: 1.15 },
    { gx: 6, gy: 3, kind: "cabinet", name: "Ledger Cabinet" },
    { gx: 0, gy: 3, kind: "statue", name: "Wealth Idol", tint: 0xd4af37 },
    { gx: 3, gy: 6, kind: "lamp", name: "Vault Lamp", tint: 0xffe080 },
    { gx: 5, gy: 6, kind: "npc", name: "Treasurer", seed: 3 },
    { wall: true, wallIndex: 1, gx: 0, gy: 0, kind: "emblem", name: "Coin Seal", tint: 0xd4af37 },
  ];
}

function workshop(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "table", name: "Craft Bench", scale: 1.2 },
    { gx: 1, gy: 2, kind: "chest", name: "Parts Crate", tint: 0x8a6a3f },
    { gx: 5, gy: 2, kind: "chest", name: "Scrap Barrel", tint: 0x6b4f2c },
    { gx: 1, gy: 5, kind: "cabinet", name: "Tool Cabinet" },
    { gx: 5, gy: 5, kind: "bookshelf", name: "Blueprint Shelf" },
    { gx: 6, gy: 3, kind: "lamp", name: "Work Lamp", tint: 0xff9030 },
    { gx: 3, gy: 5, kind: "chair", name: "Stool", tint: 0x6b4f2c },
    { gx: 0, gy: 4, kind: "weapon-rack", name: "Tool Rack" },
    { gx: 4, gy: 6, kind: "npc", name: "Artisan", seed: 4 },
    { gx: 2, gy: 1, kind: "plant", name: "Oil Plant" },
  ];
}

function storageRoom(): BlueprintProp[] {
  return [
    { gx: 1, gy: 1, kind: "chest", name: "Crate Stack", tint: 0x8a6a3f },
    { gx: 3, gy: 1, kind: "chest", name: "Barrels", tint: 0x6b4f2c },
    { gx: 5, gy: 1, kind: "chest", name: "Supply Chests", tint: 0x8a6a3f },
    { gx: 1, gy: 4, kind: "chest", name: "Grain Sacks", tint: 0xc4a06a },
    { gx: 5, gy: 4, kind: "cabinet", name: "Spare Cabinet" },
    { gx: 3, gy: 4, kind: "rug", name: "Warehouse Mat", tint: 0x6a5a4a },
    { gx: 6, gy: 5, kind: "lamp", name: "Store Lamp", tint: 0xf0c060 },
    { gx: 2, gy: 6, kind: "npc", name: "Quartermaster", seed: 5 },
    { gx: 6, gy: 2, kind: "bookshelf", name: "Inventory Logs" },
  ];
}

function arcaneVault(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Rune Circle", tint: 0x6a3a9b, scale: 1.2 },
    { gx: 3, gy: 4, kind: "crystal", name: "Focus Crystal", tint: 0xb06bff, scale: 1.25 },
    { gx: 1, gy: 2, kind: "bookshelf", name: "Grimoires" },
    { gx: 5, gy: 2, kind: "bookshelf", name: "Scrolls" },
    { gx: 1, gy: 5, kind: "lamp", name: "Ward Lamp", tint: 0xb06bff },
    { gx: 5, gy: 5, kind: "lamp", name: "Ward Lamp", tint: 0x70e0ff },
    { gx: 6, gy: 3, kind: "statue", name: "Familiar", tint: 0x9b59b6 },
    { gx: 0, gy: 3, kind: "cabinet", name: "Relic Cabinet" },
    { gx: 4, gy: 6, kind: "npc", name: "Arcanist", seed: 3 },
    { gx: 2, gy: 1, kind: "banner", name: "Arcane Banner", tint: 0x9b59b6 },
    { wall: true, wallIndex: 2, gx: 0, gy: 0, kind: "emblem", name: "Rune Seal", tint: 0xb06bff },
  ];
}

/** Convert blueprint props into render-slot decorations (virtual — not persisted). */
export function blueprintAsDecos(
  roomId: string,
  occupiedSlots: Set<number>,
): Array<{
  slot: number;
  category: DecoCategory;
  name: string;
  rarityColor: number;
  spritePath: string | null;
  propKind: PropKind;
  scale?: number;
  seed?: number;
}> {
  const out: Array<{
    slot: number;
    category: DecoCategory;
    name: string;
    rarityColor: number;
    spritePath: string | null;
    propKind: PropKind;
    scale?: number;
    seed?: number;
  }> = [];
  for (const p of roomBlueprint(roomId)) {
    const slot = p.wall
      ? wallSlot(p.wallIndex ?? 0)
      : floorSlot(p.gx, p.gy);
    if (occupiedSlots.has(slot)) continue;
    out.push({
      slot,
      category: categoryForProp(p.kind),
      name: p.name,
      rarityColor: p.tint ?? 0xc0392b,
      spritePath: null,
      propKind: p.kind,
      scale: p.scale,
      seed: p.seed,
    });
  }
  return out;
}

function categoryForProp(kind: PropKind): DecoCategory {
  switch (kind) {
    case "rug": return "rug";
    case "plant": case "flowers": return "plant";
    case "banner": return "banner";
    case "statue": case "couch": case "chair": case "table": case "bed":
    case "npc": case "fireplace": case "weapon-rack": case "bookshelf":
    case "cabinet": return "statue";
    case "trophy": return "trophy";
    case "monument": return "monument";
    case "lamp": return "light";
    case "chest": case "case": return "case";
    case "crystal": return "crystal";
    case "emblem": return "emblem";
    case "tree": return "tree";
    case "rock": return "rock";
    case "fence": return "fence";
    case "path": return "path";
    default: return "statue";
  }
}
