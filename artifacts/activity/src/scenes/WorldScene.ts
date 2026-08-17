import Phaser from "phaser";
import type { DuelSetup } from "../duel/types";
import { getContext } from "../core/context";

// ─────────────────────────────────────────────────────────────────────────────
// WorldScene — a lightweight top-down open world (Battle City style). Adapted in
// spirit from the RPG template: connected areas, NPCs, doors, and duelist
// challenges that launch the true Yu-Gi-Oh duel. Each area is one screen (no
// external tilesets → nothing for Discord's CSP to block; art is procedural so
// it always renders). Walk to a glowing exit to travel; tap/approach a duelist
// to challenge them.
//
//   🏙️ Battle City ──door──▶ 🏪 Card Shop ──▶ 👨 Duelist ──challenge──▶ ⚔️ Duel
//        │ south                                   ▲ return
//        ▼                                         │
//   🌳 Route 1 ──east──▶ 🏙️ New City ─────────────┘
// ─────────────────────────────────────────────────────────────────────────────

interface Exit { x: number; y: number; w: number; h: number; to: string; spawn: string; label: string; }
interface Npc { id: string; x: number; y: number; glyph: string; name: string; line: string; duelist: boolean; }
interface Building { x: number; y: number; w: number; h: number; color: number; label: string; }
interface Area {
  key: string; name: string; ground: number; accent: number;
  spawns: Record<string, { x: number; y: number }>;
  exits: Exit[]; npcs: Npc[]; buildings: Building[];
}

// Fractions of the screen so every area is responsive.
function areas(W: number, H: number): Record<string, Area> {
  const defeated = WorldScene.defeated;
  return {
    battle_city: {
      key: "battle_city", name: "🏙️  Battle City", ground: 0x2a2f45, accent: 0x3a4a80,
      spawns: { start: { x: W * 0.5, y: H * 0.6 }, fromShop: { x: W * 0.7, y: H * 0.45 }, fromRoute: { x: W * 0.5, y: H * 0.2 } },
      buildings: [
        { x: W * 0.68, y: H * 0.32, w: W * 0.2, h: H * 0.18, color: 0x6b4a8f, label: "🏪 Card Shop" },
        { x: W * 0.22, y: H * 0.30, w: W * 0.18, h: H * 0.16, color: 0x445, label: "🏢 Arena" },
      ],
      exits: [
        { x: W * 0.68, y: H * 0.42, w: W * 0.09, h: H * 0.06, to: "card_shop_int", spawn: "enter", label: "Enter Shop" },
        { x: W * 0.5, y: H - 8, w: W * 0.24, h: 16, to: "route1", spawn: "fromCity", label: "▼ Route 1" },
      ],
      npcs: [
        { id: "greeter", x: W * 0.4, y: H * 0.62, glyph: "🧑", name: "Townsperson", line: "Welcome to Battle City! The Card Shop up north always has a duelist itching for a match.", duelist: false },
      ],
    },
    card_shop_int: {
      key: "card_shop_int", name: "🏠  Card Shop", ground: 0x3a2f4a, accent: 0x7b46b0,
      spawns: { enter: { x: W * 0.5, y: H * 0.8 } },
      buildings: [
        { x: W * 0.5, y: H * 0.2, w: W * 0.7, h: H * 0.14, color: 0x50406b, label: "🛒 Counter" },
      ],
      exits: [
        { x: W * 0.5, y: H - 8, w: W * 0.2, h: 16, to: "battle_city", spawn: "fromShop", label: "▼ Exit" },
      ],
      npcs: [
        { id: "shop_duelist", x: W * 0.5, y: H * 0.45, glyph: "👨", name: "Rex the Duelist", line: WorldScene.defeated.has("shop_duelist") ? "Good duel! Come back anytime." : "You look tough. Care for a duel? Winner keeps their pride!", duelist: !defeated.has("shop_duelist") },
      ],
    },
    route1: {
      key: "route1", name: "🌳  Route 1", ground: 0x24402f, accent: 0x2f8f5a,
      spawns: { fromCity: { x: W * 0.5, y: H * 0.2 }, fromNewCity: { x: W * 0.2, y: H * 0.5 } },
      buildings: [
        { x: W * 0.5, y: H * 0.5, w: W * 0.12, h: H * 0.1, color: 0x1e5e3a, label: "🌳" },
        { x: W * 0.3, y: H * 0.7, w: W * 0.1, h: H * 0.08, color: 0x1e5e3a, label: "🌳" },
      ],
      exits: [
        { x: W * 0.5, y: 8, w: W * 0.24, h: 16, to: "battle_city", spawn: "fromRoute", label: "▲ Battle City" },
        { x: W - 8, y: H * 0.5, w: 16, h: H * 0.24, to: "new_city", spawn: "fromRoute", label: "New City ▶" },
      ],
      npcs: [
        { id: "route_duelist", x: W * 0.65, y: H * 0.6, glyph: "🥷", name: "Wandering Duelist", line: WorldScene.defeated.has("route_duelist") ? "You bested me fair and square." : "Nobody passes Route 1 without a duel!", duelist: !defeated.has("route_duelist") },
      ],
    },
    new_city: {
      key: "new_city", name: "🏙️  New City", ground: 0x2f2a45, accent: 0x8a6bd0,
      spawns: { fromRoute: { x: W * 0.15, y: H * 0.5 } },
      buildings: [
        { x: W * 0.5, y: H * 0.28, w: W * 0.5, h: H * 0.16, color: 0x5a4a8f, label: "🏙️ Downtown" },
      ],
      exits: [
        { x: 8, y: H * 0.5, w: 16, h: H * 0.24, to: "route1", spawn: "fromNewCity", label: "◀ Route 1" },
      ],
      npcs: [
        { id: "champ", x: W * 0.6, y: H * 0.6, glyph: "👑", name: "City Champion", line: WorldScene.defeated.has("champ") ? "You're the real champion now." : "So you made it to New City. Face me — the Champion!", duelist: !defeated.has("champ") },
      ],
    },
  };
}

export class WorldScene extends Phaser.Scene {
  /** Duelists the player has beaten this session (persists across area loads). */
  static defeated = new Set<string>();

  private areaKey = "battle_city";
  private spawnKey = "start";
  private player!: Phaser.GameObjects.Container;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private move = { x: 0, y: 0 };
  private area!: Area;
  private worldLayer!: Phaser.GameObjects.Container;
  private prompt!: Phaser.GameObjects.Text;
  private nearNpc: Npc | null = null;
  private nearExit: Exit | null = null;
  private locked = false;
  private speed = 180;

  constructor() { super("World"); }

  static pendingArea: string | null = null;
  static pendingSpawn: string | null = null;

  init(data: { area?: string; spawn?: string; duelWon?: boolean }): void {
    // Returning from a duel started in the world.
    if (data && data.duelWon !== undefined) {
      if (WorldScene.pendingOpponent && data.duelWon) WorldScene.defeated.add(WorldScene.pendingOpponent);
      if (WorldScene.pendingArea) { this.areaKey = WorldScene.pendingArea; this.spawnKey = WorldScene.pendingSpawn ?? "start"; }
      WorldScene.pendingOpponent = null;
      return;
    }
    if (data?.area) this.areaKey = data.area;
    if (data?.spawn) this.spawnKey = data.spawn;
  }

  create(): void {
    document.getElementById("boot")?.remove();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D,E") as Record<string, Phaser.Input.Keyboard.Key>;
    this.worldLayer = this.add.container(0, 0);
    this.prompt = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#fff", backgroundColor: "#000000aa", padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(2000).setVisible(false);
    this.buildArea();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.buildArea, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.buildArea, this));
  }

  private buildArea = (): void => {
    this.worldLayer.removeAll(true);
    const W = this.scale.width, H = this.scale.height;
    this.area = areas(W, H)[this.areaKey]!;

    // Ground.
    const g = this.add.graphics();
    g.fillStyle(this.area.ground, 1); g.fillRect(0, 0, W, H);
    // Subtle grid.
    g.lineStyle(1, this.area.accent, 0.14);
    for (let x = 0; x < W; x += 40) g.lineBetween(x, 0, x, H);
    for (let y = 0; y < H; y += 40) g.lineBetween(0, y, W, y);
    this.worldLayer.add(g);

    // Area name.
    this.worldLayer.add(this.add.text(12, 10, this.area.name, {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#fff", fontStyle: "bold", stroke: "#000", strokeThickness: 4,
    }));
    this.worldLayer.add(this.add.text(12, 34, "Arrows / WASD to move · E or tap to interact", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#c9d4ff",
    }).setAlpha(0.8));

    // Buildings.
    for (const b of this.area.buildings) {
      const bg = this.add.graphics();
      bg.fillStyle(b.color, 1); bg.fillRoundedRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 8);
      bg.lineStyle(2, 0xffffff, 0.18); bg.strokeRoundedRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 8);
      this.worldLayer.add(bg);
      this.worldLayer.add(this.add.text(b.x, b.y, b.label, { fontSize: "15px", color: "#fff" }).setOrigin(0.5));
    }

    // Exits (glowing pads).
    for (const e of this.area.exits) {
      const eg = this.add.graphics();
      eg.fillStyle(0xffd75e, 0.22); eg.fillRoundedRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h, 6);
      eg.lineStyle(2, 0xffd75e, 0.8); eg.strokeRoundedRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h, 6);
      this.worldLayer.add(eg);
      this.worldLayer.add(this.add.text(e.x, e.y - e.h / 2 - 10, e.label, {
        fontSize: "11px", color: "#ffe9b0", fontStyle: "bold",
      }).setOrigin(0.5));
    }

    // NPCs.
    for (const n of this.area.npcs) {
      const npc = this.add.container(n.x, n.y);
      npc.add(this.add.circle(0, 0, 16, n.duelist ? 0xb84a4a : 0x4a7ab8, 0.9));
      npc.add(this.add.text(0, 0, n.glyph, { fontSize: "20px" }).setOrigin(0.5));
      if (n.duelist) npc.add(this.add.text(0, -26, "⚔", { fontSize: "14px", color: "#ffd75e" }).setOrigin(0.5));
      npc.setSize(40, 40).setInteractive(new Phaser.Geom.Rectangle(-20, -20, 40, 40), Phaser.Geom.Rectangle.Contains);
      npc.on("pointerdown", () => { if (this.dist(this.player, n) < 90) this.interact(n); });
      this.worldLayer.add(npc);
      this.worldLayer.add(this.add.text(n.x, n.y + 22, n.name, {
        fontSize: "10px", color: "#e6ecff",
      }).setOrigin(0.5).setAlpha(0.85));
    }

    // Player token.
    const sp = this.area.spawns[this.spawnKey] ?? Object.values(this.area.spawns)[0]!;
    this.player = this.add.container(sp.x, sp.y);
    this.player.add(this.add.circle(0, 0, 14, 0x2ec4ff, 1).setStrokeStyle(2, 0xffffff));
    this.player.add(this.add.text(0, 0, "🧢", { fontSize: "18px" }).setOrigin(0.5));
    this.player.setDepth(500);
    this.worldLayer.add(this.player);

    this.worldLayer.add(this.prompt);
    this.buildTouchControls(W, H);
  };

  private buildTouchControls(W: number, H: number): void {
    // On-screen D-pad + action button for touch. Also works with mouse.
    const btn = (x: number, y: number, r: number, label: string): Phaser.GameObjects.Container => {
      const c = this.add.container(x, y).setDepth(1500).setScrollFactor(0);
      c.add(this.add.circle(0, 0, r, 0x101830, 0.55).setStrokeStyle(2, 0x3a4a80));
      c.add(this.add.text(0, 0, label, { fontSize: `${r}px`, color: "#c9d4ff" }).setOrigin(0.5));
      c.setSize(r * 2, r * 2).setInteractive(new Phaser.Geom.Circle(0, 0, r), Phaser.Geom.Circle.Contains);
      return c;
    };
    const base = { x: 64, y: H - 76 };
    const dirs: Array<[string, number, number]> = [["▲", 0, -40], ["▼", 0, 40], ["◀", -40, 0], ["▶", 40, 0]];
    for (const [glyph, dx, dy] of dirs) {
      const b = btn(base.x + dx, base.y + dy, 20, glyph);
      const set = (on: boolean) => {
        if (dx < 0) this.move.x = on ? -1 : (this.move.x === -1 ? 0 : this.move.x);
        if (dx > 0) this.move.x = on ? 1 : (this.move.x === 1 ? 0 : this.move.x);
        if (dy < 0) this.move.y = on ? -1 : (this.move.y === -1 ? 0 : this.move.y);
        if (dy > 0) this.move.y = on ? 1 : (this.move.y === 1 ? 0 : this.move.y);
      };
      b.on("pointerdown", () => set(true));
      b.on("pointerup", () => set(false));
      b.on("pointerout", () => set(false));
      this.worldLayer.add(b);
    }
    const act = btn(W - 60, H - 76, 28, "E");
    act.on("pointerdown", () => this.onAction());
    this.worldLayer.add(act);
  }

  update(_t: number, delta: number): void {
    if (!this.player || this.locked) return;
    let dx = this.move.x, dy = this.move.y;
    if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;
    if (Phaser.Input.Keyboard.JustDown(this.wasd.E)) this.onAction();

    const len = Math.hypot(dx, dy) || 1;
    const step = (this.speed * delta) / 1000;
    const nx = Phaser.Math.Clamp(this.player.x + (dx / len) * step, 16, this.scale.width - 16);
    const ny = Phaser.Math.Clamp(this.player.y + (dy / len) * step, 16, this.scale.height - 16);
    this.player.setPosition(nx, ny);

    // Proximity checks.
    this.nearNpc = null; this.nearExit = null;
    for (const n of this.area.npcs) { if (this.dist(this.player, n) < 60) { this.nearNpc = n; break; } }
    for (const e of this.area.exits) {
      if (nx > e.x - e.w / 2 - 8 && nx < e.x + e.w / 2 + 8 && ny > e.y - e.h / 2 - 8 && ny < e.y + e.h / 2 + 8) { this.nearExit = e; break; }
    }

    if (this.nearExit) {
      this.travel(this.nearExit);
    } else if (this.nearNpc) {
      this.prompt.setText(`${this.nearNpc.name}: press E`).setPosition(this.player.x, this.player.y - 22).setVisible(true);
    } else {
      this.prompt.setVisible(false);
    }
  }

  private onAction(): void {
    if (this.locked) return;
    if (this.nearNpc) this.interact(this.nearNpc);
  }

  private interact(n: Npc): void {
    this.locked = true;
    this.dialogue(n.name, n.line, n.duelist, () => {
      this.locked = false;
      if (n.duelist) this.startDuel(n);
    });
  }

  private async startDuel(n: Npc): Promise<void> {
    this.locked = true;
    let setup: DuelSetup | undefined;
    try {
      setup = await getContext(this).api.duel();
      setup = { ...setup, opponent: { ...setup.opponent, name: n.name } };
    } catch {
      setup = undefined;
    }
    // Remember whom we're fighting + where, so a win marks them defeated and we
    // return to the same area on the way back.
    WorldScene.pendingOpponent = n.id;
    WorldScene.pendingArea = this.areaKey;
    WorldScene.pendingSpawn = this.spawnKey;
    this.scene.start("Duel", { setup, returnTo: "World" });
  }
  static pendingOpponent: string | null = null;

  private travel(e: Exit): void {
    this.locked = true;
    this.cameras.main.fadeOut(180);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.areaKey = e.to; this.spawnKey = e.spawn;
      this.move = { x: 0, y: 0 };
      this.buildArea();
      this.cameras.main.fadeIn(180);
      this.locked = false;
    });
  }

  private dialogue(name: string, line: string, duelist: boolean, onClose: () => void): void {
    const W = this.scale.width, H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(3000);
    c.add(this.add.rectangle(0, 0, W, H, 0x000000, 0.35).setOrigin(0).setInteractive());
    const bw = Math.min(W - 32, 560), bh = 120;
    const bx = W / 2, by = H - bh / 2 - 16;
    const g = this.add.graphics();
    g.fillStyle(0x121a2e, 0.98); g.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12);
    g.lineStyle(2, 0x3a4a80, 1); g.strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12);
    c.add(g);
    c.add(this.add.text(bx - bw / 2 + 16, by - bh / 2 + 12, name, { fontSize: "15px", color: "#ffe9b0", fontStyle: "bold" }));
    c.add(this.add.text(bx - bw / 2 + 16, by - bh / 2 + 38, line, {
      fontSize: "14px", color: "#e6ecff", wordWrap: { width: bw - 32 },
    }));
    const label = duelist ? "⚔ Duel!  (tap)" : "▶ (tap to close)";
    c.add(this.add.text(bx + bw / 2 - 16, by + bh / 2 - 18, label, { fontSize: "13px", color: "#9db2ff", fontStyle: "bold" }).setOrigin(1, 0.5));
    c.setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
    c.once("pointerdown", () => { c.destroy(true); onClose(); });
  }

  private dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
