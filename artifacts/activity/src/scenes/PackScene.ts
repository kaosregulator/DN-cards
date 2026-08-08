import Phaser from "phaser";
import { getContext } from "../core/context";
import { NavDock } from "../hud/navDock";
import type { PackModel } from "../net/api";
import { ensureKeys, centerLabel, impactFlash } from "./play/common";

// Reusable Pack-Opening Scene — a premium reveal presentation. Tiers, sizes and
// rarity ODDS are the guild's REAL configuration (read model). Rarities are
// sampled from those real weights for the reveal; this scene grants NOTHING —
// authoritative opening (currency, ownership) stays in the bot.
export class PackScene extends Phaser.Scene {
  private nav!: NavDock;
  private model!: PackModel;

  constructor() {
    super("Pack");
  }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    this.nav = new NavDock("Pack", (k) => this.scene.start(k === "Hq" ? "Boot" : k));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.nav.destroy());
    this.cameras.main.setBackgroundColor("#0a1020");

    const loading = centerLabel(this, "Loading the store…");
    try {
      this.model = await getContext(this).api.packs();
    } catch {
      loading.setText("Couldn't load packs.");
      return;
    }
    loading.destroy();
    await ensureKeys(this, ["deco/supply-crate", "fx/flash00"]);
    this.showTierPicker();
  }

  private showTierPicker(): void {
    this.children.removeAll();
    const { width, height } = this.scale;
    this.add.text(width / 2, height * 0.22, "🎁  Open a Pack", {
      fontFamily: "system-ui, sans-serif", fontSize: "26px", fontStyle: "bold", color: "#fff",
    }).setOrigin(0.5);
    this.add.text(width / 2, height * 0.22 + 34, "Live preview · odds are your server's real drop rates", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#7a86b0",
    }).setOrigin(0.5);

    const n = this.model.tiers.length;
    const spacing = Math.min(200, (width - 24) / n);
    const boxW = Math.min(170, spacing - 14);
    this.model.tiers.forEach((t, i) => {
      const x = width / 2 + (i - (n - 1) / 2) * spacing;
      const y = height * 0.52;
      const card = this.add.container(x, y);
      const box = this.add.rectangle(0, 0, boxW, 200, 0x162038).setStrokeStyle(2, 0x33406f);
      const crate = this.add.image(0, -14, "deco/supply-crate").setScale(0.28);
      const title = this.add.text(0, 58, `${t.emoji} ${t.label}`, {
        fontFamily: "system-ui, sans-serif", fontSize: "16px", fontStyle: "bold", color: "#e6ecff",
      }).setOrigin(0.5);
      const meta = this.add.text(0, 82, `💠 ${t.cost.toLocaleString()} · ${t.size} cards`, {
        fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#9db2ff",
      }).setOrigin(0.5);
      card.add([box, crate, title, meta]);
      box.setInteractive({ useHandCursor: true })
        .on("pointerover", () => this.tweens.add({ targets: card, scale: 1.05, duration: 120 }))
        .on("pointerout", () => this.tweens.add({ targets: card, scale: 1, duration: 120 }))
        .on("pointerdown", () => this.openPack(t.size));
    });
  }

  private weightedRarity() {
    const total = this.model.rarities.reduce((s, r) => s + Math.max(0, r.weight), 0) || 1;
    let roll = Math.random() * total;
    for (const r of this.model.rarities) {
      roll -= Math.max(0, r.weight);
      if (roll <= 0) return r;
    }
    return this.model.rarities[0]!;
  }

  private openPack(size: number): void {
    this.children.removeAll();
    const { width, height } = this.scale;
    const crate = this.add.image(width / 2, height / 2, "deco/supply-crate").setScale(0.55);
    const glow = this.add.ellipse(width / 2, height / 2, 60, 60, 0x6ad0ff, 0.0).setBlendMode(Phaser.BlendModes.ADD);

    // shake + build-up glow
    this.tweens.add({ targets: crate, angle: { from: -4, to: 4 }, yoyo: true, repeat: 6, duration: 80 });
    this.tweens.add({
      targets: glow, alpha: 0.8, scaleX: 8, scaleY: 8, duration: 900, ease: "Cubic.In",
      onComplete: () => {
        impactFlash(this, width / 2, height / 2);
        this.cameras.main.flash(200, 180, 220, 255);
        crate.destroy();
        glow.destroy();
        this.revealCards(size);
      },
    });
  }

  private revealCards(size: number): void {
    const { width, height } = this.scale;
    const rolls = Array.from({ length: size }, () => this.weightedRarity());
    // Size cards so the whole pack fits the viewport width (phones included).
    const gap = 12;
    const cw = Phaser.Math.Clamp((width - 24 - (size - 1) * gap) / size, 48, 92);
    const totalW = size * cw + (size - 1) * gap;
    const startX = width / 2 - totalW / 2 + cw / 2;

    rolls.forEach((r, i) => {
      const x = startX + i * (cw + gap);
      const y = height / 2;
      const card = this.add.container(x, y).setScale(0).setAlpha(0);
      const face = this.add.rectangle(0, 0, cw, cw * 1.4, 0x0e1626).setStrokeStyle(3, r.color);
      const shine = this.add.rectangle(0, 0, cw, cw * 1.4, r.color, 0.12);
      const label = this.add.text(0, cw * 0.5, r.label, {
        fontFamily: "system-ui, sans-serif", fontSize: "12px", fontStyle: "bold",
        color: "#" + r.color.toString(16).padStart(6, "0"),
      }).setOrigin(0.5);
      const gem = this.add.text(0, -8, "◆", {
        fontFamily: "system-ui, sans-serif", fontSize: "34px",
        color: "#" + r.color.toString(16).padStart(6, "0"),
      }).setOrigin(0.5);
      card.add([face, shine, gem, label]);

      this.tweens.add({
        targets: card, scale: 1, alpha: 1, duration: 380, ease: "Back.Out", delay: 250 + i * 260,
        onStart: () => {
          this.time.delayedCall(250 + i * 260, () => {
            impactFlash(this, x, y);
            // higher rarities get a brighter pop
            if (r.weight <= 10) this.cameras.main.shake(120, 0.004);
          });
        },
      });
      // idle shimmer
      this.tweens.add({ targets: shine, alpha: 0.28, yoyo: true, repeat: -1, duration: 900, delay: 900 + i * 260 });
    });

    // "Open another" after the reveal
    this.time.delayedCall(400 + size * 260, () => {
      const again = this.add.text(width / 2, height * 0.82, "↺ Open another", {
        fontFamily: "system-ui, sans-serif", fontSize: "15px", color: "#fff",
        backgroundColor: "#3355ee", padding: { x: 18, y: 10 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      again.on("pointerdown", () => this.showTierPicker());
    });
  }
}
