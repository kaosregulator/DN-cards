// ─────────────────────────────────────────────────────────────────────────────
// CityScene — Starting Town.
//
// KEEP THE BONES: player movement, camera follow, NPCs, dialogue, doors,
// Shop / Duel transitions, mobile TouchPad, Discord Activity integration.
//
// REPLACE THE WORLD: this is NOT a procedural tile-grid of extruded cubes,
// and NOT the previous Domino Plaza / medieval fantasy asset dump.
// Terrain still uses isometric ground tiles. Buildings, trees, landmarks and
// props are large FLARE world objects placed from an authored map (a cropped
// Black Oak City region + plaza overlays). The player walks around a little
// RPG town, not across a grid prototype.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { getContext } from "../core/context";
import { gameState } from "../state/gameState";
import { DialogueBox } from "../ui/dialogue";
import { TouchPad } from "../ui/touchPad";
import { preloadCharSheets, composeChar, heroMap } from "../world/charSprites";
import { ensureCharTexture, CHAR_KEY, charFrame } from "../world/tiles";

const asset = (p: string): string => `${import.meta.env.BASE_URL}world/town/${p}`;

type Facing = "down" | "left" | "right" | "up";

interface TileMeta { w: number; h: number; ox: number; oy: number; }
interface OverlayDef {
  kind: string; tile: number; tx: number; ty: number;
  foot: [number, number]; label?: string; solid?: boolean;
}
interface TownNpc {
  id: string; key: string; tx: number; ty: number; name: string;
  lines: string[]; duelist?: boolean; role?: "shop"; defeatedLines?: string[];
}
interface DoorDef { tx: number; ty: number; to: "shop"; label: string; }
interface TownData {
  id: string; name: string;
  tileWidth: number; tileHeight: number;
  width: number; height: number;
  background: number[][];
  object: number[][];
  solid: boolean[][];
  tiles: Record<string, TileMeta>;
  overlays: OverlayDef[];
  spawn: { tx: number; ty: number; face: Facing };
  doors: DoorDef[];
  npcs: TownNpc[];
  cameraZoom?: number;
}

export class CityScene extends Phaser.Scene {
  private town!: TownData;
  private TILE_W = 64;
  private TILE_H = 32;
  private isoOX = 0;
  private isoOY = 0;

  private solid: boolean[][] = [];
  private player!: Phaser.GameObjects.Sprite;
  private facing: Facing = "up";
  private tileX = 0;
  private tileY = 0;
  private moving = false;
  private locked = false;
  private walkFrame: 0 | 1 = 0;

  private npcSprites: Array<{ def: TownNpc; sprite: Phaser.GameObjects.Image }> = [];
  private doorAt = new Map<string, DoorDef>();
  private world!: Phaser.GameObjects.Layer;
  private hud!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;
  private dialogue!: DialogueBox;
  private pad!: TouchPad;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() { super("City"); }

  init(data: { spawn?: string; duelWon?: boolean; npcId?: string }): void {
    if (data?.duelWon !== undefined && data.npcId && data.duelWon) gameState.defeat(data.npcId);
  }

  preload(): void {
    preloadCharSheets(this);
    this.load.json("starting_town", asset("starting_town.json"));
    // Tile PNGs are queued after JSON arrives in create via a second load pass
    // if needed — but Vite public JSON is available sync after load completes.
    // We also preload NPC sheets here by known keys.
    for (const k of ["villager_m", "villager_m2", "villager_f", "villager_f2", "trader"]) {
      const key = `tnpc:${k}`;
      if (!this.textures.exists(key)) this.load.image(key, asset(`npc/${k}.png`));
      if (!this.cache.json.exists(`tnpcmeta:${k}`)) this.load.json(`tnpcmeta:${k}`, asset(`npc/${k}.json`));
    }
  }

  create(): void {
    document.getElementById("boot")?.remove();
    this.town = this.cache.json.get("starting_town") as TownData;
    if (!this.town) {
      console.error("Starting Town map missing");
      this.scene.start("Menu");
      return;
    }
    this.TILE_W = this.town.tileWidth || 64;
    this.TILE_H = this.town.tileHeight || 32;

    // Queue every tile texture used by the map, then finish building once loaded.
    const needed = new Set<number>();
    for (const row of this.town.background) for (const id of row) if (id) needed.add(id);
    for (const row of this.town.object) for (const id of row) if (id) needed.add(id);
    for (const o of this.town.overlays ?? []) needed.add(o.tile);

    let pending = 0;
    for (const id of needed) {
      const key = `ft:${id}`;
      if (this.textures.exists(key)) continue;
      pending++;
      this.load.image(key, asset(`tiles/t${id}.png`));
    }

    const finish = (): void => this.finishCreate();
    if (pending > 0) {
      this.load.once(Phaser.Loader.Events.COMPLETE, finish);
      this.load.start();
    } else {
      finish();
    }
  }

  private finishCreate(): void {
    const T = this.town;
    this.isoOX = T.height * (this.TILE_W / 2);
    this.isoOY = this.TILE_H * 2;

    // Restore position if we were already in Starting Town.
    if (gameState.lastMap === "starting_town" || gameState.lastMap === "cityplaza") {
      this.tileX = gameState.lastX || T.spawn.tx;
      this.tileY = gameState.lastY || T.spawn.ty;
      this.facing = (gameState.lastFace as Facing) || T.spawn.face;
    } else {
      this.tileX = T.spawn.tx;
      this.tileY = T.spawn.ty;
      this.facing = T.spawn.face;
    }
    gameState.lastMap = "starting_town";
    gameState.lastX = this.tileX;
    gameState.lastY = this.tileY;
    gameState.lastFace = this.facing;

    this.solid = T.solid.map((r) => r.slice());
    this.doorAt.clear();
    for (const d of T.doors) {
      this.doorAt.set(`${d.tx},${d.ty}`, d);
      if (this.solid[d.ty]) this.solid[d.ty]![d.tx] = false;
    }

    this.world = this.add.layer();
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(100000);

    this.buildGround();
    this.buildObjects();
    this.buildOverlays();
    this.buildNpcs();
    this.buildPlayer();

    this.dialogue = new DialogueBox(this);
    this.pad = new TouchPad(this, { onAction: () => this.onAction(), onMenu: () => this.openPause() });
    this.hint = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#fff",
      backgroundColor: "#000000bb", padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(99000).setVisible(false);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
    const kb = this.input.keyboard!;
    kb.on("keydown-E", this.onAction, this);
    kb.on("keydown-SPACE", this.onAction, this);
    kb.on("keydown-ESC", this.openPause, this);

    const cam = this.cameras.main;
    cam.setBackgroundColor("#1a2a22");
    cam.startFollow(this.player, true, 0.14, 0.14);
    // Close RPG exploration camera — character + nearby buildings have weight.
    cam.setZoom(T.cameraZoom ?? 1.35);
    const worldW = this.isoOX + (T.width - 1) * (this.TILE_W / 2) + this.TILE_W * 2;
    const worldH = this.isoOY + (T.width + T.height) * (this.TILE_H / 2) + 800;
    cam.setBounds(-this.TILE_W * 2, -400, worldW + this.TILE_W * 4, worldH);

    this.buildHud();
    this.pad.layout();
    cam.fadeIn(280, 0, 0, 0);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      kb.off("keydown-E", this.onAction, this);
      kb.off("keydown-SPACE", this.onAction, this);
      kb.off("keydown-ESC", this.openPause, this);
      this.pad.destroy();
      this.dialogue.destroy();
    });
  }

  private onResize = (): void => { this.pad.layout(); this.buildHud(); };

  private iso(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.isoOX + (tx - ty) * (this.TILE_W / 2),
      y: this.isoOY + (tx + ty) * (this.TILE_H / 2),
    };
  }

  private meta(id: number): TileMeta | null {
    const m = this.town.tiles[String(id)] ?? this.town.tiles[id as unknown as string];
    return m ?? null;
  }

  private placeTile(id: number, tx: number, ty: number, depthBoost = 0): Phaser.GameObjects.Image | null {
    if (!id || !this.textures.exists(`ft:${id}`)) return null;
    const m = this.meta(id);
    const p = this.iso(tx, ty);
    const img = this.add.image(p.x, p.y, `ft:${id}`);
    if (m && m.w > 0 && m.h > 0) {
      // FLARE anchor (ox, oy) is the feet / ground contact inside the sprite.
      img.setOrigin(m.ox / m.w, m.oy / m.h);
    } else {
      img.setOrigin(0.5, 1);
    }
    const depth = p.y + depthBoost;
    img.setDepth(depth);
    this.world.add(img);
    return img;
  }

  private buildGround(): void {
    const gl = this.add.layer().setDepth(-100000);
    for (let ty = 0; ty < this.town.height; ty++) {
      for (let tx = 0; tx < this.town.width; tx++) {
        const id = this.town.background[ty]![tx]!;
        if (!id || !this.textures.exists(`ft:${id}`)) continue;
        const m = this.meta(id);
        const p = this.iso(tx, ty);
        const img = this.add.image(p.x, p.y, `ft:${id}`);
        if (m) img.setOrigin(m.ox / m.w, m.oy / m.h);
        else img.setOrigin(0.5, 0.5);
        gl.add(img);
      }
    }
  }

  private buildObjects(): void {
    // Object layer = large world pieces (trees, cliffs, structures) depth-sorted.
    for (let ty = 0; ty < this.town.height; ty++) {
      for (let tx = 0; tx < this.town.width; tx++) {
        const id = this.town.object[ty]![tx]!;
        if (!id) continue;
        this.placeTile(id, tx, ty, 4);
      }
    }
  }

  private buildOverlays(): void {
    for (const o of this.town.overlays ?? []) {
      const img = this.placeTile(o.tile, o.tx, o.ty, 8);
      if (img && o.label) {
        const p = this.iso(o.tx, o.ty);
        const t = this.add.text(p.x, p.y - (img.displayHeight * 0.55), o.label, {
          fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffe9b0",
          backgroundColor: "#00000099", padding: { x: 5, y: 2 },
        }).setOrigin(0.5, 1).setDepth(99000);
        this.world.add(t);
      }
    }
    for (const d of this.town.doors) {
      const p = this.iso(d.tx, d.ty);
      const t = this.add.text(p.x, p.y - this.TILE_H, d.label, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffe9b0",
        backgroundColor: "#00000099", padding: { x: 4, y: 2 },
      }).setOrigin(0.5, 1).setDepth(99000);
      this.world.add(t);
    }
  }

  private buildNpcs(): void {
    this.npcSprites = [];
    for (const n of this.town.npcs) {
      const p = this.iso(n.tx, n.ty);
      const tex = `tnpc:${n.key}`;
      const meta = this.cache.json.get(`tnpcmeta:${n.key}`) as { frameW: number; frameH: number; originY?: number } | undefined;
      let sprite: Phaser.GameObjects.Image;
      if (this.textures.exists(tex) && meta) {
        // Idle strip: down|left|right|up — show "down" by default via crop.
        if (!this.textures.exists(`${tex}:down`)) {
          const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
          for (let i = 0; i < 4; i++) {
            const c = document.createElement("canvas");
            c.width = meta.frameW; c.height = meta.frameH;
            const ctx = c.getContext("2d");
            if (ctx) ctx.drawImage(src, i * meta.frameW, 0, meta.frameW, meta.frameH, 0, 0, meta.frameW, meta.frameH);
            this.textures.addCanvas(`${tex}:${["down", "left", "right", "up"][i]}`, c);
          }
        }
        sprite = this.add.image(p.x, p.y, `${tex}:down`).setOrigin(0.5, meta.originY ?? 0.9);
      } else {
        sprite = this.add.image(p.x, p.y, tex).setOrigin(0.5, 0.9).setScale(0.55);
      }
      sprite.setDepth(p.y + 10);
      this.world.add(sprite);

      const beaten = gameState.isDefeated(n.id);
      const tag = n.role === "shop" ? "🛒" : n.duelist ? (beaten ? "✔" : "⚔") : "💬";
      const plate = this.add.text(p.x, p.y - sprite.displayHeight * 0.85, `${tag} ${n.name}`, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px",
        color: beaten ? "#8ef0bd" : "#ffe9b0",
        backgroundColor: "#00000099", padding: { x: 4, y: 1 },
      }).setOrigin(0.5, 1).setDepth(99000);
      this.world.add(plate);
      this.npcSprites.push({ def: n, sprite });
      this.solid[n.ty]![n.tx] = true;
    }
  }

  private buildPlayer(): void {
    if (!composeChar(this, "player", "hero", heroMap())) {
      ensureCharTexture(this, "player", { body: 0x2f6bd0, trim: 0xffe08a, skin: 0xe8b98c, hair: 0x2a1e14 });
    }
    const p = this.iso(this.tileX, this.tileY);
    // Substantial on-screen character to match close camera / FLARE object scale.
    this.player = this.add.sprite(p.x, p.y, CHAR_KEY("player"), charFrame(this.facing, 0))
      .setOrigin(0.5, 0.86).setScale(2.8);
    this.player.setDepth(p.y + 12);
    this.world.add(this.player);
    this.world.sort("depth");
  }

  private buildHud(): void {
    this.hud.removeAll(true);
    const W = this.scale.width;
    const snap = getContext(this).playerState.get();
    const name = snap?.user.username ?? "Traveler";
    const shards = snap?.player.shards ?? 0;
    const card = this.add.container(8, 8);
    const g = this.add.graphics();
    g.fillStyle(0x0b1020, 0.9); g.fillRoundedRect(0, 0, 210, 50, 10);
    g.lineStyle(2, 0x3a5db0, 0.95); g.strokeRoundedRect(0, 0, 210, 50, 10);
    card.add(g);
    card.add(this.add.circle(27, 25, 17, 0x2b57b8, 0.5).setStrokeStyle(2, 0x8fb0ff, 1));
    card.add(this.add.text(27, 25, (name[0] ?? "?").toUpperCase(), {
      fontFamily: "system-ui, sans-serif", fontSize: "17px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0.5));
    card.add(this.add.text(50, 8, name, {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0, 0));
    card.add(this.add.text(50, 28, `💠 ${shards.toLocaleString()}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#9fe0ff", fontStyle: "bold",
    }).setOrigin(0, 0));
    this.hud.add(card);

    const title = this.town?.name?.toUpperCase() ?? "STARTING TOWN";
    const bt = this.add.text(W / 2, 14, title, {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#bfe0ff", fontStyle: "bold",
    }).setOrigin(0.5, 0);
    const bw = bt.width + 26;
    const bg = this.add.graphics();
    bg.fillStyle(0x101a33, 0.85); bg.fillRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8);
    bg.lineStyle(1.5, 0x3a5db0, 0.8); bg.strokeRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8);
    this.hud.add(bg); this.hud.add(bt);
  }

  update(): void {
    if (this.locked || this.moving || !this.player || this.dialogue?.isOpen) return;
    let dx = 0, dy = 0;
    const pd = this.pad.direction();
    if (this.cursors.left.isDown || this.keys.A.isDown || pd.x < 0) dx = -1;
    else if (this.cursors.right.isDown || this.keys.D.isDown || pd.x > 0) dx = 1;
    else if (this.cursors.up.isDown || this.keys.W.isDown || pd.y < 0) dy = -1;
    else if (this.cursors.down.isDown || this.keys.S.isDown || pd.y > 0) dy = 1;
    if (!dx && !dy) {
      this.player.setFrame(charFrame(this.facing, 0));
      this.updateHint();
      return;
    }
    this.facing = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
    this.tryStep(dx, dy);
  }

  private tryStep(dx: number, dy: number): void {
    const nx = this.tileX + dx, ny = this.tileY + dy;
    const door = this.doorAt.get(`${nx},${ny}`);
    if (door) { this.enterShop(); return; }
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
    const p = this.iso(nx, ny);
    this.tweens.add({
      targets: this.player, x: p.x, y: p.y, duration: 150, ease: "Linear",
      onUpdate: () => { this.player.setDepth(this.player.y + 12); this.world.sort("depth"); },
      onComplete: () => {
        this.moving = false;
        this.player.setDepth(p.y + 12);
        this.world.sort("depth");
        this.updateHint();
      },
    });
  }

  private walkable(x: number, y: number): boolean {
    if (y < 0 || y >= this.solid.length || x < 0 || x >= (this.solid[0]?.length ?? 0)) return false;
    return !this.solid[y]![x];
  }

  private facingTile(): { x: number; y: number } {
    const d = this.facing;
    return {
      x: this.tileX + (d === "left" ? -1 : d === "right" ? 1 : 0),
      y: this.tileY + (d === "up" ? -1 : d === "down" ? 1 : 0),
    };
  }

  private npcAt(x: number, y: number): TownNpc | null {
    return this.npcSprites.find((n) => n.def.tx === x && n.def.ty === y)?.def ?? null;
  }

  private updateHint(): void {
    const t = this.facingTile();
    const npc = this.npcAt(t.x, t.y);
    const door = this.doorAt.get(`${t.x},${t.y}`);
    if (npc) {
      const verb = npc.role === "shop" ? "talk" : npc.duelist && !gameState.isDefeated(npc.id) ? "duel" : "talk";
      this.hint.setText(`E to ${verb}`).setPosition(this.player.x, this.player.y - 70).setVisible(true);
    } else if (door) {
      this.hint.setText("E to enter").setPosition(this.player.x, this.player.y - 70).setVisible(true);
    } else {
      this.hint.setVisible(false);
    }
  }

  private onAction = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.advance(); return; }
    if (this.locked) return;
    const t = this.facingTile();
    const door = this.doorAt.get(`${t.x},${t.y}`);
    if (door) { this.enterShop(); return; }
    const npc = this.npcAt(t.x, t.y);
    if (npc) this.interact(npc);
  };

  private interact(def: TownNpc): void {
    const beaten = gameState.isDefeated(def.id);
    const lines = beaten && def.defeatedLines?.length ? def.defeatedLines : def.lines;
    this.locked = true;
    this.dialogue.show(def.name, lines, () => {
      this.locked = false;
      this.hint.setVisible(false);
      if (def.role === "shop") { this.enterShop(); return; }
      if (def.duelist && !beaten) this.startDuel(def);
    });
  }

  private enterShop(): void {
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start("Shop", { returnTo: "City" });
    });
  }

  private async startDuel(def: TownNpc): Promise<void> {
    this.locked = true;
    const cam = this.cameras.main;
    for (let i = 0; i < 3; i++) { cam.flash(90, 255, 255, 255); await this.wait(150); }
    cam.fadeOut(420, 0, 0, 0);
    let setup;
    try {
      const api = getContext(this).api;
      setup = await api.duel();
      setup = { ...setup, opponent: { ...setup.opponent, name: def.name } };
    } catch { setup = undefined; }
    await this.wait(440);
    this.scene.start("Duel", { setup, returnTo: "City", npcId: def.id, opponentName: def.name });
  }

  private openPause = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.close(); this.locked = false; return; }
    if (this.locked) return;
    this.locked = true;
    this.dialogue.choice("Pause", [
      ["Resume", () => { this.locked = false; }],
      ["Main Menu", () => this.scene.start("Menu")],
    ], () => { this.locked = false; });
  };

  private wait(ms: number): Promise<void> {
    return new Promise((res) => this.time.delayedCall(ms, res));
  }
}
