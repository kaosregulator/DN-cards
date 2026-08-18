// ─────────────────────────────────────────────────────────────────────────────
// CityScene — a hand-authored isometric town plaza built from REAL detailed
// art (SpriteCook CC0 isometric buildings, props, textures, and characters),
// NOT a procedural tile grid. Buildings, a fountain, props and NPCs are placed
// by hand on an isometric ground; the player walks around with a close camera,
// proper depth/occlusion, and can enter the shop, talk to NPCs and start duels
// — reusing the existing Shop and Duel scenes untouched.
//
// Assets ship from public/world/city/ (same-origin, CSP-safe). All the game
// systems (duel engine, DN Cards, shop, dialogue, progression, Discord) are
// untouched; only the world PRESENTATION lives here.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { getContext } from "../core/context";
import { gameState } from "../state/gameState";
import { DialogueBox } from "../ui/dialogue";
import { TouchPad } from "../ui/touchPad";
import { preloadCharSheets, composeChar, heroMap } from "../world/charSprites";
import { ensureCharTexture, CHAR_KEY, charFrame } from "../world/tiles";

const TILE_W = 128, TILE_H = 64;                 // 2:1 isometric ground diamond
const asset = (p: string): string => `${import.meta.env.BASE_URL}world/city/${p}`;

type Facing = "down" | "left" | "right" | "up";
type Ground = "grass" | "cobble" | "water";

interface BuildingDef {
  key: string; tx: number; ty: number;     // anchor cell (front-centre)
  scale: number; foot: [number, number];   // footprint w×h in cells (solid)
  label?: string;
}
interface PropDef { key: string; tx: number; ty: number; scale: number; solid?: boolean; }
interface CityNpc {
  id: string; key: string; tx: number; ty: number; name: string;
  lines: string[]; duelist?: boolean; role?: "shop"; defeatedLines?: string[];
}
interface DoorDef { tx: number; ty: number; to: "shop"; label: string; }

// ── The authored plaza ───────────────────────────────────────────────────────
const GRID = 24;
const BUILDINGS: BuildingDef[] = [
  { key: "building1", tx: 5, ty: 5, scale: 1.15, foot: [3, 3], label: "🏪 Card Emporium" },
  { key: "building6", tx: 5, ty: 16, scale: 1.15, foot: [3, 3], label: "⛪ Duel Chapel" },
  { key: "building11", tx: 17, ty: 5, scale: 1.2, foot: [3, 3], label: "⚒ The Forge" },
  { key: "building2", tx: 17, ty: 16, scale: 1.1, foot: [3, 3], label: "🏠 Inn" },
  { key: "building3", tx: 11, ty: 2, scale: 1.0, foot: [3, 2] },
  { key: "building7", tx: 2, ty: 11, scale: 1.0, foot: [2, 3] },
  { key: "building5", tx: 21, ty: 11, scale: 1.0, foot: [2, 3] },
];
const PROPS: PropDef[] = [
  { key: "barrel", tx: 8, ty: 8, scale: 0.34, solid: true },
  { key: "crate_intact", tx: 9, ty: 8, scale: 0.34, solid: true },
  { key: "crate_damaged", tx: 15, ty: 9, scale: 0.34, solid: true },
  { key: "barrel", tx: 16, ty: 15, scale: 0.34, solid: true },
  { key: "chest_closed", tx: 8, ty: 15, scale: 0.32, solid: true },
  { key: "crate_intact", tx: 15, ty: 16, scale: 0.34, solid: true },
];
const NPCS: CityNpc[] = [
  {
    id: "city_shopkeeper", key: "gnome_merchant", tx: 8, ty: 6, name: "Merchant Rowe", role: "shop",
    lines: ["Welcome to the Card Emporium!", "Every card in the realm is on my shelves — step inside and browse."],
  },
  {
    id: "city_knight", key: "battleworn_knight", tx: 12, ty: 12, name: "Sir Garan", duelist: true,
    lines: ["A new challenger walks the plaza.", "Draw your deck — let us duel!"],
    defeatedLines: ["You fight well. The Forge master will want a match."],
  },
  {
    id: "city_archer", key: "forest_archer", tx: 18, ty: 12, name: "Archer Lyn",
    lines: ["The Forge to the north hides a fierce duelist.", "Tributes win games — never summon your big monsters for free."],
  },
  {
    id: "city_smith", key: "monster_hunter", tx: 17, ty: 8, name: "Forge Master", duelist: true,
    lines: ["You reached my Forge.", "Beat me and the plaza is yours to rule."],
    defeatedLines: ["Steel sharpens steel. Well fought, duelist."],
  },
];
const DOORS: DoorDef[] = [{ tx: 6, ty: 7, to: "shop", label: "▼ Enter" }];
const SPAWN = { tx: 11, ty: 13, face: "up" as Facing };

// Central fountain footprint (water) + a cobble plaza ring around the middle.
function groundAt(tx: number, ty: number): Ground {
  if (tx >= 11 && tx <= 12 && ty >= 10 && ty <= 11) return "water";
  if (tx >= 8 && tx <= 15 && ty >= 7 && ty <= 14) return "cobble";
  return "grass";
}

export class CityScene extends Phaser.Scene {
  private isoOX = 0; private isoOY = 0;
  private solid: boolean[][] = [];
  private player!: Phaser.GameObjects.Sprite;
  private facing: Facing = "up";
  private tileX = SPAWN.tx; private tileY = SPAWN.ty;
  private moving = false; private locked = false; private walkFrame: 0 | 1 = 0;
  private npcSprites: Array<{ def: CityNpc; sprite: Phaser.GameObjects.GameObject }> = [];
  private doorAt = new Map<string, DoorDef>();
  private objects: Phaser.GameObjects.GameObject[] = [];
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
    // Returning from the shop or a duel restores the exact spot; a fresh entry
    // from the menu starts at the plaza spawn.
    if (gameState.lastMap === "cityplaza") {
      this.tileX = gameState.lastX || SPAWN.tx; this.tileY = gameState.lastY || SPAWN.ty;
      this.facing = (gameState.lastFace as Facing) || SPAWN.face;
    } else {
      this.tileX = SPAWN.tx; this.tileY = SPAWN.ty; this.facing = SPAWN.face;
      gameState.lastMap = "cityplaza"; gameState.lastX = SPAWN.tx; gameState.lastY = SPAWN.ty; gameState.lastFace = SPAWN.face;
    }
  }

  preload(): void {
    preloadCharSheets(this);
    for (const t of ["grass", "dirt", "water"]) if (!this.textures.exists(`ct:${t}`)) this.load.image(`ct:${t}`, asset(`ground/${t}.png`));
    for (const b of BUILDINGS) if (!this.textures.exists(`cb:${b.key}`)) this.load.image(`cb:${b.key}`, asset(`buildings/${b.key}.png`));
    for (const p of new Set(PROPS.map((p) => p.key))) if (!this.textures.exists(`cp:${p}`)) this.load.image(`cp:${p}`, asset(`props/${p}.png`));
    for (const n of NPCS) if (!this.textures.exists(`cn:${n.key}`)) this.load.image(`cn:${n.key}`, asset(`npc/${n.key}.png`));
  }

  private iso(tx: number, ty: number): { x: number; y: number } {
    return { x: this.isoOX + (tx - ty) * (TILE_W / 2), y: this.isoOY + (tx + ty) * (TILE_H / 2) };
  }

  create(): void {
    document.getElementById("boot")?.remove();
    this.isoOX = GRID * (TILE_W / 2);
    this.isoOY = TILE_H;
    this.makeGroundTiles();

    this.world = this.add.layer();
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(100000);

    this.buildGround();
    this.buildSolids();
    this.buildBuildingsAndProps();
    this.buildNpcs();
    this.buildPlayer();

    this.dialogue = new DialogueBox(this);
    this.pad = new TouchPad(this, { onAction: () => this.onAction(), onMenu: () => this.openPause() });
    this.hint = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#fff", backgroundColor: "#000000bb", padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(99000).setVisible(false);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
    const kb = this.input.keyboard!;
    kb.on("keydown-E", this.onAction, this); kb.on("keydown-SPACE", this.onAction, this); kb.on("keydown-ESC", this.openPause, this);

    const cam = this.cameras.main;
    cam.setBackgroundColor("#243a2a");
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setZoom(1);

    this.buildHud();
    this.pad.layout();
    cam.fadeIn(280, 0, 0, 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      kb.off("keydown-E", this.onAction, this); kb.off("keydown-SPACE", this.onAction, this); kb.off("keydown-ESC", this.openPause, this);
      this.pad.destroy(); this.dialogue.destroy();
    });
  }

  private onResize = (): void => { this.pad.layout(); this.buildHud(); };

  // ── Ground ──────────────────────────────────────────────────────────────────
  /** Build diamond-masked ground tiles from the seamless textures (once). */
  private makeGroundTiles(): void {
    const carve = (key: string, srcKey: string, tint?: [number, number, number]) => {
      if (this.textures.exists(key)) return;
      const src = this.textures.get(srcKey).getSourceImage() as CanvasImageSource;
      const c = document.createElement("canvas"); c.width = TILE_W; c.height = TILE_H;
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.beginPath(); ctx.moveTo(TILE_W / 2, 0); ctx.lineTo(TILE_W, TILE_H / 2); ctx.lineTo(TILE_W / 2, TILE_H); ctx.lineTo(0, TILE_H / 2); ctx.closePath(); ctx.clip();
      ctx.drawImage(src, 0, 0, (src as HTMLImageElement).width || 256, (src as HTMLImageElement).height || 256, 0, 0, TILE_W, TILE_H);
      if (tint) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; ctx.fillRect(0, 0, TILE_W, TILE_H); ctx.globalCompositeOperation = "source-over"; }
      // Soft diamond edge.
      ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(TILE_W / 2, 0); ctx.lineTo(TILE_W, TILE_H / 2); ctx.lineTo(TILE_W / 2, TILE_H); ctx.lineTo(0, TILE_H / 2); ctx.closePath(); ctx.stroke();
      this.textures.addCanvas(key, c);
    };
    carve("gt:grass", "ct:grass");
    carve("gt:cobble", "ct:dirt", [150, 150, 160]);
    carve("gt:water", "ct:water");
  }

  private buildGround(): void {
    const gl = this.add.layer().setDepth(-100000);
    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++) {
        const g = groundAt(tx, ty);
        const key = g === "water" ? "gt:water" : g === "cobble" ? "gt:cobble" : "gt:grass";
        const p = this.iso(tx, ty);
        gl.add(this.add.image(p.x, p.y, key).setOrigin(0.5, 0.5));
      }
    }
  }

  private buildSolids(): void {
    this.solid = Array.from({ length: GRID }, () => Array<boolean>(GRID).fill(false));
    const mark = (tx: number, ty: number) => { if (ty >= 0 && ty < GRID && tx >= 0 && tx < GRID) this.solid[ty]![tx] = true; };
    // Map border.
    for (let i = 0; i < GRID; i++) { mark(0, i); mark(GRID - 1, i); mark(i, 0); mark(i, GRID - 1); }
    // Building footprints.
    for (const b of BUILDINGS) for (let dx = 0; dx < b.foot[0]; dx++) for (let dy = 0; dy < b.foot[1]; dy++) mark(b.tx - Math.floor(b.foot[0] / 2) + dx, b.ty - b.foot[1] + 1 + dy);
    // Fountain water.
    for (let ty = 0; ty < GRID; ty++) for (let tx = 0; tx < GRID; tx++) if (groundAt(tx, ty) === "water") mark(tx, ty);
    // Props.
    for (const p of PROPS) if (p.solid) mark(p.tx, p.ty);
    // NPCs stand on solid tiles (can't walk through people); doors are open.
    for (const n of NPCS) mark(n.tx, n.ty);
    for (const d of DOORS) { this.doorAt.set(`${d.tx},${d.ty}`, d); if (this.solid[d.ty]) this.solid[d.ty]![d.tx] = false; }
  }

  private addObject(o: Phaser.GameObjects.GameObject & { setDepth: (d: number) => void }, depth: number): void {
    o.setDepth(depth); this.world.add(o); this.objects.push(o);
  }

  private buildBuildingsAndProps(): void {
    for (const b of BUILDINGS) {
      const p = this.iso(b.tx, b.ty);
      const img = this.add.image(p.x, p.y + TILE_H * 0.4, `cb:${b.key}`).setOrigin(0.5, 1).setScale(b.scale);
      this.addObject(img, p.y + 40);
      if (b.label) {
        const t = this.add.text(p.x, p.y - img.displayHeight * 0.9, b.label, {
          fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffe9b0", backgroundColor: "#00000099", padding: { x: 5, y: 2 },
        }).setOrigin(0.5, 1);
        this.addObject(t, 99000);
      }
    }
    for (const pr of PROPS) {
      const p = this.iso(pr.tx, pr.ty);
      const img = this.add.image(p.x, p.y + TILE_H * 0.35, `cp:${pr.key}`).setOrigin(0.5, 1).setScale(pr.scale);
      this.addObject(img, p.y + 10);
    }
  }

  private buildNpcs(): void {
    for (const n of NPCS) {
      const p = this.iso(n.tx, n.ty);
      const img = this.add.image(p.x, p.y + TILE_H * 0.3, `cn:${n.key}`).setOrigin(0.5, 1).setScale(0.28);
      this.addObject(img, p.y + 20);
      const beaten = gameState.isDefeated(n.id);
      const tag = n.role === "shop" ? "🛒" : n.duelist ? (beaten ? "✔" : "⚔") : "💬";
      const plate = this.add.text(p.x, p.y - img.displayHeight * 0.72, `${tag} ${n.name}`, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: beaten ? "#8ef0bd" : "#ffe9b0", backgroundColor: "#00000099", padding: { x: 4, y: 1 },
      }).setOrigin(0.5, 1);
      this.addObject(plate, 99000);
      this.npcSprites.push({ def: n, sprite: img });
    }
  }

  private buildPlayer(): void {
    if (!composeChar(this, "player", "hero", heroMap())) {
      ensureCharTexture(this, "player", { body: 0x2f6bd0, trim: 0xffe08a, skin: 0xe8b98c, hair: 0x2a1e14 });
    }
    const p = this.iso(this.tileX, this.tileY);
    this.player = this.add.sprite(p.x, p.y, CHAR_KEY("player"), charFrame(this.facing, 0)).setOrigin(0.5, 0.82).setScale(2.6);
    this.addObject(this.player, p.y);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  private buildHud(): void {
    this.hud.removeAll(true);
    const W = this.scale.width, H = this.scale.height;
    const snap = getContext(this).playerState.get();
    const name = snap?.user.username ?? "Duelist";
    const shards = snap?.player.shards ?? 0;
    const card = this.add.container(8, 8);
    const g = this.add.graphics();
    g.fillStyle(0x0b1020, 0.9); g.fillRoundedRect(0, 0, 210, 50, 10);
    g.lineStyle(2, 0x3a5db0, 0.95); g.strokeRoundedRect(0, 0, 210, 50, 10);
    card.add(g);
    card.add(this.add.circle(27, 25, 17, 0x2b57b8, 0.5).setStrokeStyle(2, 0x8fb0ff, 1));
    card.add(this.add.text(27, 25, (name[0] ?? "?").toUpperCase(), { fontFamily: "system-ui, sans-serif", fontSize: "17px", color: "#fff", fontStyle: "bold" }).setOrigin(0.5));
    card.add(this.add.text(50, 8, name, { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#fff", fontStyle: "bold" }).setOrigin(0, 0));
    card.add(this.add.text(50, 28, `💠 ${shards.toLocaleString()}`, { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#9fe0ff", fontStyle: "bold" }).setOrigin(0, 0));
    this.hud.add(card);
    const bt = this.add.text(W / 2, 14, "DOMINO PLAZA", { fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#bfe0ff", fontStyle: "bold" }).setOrigin(0.5, 0);
    const bw = bt.width + 26;
    const bg = this.add.graphics();
    bg.fillStyle(0x101a33, 0.85); bg.fillRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8); bg.lineStyle(1.5, 0x3a5db0, 0.8); bg.strokeRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8);
    this.hud.add(bg); this.hud.add(bt);
    void H;
  }

  // ── Movement ────────────────────────────────────────────────────────────────
  update(): void {
    if (this.locked || this.moving || !this.player || this.dialogue.isOpen) return;
    let dx = 0, dy = 0;
    const pd = this.pad.direction();
    if (this.cursors.left.isDown || this.keys.A.isDown || pd.x < 0) dx = -1;
    else if (this.cursors.right.isDown || this.keys.D.isDown || pd.x > 0) dx = 1;
    else if (this.cursors.up.isDown || this.keys.W.isDown || pd.y < 0) dy = -1;
    else if (this.cursors.down.isDown || this.keys.S.isDown || pd.y > 0) dy = 1;
    if (!dx && !dy) { this.player.setFrame(charFrame(this.facing, 0)); this.updateHint(); return; }
    this.facing = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
    this.tryStep(dx, dy);
  }

  private tryStep(dx: number, dy: number): void {
    const nx = this.tileX + dx, ny = this.tileY + dy;
    const door = this.doorAt.get(`${nx},${ny}`);
    if (door) { this.enterShop(); return; }
    if (!this.walkable(nx, ny)) { this.player.setFrame(charFrame(this.facing, 0)); this.updateHint(); return; }
    this.moving = true;
    this.walkFrame = this.walkFrame === 0 ? 1 : 0;
    this.player.setFrame(charFrame(this.facing, this.walkFrame));
    this.tileX = nx; this.tileY = ny;
    gameState.lastX = nx; gameState.lastY = ny; gameState.lastFace = this.facing;
    const p = this.iso(nx, ny);
    this.tweens.add({
      targets: this.player, x: p.x, y: p.y, duration: 150, ease: "Linear",
      onUpdate: () => { this.player.setDepth(this.player.y); this.world.sort("depth"); },
      onComplete: () => { this.moving = false; this.player.setDepth(p.y); this.world.sort("depth"); this.updateHint(); },
    });
  }

  private walkable(x: number, y: number): boolean {
    if (y < 0 || y >= GRID || x < 0 || x >= GRID) return false;
    return !this.solid[y]![x];
  }

  private facingTile(): { x: number; y: number } {
    const d = this.facing;
    return { x: this.tileX + (d === "left" ? -1 : d === "right" ? 1 : 0), y: this.tileY + (d === "up" ? -1 : d === "down" ? 1 : 0) };
  }
  private npcAt(x: number, y: number): CityNpc | null { return this.npcSprites.find((n) => n.def.tx === x && n.def.ty === y)?.def ?? null; }

  private updateHint(): void {
    const t = this.facingTile();
    const npc = this.npcAt(t.x, t.y);
    const door = this.doorAt.get(`${t.x},${t.y}`);
    if (npc) {
      const verb = npc.role === "shop" ? "talk" : npc.duelist && !gameState.isDefeated(npc.id) ? "duel" : "talk";
      this.hint.setText(`E to ${verb}`).setPosition(this.player.x, this.player.y - 60).setVisible(true);
    } else if (door) {
      this.hint.setText("E to enter").setPosition(this.player.x, this.player.y - 60).setVisible(true);
    } else this.hint.setVisible(false);
  }

  // ── Interaction ───────────────────────────────────────────────────────────────
  private onAction = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.advance(); return; }
    if (this.locked) return;
    const t = this.facingTile();
    const door = this.doorAt.get(`${t.x},${t.y}`);
    if (door) { this.enterShop(); return; }
    const npc = this.npcAt(t.x, t.y);
    if (npc) this.interact(npc);
  };

  private interact(def: CityNpc): void {
    const beaten = gameState.isDefeated(def.id);
    const lines = beaten && def.defeatedLines?.length ? def.defeatedLines : def.lines;
    this.locked = true;
    this.dialogue.show(def.name, lines, () => {
      this.locked = false; this.hint.setVisible(false);
      if (def.role === "shop") { this.enterShop(); return; }
      if (def.duelist && !beaten) this.startDuel(def);
    });
  }

  private enterShop(): void {
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start("Shop", { returnTo: "City" }));
  }

  private async startDuel(def: CityNpc): Promise<void> {
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
    this.dialogue.choice("Pause", [["Resume", () => { this.locked = false; }], ["Main Menu", () => this.scene.start("Menu")]], () => { this.locked = false; });
  };

  private wait(ms: number): Promise<void> { return new Promise((res) => this.time.delayedCall(ms, res)); }
}
