import Phaser from "phaser";
import { getContext } from "../core/context";
import { TILE, TILE_KEY, SOLID, ensureTileTextures, ensureCharTexture, CHAR_KEY, charFrame, type TileKind } from "../world/tiles";
import { preloadCharSheets, composeChar, heroMap, npcMap, npcRowFor } from "../world/charSprites";
import { preloadTilesets, buildTilesetTextures } from "../world/tileset";
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
    preloadTilesets(this);
  }

  create(): void {
    document.getElementById("boot")?.remove();
    // Real tileset tiles claim their keys first; the procedural pass then fills
    // only the kinds the tilesets don't cover (doors, roofs, fences, …).
    buildTilesetTextures(this);
    ensureTileTextures(this);
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

    // Tiles.
    this.solid = [];
    for (let y = 0; y < h; y++) {
      this.solid[y] = [];
      for (let x = 0; x < w; x++) {
        const ch = g[y]![x] ?? ".";
        const kind = (LEGEND[ch] ?? "grass") as TileKind;
        const img = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE_KEY(kind));
        if (this.map.ambient !== 0xffffff) img.setTint(this.map.ambient);
        this.groundLayer.add(img);
        this.solid[y]![x] = SOLID.has(kind);
      }
    }
    // Doors are walkable and register a transition.
    for (const d of this.map.doors) {
      this.doorAt.set(`${d.x},${d.y}`, d);
      if (this.solid[d.y]) this.solid[d.y]![d.x] = false;
      if (d.label) {
        this.objectLayer.add(this.add.text(d.x * TILE + TILE / 2, d.y * TILE - 6, d.label, {
          fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffe9b0",
          backgroundColor: "#00000099", padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1).setDepth(5));
      }
    }
    // Signs.
    for (const s of this.map.signs ?? []) {
      this.objectLayer.add(this.add.text(s.x * TILE + TILE / 2, s.y * TILE, s.text, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#e6ecff",
        backgroundColor: "#0a0d1699", padding: { x: 5, y: 3 },
      }).setOrigin(0.5).setDepth(5));
    }

    // NPCs — real townsfolk sprites (varied by id), procedural fallback.
    for (const n of this.map.npcs) {
      if (!composeChar(this, n.id, "npc", npcMap(npcRowFor(n.id)))) {
        ensureCharTexture(this, n.id, n.colors);
      }
      const beaten = gameState.isDefeated(n.id);
      const spr = this.add.sprite(n.x * TILE + TILE / 2, n.y * TILE + TILE / 2 - 4, CHAR_KEY(n.id), charFrame(n.face ?? "down", 0));
      spr.setDepth(20 + n.y);
      this.objectLayer.add(spr);
      // Name plate + duelist marker.
      const tag = n.role === "shop" ? "🛒" : n.duelist ? (beaten ? "✔" : "⚔") : "";
      this.objectLayer.add(this.add.text(spr.x, spr.y - 22, `${tag} ${n.name}`.trim(), {
        fontFamily: "system-ui, sans-serif", fontSize: "10px", color: beaten ? "#8ef0bd" : "#ffe9b0",
        backgroundColor: "#00000088", padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1).setDepth(400));
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
    this.player = this.add.sprite(
      this.tileX * TILE + TILE / 2, this.tileY * TILE + TILE / 2 - 4,
      CHAR_KEY("player"), charFrame(this.facing, 0),
    ).setDepth(500);
    this.objectLayer.add(this.player);

    // Camera.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, w * TILE, h * TILE);
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setBackgroundColor(this.map.indoor ? "#120d18" : "#0a1020");
    // Zoom to show roughly a fixed window of tiles, so phones and desktops see a
    // comparable slice of the world (small interiors just fill the frame).
    const TILES_TALL = 15;
    const wanted = this.scale.height / (TILES_TALL * TILE);
    // Never zoom out past the map edges on either axis.
    const minFit = Math.max(this.scale.width / (w * TILE), this.scale.height / (h * TILE));
    const zoom = Phaser.Math.Clamp(Math.max(wanted, minFit), 0.9, 2.6);
    cam.setZoom(Number.isFinite(zoom) && zoom > 0 ? zoom : 1.4);

    this.buildHud();
    this.pad.layout();
  }

  private buildHud(): void {
    const label = this.add.text(10, 8, `📍 ${this.map.name}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "15px", color: "#fff", fontStyle: "bold",
      stroke: "#000", strokeThickness: 4,
    }).setScrollFactor(0);
    const beaten = gameState.defeatedCount();
    const prog = this.add.text(10, 28, `⚔ Duelists beaten: ${beaten}/${TOTAL_DUELISTS}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#c9d4ff",
      stroke: "#000", strokeThickness: 3,
    }).setScrollFactor(0);
    this.hud.add([label, prog]);
    this.layoutHud();
  }
  private layoutHud(): void { /* HUD is top-left anchored; nothing to reflow yet */ }

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
    this.tweens.add({
      targets: this.player,
      x: nx * TILE + TILE / 2,
      y: ny * TILE + TILE / 2 - 4,
      duration: 140,
      ease: "Linear",
      onComplete: () => {
        this.moving = false;
        this.player.setDepth(500);
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
