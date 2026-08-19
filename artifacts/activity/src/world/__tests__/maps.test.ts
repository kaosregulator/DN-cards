import { describe, it, expect } from "vitest";
import { MAPS, LEGEND, getMap, TOTAL_DUELISTS, type MapDef } from "../maps";
import { SOLID, type TileKind } from "../tiles";

/** Walkability grid for a map: solid tiles blocked, doors always open. */
function solidGrid(map: MapDef): boolean[][] {
  const grid = map.grid.map((row) =>
    [...row].map((ch) => SOLID.has((LEGEND[ch] ?? "grass") as TileKind)),
  );
  for (const d of map.doors) if (grid[d.y]) grid[d.y]![d.x] = false;
  // NPCs stand on solid tiles (you can't walk through people).
  for (const n of map.npcs) if (grid[n.y]) grid[n.y]![n.x] = true;
  return grid;
}

/** Every tile reachable on foot from a starting tile. */
function reachable(map: MapDef, from: { x: number; y: number }): Set<string> {
  const grid = solidGrid(map);
  const h = grid.length, w = grid[0]!.length;
  const seen = new Set<string>();
  const queue = [from];
  const ok = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && !grid[y]![x];
  if (!ok(from.x, from.y)) return seen;
  seen.add(`${from.x},${from.y}`);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !ok(nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

const allMaps = Object.values(MAPS);

describe("world maps", () => {
  it("every map is a rectangle of known tiles", () => {
    for (const map of allMaps) {
      const w = map.grid[0]!.length;
      for (const row of map.grid) expect(row.length, `${map.id} row width`).toBe(w);
      for (const row of map.grid) {
        for (const ch of row) expect(LEGEND[ch], `${map.id} unknown tile '${ch}'`).toBeTruthy();
      }
    }
  });

  it("every spawn point is on a walkable tile", () => {
    for (const map of allMaps) {
      const grid = solidGrid(map);
      for (const [name, sp] of Object.entries(map.spawns)) {
        expect(grid[sp.y]?.[sp.x], `${map.id}:${name} spawn is solid`).toBe(false);
      }
    }
  });

  it("every door leads to a real map and a real spawn point", () => {
    for (const map of allMaps) {
      for (const d of map.doors) {
        const target = MAPS[d.to];
        expect(target, `${map.id} door → unknown map ${d.to}`).toBeTruthy();
        expect(target!.spawns[d.spawn], `${map.id} door → unknown spawn ${d.to}:${d.spawn}`).toBeTruthy();
      }
    }
  });

  it("every door is reachable on foot from the map's spawn", () => {
    for (const map of allMaps) {
      const start = Object.values(map.spawns)[0]!;
      const seen = reachable(map, start);
      for (const d of map.doors) {
        expect(seen.has(`${d.x},${d.y}`), `${map.id}: door to ${d.to} at ${d.x},${d.y} unreachable`).toBe(true);
      }
    }
  });

  // The bug this suite exists for: an NPC walled off behind scenery can never
  // be talked to, which silently breaks the shop and any duelist encounter.
  it("every NPC can be stood next to and talked to", () => {
    for (const map of allMaps) {
      const start = Object.values(map.spawns)[0]!;
      const seen = reachable(map, start);
      for (const npc of map.npcs) {
        const adjacent = [[0, 1], [0, -1], [1, 0], [-1, 0]]
          .map(([dx, dy]) => `${npc.x + dx!},${npc.y + dy!}`)
          .some((k) => seen.has(k));
        expect(adjacent, `${map.id}: NPC "${npc.name}" at ${npc.x},${npc.y} is unreachable`).toBe(true);
      }
    }
  });

  // People must stand on the ground, not on top of a roof, wall or tree.
  it("no NPC stands on solid scenery", () => {
    for (const map of allMaps) {
      for (const npc of map.npcs) {
        const ch = map.grid[npc.y]?.[npc.x];
        const kind = (LEGEND[ch ?? "."] ?? "grass") as TileKind;
        expect(SOLID.has(kind), `${map.id}: "${npc.name}" stands on ${kind} at ${npc.x},${npc.y}`).toBe(false);
      }
    }
  });

  it("signs are placed on real tiles inside the map", () => {
    for (const map of allMaps) {
      for (const s of map.signs ?? []) {
        expect(map.grid[s.y], `${map.id}: sign off-map at ${s.x},${s.y}`).toBeTruthy();
        expect(s.x, `${map.id}: sign off-map at ${s.x},${s.y}`).toBeLessThan(map.grid[0]!.length);
      }
    }
  });

  it("NPCs and doors never occupy the same tile", () => {
    for (const map of allMaps) {
      for (const npc of map.npcs) {
        for (const d of map.doors) {
          expect(npc.x === d.x && npc.y === d.y, `${map.id}: NPC on a door tile`).toBe(false);
        }
      }
    }
  });

  it("the world is fully connected — every map is reachable from the city", () => {
    const seen = new Set<string>(["city"]);
    const queue = ["city"];
    while (queue.length) {
      const id = queue.shift()!;
      for (const d of getMap(id).doors) {
        if (!seen.has(d.to)) { seen.add(d.to); queue.push(d.to); }
      }
    }
    for (const id of Object.keys(MAPS)) {
      expect(seen.has(id), `map "${id}" is unreachable from Battle City`).toBe(true);
    }
  });

  it("has duelists to fight and a shopkeeper to buy from", () => {
    expect(TOTAL_DUELISTS).toBeGreaterThanOrEqual(5);
    const shops = allMaps.flatMap((m) => m.npcs).filter((n) => n.role === "shop");
    expect(shops.length).toBeGreaterThanOrEqual(1);
    // Duelist ids must be unique — progress is tracked by id.
    const ids = allMaps.flatMap((m) => m.npcs).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
