// ─────────────────────────────────────────────────────────────────────────────
// TouchPad — the on-screen D-pad + A / menu buttons for phones (and mouse).
// Held state is polled by the scene each frame, so it drives the same movement
// path as the keyboard. Screen-fixed and re-laid-out on resize.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";

interface TouchPadOpts {
  onAction: () => void;
  onMenu?: () => void;
}

export class TouchPad {
  private scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container;
  private held = { x: 0, y: 0 };
  private buttons: Array<{ c: Phaser.GameObjects.Container; ax: number; ay: number }> = [];
  private actionBtn!: Phaser.GameObjects.Container;
  private menuBtn!: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, opts: TouchPadOpts) {
    this.scene = scene;
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(2000);

    const mkDir = (glyph: string, ax: number, ay: number) => {
      const c = this.circle(26, glyph, 20);
      const set = (on: boolean) => {
        if (ax) this.held.x = on ? ax : (this.held.x === ax ? 0 : this.held.x);
        if (ay) this.held.y = on ? ay : (this.held.y === ay ? 0 : this.held.y);
        c.setAlpha(on ? 1 : 0.72);
      };
      c.on("pointerdown", () => set(true));
      c.on("pointerup", () => set(false));
      c.on("pointerout", () => set(false));
      c.on("pointerupoutside", () => set(false));
      this.buttons.push({ c, ax, ay });
      return c;
    };
    mkDir("▲", 0, -1); mkDir("▼", 0, 1); mkDir("◀", -1, 0); mkDir("▶", 1, 0);

    this.actionBtn = this.circle(34, "A", 22, 0x2b57b8);
    this.actionBtn.on("pointerdown", () => opts.onAction());
    this.menuBtn = this.circle(20, "☰", 14, 0x3a3f5a);
    this.menuBtn.on("pointerdown", () => opts.onMenu?.());

    this.layout();
  }

  /** Current held direction (-1/0/1 on each axis). */
  direction(): { x: number; y: number } { return this.held; }

  layout(): void {
    const W = this.scene.scale.width, H = this.scene.scale.height;
    const bx = 74, by = H - 84;
    const offs = [[0, -42], [0, 42], [-42, 0], [42, 0]];
    this.buttons.forEach((b, i) => {
      const [ox, oy] = offs[i]!;
      b.c.setPosition(bx + ox!, by + oy!);
    });
    this.actionBtn.setPosition(W - 62, H - 74);
    this.menuBtn.setPosition(W - 32, 30);
  }

  destroy(): void { this.root.destroy(true); }

  private circle(r: number, glyph: string, fontSize: number, fill = 0x101830): Phaser.GameObjects.Container {
    const s = this.scene;
    const c = s.add.container(0, 0).setScrollFactor(0);
    const bg = s.add.circle(0, 0, r, fill, 0.62).setStrokeStyle(2, 0x5a7ad0, 0.9);
    const t = s.add.text(0, 0, glyph, {
      fontFamily: "system-ui, sans-serif", fontSize: `${fontSize}px`, color: "#dbe4ff", fontStyle: "bold",
    }).setOrigin(0.5);
    c.add([bg, t]);
    c.setSize(r * 2, r * 2).setAlpha(0.72);
    c.setInteractive(new Phaser.Geom.Circle(0, 0, r), Phaser.Geom.Circle.Contains);
    this.root.add(c);
    return c;
  }
}
