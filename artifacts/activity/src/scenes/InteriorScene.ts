// ─────────────────────────────────────────────────────────────────────────────
// InteriorScene — a real walk-in isometric shop room. You enter it from the
// plaza's Card Emporium, walk across a wood floor between shelves to the
// counter, and interact with the shopkeeper to open the card browser (the
// existing Shop scene). Walking out the door returns you to the exact plaza
// spot. Floor/walls/counter/shelves are procedural iso art (CSP-safe); the
// shopkeeper and player use the same CC0 sprites as the plaza.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { gameState } from "../state/gameState";
import { DialogueBox } from "../ui/dialogue";
import { TouchPad } from "../ui/touchPad";

const TILE_W = 128, TILE_H = 64;
const asset = (p: string): string => `${import.meta.env.BASE_URL}world/city/${p}`;
type Facing = "down" | "left" | "right" | "up";
const RPG_ROW: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 };

const RW = 11, RH = 9;                 // room grid
const COUNTER: [number, number] = [5, 2];
const KEEPER: [number, number] = [5, 1];
const EXIT: Array<[number, number]> = [[5, 8], [6, 8]];
const SPAWN: [number, number] = [5, 7];

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
  }

  private iso(tx: number, ty: number): { x: number; y: number } {
    return { x: this.isoOX + (tx - ty) * (TILE_W / 2), y: this.isoOY + (tx + ty) * (TILE_H / 2) };
  }

  create(): void {
    document.getElementById("boot")?.remove();
    this.isoOX = RH * (TILE_W / 2); this.isoOY = TILE_H;
    this.makeTextures();
    this.world = this.add.layer();
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(100000);

    // Ground + walls.
    this.solid = Array.from({ length: RH }, () => Array<boolean>(RW).fill(false));
    const gl = this.add.layer().setDepth(-100000);
    for (let ty = 0; ty < RH; ty++) for (let tx = 0; tx < RW; tx++) {
      const wall = ty === 0 || tx === 0 || tx === RW - 1;
      const p = this.iso(tx, ty);
      if (wall) {
        this.solid[ty]![tx] = true;
        const b = this.add.image(p.x, p.y, "it:wall").setOrigin(0.5, (TILE_H * 0.5 + TILE_H / 2) / (TILE_H + 40));
        b.setDepth(p.y); this.world.add(b);
      } else {
        gl.add(this.add.image(p.x, p.y, "it:floor").setOrigin(0.5, 0.5));
      }
    }
    // Counter (solid) + shelves on the back wall.
    for (let tx = 3; tx <= 7; tx++) { const p = this.iso(tx, 2); const c = this.add.image(p.x, p.y, "it:counter").setOrigin(0.5, 0.78); c.setDepth(p.y); this.world.add(c); this.solid[2]![tx] = true; }
    for (const tx of [2, 3, 7, 8]) { const p = this.iso(tx, 1); const s = this.add.image(p.x, p.y, "it:shelf").setOrigin(0.5, 0.86); s.setDepth(p.y - 4); this.world.add(s); }
    // Shopkeeper behind the counter.
    { const p = this.iso(KEEPER[0], KEEPER[1]); const k = this.add.image(p.x, p.y + 4, "cn:gnome_merchant").setOrigin(0.5, 1).setScale(0.085); k.setDepth(p.y); this.world.add(k); this.tweens.add({ targets: k, y: k.y - 2, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.InOut" }); }
    // Exit mat.
    for (const [tx, ty] of EXIT) { const p = this.iso(tx, ty); const m = this.add.image(p.x, p.y, "it:mat").setOrigin(0.5, 0.5).setDepth(p.y - 50); this.world.add(m); this.solid[ty]![tx] = false; }

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
    cam.setBackgroundColor("#1a1410");
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

  private onResize = (): void => { this.pad.layout(); this.buildHud(); };

  private makeTextures(): void {
    const tex = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d"); if (!ctx) return; draw(ctx); this.textures.addCanvas(key, cv);
    };
    const diamond = (c: CanvasRenderingContext2D, oy = 0) => { c.beginPath(); c.moveTo(TILE_W / 2, oy); c.lineTo(TILE_W, oy + TILE_H / 2); c.lineTo(TILE_W / 2, oy + TILE_H); c.lineTo(0, oy + TILE_H / 2); c.closePath(); };
    // Wood floor diamond with plank lines.
    tex("it:floor", TILE_W, TILE_H, (c) => {
      diamond(c); c.fillStyle = "#8a5f38"; c.fill(); c.save(); diamond(c); c.clip();
      c.strokeStyle = "rgba(60,40,22,0.5)"; c.lineWidth = 1;
      for (let i = -TILE_W; i < TILE_W; i += 12) { c.beginPath(); c.moveTo(TILE_W / 2 + i, 0); c.lineTo(i, TILE_H / 2); c.stroke(); }
      c.restore(); c.strokeStyle = "rgba(0,0,0,0.2)"; diamond(c); c.stroke();
    });
    // Wall block (raised) — plaster over stone.
    tex("it:wall", TILE_W, TILE_H + 40, (c) => {
      c.fillStyle = "#5a5048"; c.beginPath(); c.moveTo(0, TILE_H / 2 + 20); c.lineTo(TILE_W / 2, TILE_H + 20); c.lineTo(TILE_W / 2, TILE_H + 20 + 40); c.lineTo(0, TILE_H / 2 + 20 + 40); c.closePath(); c.fill();
      c.fillStyle = "#4a423a"; c.beginPath(); c.moveTo(TILE_W / 2, TILE_H + 20); c.lineTo(TILE_W, TILE_H / 2 + 20); c.lineTo(TILE_W, TILE_H / 2 + 20 + 40); c.lineTo(TILE_W / 2, TILE_H + 20 + 40); c.closePath(); c.fill();
      diamond(c, 20); c.fillStyle = "#c9bfa8"; c.fill(); c.strokeStyle = "rgba(0,0,0,0.25)"; c.stroke();
    });
    // Counter — wood top + front panel.
    tex("it:counter", TILE_W, 70, (c) => {
      c.fillStyle = "#6b4a2f"; c.beginPath(); c.moveTo(10, 34); c.lineTo(TILE_W / 2, 8); c.lineTo(TILE_W - 10, 34); c.lineTo(TILE_W / 2, 60); c.closePath(); c.fill();
      c.fillStyle = "#8a6742"; c.beginPath(); c.moveTo(10, 34); c.lineTo(TILE_W / 2, 8); c.lineTo(TILE_W / 2, 20); c.lineTo(10, 46); c.closePath(); c.fill();
      c.fillStyle = "#513723"; c.fillRect(10, 34, TILE_W - 20, 14);
    });
    // Shelf with colourful card packs.
    tex("it:shelf", 96, 96, (c) => {
      c.fillStyle = "#5a3d24"; c.fillRect(14, 20, 68, 66); c.fillStyle = "#3a2717"; c.fillRect(14, 42, 68, 3); c.fillRect(14, 64, 68, 3);
      const cols = ["#c94f4f", "#4f7fc9", "#4fc97a", "#c9a24f", "#8a5cd0"];
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) { c.fillStyle = cols[(r * 4 + i) % cols.length]!; c.fillRect(18 + i * 16, 24 + r * 22, 12, 16); }
    });
    // Doormat.
    tex("it:mat", TILE_W, TILE_H, (c) => { diamond(c); c.fillStyle = "#3a2f22"; c.fill(); c.fillStyle = "#c9a24f"; c.font = "bold 16px system-ui"; c.textAlign = "center"; c.fillText("EXIT", TILE_W / 2, TILE_H / 2 + 5); });
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
    bg.fillStyle(0x101a33, 0.85); bg.fillRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8); bg.lineStyle(1.5, 0x3a5db0, 0.8); bg.strokeRoundedRect(W / 2 - bw / 2, 10, bw, 26, 8);
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
  private updateHint(): void {
    const [fx, fy] = this.facingTile();
    if ((fx === COUNTER[0] && fy === COUNTER[1]) || (fx === KEEPER[0] && fy === KEEPER[1])) { this.hint.setText("E to browse").setPosition(this.player.x, this.player.y - 44).setVisible(true); }
    else this.hint.setVisible(false);
  }

  private onAction = (): void => {
    if (this.dialogue.isOpen) { this.dialogue.advance(); return; }
    if (this.locked) return;
    const [fx, fy] = this.facingTile();
    if ((fx === COUNTER[0] && fy === COUNTER[1]) || (fx === KEEPER[0] && fy === KEEPER[1])) {
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
