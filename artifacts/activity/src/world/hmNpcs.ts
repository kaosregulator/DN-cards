// ─────────────────────────────────────────────────────────────────────────────
// Harvest Moon townsfolk — a light NPC layer for the ported world. Each NPC is a
// still sprite (frame 0 of the source side-view sheet) with a floating name tag,
// scaled to match Jack. Walk up and interact to read a short line of dialog. The
// source game shipped empty dialog trees, so the lines here are our own flavor.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";

export interface HmNpcDef {
  map: string;
  sprite: string; // key in NPC_SPRITES
  tx: number;
  ty: number;
  name: string;
  lines: string[];
}

// source sprite → its native height (for proportional scaling) and file.
export const NPC_SPRITES: Record<string, { h: number; url: string }> = {
  bartender: { h: 145, url: "world/hm/chars/npc/bartender.png" },
  drunk: { h: 120, url: "world/hm/chars/npc/drunk.png" },
  "fortune-teller": { h: 110, url: "world/hm/chars/npc/fortune-teller.png" },
  "restaurant-owner": { h: 140, url: "world/hm/chars/npc/restaurant-owner.png" },
  elf: { h: 75, url: "world/hm/chars/npc/elf.png" },
};

export const HM_NPCS: HmNpcDef[] = [
  {
    map: "hm-bar", sprite: "bartender", tx: 34, ty: 22, name: "Barkeep",
    lines: ["Welcome to the tavern, stranger.", "First one's on the house — you look like you came a long way.", "Careful up in the mountains after dark."],
  },
  {
    map: "hm-restaurant", sprite: "restaurant-owner", tx: 34, ty: 22, name: "Restaurant Owner",
    lines: ["Hungry? Best food in the whole valley, right here.", "Try the summer-fruit tart — picked fresh this morning."],
  },
  {
    map: "hm-fortuneteller", sprite: "fortune-teller", tx: 28, ty: 22, name: "Fortune Teller",
    lines: ["I see… a duelist far from home.", "Your fate is tangled with a cave and a deck of cards…", "Beware the shadows — but trust your cards."],
  },
  {
    map: "hm-town", sprite: "drunk", tx: 96, ty: 132, name: "Townsfolk",
    lines: ["Hic! …nice hat.", "This lil' town's the best place around, y'know?", "New face! You here for the harvest festival?"],
  },
  {
    map: "hm-mountains", sprite: "elf", tx: 46, ty: 108, name: "Forest Spirit",
    lines: ["A traveler! We spirits rarely see new faces up here.", "Help the townsfolk, and the harvest will smile on you.", "Wild berries grow all over these slopes — take what you need."],
  },
  {
    map: "hm-mountains", sprite: "elf", tx: 60, ty: 102, name: "Forest Spirit",
    lines: ["Shhh… listen to the wind through the pines.", "The deep cave holds mushrooms found nowhere else."],
  },
];

interface Placed { def: HmNpcDef; sprite: Phaser.GameObjects.Image; }

export class HmNpcs {
  private placed: Placed[] = [];

  constructor(scene: Phaser.Scene, mapKey: string, tile: number) {
    for (const def of HM_NPCS.filter((n) => n.map === mapKey)) {
      const meta = NPC_SPRITES[def.sprite];
      const key = `hmnpc-${def.sprite}`;
      if (!meta || !scene.textures.exists(key)) continue;
      const x = def.tx * tile + tile / 2, y = def.ty * tile + tile / 2;
      // Native size (as in the source game), so townsfolk match Jack's scale.
      const scale = 1;
      const spr = scene.add.image(x, y, key).setOrigin(0.5, 0.88).setScale(scale).setDepth(460);
      scene.add.ellipse(x, y + 2, tile * 0.9, tile * 0.4, 0x000000, 0.22).setDepth(459);
      scene.add.text(x, y - meta.h * scale * 0.9, def.name, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#fff",
        backgroundColor: "#1a1428cc", padding: { x: 5, y: 2 },
      }).setOrigin(0.5, 1).setDepth(461);
      this.placed.push({ def, sprite: spr });
    }
  }

  /** The NPC within `range` px of a point, if any. */
  nearest(px: number, py: number, range: number): HmNpcDef | null {
    let best: HmNpcDef | null = null, bd = range;
    for (const p of this.placed) {
      const d = Math.hypot(p.sprite.x - px, p.sprite.y - py);
      if (d < bd) { bd = d; best = p.def; }
    }
    return best;
  }

  /** Sprite keys to preload for a given map. */
  static spritesForMap(mapKey: string): { key: string; url: string }[] {
    const out: { key: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const n of HM_NPCS.filter((x) => x.map === mapKey)) {
      if (seen.has(n.sprite)) continue;
      seen.add(n.sprite);
      const meta = NPC_SPRITES[n.sprite];
      if (meta) out.push({ key: `hmnpc-${n.sprite}`, url: meta.url });
    }
    return out;
  }
}

// A tiny bottom-of-screen dialog box, advanced by the interact button/key.
export class DialogBox {
  private root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private lines: string[] = [];
  private i = 0;

  constructor(private onClose: () => void) {
    this.inject();
    this.root = document.createElement("div");
    this.root.className = "dlg-box";
    this.root.innerHTML = `<div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-hint">▶ tap / space</div>`;
    this.nameEl = this.root.querySelector(".dlg-name") as HTMLDivElement;
    this.textEl = this.root.querySelector(".dlg-text") as HTMLDivElement;
    this.root.addEventListener("click", () => this.advance());
    document.body.appendChild(this.root);
  }

  open(name: string, lines: string[]): void {
    this.lines = lines.length ? lines : ["…"];
    this.i = 0;
    this.nameEl.textContent = name;
    this.textEl.textContent = this.lines[0]!;
    this.root.style.display = "block";
  }

  get isOpen(): boolean { return this.root.style.display === "block"; }

  advance(): void {
    this.i++;
    if (this.i >= this.lines.length) { this.close(); return; }
    this.textEl.textContent = this.lines[this.i]!;
  }

  close(): void {
    this.root.style.display = "none";
    this.onClose();
  }

  destroy(): void { this.root.remove(); }

  private inject(): void {
    if (document.getElementById("dlg-style")) return;
    const s = document.createElement("style");
    s.id = "dlg-style";
    s.textContent = `
      .dlg-box { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom,0px));
        transform: translateX(-50%); width: min(560px, 92vw); display: none; z-index: 55;
        background: rgba(18,24,44,.97); border: 2px solid #d4a84b; border-radius: 14px;
        padding: 12px 16px 10px; color: #eef2ff; cursor: pointer;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 12px 40px rgba(0,0,0,.5); }
      .dlg-name { font-size: 13px; font-weight: 700; color: #ffe9b0; margin-bottom: 4px; }
      .dlg-text { font-size: 15px; line-height: 1.35; }
      .dlg-hint { font-size: 11px; color: #9db2ff; text-align: right; margin-top: 6px; }
    `;
    document.head.appendChild(s);
  }
}
