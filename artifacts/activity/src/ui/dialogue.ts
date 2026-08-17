// ─────────────────────────────────────────────────────────────────────────────
// DialogueBox — the classic bottom-of-screen text window with a typewriter
// reveal, a blinking "▼ next" caret, and an optional choice list. Fixed to the
// camera so it works over a scrolling world.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";

export class DialogueBox {
  private scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container | null = null;
  private nameText!: Phaser.GameObjects.Text;
  private bodyText!: Phaser.GameObjects.Text;
  private caret!: Phaser.GameObjects.Text;
  private lines: string[] = [];
  private index = 0;
  private full = "";
  private typed = 0;
  private typing = false;
  private timer?: Phaser.Time.TimerEvent;
  private onDone: (() => void) | null = null;

  constructor(scene: Phaser.Scene) { this.scene = scene; }

  get isOpen(): boolean { return this.root !== null; }

  show(name: string, lines: string[], onDone?: () => void): void {
    this.close();
    this.lines = [...lines];
    this.index = 0;
    this.onDone = onDone ?? null;
    this.build(name);
    this.type(this.lines[0] ?? "");
  }

  /** Present a titled list of choices; resolves through the chosen callback. */
  choice(title: string, options: Array<[string, () => void]>, onCancel?: () => void): void {
    this.close();
    const s = this.scene;
    const W = s.scale.width, H = s.scale.height;
    const root = s.add.container(0, 0).setScrollFactor(0).setDepth(3000);
    this.root = root;
    const shade = s.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0).setInteractive();
    root.add(shade);
    const pw = Math.min(300, W - 48);
    const ph = 52 + options.length * 44;
    const px = W / 2, py = H / 2;
    const g = s.add.graphics();
    g.fillStyle(0x121a2e, 0.98); g.fillRoundedRect(px - pw / 2, py - ph / 2, pw, ph, 12);
    g.lineStyle(2, 0x3a4a80, 1); g.strokeRoundedRect(px - pw / 2, py - ph / 2, pw, ph, 12);
    root.add(g);
    root.add(s.add.text(px, py - ph / 2 + 14, title, {
      fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#e6ecff", fontStyle: "bold",
    }).setOrigin(0.5, 0));
    let oy = py - ph / 2 + 46;
    for (const [label, fn] of options) {
      const bg = s.add.rectangle(px, oy + 16, pw - 28, 36, 0x24407e).setStrokeStyle(1, 0x4a5a90).setInteractive();
      const tx = s.add.text(px, oy + 16, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#fff", fontStyle: "bold",
      }).setOrigin(0.5);
      bg.on("pointerdown", () => { this.close(); fn(); });
      root.add([bg, tx]);
      oy += 44;
    }
    shade.on("pointerdown", () => { this.close(); onCancel?.(); });
  }

  /** Advance the typewriter / move to the next line / close. */
  advance(): void {
    if (!this.root) return;
    if (this.typing) { this.finishTyping(); return; }
    this.index++;
    if (this.index < this.lines.length) { this.type(this.lines[this.index]!); return; }
    const done = this.onDone;
    this.close();
    done?.();
  }

  close(): void {
    this.timer?.remove();
    this.timer = undefined;
    this.typing = false;
    this.root?.destroy(true);
    this.root = null;
  }

  destroy(): void { this.close(); }

  // ── internals ─────────────────────────────────────────────────────────────
  private build(name: string): void {
    const s = this.scene;
    const W = s.scale.width, H = s.scale.height;
    const root = s.add.container(0, 0).setScrollFactor(0).setDepth(3000);
    this.root = root;

    const bw = Math.min(W - 24, 620), bh = 116;
    const bx = W / 2, by = H - bh / 2 - 12;
    const g = s.add.graphics();
    g.fillStyle(0x0e1526, 0.97); g.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12);
    g.lineStyle(3, 0x5a7ad0, 1); g.strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12);
    g.lineStyle(1, 0x9db2ff, 0.5); g.strokeRoundedRect(bx - bw / 2 + 5, by - bh / 2 + 5, bw - 10, bh - 10, 8);
    root.add(g);

    this.nameText = s.add.text(bx - bw / 2 + 16, by - bh / 2 + 10, name, {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#ffe9b0", fontStyle: "bold",
    });
    this.bodyText = s.add.text(bx - bw / 2 + 16, by - bh / 2 + 36, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "15px", color: "#e6ecff",
      wordWrap: { width: bw - 32 }, lineSpacing: 4,
    });
    this.caret = s.add.text(bx + bw / 2 - 18, by + bh / 2 - 16, "▼", {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#9db2ff",
    }).setOrigin(0.5).setVisible(false);
    root.add([this.nameText, this.bodyText, this.caret]);
    s.tweens.add({ targets: this.caret, alpha: 0.25, duration: 520, yoyo: true, repeat: -1 });

    // Tapping the box advances it.
    const hit = s.add.rectangle(0, 0, W, H, 0x000000, 0.001).setOrigin(0).setInteractive();
    hit.on("pointerdown", () => this.advance());
    root.addAt(hit, 0);
  }

  private type(line: string): void {
    this.full = line;
    this.typed = 0;
    this.typing = true;
    this.caret.setVisible(false);
    this.bodyText.setText("");
    this.timer?.remove();
    this.timer = this.scene.time.addEvent({
      delay: 18,
      loop: true,
      callback: () => {
        this.typed++;
        this.bodyText.setText(this.full.slice(0, this.typed));
        if (this.typed >= this.full.length) this.finishTyping();
      },
    });
  }

  private finishTyping(): void {
    this.timer?.remove();
    this.timer = undefined;
    this.typing = false;
    this.bodyText.setText(this.full);
    this.caret.setVisible(true);
  }
}
