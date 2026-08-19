// ─────────────────────────────────────────────────────────────────────────────
// InteriorScene — a cozy, richly-furnished walk-in isometric shop, themed as a
// warm card-and-curio emporium. Wood floors, a rug, a stocked bar/counter, wall
// shelves of card packs and bottles, tables & chairs, barrels, crates, a lit
// fireplace, plants and wall sconces — so it reads as a lived-in room, not an
// empty box. Interacting with the counter opens the card browser (existing Shop
// scene); walking onto the EXIT returns to the exact plaza spot.
//
// Furniture is procedural iso art (CSP-safe); barrels/crates/chests reuse the
// CC0 SpriteCook props. Warm point-lights from the fireplace and sconces set
// the theme. Game systems (shop, dialogue) are untouched.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { gameState } from "../state/gameState";
import { DialogueBox } from "../ui/dialogue";
import { TouchPad } from "../ui/touchPad";

const TILE_W = 128, TILE_H = 64;
const asset = (p: string): string => `${import.meta.env.BASE_URL}world/city/${p}`;
type Facing = "down" | "left" | "right" | "up";
const RPG_ROW: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 };

const RW = 13, RH = 11;                 // room grid
const COUNTER_Y = 2;                    // counter row
const COUNTER_X: [number, number] = [4, 8];
const KEEPER: [number, number] = [6, 1];
const EXIT: Array<[number, number]> = [[6, 10], [7, 10]];
const SPAWN: [number, number] = [6, 9];

// Furniture placements. [tx, ty, solid?]
const TABLES: Array<[number, number]> = [[3, 6], [10, 6], [6, 8]];
const CHAIRS: Array<[number, number, Facing]> = [
  [3, 5, "down"], [3, 7, "up"], [10, 5, "down"], [10, 7, "up"], [5, 8, "right"], [7, 8, "left"],
];
const BARRELS: Array<[number, number]> = [[1, 3], [1, 8], [11, 3], [11, 8]];
const CRATES: Array<[number, number]> = [[11, 5], [1, 5]];
const CHESTS: Array<[number, number]> = [[2, 9]];
const PLANTS: Array<[number, number]> = [[1, 1], [11, 1], [1, 9], [11, 9]];
const WALLSHELVES: Array<[number, number]> = [[2, 1], [3, 1], [9, 1], [10, 1]];
const SCONCES: Array<[number, number]> = [[4, 0], [8, 0], [0, 4], [0, 7], [12, 4], [12, 7]];
const FIRE: [number, number] = [1, 6];

export class InteriorScene extends Phaser.Scene {
  private isoOX = 0; private isoOY = 0;
  private solid: boolean[][] = [];
  private player!: Phaser.GameObjects.Sprite;
  private playerRpg = false;
  private facing: Facing = "up";
  private tileX = SPAWN[0]; private tileY = SPAWN[1];
  private moving = false; private locked = false;
  private world!: Phaser.GameObjects.Layer;
  private hud!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;
  private dialogue!: DialogueBox;
  private pad!: TouchPad;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() { super("Interior"); }

  init(): void { this.tileX = SPAWN[0]; this.tileY = SPAWN[1]; this.facing = "up"; }

  preload(): void {
    if (!this.textures.exists("rpgwalk")) this.load.spritesheet("rpgwalk", asset("hero_walk.png"), { frameWidth: 24, frameHeight: 32 });
    if (!this.textures.exists("cn:gnome_merchant")) this.load.image("cn:gnome_merchant", asset("npc/gnome_merchant.png"));
    for (const pr of ["barrel", "crate_intact", "chest_closed"]) if (!this.textures.exists(`cp:${pr}`)) this.load.image(`cp:${pr}`, asset(`props/${pr}.png`));
  }

  private iso(tx: number, ty: number): { x: number; y: number } {
    return { x: this.isoOX + (tx - ty) * (TILE_W / 2), y: this.isoOY + (tx + ty) * (TILE_H / 2) };
  }
  private mark(tx: number, ty: number): void { if (ty >= 0 && ty < RH && tx >= 0 && tx < RW) this.solid[ty]![tx] = true; }
  private place(o: Phaser.GameObjects.Image, depth: number): void { o.setDepth(depth); this.world.add(o); }

  create(): void {
    document.getElementById("boot")?.remove();
    this.isoOX = RH * (TILE_W / 2); this.isoOY = TILE_H;
    this.makeTextures();
    this.world = this.add.layer();
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(100000);
    this.solid = Array.from({ length: RH }, () => Array<boolean>(RW).fill(false));

    // Floor + walls.
    const gl = this.add.layer().setDepth(-100000);
    for (let ty = 0; ty < RH; ty++) for (let tx = 0; tx < RW; tx++) {
      const wall = ty === 0 || tx === 0 || tx === RW - 1;
      const p = this.iso(tx, ty);
      if (wall) { this.mark(tx, ty); this.place(this.image(p.x, p.y, "it:wall").setOrigin(0.5, (TILE_H + 40 - 20 - TILE_H / 2) / (TILE_H + 40)), p.y); }
      else gl.add(this.image(p.x, p.y, "it:floor").setOrigin(0.5, 0.5));
    }
    // Big central rug (below furniture, above floor).
    { const p = this.iso(6, 6); const r = this.image(p.x, p.y, "it:rug").setOrigin(0.5, 0.5); r.setDepth(-90000); this.world.add(r); }

    // Back-wall dressing: sconces, shelves, paintings.
    for (const [tx, ty] of WALLSHELVES) { const p = this.iso(tx, ty); this.place(this.image(p.x, p.y, "it:shelf").setOrigin(0.5, 0.9), p.y - 4); }
    for (const [tx, ty] of SCONCES) { const p = this.iso(tx, ty); const s = this.image(p.x, p.y - 8, "it:sconce").setOrigin(0.5, 0.9); this.place(s, 95000); this.glow(p.x, p.y - 24, 46, 0xffb85a, 0.5); }
    { const p = this.iso(6, 0); this.place(this.image(p.x, p.y - 6, "it:painting").setOrigin(0.5, 0.9), 95000); }

    // Counter + shopkeeper.
    for (let tx = COUNTER_X[0]; tx <= COUNTER_X[1]; tx++) { const p = this.iso(tx, COUNTER_Y); this.place(this.image(p.x, p.y, "it:counter").setOrigin(0.5, 0.78), p.y); this.mark(tx, COUNTER_Y); }
    { const p = this.iso(KEEPER[0], KEEPER[1]); const k = this.image(p.x, p.y + 4, "cn:gnome_merchant").setOrigin(0.5, 1).setScale(0.085); this.place(k, p.y); this.mark(KEEPER[0], KEEPER[1]); this.tweens.add({ targets: k, y: k.y - 2, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.InOut" }); }

    // Fireplace with firelight.
    { const [tx, ty] = FIRE; const p = this.iso(tx, ty); this.place(this.image(p.x, p.y, "it:fire").setOrigin(0.5, 0.82), p.y); this.mark(tx, ty); this.glowPulse(p.x, p.y - 20, 80, 0xff7a2a); }

    // Furniture.
    for (const [tx, ty] of TABLES) { const p = this.iso(tx, ty); this.place(this.image(p.x, p.y, "it:table").setOrigin(0.5, 0.82), p.y); this.mark(tx, ty); }
    for (const [tx, ty, face] of CHAIRS) { const p = this.iso(tx, ty); const c = this.image(p.x, p.y, "it:chair").setOrigin(0.5, 0.85); if (face === "left" || face === "up") c.setFlipX(true); this.place(c, p.y); this.mark(tx, ty); }
    for (const [tx, ty] of PLANTS) { const p = this.iso(tx, ty); this.place(this.image(p.x, p.y, "it:plant").setOrigin(0.5, 0.9), p.y); this.mark(tx, ty); }
    for (const [tx, ty] of BARRELS) { const p = this.iso(tx, ty); this.place(this.image(p.x, p.y + 6, "cp:barrel").setOrigin(0.5, 1).setScale(0.24), p.y); this.mark(tx, ty); }
    for (const [tx, ty] of CRATES) { const p = this.iso(tx, ty); this.place(this.image(p.x, p.y + 6, "cp:crate_intact").setOrigin(0.5, 1).setScale(0.24), p.y); this.mark(tx, ty); }
    for (const [tx, ty] of CHESTS) { const p = this.iso(tx, ty); this.place(this.image(p.x, p.y + 6, "cp:chest_closed").setOrigin(0.5, 1).setScale(0.22), p.y); this.mark(tx, ty); }

    // Exit mats.
    for (const [tx, ty] of EXIT) { const p = this.iso(tx, ty); const m = this.image(p.x, p.y, "it:mat").setOrigin(0.5, 0.5); m.setDepth(-89000); this.world.add(m); }

    this.buildPlayer();
    this.buildHud();

    this.dialogue = new DialogueBox(this);
    this.pad = new TouchPad(this, { onAction: () => this.onAction(), onMenu: () => this.exitToPlaza() });
    this.hint = this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#fff", backgroundColor: "#000000bb", padding: { x: 6, y: 3 } }).setOrigin(0.5, 1).setDepth(99000).setVisible(false);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
    const kb = this.input.keyboard!;
    kb.on("keydown-E", this.onAction, this); kb.on("keydown-SPACE", this.onAction, this); kb.on("keydown-ESC", this.exitToPlaza, this);

    const cam = this.cameras.main;
    cam.setBackgroundColor("#120c08");
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setZoom(1);
    cam.fadeIn(260, 0, 0, 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      kb.off("keydown-E", this.onAction, this); kb.off("keydown-SPACE", this.onAction, this); kb.off("keydown-ESC", this.exitToPlaza, this);
      this.pad.destroy(); this.dialogue.destroy();
    });
  }

  private image(x: number, y: number, key: string): Phaser.GameObjects.Image { return this.add.image(x, y, key); }
  private onResize = (): void => { this.pad.layout(); this.buildHud(); };

  /** A soft warm point-light (additive) for theme lighting. */
  private glow(x: number, y: number, r: number, color: number, alpha = 0.6): void {
    const g = this.add.circle(x, y, r, color, alpha).setDepth(96000).setBlendMode(Phaser.BlendModes.ADD);
    this.world.add(g);
  }
  private glowPulse(x: number, y: number, r: number, color: number): void {
    const g = this.add.circle(x, y, r, color, 0.5).setDepth(96000).setBlendMode(Phaser.BlendModes.ADD);
    this.world.add(g);
    this.tweens.add({ targets: g, scale: 1.12, alpha: 0.32, duration: 700, yoyo: true, repeat: -1, ease: "Sine.InOut" });
  }

  private makeTextures(): void {
    const tex = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d"); if (!ctx) return; draw(ctx); this.textures.addCanvas(key, cv);
    };
    const dia = (c: CanvasRenderingContext2D, oy = 0, w = TILE_W, h = TILE_H) => { c.beginPath(); c.moveTo(w / 2, oy); c.lineTo(w, oy + h / 2); c.lineTo(w / 2, oy + h); c.lineTo(0, oy + h / 2); c.closePath(); };
    tex("it:floor", TILE_W, TILE_H, (c) => {
      dia(c); c.fillStyle = "#7a5230"; c.fill(); c.save(); dia(c); c.clip();
      c.strokeStyle = "rgba(45,28,15,0.55)"; c.lineWidth = 1;
      for (let i = -TILE_W; i < TILE_W; i += 11) { c.beginPath(); c.moveTo(TILE_W / 2 + i, 0); c.lineTo(i, TILE_H / 2); c.stroke(); }
      c.restore(); c.strokeStyle = "rgba(0,0,0,0.22)"; dia(c); c.stroke();
    });
    tex("it:wall", TILE_W, TILE_H + 40, (c) => {
      c.fillStyle = "#4a3526"; c.beginPath(); c.moveTo(0, TILE_H / 2 + 20); c.lineTo(TILE_W / 2, TILE_H + 20); c.lineTo(TILE_W / 2, TILE_H + 60); c.lineTo(0, TILE_H / 2 + 60); c.closePath(); c.fill();
      c.fillStyle = "#3a281c"; c.beginPath(); c.moveTo(TILE_W / 2, TILE_H + 20); c.lineTo(TILE_W, TILE_H / 2 + 20); c.lineTo(TILE_W, TILE_H / 2 + 60); c.lineTo(TILE_W / 2, TILE_H + 60); c.closePath(); c.fill();
      // wainscot band
      c.fillStyle = "#5a4130"; c.fillRect(0, TILE_H / 2 + 46, TILE_W, 6);
      dia(c, 20); c.fillStyle = "#d8c7a6"; c.fill(); c.strokeStyle = "rgba(0,0,0,0.25)"; c.stroke();
    });
    tex("it:rug", 300, 180, (c) => {
      c.save(); dia(c, 0, 300, 180); c.fillStyle = "#7a2f3a"; c.fill(); dia(c, 0, 300, 180); c.clip();
      c.strokeStyle = "#c9a24f"; c.lineWidth = 6; dia(c, 14, 272, 152); c.translate(14, 14); c.stroke(); c.restore();
      c.strokeStyle = "rgba(201,162,79,0.6)"; c.lineWidth = 3; dia(c, 40, 220, 100); c.translate(40, 40); c.stroke();
    });
    tex("it:counter", TILE_W, 74, (c) => {
      c.fillStyle = "#5a3d24"; c.beginPath(); c.moveTo(6, 40); c.lineTo(TILE_W / 2, 14); c.lineTo(TILE_W - 6, 40); c.lineTo(TILE_W / 2, 66); c.closePath(); c.fill();
      c.fillStyle = "#7a5230"; c.beginPath(); c.moveTo(6, 40); c.lineTo(TILE_W / 2, 14); c.lineTo(TILE_W / 2, 26); c.lineTo(6, 52); c.closePath(); c.fill();
      c.fillStyle = "#3a2717"; c.fillRect(6, 40, TILE_W - 12, 20);
    });
    tex("it:shelf", 92, 104, (c) => {
      c.fillStyle = "#4a3018"; c.fillRect(8, 12, 76, 88); c.fillStyle = "#2f1e0f"; for (const y of [34, 58, 82]) c.fillRect(8, y, 76, 3);
      const cols = ["#c94f4f", "#4f7fc9", "#4fc97a", "#c9a24f", "#8a5cd0", "#d07fae"];
      for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) { c.fillStyle = cols[(r * 5 + i) % cols.length]!; c.fillRect(11 + i * 15, 16 + r * 24, 11, 16); }
    });
    tex("it:table", 96, 64, (c) => {
      c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(48, 54, 30, 8, 0, 0, 7); c.fill();
      c.fillStyle = "#6b4a2f"; c.fillRect(30, 36, 6, 16); c.fillRect(60, 36, 6, 16);
      c.fillStyle = "#8a6742"; c.beginPath(); c.ellipse(48, 34, 34, 14, 0, 0, 7); c.fill();
      c.fillStyle = "#9c7a50"; c.beginPath(); c.ellipse(48, 32, 34, 13, 0, 0, 7); c.fill();
      // a mug on the table
      c.fillStyle = "#c9a24f"; c.fillRect(44, 24, 8, 8);
    });
    tex("it:chair", 40, 56, (c) => {
      c.fillStyle = "rgba(0,0,0,0.22)"; c.beginPath(); c.ellipse(20, 50, 14, 4, 0, 0, 7); c.fill();
      c.fillStyle = "#6b4a2f"; c.fillRect(10, 30, 20, 8); c.fillRect(11, 38, 4, 12); c.fillRect(25, 38, 4, 12);
      c.fillStyle = "#5a3d24"; c.fillRect(10, 12, 20, 20);
    });
    tex("it:plant", 56, 78, (c) => {
      c.fillStyle = "rgba(0,0,0,0.22)"; c.beginPath(); c.ellipse(28, 72, 16, 5, 0, 0, 7); c.fill();
      c.fillStyle = "#8a5a34"; c.beginPath(); c.moveTo(14, 52); c.lineTo(42, 52); c.lineTo(38, 74); c.lineTo(18, 74); c.closePath(); c.fill();
      c.fillStyle = "#2b6b38"; c.beginPath(); c.ellipse(28, 40, 20, 22, 0, 0, 7); c.fill();
      c.fillStyle = "#358a4a"; c.beginPath(); c.ellipse(20, 32, 12, 14, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(36, 34, 12, 14, 0, 0, 7); c.fill();
    });
    tex("it:sconce", 28, 44, (c) => {
      c.fillStyle = "#3a3025"; c.fillRect(11, 18, 6, 24);
      c.fillStyle = "#c9a24f"; c.beginPath(); c.ellipse(14, 16, 8, 6, 0, 0, 7); c.fill();
      c.fillStyle = "#ff9a3a"; c.beginPath(); c.moveTo(14, 2); c.lineTo(20, 16); c.lineTo(8, 16); c.closePath(); c.fill();
      c.fillStyle = "#ffe08a"; c.beginPath(); c.moveTo(14, 8); c.lineTo(17, 16); c.lineTo(11, 16); c.closePath(); c.fill();
    });
    tex("it:fire", TILE_W, 92, (c) => {
      c.fillStyle = "#5a5048"; c.fillRect(20, 22, TILE_W - 40, 60);          // hearth
      c.fillStyle = "#2a2018"; c.fillRect(32, 40, TILE_W - 64, 40);          // opening
      c.fillStyle = "#ff7a2a"; c.beginPath(); c.moveTo(TILE_W / 2, 44); c.lineTo(TILE_W / 2 + 16, 78); c.lineTo(TILE_W / 2 - 16, 78); c.closePath(); c.fill();
      c.fillStyle = "#ffd75e"; c.beginPath(); c.moveTo(TILE_W / 2, 56); c.lineTo(TILE_W / 2 + 8, 78); c.lineTo(TILE_W / 2 - 8, 78); c.closePath(); c.fill();
      c.fillStyle = "#7a5230"; c.fillRect(30, 78, TILE_W - 60, 6);           // mantle logs
    });
    tex("it:painting", 84, 60, (c) => {
      c.fillStyle = "#c9a24f"; c.fillRect(0, 0, 84, 60); c.fillStyle = "#2a3a5a"; c.fillRect(6, 6, 72, 48);
      c.fillStyle = "#6a8ac0"; c.beginPath(); c.moveTo(6, 44); c.lineTo(30, 20); c.lineTo(50, 40); c.lineTo(78, 14); c.lineTo(78, 54); c.lineTo(6, 54); c.closePath(); c.fill();
      c.fillStyle = "#ffe08a"; c.beginPath(); c.ellipse(64, 18, 6, 6, 0, 0, 7); c.fill();
    });
    tex("it:mat", TILE_W, TILE_H, (c) => { dia(c); c.fillStyle = "#2e2417"; c.fill(); c.fillStyle = "#c9a24f"; c.font = "bold 15px system-ui"; c.textAlign = "center"; c.fillText("EXIT", TILE_W / 2, TILE_H / 2 + 5); });
  }

  private buildPlayer(): void {
    const p = this.iso(this.tileX, this.tileY);
    this.playerRpg = this.textures.exists("rpgwalk");
    if (this.playerRpg) {
      for (const [face, row] of Object.entries(RPG_ROW)) { const key = `pw-${face}`; if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers("rpgwalk", { start: row * 8, end: row * 8 + 7 }), frameRate: 12, repeat: -1 }); }
      this.player = this.add.sprite(p.x, p.y, "rpgwalk", RPG_ROW[this.facing] * 8).setOrigin(0.5, 0.86).setScale(1.7);
    } else {
      this.player = this.add.rectangle(p.x, p.y, 20, 40, 0x5a6bd0) as unknown as Phaser.GameObjects.Sprite;
    }
    this.player.setDepth(p.y); this.world.add(this.player);
  }

  private playerPose(moving: boolean): void {
    if (!this.playerRpg) return;
    if (moving) this.player.anims.play(`pw-${this.facing}`, true);
    else { this.player.anims.stop(); this.player.setFrame(RPG_ROW[this.facing] * 8); }
  }

  private buildHud(): void {
    this.hud.removeAll(true);
    const W = this.scale.width;
    const bt = this.add.text(W / 2, 14, "CARD EMPORIUM", { fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#ffe9b0", fontStyle: "bold" }).setOrigin(0.5, 0);
    const bw = bt.width + 26; const bg = this.add.graphics();
    bg.fillStyle(0x1a1208, 0.9); bg.fillRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8); bg.lineStyle(1.5, 0xc9a24f, 0.8); bg.strokeRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8);
    this.hud.add([bg, bt]);
  }

  update(): void {
    if (this.locked || this.moving || !this.player || this.dialogue.isOpen) return;
    let dx = 0, dy = 0; const pd = this.pad.direction();
    if (this.cursors.left.isDown || this.keys.A.isDown || pd.x < 0) dx = -1;
    else if (this.cursors.right.isDown || this.keys.D.isDown || pd.x > 0) dx = 1;
    else if (this.cursors.up.isDown || this.keys.W.isDown || pd.y < 0) dy = -1;
    else if (this.cursors.down.isDown || this.keys.S.isDown || pd.y > 0) dy = 1;
    if (!dx && !dy) { this.playerPose(false); this.updateHint(); return; }
    this.facing = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
    const nx = this.tileX + dx, ny = this.tileY + dy;
    if (EXIT.some(([ex, ey]) => ex === nx && ey === ny)) { this.exitToPlaza(); return; }
    if (nx < 0 || nx >= RW || ny < 0 || ny >= RH || this.solid[ny]![nx]) { this.playerPose(false); this.updateHint(); return; }
    this.moving = true; this.playerPose(true); this.tileX = nx; this.tileY = ny;
    const p = this.iso(nx, ny);
    this.tweens.add({ targets: this.player, x: p.x, y: p.y, duration: 150, ease: "Linear", onUpdate: () => { this.player.setDepth(this.player.y); this.world.sort("depth"); }, onComplete: () => { this.moving = false; this.player.setDepth(p.y); this.world.sort("depth"); this.updateHint(); } });
  }

  private facingTile(): [number, number] { const d = this.facing; return [this.tileX + (d === "left" ? -1 : d === "right" ? 1 : 0), this.tileY + (d === "up" ? -1 : d === "down" ? 1 : 0)]; }
  private atCounter(): boolean { const [fx, fy] = this.facingTile(); return fy === COUNTER_Y && fx >= COUNTER_X[0] && fx <= COUNTER_X[1]; }
  private updateHint(): void {
    if (this.atCounter()) this.hint.setText("E to browse cards").setPosition(this.player.x, this.player.y - 44).setVisible(true);
    else this.hint.setVisible(false);
  }

  private onAction = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.advance(); return; }
    if (this.locked) return;
    if (this.atCounter()) {
      this.locked = true;
      this.dialogue.show("Merchant Rowe", ["Take your time browsing.", "Every card in the realm is here."], () => { this.locked = false; this.openBrowser(); });
    }
  };

  private openBrowser(): void {
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start("Shop", { returnTo: "Interior" }));
  }

  private exitToPlaza = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.close(); this.locked = false; return; }
    gameState.lastMap = "cityplaza";
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start("City"));
  };
}
