// ─────────────────────────────────────────────────────────────────────────────
// HQ Activity — placeable asset catalog (single source of truth).
//
// This registry is authoritative and lives on the SERVER. It is shipped to the
// Phaser client (so the renderer is fully asset-driven and never hard-codes an
// object) AND used to VALIDATE every saved placement (so the client can never
// place something the player hasn't earned). Each entry references a real sprite
// key from assets/hq/manifest.json.
//
// `unlock`:
//   "always"          → structural / landscaping, always placeable
//   "<decorationId>"  → gated behind that decoration's UnlockRule (hq_unlocks)
//
// Adding art later = drop a PNG in assets/hq, add a manifest key, add a row here.
// No renderer edits required.
// ─────────────────────────────────────────────────────────────────────────────

export type AssetCategory =
  | "structure" | "door" | "floor"        // building the shell
  | "furniture" | "storage" | "table" | "seating" | "rug"
  | "nature" | "light" | "trophy" | "banner" | "npc" | "building";

export interface ActivityAsset {
  /** Stable id. When it matches a decoration id, that decoration's unlock gates it. */
  id: string;
  name: string;
  /** Manifest sprite key (assets/hq/manifest.json). */
  sprite: string;
  category: AssetCategory;
  /** Footprint in floor tiles (iso). Most props are 1×1; big furniture 1–2. */
  footprint: { w: number; h: number };
  /** true → the object may be rotated in 90° steps by the editor. */
  rotatable: boolean;
  /** "always" or a decoration id whose unlock must be satisfied. */
  unlock: "always" | string;
  /** Room kinds this reads well in (empty = anywhere). Advisory, not enforced hard. */
  rooms?: string[];
  /** Rough visual scale hint applied on top of tile-fit (tuned per art). */
  scale?: number;
}

// Structural pieces used to build the shell. Always placeable.
const STRUCTURE: ActivityAsset[] = [
  { id: "wall-stone", name: "Stone Wall", sprite: "roomwall/plain", category: "structure", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "wall-aged", name: "Aged Wall", sprite: "roomwall/aged", category: "structure", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "wall-window", name: "Window Wall", sprite: "roomwall/window", category: "structure", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "wall-column", name: "Wall Column", sprite: "roomwall/column", category: "structure", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "corner", name: "Wall Corner", sprite: "roomwall/corner", category: "structure", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "door", name: "Door", sprite: "roomwall/door", category: "door", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "door-open", name: "Open Door", sprite: "roomwall/door-open", category: "door", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "archway", name: "Archway", sprite: "roomwall/archway", category: "door", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "gate", name: "Gate", sprite: "roomwall/gate", category: "door", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
];

// Furniture & props — the room-purpose kit. Real Kenney furniture sprites.
const FURNITURE: ActivityAsset[] = [
  { id: "command-rug", name: "Command Rug", sprite: "deco/command-rug", category: "rug", footprint: { w: 2, h: 2 }, rotatable: true, unlock: "always", rooms: ["command"] },
  { id: "welcome-rug", name: "Welcome Rug", sprite: "deco/welcome-rug", category: "rug", footprint: { w: 2, h: 1 }, rotatable: true, unlock: "always" },
  { id: "plush-rug", name: "Plush Rug", sprite: "deco/plush-rug", category: "rug", footprint: { w: 2, h: 2 }, rotatable: true, unlock: "always" },
  { id: "vault-rug", name: "Vault Rug", sprite: "deco/vault-rug", category: "rug", footprint: { w: 2, h: 2 }, rotatable: true, unlock: "always", rooms: ["economy"] },
  { id: "briefing-table", name: "Briefing Table", sprite: "deco/table-short-chairs", category: "table", footprint: { w: 2, h: 1 }, rotatable: true, unlock: "always", rooms: ["command", "military"] },
  { id: "study-table", name: "Study Table", sprite: "deco/study-table", category: "table", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "feast-table", name: "Feast Table", sprite: "deco/feast-table", category: "table", footprint: { w: 2, h: 1 }, rotatable: true, unlock: "always" },
  { id: "round-table", name: "Round Table", sprite: "deco/table-round-chairs", category: "table", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "chair", name: "Chair", sprite: "deco/chair", category: "seating", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "officer-chair", name: "Officer's Chair", sprite: "deco/officer-chair", category: "seating", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "supply-crate", name: "Supply Crate", sprite: "deco/supply-crate", category: "storage", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "supply-crates", name: "Supply Crates", sprite: "deco/supply-crates", category: "storage", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "barrel", name: "Barrel", sprite: "deco/barrel", category: "storage", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "barrels", name: "Barrels", sprite: "deco/barrels", category: "storage", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "stacked-barrels", name: "Stacked Barrels", sprite: "deco/stacked-barrels", category: "storage", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "storage-barrel", name: "Storage Barrel", sprite: "deco/storage-barrel", category: "storage", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "treasure-chest", name: "Treasure Chest", sprite: "deco/treasure-chest", category: "storage", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always", rooms: ["economy"] },
  { id: "treasure-chest-open", name: "Open Chest", sprite: "deco/treasure-chest-open", category: "storage", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always", rooms: ["economy"] },
  { id: "log-pile", name: "Log Pile", sprite: "deco/log-pile", category: "storage", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "stone-column", name: "Stone Column", sprite: "deco/stone-column", category: "structure", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "wood-column", name: "Wood Column", sprite: "deco/stone-column-wood", category: "structure", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "stairs", name: "Stairs", sprite: "deco/stairs", category: "structure", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "stairs-spiral", name: "Spiral Stairs", sprite: "deco/stairs-spiral", category: "structure", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
];

// Landscaping / nature — always placeable outdoors.
const NATURE: ActivityAsset[] = [
  { id: "yard-tree", name: "Pine Tree", sprite: "deco/yard-tree", category: "nature", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "tree-tall", name: "Tall Tree", sprite: "deco/tree-tall", category: "nature", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "yard-bush", name: "Shrub", sprite: "deco/yard-bush", category: "nature", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "yard-rock", name: "Boulder", sprite: "deco/yard-rock", category: "nature", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "rock-low", name: "Low Rock", sprite: "deco/rock-low", category: "nature", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "stones", name: "Stones", sprite: "deco/stones", category: "nature", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "yard-fence", name: "Fence", sprite: "deco/yard-fence", category: "nature", footprint: { w: 1, h: 1 }, rotatable: true, unlock: "always" },
  { id: "flag", name: "Flag", sprite: "deco/flag", category: "banner", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "tent", name: "Tent", sprite: "deco/tent", category: "structure", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
];

// Characters — NPCs & hero figures that populate the HQ.
const FIGURES: ActivityAsset[] = [
  { id: "npc-aide", name: "Aide", sprite: "deco/npc-aide", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "npc-scout", name: "Scout", sprite: "deco/npc-scout", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "figure-knight", name: "Knight", sprite: "deco/figure-knight", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "figure-ranger", name: "Ranger", sprite: "deco/figure-ranger", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "figure-mage", name: "Mage", sprite: "deco/figure-mage", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "figure-wizard", name: "Wizard", sprite: "deco/figure-wizard", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "figure-barbarian", name: "Barbarian", sprite: "deco/figure-barbarian", category: "npc", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
];

// Trophies & emblems — many are unlock-gated (reuse existing decoration ids).
const TROPHIES: ActivityAsset[] = [
  { id: "veteran-medals", name: "Veteran Medals", sprite: "deco/veteran-medals", category: "trophy", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "veteran-medals", rooms: ["decorative"] },
  { id: "laurel-wreath", name: "Laurel Wreath", sprite: "deco/laurel-wreath", category: "trophy", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "collectors-crest", name: "Collector's Crest", sprite: "deco/collectors-crest", category: "trophy", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "sovereign-crown", name: "Sovereign Crown", sprite: "deco/sovereign-crown", category: "trophy", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
  { id: "diplomat-seal", name: "Diplomat Seal", sprite: "deco/diplomat-seal", category: "trophy", footprint: { w: 1, h: 1 }, rotatable: false, unlock: "always" },
];

export const ACTIVITY_ASSETS: ActivityAsset[] = [
  ...STRUCTURE, ...FURNITURE, ...NATURE, ...FIGURES, ...TROPHIES,
];

const ASSET_INDEX = new Map<string, ActivityAsset>(ACTIVITY_ASSETS.map((a) => [a.id, a]));

export function getActivityAsset(id: string): ActivityAsset | undefined {
  return ASSET_INDEX.get(id);
}

// Floor / wall surface styles the shell can be built from (map to floor sprites).
export const ACTIVITY_FLOORS = [
  { id: "stone", name: "Stone", sprite: "floor/stone" },
  { id: "wood", name: "Wood", sprite: "floor/wood" },
  { id: "marble", name: "Marble", sprite: "floor/marble" },
  { id: "blue-stone", name: "Blue Stone", sprite: "floor/blue-stone" },
  { id: "grass", name: "Grass", sprite: "floor/grass" },
  { id: "dirt", name: "Dirt", sprite: "floor/dirt" },
  { id: "sand", name: "Sand", sprite: "floor/sand" },
] as const;

export const ACTIVITY_FLOOR_IDS: Set<string> = new Set(ACTIVITY_FLOORS.map((f) => f.id));
