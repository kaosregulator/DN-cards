import Phaser from "phaser";
import { getContext } from "../core/context";
import type { ShopCard } from "../net/api";
import { artKey } from "../ui/card";

// ─────────────────────────────────────────────────────────────────────────────
// ShopScene — the Card Shop counter screen. Walking up to the shopkeeper opens
// this: a scrollable grid of the server's REAL cards (our own art and names),
// each showing its derived duel stats. Tapping a card opens a full inspector
// with the card's own description and its Yu-Gi-Oh style Level/ATK/DEF.
//
// Browsing only — buying stays an authoritative bot flow. This is the shelf.
// ─────────────────────────────────────────────────────────────────────────────

const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];

export class ShopScene extends Phaser.Scene {
  private returnTo = "World";
  private cards: ShopCard[] = [];
  private filtered: ShopCard[] = [];
  private grid!: Phaser.GameObjects.Container;
  private chrome!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private filter: "all" | "owned" | "new" = "all";
  private busy = false;

  constructor() { super("Shop"); }

  init(data: { returnTo?: string }): void { this.returnTo = data?.returnTo ?? "World"; }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    this.cameras.main.setBackgroundColor("#161020");
    this.cameras.main.fadeIn(240, 0, 0, 0);
    this.grid = this.add.container(0, 0).setDepth(10);
    this.chrome = this.add.container(0, 0).setDepth(100);

    const loading = this.add.text(this.W / 2, this.H / 2, "Opening the display case…", {
      fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#c9d4ff",
    }).setOrigin(0.5);

    try {
      const model = await getContext(this).api.shop();
      this.cards = model.cards;
    } catch {
      this.cards = [];
    }
    loading.destroy();

    if (this.cards.length === 0) {
      this.add.text(this.W / 2, this.H / 2, "The shelves are empty right now.\nTap to head back.", {
        fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#ff9db2", align: "center",
      }).setOrigin(0.5);
      this.input.once("pointerdown", () => this.exit());
      return;
    }

    await this.preloadArt();
    this.applyFilter();
    this.buildChrome();
    this.renderGrid();
    this.wireScrolling();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
  }

  private onResize = (): void => {
    if (!this.cards.length) return;
    this.chrome.removeAll(true);
    this.buildChrome();
    this.renderGrid();
  };

  private get W(): number { return this.scale.width; }
  private get H(): number { return this.scale.height; }

  // Load every shelf card's art through the proxy (same keys the duel uses).
  private preloadArt(): Promise<void> {
    const api = getContext(this).api;
    const ids = this.cards.filter((c) => c.art).map((c) => c.cardId);
    if (!ids.length) return Promise.resolve();
    return new Promise((resolve) => {
      let pending = ids.length;
      const done = () => { if (--pending <= 0) resolve(); };
      this.load.on(Phaser.Loader.Events.FILE_COMPLETE, done);
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, done);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      for (const id of ids) {
        if (!this.textures.exists(artKey(id))) this.load.image(artKey(id), api.cardArtUrl(id));
        else done();
      }
      this.time.delayedCall(10000, () => resolve());
      this.load.start();
    });
  }

  private applyFilter(): void {
    this.filtered = this.cards.filter((c) =>
      this.filter === "all" ? true : this.filter === "owned" ? c.owned > 0 : c.owned === 0);
    this.scrollY = 0;
  }

  // ── Chrome: header, filters, exit ───────────────────────────────────────────
  private buildChrome(): void {
    const bar = this.add.graphics();
    bar.fillStyle(0x0e0a16, 0.96); bar.fillRect(0, 0, this.W, 76);
    bar.lineStyle(2, 0x7b46b0, 0.8); bar.lineBetween(0, 76, this.W, 76);
    this.chrome.add(bar);

    this.chrome.add(this.add.text(14, 12, "🏪 CARD SHOP", {
      fontFamily: "system-ui, sans-serif", fontSize: "20px", color: "#ffe9b0", fontStyle: "bold",
    }));
    this.chrome.add(this.add.text(14, 38, `${this.filtered.length} cards on the shelves`, {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#c9d4ff",
    }));

    // Filter chips.
    const chips: Array<["all" | "owned" | "new", string]> = [["all", "All"], ["owned", "Owned"], ["new", "Not owned"]];
    let cx = this.W - 14;
    for (let i = chips.length - 1; i >= 0; i--) {
      const [key, label] = chips[i]!;
      const active = this.filter === key;
      const t = this.add.text(0, 0, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "12px", fontStyle: "bold",
        color: active ? "#0e0a16" : "#dbe4ff",
        backgroundColor: active ? "#ffd75e" : "#2a2350",
        padding: { x: 10, y: 6 },
      }).setOrigin(1, 0).setPosition(cx, 40).setInteractive();
      t.on("pointerdown", () => { this.filter = key; this.applyFilter(); this.chrome.removeAll(true); this.buildChrome(); this.renderGrid(); });
      this.chrome.add(t);
      cx -= t.width + 8;
    }

    const back = this.add.text(this.W - 14, 12, "✕ Leave", {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#fff", fontStyle: "bold",
      backgroundColor: "#8a3550", padding: { x: 10, y: 5 },
    }).setOrigin(1, 0).setInteractive();
    back.on("pointerdown", () => this.exit());
    this.chrome.add(back);
  }

  // ── The shelf grid ──────────────────────────────────────────────────────────
  private renderGrid(): void {
    this.grid.removeAll(true);
    const pad = 12;
    const top = 88;
    const cols = Math.max(2, Math.floor((this.W - pad) / 124));
    const cw = (this.W - pad * (cols + 1)) / cols;
    const ch = cw * 1.72;

    this.filtered.forEach((card, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = pad + col * (cw + pad) + cw / 2;
      const y = top + row * (ch + pad + 16) + ch / 2;
      const cell = this.buildCell(card, cw, ch);
      cell.setPosition(x, y);
      this.grid.add(cell);
    });

    const rows = Math.ceil(this.filtered.length / cols);
    const contentH = top + rows * (ch + pad + 16);
    this.maxScroll = Math.max(0, contentH - this.H + 20);
    this.grid.y = -this.scrollY;
  }

  private buildCell(card: ShopCard, w: number, h: number): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    g.fillStyle(0x1a1428, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    g.lineStyle(2, card.color, 0.95); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    c.add(g);

    // Art window.
    const aw = w - 12, ah = h * 0.50, ay = -h / 2 + 7 + ah / 2;
    const key = artKey(card.cardId);
    if (this.textures.exists(key)) {
      const img = this.add.image(0, ay, key);
      const sc = Math.max(aw / img.width, ah / img.height);
      img.setScale(sc);
      const mask = this.make.graphics({});
      mask.fillStyle(0xffffff); mask.fillRect(-aw / 2, ay - ah / 2, aw, ah);
      img.setMask(mask.createGeometryMask());
      c.add(img);
      // The mask must follow the container; simplest is to position it when added.
      c.on("destroy", () => mask.destroy());
    } else {
      const p = this.add.graphics();
      p.fillStyle(card.color, 0.28); p.fillRect(-aw / 2, ay - ah / 2, aw, ah);
      c.add(p);
      c.add(this.add.text(0, ay, "★", { fontSize: `${Math.round(ah * 0.5)}px`, color: "#" + card.color.toString(16).padStart(6, "0") }).setOrigin(0.5));
    }

    // Name + stats.
    c.add(this.add.text(0, ay + ah / 2 + 6, fit(card.name, Math.floor(w / 6.2)), {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.max(9, Math.round(w / 11))}px`,
      color: "#f4ead0", fontStyle: "bold",
    }).setOrigin(0.5, 0));
    c.add(this.add.text(0, ay + ah / 2 + 22, "★".repeat(Math.min(8, card.level)), {
      fontSize: `${Math.max(7, Math.round(w / 15))}px`, color: "#ffd75e",
    }).setOrigin(0.5, 0));
    c.add(this.add.text(0, h / 2 - 34, `ATK ${card.atk}`, {
      fontFamily: "monospace", fontSize: `${Math.max(9, Math.round(w / 12))}px`, color: "#ffe9b0", fontStyle: "bold",
    }).setOrigin(0.5, 0));
    c.add(this.add.text(0, h / 2 - 22, `DEF ${card.def}`, {
      fontFamily: "monospace", fontSize: `${Math.max(8, Math.round(w / 14))}px`, color: "#c9b98a",
    }).setOrigin(0.5, 0));
    c.add(this.add.text(0, h / 2 - 9, card.owned > 0 ? `✔ owned ×${card.owned}` : `💠 ${card.price}`, {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.max(8, Math.round(w / 14))}px`,
      color: card.owned > 0 ? "#8ef0bd" : "#9db2ff",
    }).setOrigin(0.5, 1).setY(h / 2 - 6));

    c.setSize(w, h).setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    c.on("pointerdown", () => { if (!this.dragged) this.inspect(card); });
    return c;
  }

  // ── Scrolling (wheel + drag) ────────────────────────────────────────────────
  private dragged = false;
  private wireScrolling(): void {
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.scrollBy(dy * 0.6);
    });
    let startY = 0, startScroll = 0, dragging = false;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.y < 76) return;
      dragging = true; this.dragged = false; startY = p.y; startScroll = this.scrollY;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!dragging || !p.isDown) return;
      const dy = startY - p.y;
      if (Math.abs(dy) > 6) this.dragged = true;
      this.scrollTo(startScroll + dy);
    });
    this.input.on("pointerup", () => {
      dragging = false;
      this.time.delayedCall(30, () => { this.dragged = false; });
    });
  }
  private scrollBy(d: number): void { this.scrollTo(this.scrollY + d); }
  private scrollTo(v: number): void {
    this.scrollY = Phaser.Math.Clamp(v, 0, this.maxScroll);
    this.grid.y = -this.scrollY;
  }

  // ── Card inspector ──────────────────────────────────────────────────────────
  private inspect(card: ShopCard): void {
    if (this.busy) return;
    this.busy = true;
    const overlay = this.add.container(0, 0).setDepth(3000);
    overlay.add(this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.72).setOrigin(0).setInteractive());

    const pw = Math.min(360, this.W - 40), ph = Math.min(560, this.H - 60);
    const px = this.W / 2, py = this.H / 2;
    const g = this.add.graphics();
    g.fillStyle(0x140f22, 0.99); g.fillRoundedRect(px - pw / 2, py - ph / 2, pw, ph, 14);
    g.lineStyle(3, card.color, 1); g.strokeRoundedRect(px - pw / 2, py - ph / 2, pw, ph, 14);
    overlay.add(g);

    overlay.add(this.add.text(px, py - ph / 2 + 14, card.name, {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#f4ead0", fontStyle: "bold",
      align: "center", wordWrap: { width: pw - 28 },
    }).setOrigin(0.5, 0));

    const aw = pw - 40, ah = ph * 0.38, ay = py - ph / 2 + 62 + ah / 2;
    const key = artKey(card.cardId);
    if (this.textures.exists(key)) {
      const img = this.add.image(px, ay, key);
      const sc = Math.min(aw / img.width, ah / img.height);
      img.setScale(sc);
      overlay.add(img);
    } else {
      const p = this.add.graphics();
      p.fillStyle(card.color, 0.28); p.fillRect(px - aw / 2, ay - ah / 2, aw, ah);
      overlay.add(p);
    }

    const infoY = ay + ah / 2 + 12;
    overlay.add(this.add.text(px, infoY, `${card.rarity}  ·  ${card.attribute}  ·  ${"★".repeat(Math.min(12, card.level))}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffd75e", align: "center",
      wordWrap: { width: pw - 28 },
    }).setOrigin(0.5, 0));
    overlay.add(this.add.text(px, infoY + 24, `ATK ${card.atk}      DEF ${card.def}`, {
      fontFamily: "monospace", fontSize: "16px", color: "#ffe9b0", fontStyle: "bold",
    }).setOrigin(0.5, 0));
    overlay.add(this.add.text(px, infoY + 52, card.desc, {
      fontFamily: "system-ui, sans-serif", fontSize: "12.5px", color: "#dbe4ff",
      align: "center", wordWrap: { width: pw - 36 }, lineSpacing: 3,
    }).setOrigin(0.5, 0));

    overlay.add(this.add.text(px, py + ph / 2 - 44, card.owned > 0 ? `✔ In your collection ×${card.owned}` : `💠 ${card.price} shards`, {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", fontStyle: "bold",
      color: card.owned > 0 ? "#8ef0bd" : "#9db2ff",
    }).setOrigin(0.5, 0));

    const close = this.add.text(px, py + ph / 2 - 20, "Close", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#fff", fontStyle: "bold",
      backgroundColor: "#3a4a80", padding: { x: 16, y: 5 },
    }).setOrigin(0.5, 0).setInteractive();
    close.on("pointerdown", () => { overlay.destroy(true); this.busy = false; });
    overlay.add(close);
  }

  private exit(): void {
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(this.returnTo);
    });
  }
}

function fit(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}
