// ─────────────────────────────────────────────────────────────────────────────
// LpPanel — the duelist's corner plate: avatar disc, name, Life Point counter
// and an animated LP bar. Modelled on the reference client's HealthBar (avatar +
// name + progress), which sits in the top corners of the playmat.
//
// The counter ticks down digit-by-digit and the bar drains with it, so taking
// 2000 damage reads as an event rather than a number swap.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";

export interface LpPanelOpts {
  name: string;
  maxLp: number;
  accent: number;
  /** "left" pins the avatar on the left, "right" mirrors the layout. */
  align: "left" | "right";
  /** Overall panel width (defaults to 196; use a smaller value on phones). */
  width?: number;
}

export class LpPanel {
  private scene: Phaser.Scene;
  private opts: LpPanelOpts;
  readonly container: Phaser.GameObjects.Container;
  private barFill!: Phaser.GameObjects.Rectangle;
  private lpText!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private shownLp: number;
  private w: number;
  private h = 56;

  constructor(scene: Phaser.Scene, opts: LpPanelOpts) {
    this.scene = scene;
    this.opts = opts;
    this.w = opts.width ?? 196;
    this.shownLp = opts.maxLp;
    this.container = scene.add.container(0, 0);
    this.build();
  }

  private build(): void {
    const s = this.scene;
    const { align, accent, name } = this.opts;
    const w = this.w, h = this.h;
    const left = align === "left";

    const g = s.add.graphics();
    g.fillStyle(0x0b1020, 0.92); g.fillRoundedRect(0, 0, w, h, 10);
    g.lineStyle(2, accent, 0.9); g.strokeRoundedRect(0, 0, w, h, 10);
    this.container.add(g);

    // Avatar disc with the duelist's initial.
    const ax = left ? 26 : w - 26;
    const disc = s.add.circle(ax, h / 2, 17, accent, 0.28).setStrokeStyle(2, accent, 1);
    const initial = s.add.text(ax, h / 2, (name[0] ?? "?").toUpperCase(), {
      fontFamily: "system-ui, sans-serif", fontSize: "17px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0.5);
    this.container.add([disc, initial]);

    const tx = left ? 50 : w - 50;
    const originX = left ? 0 : 1;
    this.nameText = s.add.text(tx, 7, name, {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#dbe4ff", fontStyle: "bold",
    }).setOrigin(originX, 0);
    this.lpText = s.add.text(tx, 22, `${this.opts.maxLp}`, {
      fontFamily: "monospace", fontSize: "18px", color: "#ffe9b0", fontStyle: "bold",
    }).setOrigin(originX, 0);
    this.container.add([this.nameText, this.lpText]);

    // LP bar, below the counter so nothing overlaps.
    const barW = w - 62, barH = 6;
    const bx = left ? 50 : w - 50 - barW;
    const by = h - 9;
    const back = s.add.rectangle(bx, by, barW, barH, 0x1b2340).setOrigin(0, 0.5).setStrokeStyle(1, 0x2f3c66);
    this.barFill = s.add.rectangle(bx, by, barW, barH, accent).setOrigin(0, 0.5);
    this.container.add([back, this.barFill]);
    this.container.setSize(w, h);
  }

  /** Position by the panel's outer corner. */
  place(x: number, y: number): void {
    this.container.setPosition(this.opts.align === "left" ? x : x - this.w, y);
  }

  setName(name: string): void { this.nameText.setText(name); }

  /** Animate to a new LP total; damage flashes red, healing flashes green. */
  set(lp: number): void {
    const from = this.shownLp;
    if (lp === from) return;
    const damage = lp < from;
    this.shownLp = lp;
    const barW = this.w - 62;

    this.scene.tweens.addCounter({
      from, to: lp, duration: 420, ease: "Cubic.Out",
      onUpdate: (tw) => {
        const v = Math.round(tw.getValue() ?? lp);
        this.lpText.setText(`${Math.max(0, v)}`);
        const pct = Phaser.Math.Clamp(v / this.opts.maxLp, 0, 1);
        this.barFill.width = barW * pct;
        this.barFill.setFillStyle(pct < 0.25 ? 0xff4d6a : pct < 0.5 ? 0xffa64d : this.opts.accent);
      },
    });
    this.lpText.setColor(damage ? "#ff8fa3" : "#8ef0bd");
    this.scene.tweens.add({
      targets: this.lpText, scale: 1.22, duration: 130, yoyo: true,
      onComplete: () => this.lpText.setColor("#ffe9b0"),
    });
    if (damage) {
      this.scene.tweens.add({
        targets: this.container, x: this.container.x + 5, duration: 55, yoyo: true, repeat: 2,
      });
    }
  }

  destroy(): void { this.container.destroy(true); }
}
