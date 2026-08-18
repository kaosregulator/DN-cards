import Phaser from "phaser";
import { getContext } from "../core/context";
import { SOLID, ensureCharTexture, CHAR_KEY, charFrame, type TileKind } from "../world/tiles";
import { preloadCharSheets, composeChar, heroMap, npcMap, npcRowFor } from "../world/charSprites";
import { ensureIsoTextures, isRaised, isoOrigin, ISO_KEY, ISO_W, ISO_H, ISO_LIFT } from "../world/isoTiles";
import { LEGEND, getMap, TOTAL_DUELISTS, type MapDef, type NpcDef, type DoorDef } from "../world/maps";
import { gameState } from "../state/gameState";
import { DialogueBox } from "../ui/dialogue";
import { TouchPad } from "../ui/touchPad";

// ─────────────────────────────────────────────────────────────────────────────
// WorldScene — the explorable overworld. Classic Game-Boy structure: tile maps
// bigger than the screen, a camera that follows the walker, solid-tile
// collision, doors that swap rooms behind a screen wipe, NPCs you walk up to
// and talk with, duelists that launch the card duel, and a shopkeeper that
// opens the card shop screen.
// ─────────────────────────────────────────────────────────────────────────────

type Facing = "down" | "left" | "right" | "up";

// Characters are drawn larger than a tile so they read as the focal actors on
// the isometric board (like the reference client's big overworld sprites).
const CHAR_SCALE = 1.6;

/** Duelist rank shown on the HUD player card, derived from level. */
function rankName(level: number): string {
  if (level >= 50) return "CHAMPION";
  if (level >= 35) return "MASTER";
  if (level >= 20) return "EXPERT";
  if (level >= 10) return "DUELIST";
  if (level >= 5) return "ROOKIE";
  return "BEGINNER";
}

interface NpcView { def: NpcDef; sprite: Phaser.GameObjects.Sprite; }

export class WorldScene extends Phaser.Scene {
  private mapId = "city";
  private spawnId = "start";

  private map!: MapDef;
  private solid: boolean[][] = [];
  private doorAt = new Map<string, DoorDef>();

  private player!: Phaser.GameObjects.Sprite;
  private facing: Facing = "down";
  private tileX = 0;
  private tileY = 0;
  private moving = false;
  private walkFrame: 0 | 1 = 0;

  private npcs: NpcView[] = [];
  private groundLayer!: Phaser.GameObjects.Container;
  private objectLayer!: Phaser.GameObjects.Container;
  // Isometric world origin (set per map so the grid sits fully on-screen).
  private isoOX = 0;
  private isoOY = 0;
  private isoScreen(tx: number, ty: number): { x: number; y: number } {
    return { x: this.isoOX + (tx - ty) * (ISO_W / 2), y: this.isoOY + (tx + ty) * (ISO_H / 2) };
  }
  private hud!: Phaser.GameObjects.Container;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private pad!: TouchPad;
  private dialogue!: DialogueBox;
  private locked = false;
  private hint!: Phaser.GameObjects.Text;

  constructor() { super("World"); }

  init(data: { map?: string; spawn?: string; duelWon?: boolean; npcId?: string }): void {
    // Returning from a duel: record the result and restore where we were.
    if (data && data.duelWon !== undefined) {
      if (data.npcId && data.duelWon) gameState.defeat(data.npcId);
      this.mapId = gameState.lastMap ?? "city";
      this.spawnId = "__restore";
      return;
    }
    this.mapId = data?.map ?? gameState.lastMap ?? "city";
    this.spawnId = data?.spawn ?? "start";
  }

  preload(): void {
    // Bundled, same-origin character sheets (CSP-safe). If a load fails the
    // world silently falls back to the procedural walkers / tiles.
    preloadCharSheets(this);
  }

  create(): void {
    document.getElementById("boot")?.remove();
    ensureIsoTextures(this);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
    // Discrete actions are event-driven (polling JustDown is unreliable);
    // movement stays polled from held keys / the touch pad.
    const kb = this.input.keyboard!;
    kb.on("keydown-E", this.onActionKey, this);
    kb.on("keydown-SPACE", this.onActionKey, this);
    kb.on("keydown-ESC", this.onMenuKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      kb.off("keydown-E", this.onActionKey, this);
      kb.off("keydown-SPACE", this.onActionKey, this);
      kb.off("keydown-ESC", this.onMenuKey, this);
    });

    this.groundLayer = this.add.container(0, 0).setDepth(0);
    this.objectLayer = this.add.container(0, 0).setDepth(10);
    this.hud = this.add.container(0, 0).setDepth(1000).setScrollFactor(0);

    this.dialogue = new DialogueBox(this);
    this.pad = new TouchPad(this, {
      onAction: () => this.onAction(),
      onMenu: () => this.openPauseMenu(),
    });
    this.hint = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#fff",
      backgroundColor: "#000000bb", padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(900).setVisible(false);

    this.buildMap();
    this.cameras.main.fadeIn(260, 0, 0, 0);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      this.pad.destroy();
      this.dialogue.destroy();
    });
  }

  private onResize = (): void => { this.pad.layout(); this.layoutHud(); };

  // ── Map construction ────────────────────────────────────────────────────────
  private buildMap(): void {
    this.groundLayer.removeAll(true);
    this.objectLayer.removeAll(true);
    this.hud.removeAll(true);
    this.npcs = [];
    this.doorAt.clear();

    this.map = getMap(this.mapId);
    gameState.lastMap = this.mapId;
    const g = this.map.grid;
    const h = g.length, w = g[0]!.length;

    // Isometric world origin: shift right so the leftmost column lands at x≈0,
    // with headroom above for raised blocks.
    this.isoOX = h * (ISO_W / 2);
    this.isoOY = ISO_LIFT + ISO_H;

    // Tiles — flat floor into the ground layer (drawn back-to-front), raised
    // blocks (walls, trees, buildings, furniture) into the depth-sorted object
    // layer so the player passes correctly in front of / behind them.
    this.solid = [];
    for (let y = 0; y < h; y++) {
      this.solid[y] = [];
      for (let x = 0; x < w; x++) {
        const ch = g[y]![x] ?? ".";
        const kind = (LEGEND[ch] ?? "grass") as TileKind;
        this.solid[y]![x] = SOLID.has(kind);
        const p = this.isoScreen(x, y);
        const img = this.add.image(p.x, p.y, ISO_KEY(kind));
        if (this.map.ambient !== 0xffffff) img.setTint(this.map.ambient);
        if (isRaised(kind)) {
          const o = isoOrigin(kind);
          img.setOrigin(o.ox, o.oy).setDepth(p.y);
          this.objectLayer.add(img);
        } else {
          img.setOrigin(0.5, 0.5);
          this.groundLayer.add(img);
        }
      }
    }
    // Doors are walkable and register a transition (label floats above the tile).
    for (const d of this.map.doors) {
      this.doorAt.set(`${d.x},${d.y}`, d);
      if (this.solid[d.y]) this.solid[d.y]![d.x] = false;
      if (d.label) {
        const p = this.isoScreen(d.x, d.y);
        this.objectLayer.add(this.add.text(p.x, p.y - ISO_H, d.label, {
          fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffe9b0",
          backgroundColor: "#00000099", padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1).setDepth(90000));
      }
    }
    // Signs.
    for (const s of this.map.signs ?? []) {
      const p = this.isoScreen(s.x, s.y);
      this.objectLayer.add(this.add.text(p.x, p.y - ISO_H / 2, s.text, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#e6ecff",
        backgroundColor: "#0a0d1699", padding: { x: 5, y: 3 },
      }).setOrigin(0.5).setDepth(90000));
    }

    // NPCs — real townsfolk sprites (varied by id), procedural fallback.
    for (const n of this.map.npcs) {
      if (!composeChar(this, n.id, "npc", npcMap(npcRowFor(n.id)))) {
        ensureCharTexture(this, n.id, n.colors);
      }
      const beaten = gameState.isDefeated(n.id);
      const p = this.isoScreen(n.x, n.y);
      const spr = this.add.sprite(p.x, p.y - ISO_H * 0.25, CHAR_KEY(n.id), charFrame(n.face ?? "down", 0))
        .setOrigin(0.5, 0.86).setScale(CHAR_SCALE).setDepth(p.y);
      this.objectLayer.add(spr);
      // Name plate + duelist marker.
      const tag = n.role === "shop" ? "🛒" : n.duelist ? (beaten ? "✔" : "⚔") : "";
      this.objectLayer.add(this.add.text(p.x, p.y - ISO_H * 0.25 - 40, `${tag} ${n.name}`.trim(), {
        fontFamily: "system-ui, sans-serif", fontSize: "10px", color: beaten ? "#8ef0bd" : "#ffe9b0",
        backgroundColor: "#00000088", padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1).setDepth(90000));
      this.solid[n.y]![n.x] = true; // can't walk through people
      this.npcs.push({ def: n, sprite: spr });
    }

    // Player — the real animated hero sheet when it loaded, else procedural.
    if (!composeChar(this, "player", "hero", heroMap())) {
      ensureCharTexture(this, "player", { body: 0x2f6bd0, trim: 0xffe08a, skin: 0xe8b98c, hair: 0x2a1e14 });
    }
    const sp = this.spawnId === "__restore"
      ? { x: gameState.lastX, y: gameState.lastY, face: gameState.lastFace as Facing }
      : (this.map.spawns[this.spawnId] ?? Object.values(this.map.spawns)[0]!);
    this.tileX = sp.x; this.tileY = sp.y;
    this.facing = (sp.face as Facing) ?? "down";
    const pp = this.isoScreen(this.tileX, this.tileY);
    this.player = this.add.sprite(pp.x, pp.y - ISO_H * 0.25, CHAR_KEY("player"), charFrame(this.facing, 0))
      .setOrigin(0.5, 0.86).setScale(CHAR_SCALE).setDepth(pp.y);
    this.objectLayer.add(this.player);
    this.objectLayer.sort("depth");

    // Camera — bounds cover the whole diamond, follow the player.
    const cam = this.cameras.main;
    const worldW = this.isoOX + (w - 1) * (ISO_W / 2) + ISO_W;
    const worldH = this.isoOY + (w + h - 2) * (ISO_H / 2) + ISO_H + ISO_LIFT;
    cam.setBounds(-ISO_W, -(ISO_LIFT + ISO_H), worldW + ISO_W * 2, worldH + ISO_LIFT + ISO_H * 3);
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setBackgroundColor(this.map.indoor ? "#120d18" : "#0a1020");
    // Render at 1× so the fixed (scrollFactor-0) HUD isn't scaled by camera
    // zoom; character sprites are already drawn larger via CHAR_SCALE.
    cam.setZoom(1);

    this.buildHud();
    this.pad.layout();
  }

  // ── HUD (ygoevolution-style overlay) ─────────────────────────────────────────
  private buildHud(): void {
    this.hud.removeAll(true);
    const W = this.scale.width, H = this.scale.height;
    const narrow = W < 560;
    const snap = getContext(this).playerState.get();
    const name = snap?.user.username ?? "Duelist";
    const level = snap?.player.level ?? 1;
    const shards = snap?.player.shards ?? 0;
    const beaten = gameState.defeatedCount();

    // Player card (top-left): avatar, name + rank, duel progress + shards.
    const cardW = narrow ? 178 : 226, cardH = 54;
    const card = this.add.container(8, 8);
    const cg = this.add.graphics();
    cg.fillStyle(0x0b1020, 0.9); cg.fillRoundedRect(0, 0, cardW, cardH, 10);
    cg.lineStyle(2, 0x3a5db0, 0.95); cg.strokeRoundedRect(0, 0, cardW, cardH, 10);
    card.add(cg);
    card.add(this.add.circle(29, cardH / 2, 18, 0x2b57b8, 0.5).setStrokeStyle(2, 0x8fb0ff, 1));
    card.add(this.add.text(29, cardH / 2, (name[0] ?? "?").toUpperCase(), {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0.5));
    card.add(this.add.text(54, 8, name, {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0, 0));
    const rank = rankName(level);
    const rw = 8 + rank.length * 6.4;
    const rg = this.add.graphics();
    rg.fillStyle(0xc9a24f, 0.95); rg.fillRoundedRect(cardW - rw - 8, 8, rw, 15, 4);
    card.add(rg);
    card.add(this.add.text(cardW - rw / 2 - 8, 15, rank, {
      fontFamily: "system-ui, sans-serif", fontSize: "9px", color: "#1a1408", fontStyle: "bold",
    }).setOrigin(0.5));
    card.add(this.add.text(54, 30, `⚔ ${beaten}/${TOTAL_DUELISTS}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffd75e", fontStyle: "bold",
    }).setOrigin(0, 0));
    card.add(this.add.text(54 + (narrow ? 62 : 74), 30, `💠 ${shards.toLocaleString()}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#9fe0ff", fontStyle: "bold",
    }).setOrigin(0, 0));
    this.hud.add(card);

    // Area banner (top-centre).
    const banner = this.add.container(W / 2, 12);
    const bt = this.add.text(0, 8, this.map.name.toUpperCase(), {
      fontFamily: "system-ui, sans-serif", fontSize: narrow ? "12px" : "14px", color: "#bfe0ff", fontStyle: "bold",
    }).setOrigin(0.5, 0);
    const bw = bt.width + 28;
    const bg = this.add.graphics();
    bg.fillStyle(0x101a33, 0.85); bg.fillRoundedRect(-bw / 2, 4, bw, 26, 8);
    bg.lineStyle(1.5, 0x3a5db0, 0.8); bg.strokeRoundedRect(-bw / 2, 4, bw, 26, 8);
    banner.add([bg, bt]);
    this.hud.add(banner);

    // Top-right quick buttons.
    let bx = W - 8;
    for (const [label, fn] of [
      ["☰ MENU", () => this.openPauseMenu()],
      ["🛒 SHOP", () => this.openShop()],
      ["🗺 MAP", () => this.flashMap()],
    ] as Array<[string, () => void]>) {
      const b = this.hudPill(label, fn);
      b.x = bx - (b.getData("w") as number); b.y = 8;
      bx -= (b.getData("w") as number) + 6;
      this.hud.add(b);
    }
    this.hud.add(this.add.text(bx - 6, 18, "● 1 online", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#8ef0bd",
    }).setOrigin(1, 0.5));

    // Chat bar (bottom-left) — presentation shell for now (no networked chat yet).
    if (!narrow || H > 620) {
      const chW = Math.min(360, W - 16), chH = 40;
      const chat = this.add.container(8, H - chH - 8);
      const chg = this.add.graphics();
      chg.fillStyle(0x0a0d16, 0.72); chg.fillRoundedRect(0, 0, chW, chH, 8);
      chg.lineStyle(1, 0x2f3c66, 0.9); chg.strokeRoundedRect(0, 0, chW, chH, 8);
      chat.add(chg);
      chg.fillStyle(0x2b57b8, 0.9); chg.fillRoundedRect(6, 6, 52, 15, 4);
      chat.add(this.add.text(32, 13, "WORLD", { fontFamily: "system-ui, sans-serif", fontSize: "9px", color: "#fff", fontStyle: "bold" }).setOrigin(0.5));
      chat.add(this.add.text(70, 13, "LOCAL", { fontFamily: "system-ui, sans-serif", fontSize: "9px", color: "#6a7aa8", fontStyle: "bold" }).setOrigin(0, 0.5));
      chat.add(this.add.text(10, 28, "Press Enter — message everyone", {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#5f6b96",
      }).setOrigin(0, 0.5));
      this.hud.add(chat);
    }
  }

  /** A small rounded HUD button. Stores its width in data("w"). */
  private hudPill(label: string, onClick: () => void): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const t = this.add.text(0, 0, label, {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#dbe4ff", fontStyle: "bold",
    }).setOrigin(0, 0.5);
    const w = t.width + 20, h = 26;
    const g = this.add.graphics();
    g.fillStyle(0x1b2340, 0.92); g.fillRoundedRect(0, 0, w, h, 7);
    g.lineStyle(1.5, 0x3a5db0, 0.9); g.strokeRoundedRect(0, 0, w, h, 7);
    t.setPosition(10, h / 2);
    c.add([g, t]);
    c.setData("w", w);
    c.setSize(w, h).setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    c.on("pointerdown", onClick);
    c.on("pointerover", () => c.setAlpha(0.85));
    c.on("pointerout", () => c.setAlpha(1));
    return c;
  }

  private flashMap(): void {
    const beaten = gameState.defeatedCount();
    this.hint.setText(`${this.map.name} · ${beaten}/${TOTAL_DUELISTS} duelists beaten`)
      .setPosition(this.player.x, this.player.y - 40).setVisible(true);
    this.time.delayedCall(1800, () => this.hint.setVisible(false));
  }

  private layoutHud(): void { if (this.map) this.buildHud(); }

  // ── Movement ────────────────────────────────────────────────────────────────
  /** E / Space — talk, advance dialogue, interact. */
  private onActionKey = (): void => {
    if (!this.player) return;
    this.onAction();
  };
  private onMenuKey = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.close(); this.locked = false; return; }
    this.openPauseMenu();
  };

  update(): void {
    if (this.locked || this.moving || !this.player) return;
    if (this.dialogue.isOpen) return;

    let dx = 0, dy = 0;
    const p = this.pad.direction();
    if (this.cursors.left.isDown || this.keys.A.isDown || p.x < 0) dx = -1;
    else if (this.cursors.right.isDown || this.keys.D.isDown || p.x > 0) dx = 1;
    else if (this.cursors.up.isDown || this.keys.W.isDown || p.y < 0) dy = -1;
    else if (this.cursors.down.isDown || this.keys.S.isDown || p.y > 0) dy = 1;
    if (!dx && !dy) { this.player.setFrame(charFrame(this.facing, 0)); this.updateHint(); return; }

    this.facing = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
    this.tryStep(dx, dy);
  }

  private tryStep(dx: number, dy: number): void {
    const nx = this.tileX + dx, ny = this.tileY + dy;
    // Door first — stepping onto it travels.
    const door = this.doorAt.get(`${nx},${ny}`);
    if (door) { this.travel(door); return; }
    if (!this.walkable(nx, ny)) {
      this.player.setFrame(charFrame(this.facing, 0));
      this.updateHint();
      return;
    }
    this.moving = true;
    this.walkFrame = this.walkFrame === 0 ? 1 : 0;
    this.player.setFrame(charFrame(this.facing, this.walkFrame));
    this.tileX = nx; this.tileY = ny;
    gameState.lastX = nx; gameState.lastY = ny; gameState.lastFace = this.facing;
    const p = this.isoScreen(nx, ny);
    this.tweens.add({
      targets: this.player,
      x: p.x,
      y: p.y - ISO_H * 0.25,
      duration: 150,
      ease: "Linear",
      onUpdate: () => { this.player.setDepth(this.player.y + ISO_H * 0.25); this.objectLayer.sort("depth"); },
      onComplete: () => {
        this.moving = false;
        this.player.setDepth(p.y);
        this.objectLayer.sort("depth");
        this.updateHint();
      },
    });
  }

  private walkable(x: number, y: number): boolean {
    if (y < 0 || y >= this.solid.length) return false;
    const row = this.solid[y]!;
    if (x < 0 || x >= row.length) return false;
    return !row[x];
  }

  /** Show a prompt when facing something interactive. */
  private updateHint(): void {
    const t = this.facingTile();
    const npc = this.npcAt(t.x, t.y);
    if (npc) {
      const verb = npc.def.role === "shop" ? "browse" : npc.def.duelist && !gameState.isDefeated(npc.def.id) ? "duel" : "talk";
      this.hint.setText(`E to ${verb}`)
        .setPosition(this.player.x, this.player.y - 30).setVisible(true);
    } else {
      this.hint.setVisible(false);
    }
  }

  private facingTile(): { x: number; y: number } {
    const d = this.facing;
    return {
      x: this.tileX + (d === "left" ? -1 : d === "right" ? 1 : 0),
      y: this.tileY + (d === "up" ? -1 : d === "down" ? 1 : 0),
    };
  }
  private npcAt(x: number, y: number): NpcView | null {
    return this.npcs.find((n) => n.def.x === x && n.def.y === y) ?? null;
  }

  // ── Interaction ─────────────────────────────────────────────────────────────
  private onAction(): void {
    if (this.locked || this.dialogue.isOpen) { this.dialogue.advance(); return; }
    const t = this.facingTile();
    const npc = this.npcAt(t.x, t.y);
    if (!npc) return;
    this.interact(npc);
  }

  private interact(npc: NpcView): void {
    const def = npc.def;
    // Face the player.
    const dx = this.tileX - def.x, dy = this.tileY - def.y;
    const face: Facing = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
    npc.sprite.setFrame(charFrame(face, 0));

    const beaten = gameState.isDefeated(def.id);
    const lines = beaten && def.defeatedLines?.length ? def.defeatedLines : def.lines;
    this.locked = true;
    this.dialogue.show(def.name, lines, () => {
      this.locked = false;
      this.hint.setVisible(false);
      if (def.role === "shop") { this.openShop(); return; }
      if (def.duelist && !beaten) this.startDuel(def);
    });
  }

  private openShop(): void {
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start("Shop", { returnTo: "World" });
    });
  }

  /** Battle transition — the classic flash + wipe into the duel scene. */
  private async startDuel(def: NpcDef): Promise<void> {
    this.locked = true;
    const cam = this.cameras.main;
    // Triple flash, then a zoom-punch and fade — Game-Boy encounter feel.
    for (let i = 0; i < 3; i++) {
      cam.flash(90, 255, 255, 255);
      await this.wait(150);
    }
    this.tweens.add({ targets: cam, zoom: cam.zoom * 1.6, duration: 420, ease: "Cubic.In" });
    cam.fadeOut(420, 0, 0, 0);
    let setup;
    try {
      const api = getContext(this).api;
      setup = await api.duel();
      setup = { ...setup, opponent: { ...setup.opponent, name: def.name } };
    } catch { setup = undefined; }
    await this.wait(440);
    this.scene.start("Duel", { setup, returnTo: "World", npcId: def.id, opponentName: def.name });
  }

  private travel(door: DoorDef): void {
    this.locked = true;
    this.hint.setVisible(false);
    const cam = this.cameras.main;
    cam.fadeOut(200, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.mapId = door.to;
      this.spawnId = door.spawn;
      this.buildMap();
      cam.fadeIn(240, 0, 0, 0);
      this.locked = false;
    });
  }

  private openPauseMenu(): void {
    if (this.locked) return;
    this.locked = true;
    this.dialogue.choice("Pause", [
      ["Resume", () => { this.locked = false; }],
      ["Main Menu", () => { this.scene.start("Menu"); }],
    ], () => { this.locked = false; });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((res) => this.time.delayedCall(ms, res));
  }
}
