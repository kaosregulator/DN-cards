import Phaser from "phaser";
import { getContext } from "../core/context";
import { NavDock } from "../hud/navDock";
import type { RaidModel, RaidBossModel, Combatant } from "../net/api";
import {
  addBackdrop, ensureKeys, makeHealthBar, floatDamage, impactFlash, bannerText, centerLabel, type HealthBar,
} from "./play/common";

// Reusable Raid Scene. Presents the REAL campaign ladder + this player's clear
// progress. Boss stats, sequence, and enrage come from the read model; the scene
// choreographs the assault. Presentation only.
export class RaidScene extends Phaser.Scene {
  private nav!: NavDock;
  private model!: RaidModel;
  private idx = 0;
  private bossHp = 0;
  private bossBar!: HealthBar;
  private boss!: Phaser.GameObjects.Image;
  private team: Phaser.GameObjects.Image[] = [];
  private turn = 0;
  private fighting = false;

  constructor() {
    super("Raid");
  }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    this.nav = new NavDock("Raid", (k) => this.scene.start(k === "Hq" ? "Boot" : k));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.nav.destroy());

    const loading = centerLabel(this, "Approaching the campaign…");
    try {
      this.model = await getContext(this).api.raid();
    } catch {
      loading.setText("Couldn't load the raid.");
      return;
    }
    loading.destroy();

    if (this.model.bosses.length === 0) {
      centerLabel(this, "No raid bosses are set up yet.\nAsk an admin to create one with /raid_admin.");
      return;
    }

    const keys = [
      ...this.model.backdrops, ...this.model.bosses.map((b) => b.sprite),
      ...this.model.team.map((c) => c.sprite), "fx/flash00",
    ];
    await ensureKeys(this, keys);

    // start at the first uncleared boss
    this.idx = Math.max(0, this.model.bosses.findIndex((b) => !b.defeated));
    if (this.idx < 0) this.idx = 0;
    this.renderStage();
  }

  private renderStage(): void {
    this.children.removeAll();
    this.turn = 0;
    this.fighting = false;
    const { width, height } = this.scale;
    const boss = this.model.bosses[this.idx]!;
    addBackdrop(this, this.model.backdrops[this.idx % this.model.backdrops.length] ?? "");

    // campaign node bar
    this.renderLadder();

    // boss
    this.bossHp = boss.maxHealth;
    this.boss = this.add.image(width / 2, height * 0.5, boss.sprite).setOrigin(0.5, 1).setDepth(400);
    this.boss.setScale(Math.min(2.2, (height * 0.42) / (this.boss.height || 512)));
    this.add.ellipse(width / 2, height * 0.5, 220, 60, boss.color, 0.3).setDepth(390);
    this.tweens.add({ targets: this.boss, y: this.boss.y - 12, yoyo: true, repeat: -1, duration: 1800, ease: "Sine.InOut" });

    const barW = Math.min(400, width - 32);
    this.bossBar = makeHealthBar(this, width / 2 - barW / 2, 96, barW, boss.maxHealth, boss.color,
      `${boss.defeated ? "✓ " : ""}${boss.name} · ${boss.rarity}`);

    // player team along the bottom
    this.team = [];
    const n = this.model.team.length;
    const spacing = Math.min(130, (width - 40) / Math.max(1, n));
    const teamY = height * 0.86;
    this.model.team.forEach((c: Combatant, i) => {
      const x = width / 2 + (i - (n - 1) / 2) * spacing;
      const img = this.add.image(x, teamY, c.sprite).setOrigin(0.5, 1).setDepth(500 + i);
      img.setScale(Math.min(150, this.scale.height * 0.2) / (img.height || 512));
      this.add.ellipse(x, teamY, 90, 26, c.color, 0.3).setDepth(490);
      this.team.push(img);
    });

    this.renderControls(boss);
    this.time.delayedCall(600, () => this.assault());
  }

  private renderLadder(): void {
    const { width } = this.scale;
    const n = this.model.bosses.length;
    const y = 50;
    const startX = width / 2 - ((n - 1) * 40) / 2;
    this.add.text(14, 12, `Campaign · ${this.model.progress.defeated}/${this.model.progress.total} cleared`, {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#c8d4ff",
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(600);
    this.model.bosses.forEach((b, i) => {
      const x = startX + i * 40;
      if (i > 0) this.add.line(0, 0, startX + (i - 1) * 40, y, x, y, 0x3a4c78).setOrigin(0, 0).setLineWidth(2).setDepth(590);
      const dot = this.add.circle(x, y, i === this.idx ? 9 : 6,
        b.defeated ? 0x7ee0a0 : i === this.idx ? b.color : 0x38456e).setDepth(600).setScrollFactor(0);
      if (i === this.idx) dot.setStrokeStyle(2, 0xffffff);
    });
  }

  private renderControls(boss: RaidBossModel): void {
    // Prev/next pinned to the left/right edges at mid-height — clear of the nav
    // dock (top on desktop, bottom on mobile) and easy to thumb on a phone.
    const { width, height } = this.scale;
    const mk = (label: string, x: number, fn: () => void, enabled: boolean) => {
      const t = this.add.text(x, height / 2, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "16px", color: enabled ? "#dbe4ff" : "#48527a",
        backgroundColor: "#222c4dcc", padding: { x: 14, y: 14 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(700);
      if (enabled) t.setInteractive({ useHandCursor: true }).on("pointerdown", fn);
      return t;
    };
    mk("◀", 30, () => { this.idx = Math.max(0, this.idx - 1); this.renderStage(); }, this.idx > 0);
    mk("▶", width - 30, () => {
      this.idx = Math.min(this.model.bosses.length - 1, this.idx + 1); this.renderStage();
    }, this.idx < this.model.bosses.length - 1);
    void boss;
  }

  private assault(): void {
    if (this.fighting) return;
    this.fighting = true;
    this.step();
  }

  private step(): void {
    if (this.bossHp <= 0) {
      bannerText(this, "BOSS DOWN", "#7ee0a0");
      return;
    }
    const boss = this.model.bosses[this.idx]!;
    const enraged = this.turn >= boss.enrageTurn;
    if (enraged) this.boss.setTint(0xff6a6a);
    const fighter = this.team[this.turn % this.team.length];
    this.turn++;
    if (!fighter) return;

    const homeY = fighter.y;
    this.tweens.add({
      targets: fighter, y: this.boss.y + 30, duration: 220, ease: "Cubic.In",
      onComplete: () => {
        const base = this.model.team[(this.turn - 1) % this.team.length]?.atk ?? 80;
        const dmg = Math.max(40, Math.round(base * 3.4 * Phaser.Math.FloatBetween(0.85, 1.25)));
        this.bossHp = Math.max(0, this.bossHp - dmg);
        this.bossBar.set(this.bossHp);
        impactFlash(this, this.boss.x, this.boss.y - this.boss.displayHeight * 0.5);
        floatDamage(this, this.boss.x + Phaser.Math.Between(-40, 40), this.boss.y - 120, dmg, boss.color);
        this.cameras.main.shake(140, enraged ? 0.01 : 0.005);
        this.tweens.add({ targets: this.boss, x: this.boss.x + 10, duration: 60, yoyo: true, repeat: 2 });
        this.tweens.add({
          targets: fighter, y: homeY, duration: 260, ease: "Cubic.Out", delay: 60,
          onComplete: () => this.time.delayedCall(280, () => this.step()),
        });
      },
    });
  }
}
