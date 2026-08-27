// ─────────────────────────────────────────────────────────────────────────────
// Beach Concert — live animated stage on the world map music patio.
//
// Replaces the old static LimeZu piano/drums/guitars with Modern Exteriors
// Beach Concert props + GIF-derived spritesheet animations (DJ, singers, lasers).
// Anchor is the former instrument patio on `world` (~tiles 22–37, 31–39).
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";

const ROOT = "world/beach-concert";

/** Top-left tile of the shoreline stage on Limezu City (`modern-city`). */
export const BEACH_CONCERT_ORIGIN = { tx: 72, ty: 70 } as const;

function assetUrl(rel: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return `${base}${rel.replace(/^\//, "")}`;
}

type AnimDef = {
  key: string;
  file: string;
  fw: number;
  fh: number;
  frames: number;
  rate: number;
};

type StaticDef = {
  key: string;
  file: string;
};

const STATICS: StaticDef[] = [
  { key: "bc-stage-sand", file: "static/21_Beach_32x32_Example_Big_Stage_1_Sand.png" },
  { key: "bc-stage-truss", file: "static/21_Beach_32x32_Example_Big_Stage_Structure.png" },
  { key: "bc-speaker", file: "static/21_Beach_32x32_Big_Loudspeaker_Sand.png" },
  { key: "bc-speaker-cable-l", file: "static/21_Beach_32x32_Big_Loudspeaker_1_Cable_Sand.png" },
  { key: "bc-speaker-cable-r", file: "static/21_Beach_32x32_Big_Loudspeaker_2_Cable_Sand.png" },
  { key: "bc-speaker-med", file: "static/21_Beach_32x32_Medium_Loudspeaker.png" },
  { key: "bc-speaker-sm", file: "static/21_Beach_32x32_Small_Loudspeaker_Sand.png" },
  { key: "bc-dj-set", file: "static/21_Beach_32x32_DJ_Set.png" },
  { key: "bc-barrier-1", file: "static/21_Beach_32x32_Stage_Barrier_1_Sand.png" },
  { key: "bc-barrier-2", file: "static/21_Beach_32x32_Stage_Barrier_2_Sand.png" },
  { key: "bc-barrier-3", file: "static/21_Beach_32x32_Stage_Barrier_3_Sand.png" },
  { key: "bc-barrier-side", file: "static/21_Beach_32x32_Stage_Lateral_Barrier_1_Sand.png" },
  { key: "bc-stairs", file: "static/21_Beach_32x32_Stage_Stairs_Down.png" },
  { key: "bc-bar", file: "static/21_Beach_32x32_Bamboo_Bar_Counter_2_Sand.png" },
  { key: "bc-stool-1", file: "static/21_Beach_32x32_Bamboo_Bar_Chiar_1_Sand.png" },
  { key: "bc-stool-2", file: "static/21_Beach_32x32_Bamboo_Bar_Chiar_2_Sand.png" },
  { key: "bc-tool-1", file: "static/21_Beach_32x32_Stage_Tool_1.png" },
  { key: "bc-tool-2", file: "static/21_Beach_32x32_Stage_Tool_2.png" },
  { key: "bc-tool-3", file: "static/21_Beach_32x32_Stage_Tool_3.png" },
];

const ANIMS: AnimDef[] = [
  { key: "bc-dj", file: "anim/dj.png", fw: 96, fh: 96, frames: 12, rate: 8 },
  { key: "bc-singer-1", file: "anim/singer_1.png", fw: 32, fh: 64, frames: 6, rate: 6 },
  { key: "bc-singer-2", file: "anim/singer_2.png", fw: 32, fh: 64, frames: 6, rate: 6 },
  { key: "bc-singer-3", file: "anim/singer_3.png", fw: 32, fh: 64, frames: 6, rate: 7 },
  { key: "bc-laser", file: "anim/laser_color.png", fw: 256, fh: 288, frames: 20, rate: 10 },
  { key: "bc-laser-2", file: "anim/laser_color_2.png", fw: 256, fh: 288, frames: 20, rate: 10 },
  { key: "bc-fog", file: "anim/fog_loop.png", fw: 192, fh: 192, frames: 6, rate: 5 },
];

/** Queue beach-concert textures onto the scene loader (idempotent). */
export function preloadBeachConcert(scene: Phaser.Scene): void {
  for (const s of STATICS) {
    if (!scene.textures.exists(s.key)) {
      scene.load.image(s.key, assetUrl(`${ROOT}/${s.file}`));
    }
  }
  for (const a of ANIMS) {
    if (!scene.textures.exists(a.key)) {
      scene.load.spritesheet(a.key, assetUrl(`${ROOT}/${a.file}`), {
        frameWidth: a.fw,
        frameHeight: a.fh,
      });
    }
  }
}

function ensureAnims(scene: Phaser.Scene): void {
  for (const a of ANIMS) {
    const animKey = `${a.key}-play`;
    if (scene.anims.exists(animKey)) continue;
    if (!scene.textures.exists(a.key)) continue;
    scene.anims.create({
      key: animKey,
      frames: scene.anims.generateFrameNumbers(a.key, { start: 0, end: a.frames - 1 }),
      frameRate: a.rate,
      repeat: -1,
    });
  }
}

export interface BeachConcertOpts {
  scene: Phaser.Scene;
  /** Tile size in px (world map is 32). */
  tile: number;
  /** Optional origin override (tile coords). */
  origin?: { tx: number; ty: number };
}

/**
 * Spawns the animated beach concert on the world map.
 * Depth uses foot-Y so the player can walk in front of / behind props.
 */
export class BeachConcert {
  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(private opts: BeachConcertOpts) {
    ensureAnims(opts.scene);
    this.build();
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }

  private add(obj: Phaser.GameObjects.GameObject): void {
    this.objs.push(obj);
  }

  private depthAt(footY: number): number {
    // Match ambient/player layering (~400–500); stage sits in the prop band.
    return 350 + Math.floor(footY / 4);
  }

  private img(
    key: string,
    x: number,
    y: number,
    opts?: { originX?: number; originY?: number; depth?: number; flipX?: boolean },
  ): Phaser.GameObjects.Image | null {
    const { scene } = this.opts;
    if (!scene.textures.exists(key)) return null;
    const ox = opts?.originX ?? 0.5;
    const oy = opts?.originY ?? 1;
    const spr = scene.add.image(x, y, key).setOrigin(ox, oy);
    if (opts?.flipX) spr.setFlipX(true);
    spr.setDepth(opts?.depth ?? this.depthAt(y));
    this.add(spr);
    return spr;
  }

  private anim(
    texKey: string,
    x: number,
    y: number,
    opts?: { originX?: number; originY?: number; depth?: number; flipX?: boolean; rateOffset?: number },
  ): Phaser.GameObjects.Sprite | null {
    const { scene } = this.opts;
    if (!scene.textures.exists(texKey)) return null;
    const spr = scene.add.sprite(x, y, texKey).setOrigin(opts?.originX ?? 0.5, opts?.originY ?? 1);
    if (opts?.flipX) spr.setFlipX(true);
    spr.setDepth(opts?.depth ?? this.depthAt(y));
    const animKey = `${texKey}-play`;
    if (scene.anims.exists(animKey)) {
      spr.play(animKey);
      if (opts?.rateOffset) spr.anims.timeScale = 1 + opts.rateOffset;
    }
    this.add(spr);
    return spr;
  }

  private build(): void {
    const { tile } = this.opts;
    const origin = this.opts.origin ?? BEACH_CONCERT_ORIGIN;
    const ox = origin.tx * tile;
    const oy = origin.ty * tile;

    // ── Stage platform + sand (384×192) ──
    const stageW = 384;
    const stageH = 192;
    const stageX = ox + stageW / 2;
    const stageFootY = oy + stageH;
    this.img("bc-stage-sand", stageX, stageFootY, { depth: this.depthAt(stageFootY) - 20 });

    // ── Metal truss / spotlights (352×352), seated on the platform ──
    // Foot of truss aligns near the stage deck; tall beams draw above performers.
    const trussFootY = oy + 170;
    this.img("bc-stage-truss", stageX, trussFootY, { depth: this.depthAt(trussFootY) + 40 });

    // ── Speakers flanking the stage ──
    this.img("bc-speaker", ox + 16, oy + 150, { originX: 0.5, originY: 1 });
    this.img("bc-speaker-cable-l", ox + 48, oy + 168);
    this.img("bc-speaker", ox + stageW - 16, oy + 150, { originX: 0.5, originY: 1 });
    this.img("bc-speaker-cable-r", ox + stageW - 48, oy + 168);
    this.img("bc-speaker-med", stageX - 70, oy + 120);
    this.img("bc-speaker-sm", stageX + 70, oy + 125);

    // ── Stairs at front-center of stage ──
    this.img("bc-stairs", stageX, oy + stageH - 8);

    // ── Stage tools / monitors ──
    this.img("bc-tool-1", stageX - 100, oy + 100);
    this.img("bc-tool-2", stageX + 40, oy + 105);
    this.img("bc-tool-3", stageX + 110, oy + 98);

    // ── Barriers between crowd and stage ──
    const barrierY = oy + stageH + 28;
    this.img("bc-barrier-1", stageX - 90, barrierY);
    this.img("bc-barrier-2", stageX - 20, barrierY);
    this.img("bc-barrier-3", stageX + 50, barrierY);
    this.img("bc-barrier-side", ox + 40, barrierY - 10);
    this.img("bc-barrier-side", ox + stageW - 40, barrierY - 10, { flipX: true });

    // ── Bamboo tiki bar to the right of the stage ──
    const barX = ox + stageW + 56;
    const barY = oy + 140;
    this.img("bc-bar", barX, barY);
    this.img("bc-stool-1", barX - 28, barY + 18);
    this.img("bc-stool-2", barX + 20, barY + 20);

    // ── Animated performers on stage ──
    const deckY = oy + 118;
    this.img("bc-dj-set", stageX + 90, deckY + 8);
    this.anim("bc-dj", stageX + 90, deckY, { rateOffset: 0.05 });
    this.anim("bc-singer-1", stageX - 10, deckY + 6);
    this.anim("bc-singer-2", stageX - 50, deckY + 4, { rateOffset: -0.08 });
    this.anim("bc-singer-3", stageX + 30, deckY + 8, { rateOffset: 0.12 });

    // ── Laser machines at front stage corners (beams shoot upward) ──
    // Large frames; origin near the emitter base so beams rise above the stage.
    const laserY = oy + 155;
    this.anim("bc-laser", ox + 70, laserY, {
      originX: 0.5,
      originY: 0.92,
      depth: this.depthAt(laserY) + 80,
    });
    this.anim("bc-laser-2", ox + stageW - 70, laserY, {
      originX: 0.5,
      originY: 0.92,
      depth: this.depthAt(laserY) + 80,
      rateOffset: 0.15,
      flipX: true,
    });

    // Soft fog near the front of the stage
    this.anim("bc-fog", stageX - 40, oy + stageH - 20, {
      originX: 0.5,
      originY: 0.85,
      depth: this.depthAt(oy + stageH) + 30,
    });
    this.anim("bc-fog", stageX + 50, oy + stageH - 10, {
      originX: 0.5,
      originY: 0.85,
      depth: this.depthAt(oy + stageH) + 30,
      rateOffset: -0.1,
    });
  }
}
