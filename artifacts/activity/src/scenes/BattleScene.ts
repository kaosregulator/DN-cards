import Phaser from "phaser";
import { getContext } from "../core/context";
import { NavDock } from "../hud/navDock";
import type { BattleModel, Combatant } from "../net/api";
import {
  addBackdrop, ensureKeys, makeHealthBar, floatDamage, impactFlash, bannerText, centerLabel, type HealthBar,
} from "./play/common";
import { RiveFxLayer } from "./play/riveOverlay";

// Reusable Battle Scene. Presents the existing battle line-up with the classic
// Street-Fighter choreography (approach → strike → impact → recoil → return).
// Numbers are the real card-derived stats from the read model; this scene is
// presentation only — authoritative combat resolution stays in the bot.
interface Fighter {
  data: Combatant;
  img: Phaser.GameObjects.Image;
  bar: HealthBar;
  hp: number;
  homeX: number;
  facing: 1 | -1;
}

export class BattleScene extends Phaser.Scene {
  private nav!: NavDock;
  private turn = 0;
  // Optional Rive FX overlay for signature bursts. Dormant until `.riv` art is
  // registered via enableRiveFx(); every play() is then a no-op-safe cue.
  private fx = new RiveFxLayer();

  constructor() {
    super("Battle");
  }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    this.nav = new NavDock("Battle", (k) => this.scene.start(k === "Hq" ? "Boot" : k));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.nav.destroy(); this.fx.destroy(); });

    const loading = centerLabel(this, "Entering the arena…");
    let model: BattleModel;
    try {
      model = await getContext(this).api.battle();
    } catch {
      loading.setText("Couldn't load the battle.");
      return;
    }
    loading.destroy();

    const keys = [
      ...model.backdrops, ...model.player.map((c) => c.sprite), ...model.opponent.map((c) => c.sprite), "fx/flash00",
    ];
    await ensureKeys(this, keys);
    addBackdrop(this, model.backdrops[0] ?? "");

    const { width, height } = this.scale;
    this.add.text(14, 12, "⚔  ARENA", {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", fontStyle: "bold", color: "#fff",
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(600);

    const groundY = height * 0.72;
    const barW = Math.min(260, width / 2 - 20);
    const p = this.makeFighter(model.player[0]!, width * 0.28, groundY, 1, 12, barW);
    const o = this.makeFighter(model.opponent[0]!, width * 0.72, groundY, -1, width - 12 - barW, barW);

    // benched teammates, smaller, behind
    this.renderBench(model.player.slice(1), width * 0.1, groundY - 8, 1);
    this.renderBench(model.opponent.slice(1), width * 0.9, groundY - 8, -1);

    this.time.delayedCall(700, () => this.loop(p, o));
  }

  private makeFighter(c: Combatant, x: number, y: number, facing: 1 | -1, barX: number, barW: number): Fighter {
    const img = this.add.image(x, y, c.sprite).setOrigin(0.5, 1).setDepth(500 + Math.round(y));
    // Scale the fighter to the viewport so it's neither tiny nor clipped.
    const h = Math.min(240, this.scale.height * 0.34);
    img.setScale(h / (img.height || 512));
    img.setFlipX(facing === -1);
    img.setTint(0xffffff);
    // rarity glow ring under feet
    const glow = this.add.ellipse(x, y, 120, 40, c.color, 0.35).setDepth(400);
    this.tweens.add({ targets: glow, scaleX: 1.1, scaleY: 1.1, yoyo: true, repeat: -1, duration: 1400 });

    const bar = makeHealthBar(this, barX, 70, barW, c.hp, c.color, `${c.name} · ${c.rarity}`);
    return { data: c, img, bar, hp: c.hp, homeX: x, facing };
  }

  private renderBench(team: Combatant[], x: number, y: number, facing: 1 | -1): void {
    team.forEach((c, i) => {
      const img = this.add.image(x, y + i * 6, c.sprite).setOrigin(0.5, 1).setDepth(300 - i);
      img.setScale(150 / (img.height || 512)).setFlipX(facing === -1).setAlpha(0.75).setTint(0xaab4d0);
    });
  }

  // Alternating turn loop with the full lunge → impact → recoil → return beat.
  private loop(a: Fighter, b: Fighter): void {
    if (a.hp <= 0 || b.hp <= 0) {
      const won = b.hp <= 0;
      bannerText(this, won ? "VICTORY" : "DEFEAT", won ? "#7ee0a0" : "#ff9db2");
      return;
    }
    const attacker = this.turn % 2 === 0 ? a : b;
    const target = this.turn % 2 === 0 ? b : a;
    this.turn++;
    this.strike(attacker, target, () => this.time.delayedCall(360, () => this.loop(a, b)));
  }

  private strike(att: Fighter, tgt: Fighter, done: () => void): void {
    const lungeX = att.homeX + att.facing * 150;
    this.tweens.add({
      targets: att.img, x: lungeX, duration: 180, ease: "Cubic.In",
      onComplete: () => {
        const roll = Phaser.Math.FloatBetween(0.8, 1.2);
        const dmg = Math.max(20, Math.round(att.data.atk * roll));
        tgt.hp = Math.max(0, tgt.hp - dmg);
        tgt.bar.set(tgt.hp);
        impactFlash(this, tgt.img.x - tgt.facing * 40, tgt.img.y - 120);
        // Signature burst cue: big hits / knockouts get the Rive flourish when
        // overlay art is present (otherwise this is a silent no-op).
        void this.fx.play(tgt.hp <= 0 ? "ko" : roll >= 1.12 ? "crit" : "attack");
        floatDamage(this, tgt.img.x, tgt.img.y - 200, dmg, att.data.color);
        this.cameras.main.shake(120, 0.006);
        // recoil
        this.tweens.add({ targets: tgt.img, x: tgt.homeX - tgt.facing * -22, duration: 90, yoyo: true });
        // return
        this.tweens.add({
          targets: att.img, x: att.homeX, duration: 220, ease: "Cubic.Out", delay: 60, onComplete: done,
        });
      },
    });
  }
}
