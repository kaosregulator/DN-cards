// ─────────────────────────────────────────────────────────────────────────────
// Harvest Moon foraging — wild berries, fruit, flowers, herbs and mushrooms that
// scatter across the outdoor maps and caves. Walk up and interact to pick one; a
// running tally is kept per item. Placement is seeded per map so a location lays
// out the same each visit (the source game re-rolled these daily).
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";
import { addForaged } from "../state/profile";

export interface HmItemDef { id: string; name: string; url: string; h: number; }

export const HM_ITEMS: Record<string, HmItemDef> = {
  wildgrape: { id: "wildgrape", name: "Wild Grape", url: "world/hm/items/wildgrape.png", h: 70 },
  summerfruit: { id: "summerfruit", name: "Summer Fruit", url: "world/hm/items/summerfruit.png", h: 70 },
  powerberry: { id: "powerberry", name: "Power Berry", url: "world/hm/items/powerberry.png", h: 70 },
  mushroom: { id: "mushroom", name: "Mushroom", url: "world/hm/items/mushroom.png", h: 80 },
  flower: { id: "flower", name: "Flower", url: "world/hm/items/flower.png", h: 60 },
  herb: { id: "herb", name: "Herb", url: "world/hm/items/herb.png", h: 70 },
  fancyflower: { id: "fancyflower", name: "Fancy Flower", url: "world/hm/items/fancyflower.png", h: 80 },
};

// Which items forage on which map, and how many spots to scatter.
export const HM_ITEM_SPAWNS: Record<string, { items: string[]; count: number }> = {
  "hm-mountains": { items: ["wildgrape", "summerfruit", "powerberry", "flower", "herb", "fancyflower"], count: 60 },
  "hm-farm": { items: ["flower", "herb", "summerfruit"], count: 26 },
  "hm-cave1": { items: ["mushroom", "powerberry"], count: 18 },
  "hm-cave2": { items: ["mushroom", "powerberry", "herb"], count: 20 },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HmItemHit { def: HmItemDef; sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; }

export class HmItems {
  private placed: HmItemHit[] = [];

  constructor(
    scene: Phaser.Scene, mapKey: string, tile: number,
    isWalkable: (tx: number, ty: number) => boolean,
    gridW: number, gridH: number, seed: number,
    spawn: { tx: number; ty: number },
  ) {
    const cfg = HM_ITEM_SPAWNS[mapKey];
    if (!cfg) return;
    const rand = mulberry32(seed);
    const chosen: { tx: number; ty: number }[] = [];
    const put = (tx: number, ty: number): boolean => {
      if (tx < 2 || ty < 2 || tx > gridW - 3 || ty > gridH - 3) return false;
      if (!isWalkable(tx, ty)) return false;
      if (chosen.some((c) => Math.abs(c.tx - tx) < 3 && Math.abs(c.ty - ty) < 3)) return false;
      chosen.push({ tx, ty });
      const def = HM_ITEMS[cfg.items[Math.floor(rand() * cfg.items.length)]!]!;
      const key = `hmitem-${def.id}`;
      if (!scene.textures.exists(key)) return true;
      const x = tx * tile + tile / 2, y = ty * tile + tile / 2;
      const shadow = scene.add.ellipse(x, y + tile * 0.32, tile * 0.7, tile * 0.28, 0x000000, 0.22).setDepth(299);
      const spr = scene.add.image(x, y, key).setOrigin(0.5, 0.85).setScale((tile * 1.15) / def.h).setDepth(300);
      this.placed.push({ def, sprite: spr, shadow });
      return true;
    };
    // A small cluster near where the player arrives, so foraging is discoverable
    // right away, then the rest scattered across the map.
    for (const [dx, dy] of [[3, 0], [-3, 1], [0, 3], [4, 3], [-3, -3]]) put(spawn.tx + dx, spawn.ty + dy);
    let tries = 0;
    while (chosen.length < cfg.count && tries < cfg.count * 80) {
      tries++;
      put(2 + Math.floor(rand() * (gridW - 4)), 2 + Math.floor(rand() * (gridH - 4)));
    }
  }

  nearest(px: number, py: number, range: number): HmItemHit | null {
    let best: HmItemHit | null = null, bd = range;
    for (const p of this.placed) {
      const d = Math.hypot(p.sprite.x - px, p.sprite.y - py);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Pick an item up: remove it and bump the persistent tally. Returns the count. */
  collect(entry: HmItemHit): { name: string; count: number } {
    entry.sprite.destroy();
    entry.shadow.destroy();
    this.placed = this.placed.filter((p) => p !== entry);
    const count = addForaged(entry.def.id);
    return { name: entry.def.name, count };
  }

  static spritesForMap(mapKey: string): { key: string; url: string }[] {
    const cfg = HM_ITEM_SPAWNS[mapKey];
    if (!cfg) return [];
    return cfg.items.map((id) => ({ key: `hmitem-${id}`, url: HM_ITEMS[id]!.url }));
  }
}

// A brief pickup toast at the top of the screen.
export function foragedToast(name: string, count: number): void {
  let el = document.getElementById("forage-toast") as HTMLDivElement | null;
  if (!el) {
    const s = document.createElement("style");
    s.textContent = `#forage-toast{position:fixed;top:calc(74px + env(safe-area-inset-top,0px));left:50%;
      transform:translateX(-50%);z-index:58;background:rgba(18,24,44,.96);border:1px solid #d4a84b;
      border-radius:999px;padding:7px 16px;color:#ffe9b0;font:600 13px system-ui,sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;pointer-events:none;}
      #forage-toast.on{opacity:1;}`;
    document.head.appendChild(s);
    el = document.createElement("div");
    el.id = "forage-toast";
    document.body.appendChild(el);
  }
  el.textContent = `🧺 Picked a ${name}!  ×${count}`;
  el.classList.add("on");
  window.clearTimeout((el as unknown as { _t?: number })._t);
  (el as unknown as { _t?: number })._t = window.setTimeout(() => el!.classList.remove("on"), 1600);
}
