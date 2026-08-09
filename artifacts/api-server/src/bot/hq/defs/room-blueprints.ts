// ─────────────────────────────────────────────────────────────────────────────
// HQ — furnished room blueprints.
//
// Every room tells a story through furniture. Empty rooms with bare tiles are
 // not acceptable — when a player has few/no placements, the renderer merges
 // these blueprint props so the room still reads as a lived-in space.
 // ─────────────────────────────────────────────────────────────────────────────

import { HQ_GRID } from "../grid.js";
import type { PropKind } from "../props.js";
import { spriteForProp } from "../prop-sprites.js";
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
    case "barracks": return barracks();
    case "treasury": return treasury();
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
    // Central tactical rug + holotable (mockup command hub)
    { gx: 3, gy: 3, kind: "rug", name: "Command Rug", tint: 0x6b1020, scale: 1.35, seed: 3 },
    { gx: 3, gy: 4, kind: "table", name: "Holotable", scale: 1.35, tint: 0x50d0ff },
    // Lounge couches
    { gx: 1, gy: 5, kind: "couch", name: "Ops Sofa", tint: 0x8b1e2d, scale: 1.05 },
    { gx: 5, gy: 5, kind: "couch", name: "Brief Sofa", tint: 0x8b1e2d, scale: 1.05 },
    { gx: 3, gy: 6, kind: "couch", name: "Lounge Sofa", tint: 0x6b1020, scale: 0.95 },
    // Workstations
    { gx: 1, gy: 2, kind: "chair", name: "Officer Chair", tint: 0x3a3a40, seed: 1 },
    { gx: 5, gy: 2, kind: "chair", name: "Analyst Chair", tint: 0x3a3a40, seed: 2 },
    { gx: 6, gy: 3, kind: "cabinet", name: "Comms Terminal" },
    { gx: 0, gy: 3, kind: "bookshelf", name: "Intel Shelves" },
    { gx: 6, gy: 1, kind: "bookshelf", name: "Archive" },
    // Columns + lighting + banners
    { gx: 0, gy: 1, kind: "statue", name: "Stone Column", seed: 1 },
    { gx: 6, gy: 5, kind: "statue", name: "Stone Column", seed: 2 },
    { gx: 2, gy: 1, kind: "banner", name: "House Banner", tint: 0xc0392b, scale: 1.05 },
    { gx: 4, gy: 1, kind: "banner", name: "War Banner", tint: 0xc0392b, scale: 1.05 },
    { gx: 6, gy: 6, kind: "lamp", name: "Floor Lamp", tint: 0xff9030 },
    { gx: 0, gy: 6, kind: "lamp", name: "Sconce Glow", tint: 0xffa040 },
    { gx: 4, gy: 6, kind: "plant", name: "Corner Fern" },
    { gx: 0, gy: 4, kind: "npc", name: "Aide", seed: 0 },
    { gx: 5, gy: 4, kind: "npc", name: "Scout", seed: 1 },
    { wall: true, wallIndex: 0, gx: 0, gy: 0, kind: "banner", name: "Wall Banner", tint: 0xc0392b },
    { wall: true, wallIndex: 2, gx: 0, gy: 0, kind: "banner", name: "Wall Banner", tint: 0xc0392b },
    { wall: true, wallIndex: 3, gx: 0, gy: 0, kind: "emblem", name: "Crest", tint: 0xd4af37 },
    { wall: true, wallIndex: 5, gx: 0, gy: 0, kind: "lamp", name: "Wall Sconce", tint: 0xff9030 },
  ];
}

function trophyHall(): BlueprintProp[] {
  return [
    { gx: 3, gy: 3, kind: "rug", name: "Hall Runner", tint: 0x6b2d8b, scale: 1.25, seed: 5 },
    { gx: 1, gy: 2, kind: "trophy", name: "Gold Cup", tint: 0xd4af37 },
    { gx: 5, gy: 2, kind: "trophy", name: "Silver Cup", tint: 0xc0c8d0 },
    { gx: 2, gy: 5, kind: "statue", name: "Champion Column", tint: 0xd0c8b8, seed: 1 },
    { gx: 5, gy: 5, kind: "statue", name: "Hero Column", tint: 0xd0c8b8, seed: 2 },
    { gx: 6, gy: 3, kind: "chest", name: "Relic Chest", tint: 0xd4af37 },
    { gx: 0, gy: 3, kind: "case", name: "Relic Case", tint: 0xd4af37 },
    { gx: 3, gy: 5, kind: "npc", name: "Curator", seed: 2 },
    { gx: 3, gy: 6, kind: "plant", name: "Palm" },
    { gx: 4, gy: 1, kind: "lamp", name: "Spotlight", tint: 0xffe080 },
    { wall: true, wallIndex: 1, gx: 0, gy: 0, kind: "banner", name: "Victory Banner", tint: 0xd4af37 },
    { wall: true, wallIndex: 4, gx: 0, gy: 0, kind: "emblem", name: "Laurels", tint: 0x2ecc71 },
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
    const seed = p.seed ?? slot + 1;
    out.push({
      slot,
      category: categoryForProp(p.kind),
      name: p.name,
      rarityColor: p.tint ?? 0xc0392b,
      spritePath: spriteForProp(p.kind, seed),
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
