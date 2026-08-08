// Shared presentation helpers for the Battle / Raid / Pack scenes: backdrop,
// health bars, floating damage numbers, impact flashes, and a small loading /
// error label. Keeps each scene focused on choreography, not boilerplate.

import Phaser from "phaser";
import { getContext } from "../../core/context";

export async function ensureKeys(scene: Phaser.Scene, keys: string[]): Promise<void> {
  await getContext(scene).assets.ensure(scene, keys);
}

/** Full-bleed backdrop image, darkened, covering the camera. */
export function addBackdrop(scene: Phaser.Scene, key: string): void {
  const { width, height } = scene.scale;
  scene.cameras.main.setBackgroundColor("#0a1020");
  if (scene.textures.exists(key)) {
    const bg = scene.add.image(width / 2, height / 2, key).setDepth(-100);
    const cover = Math.max(width / bg.width, height / bg.height) * 1.05;
    bg.setScale(cover).setTint(0x8a97b5).setScrollFactor(0);
  }
  // vignette
  const g = scene.add.graphics().setDepth(-90).setScrollFactor(0);
  g.fillStyle(0x05070f, 0.55);
  g.fillRect(0, 0, width, height);
}

export interface HealthBar {
  set(value: number): void;
  container: Phaser.GameObjects.Container;
}

export function makeHealthBar(
  scene: Phaser.Scene, x: number, y: number, w: number, max: number, color: number, label: string,
): HealthBar {
  const h = 16;
  const c = scene.add.container(x, y).setDepth(500).setScrollFactor(0);
  const back = scene.add.rectangle(0, 0, w, h, 0x10182c).setOrigin(0, 0.5).setStrokeStyle(1.5, 0x2b3960);
  const fill = scene.add.rectangle(2, 0, w - 4, h - 4, color).setOrigin(0, 0.5);
  const txt = scene.add.text(0, -16, label, {
    fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#e6ecff", fontStyle: "bold",
  }).setOrigin(0, 1);
  const num = scene.add.text(w, -16, `${max}`, {
    fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#9db2ff",
  }).setOrigin(1, 1);
  c.add([back, fill, txt, num]);
  const fullW = w - 4;
  return {
    container: c,
    set(value: number) {
      const v = Phaser.Math.Clamp(value, 0, max);
      scene.tweens.add({ targets: fill, displayWidth: (v / max) * fullW, duration: 260, ease: "Cubic.Out" });
      num.setText(`${Math.max(0, Math.round(v))}`);
      fill.setFillStyle(v / max < 0.3 ? 0xff5a6a : color);
    },
  };
}

export function floatDamage(scene: Phaser.Scene, x: number, y: number, amount: number, color = 0xffd36b): void {
  const t = scene.add.text(x, y, `-${amount}`, {
    fontFamily: "system-ui, sans-serif", fontSize: "26px", fontStyle: "bold",
    color: "#" + color.toString(16).padStart(6, "0"),
    stroke: "#000", strokeThickness: 4,
  }).setOrigin(0.5).setDepth(2000);
  scene.tweens.add({
    targets: t, y: y - 60, alpha: 0, scale: 1.3, duration: 850, ease: "Cubic.Out",
    onComplete: () => t.destroy(),
  });
}

export function impactFlash(scene: Phaser.Scene, x: number, y: number): void {
  const key = "fx/flash00";
  if (scene.textures.exists(key)) {
    const f = scene.add.image(x, y, key).setDepth(1900).setScale(0.4).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: f, scale: 1.1, alpha: 0, duration: 320, onComplete: () => f.destroy() });
  } else {
    const c = scene.add.circle(x, y, 8, 0xffffff, 0.9).setDepth(1900).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: c, scale: 5, alpha: 0, duration: 300, onComplete: () => c.destroy() });
  }
}

export function bannerText(scene: Phaser.Scene, text: string, color: string): Phaser.GameObjects.Text {
  const { width, height } = scene.scale;
  const t = scene.add.text(width / 2, height / 2, text, {
    fontFamily: "system-ui, sans-serif", fontSize: "56px", fontStyle: "bold",
    color, stroke: "#000", strokeThickness: 8,
  }).setOrigin(0.5).setDepth(3000).setScrollFactor(0).setScale(0.2).setAlpha(0);
  scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 500, ease: "Back.Out" });
  return t;
}

export function centerLabel(scene: Phaser.Scene, text: string): Phaser.GameObjects.Text {
  const { width, height } = scene.scale;
  return scene.add.text(width / 2, height / 2, text, {
    fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#9db2ff", align: "center",
    wordWrap: { width: Math.min(560, width - 48) },
  }).setOrigin(0.5).setDepth(3000).setScrollFactor(0);
}
