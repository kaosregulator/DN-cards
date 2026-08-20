// ─────────────────────────────────────────────────────────────────────────────
// Ambient world life — the NPCs and stray dogs that make each map feel lived-in.
//
// Nothing here is hand-placed per map. Instead we scan the tiles once (using the
// same terrain read the minimap uses) to find sensible spots:
//   • open ground   → NPCs pacing back and forth, a few loose dogs trotting about
//   • water's edge   → NPCs standing and watching the lake, a dog resting nearby
//   • among buildings → NPCs idling "in the office"
// A couple of NPCs get a dog sitting beside them. Everything is spaced out and
// sized to match the player (NPCs share the 32×48 sheets; dogs are scaled down),
// so no giants and no clutter. Purely decorative: no physics, no collisions — the
// player walks freely past them. Stray dogs still bark when you click them.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";
import { type AvatarDef, buildAvatarAnims, avatarAnim } from "./avatars";
import { buildPetAnims, PET_REACTIONS } from "./pets";

type Dir = "down" | "left" | "right" | "up";

export interface AmbientOpts {
  scene: Phaser.Scene;
  tw: number;
  th: number;
  mapW: number; // tiles
  mapH: number; // tiles
  isWalkable: (tx: number, ty: number) => boolean;
  classify: (tx: number, ty: number) => 0 | 1 | 2 | 3;
  /** Pixel points (portals, spawn, player) to keep a few tiles clear of. */
  avoid: { x: number; y: number }[];
  /** npc3 avatar descriptors to draw the crowd from. */
  npcDefs: AvatarDef[];
  /** Pet breed ids available for stray dogs. */
  breeds: string[];
  seed: number;
}

interface Spot { tx: number; ty: number; }

// Small deterministic RNG so a given map lays out the same crowd every visit.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Ambient {
  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(private opts: AmbientOpts) {
    this.build();
  }

  private petTex(breed: string, anim: string): string {
    return `pet-${breed}-${anim}`;
  }

  private build(): void {
    const { scene, tw, th, mapW, mapH, isWalkable, classify, avoid, npcDefs, breeds, seed } = this.opts;
    const rand = mulberry32(seed);
    const px = (tx: number) => tx * tw + tw / 2;
    const py = (ty: number) => ty * th + th / 2;

    // ── one pass over the tiles to bucket candidate spots ──
    const open: Spot[] = [];
    const waterside: (Spot & { face: Dir })[] = [];
    const indoor: Spot[] = [];
    const clearOf = (tx: number, ty: number, tiles: number): boolean =>
      avoid.every((a) => Math.hypot(px(tx) - a.x, py(ty) - a.y) > tiles * tw);

    for (let ty = 1; ty < mapH - 1; ty++) {
      for (let tx = 1; tx < mapW - 1; tx++) {
        if (!isWalkable(tx, ty)) continue;
        if (!clearOf(tx, ty, 3)) continue;

        // water's edge: walkable tile with water in a cardinal neighbour.
        const wDir = this.waterDir(tx, ty, classify);
        if (wDir) { waterside.push({ tx, ty, face: wDir }); continue; }

        // among buildings: several blocked (building) cells in a 5×5 window and a
        // clear cardinal neighbour to face — reads as "inside / by the office".
        let blocked = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if ((dx || dy) && !isWalkable(tx + dx, ty + dy) && classify(tx + dx, ty + dy) === 3) blocked++;
        if (blocked >= 6) { indoor.push({ tx, ty }); continue; }

        // open ground: all four neighbours walkable, plain ground.
        if (
          classify(tx, ty) === 0 &&
          isWalkable(tx - 1, ty) && isWalkable(tx + 1, ty) &&
          isWalkable(tx, ty - 1) && isWalkable(tx, ty + 1)
        ) open.push({ tx, ty });
      }
    }

    // Pick well-spaced spots from a bucket (min gap in tiles), seeded shuffle.
    const shuffle = <T,>(arr: T[]): T[] => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    const pickSpread = (bucket: Spot[], count: number, gap: number): Spot[] => {
      const chosen: Spot[] = [];
      for (const s of shuffle(bucket)) {
        if (chosen.length >= count) break;
        if (chosen.every((c) => Math.hypot(c.tx - s.tx, c.ty - s.ty) >= gap)) chosen.push(s);
      }
      return chosen;
    };

    const pickNpc = (): AvatarDef => npcDefs[Math.floor(rand() * npcDefs.length)]!;
    const pickBreed = (): string => breeds[Math.floor(rand() * breeds.length)]!;

    // ── pacing NPCs on open ground ──
    for (const s of pickSpread(open, 5, 5)) {
      const horiz = rand() < 0.5;
      const span = (2 + Math.floor(rand() * 2)) * tw; // 2–3 tiles each way
      this.pacer(pickNpc(), px(s.tx), py(s.ty), horiz, span);
    }

    // ── NPCs watching the water (some with a dog resting beside them) ──
    const waterSpots = pickSpread(waterside as Spot[], 3, 5) as (Spot & { face: Dir })[];
    waterSpots.forEach((s, i) => {
      this.idleNpc(pickNpc(), px(s.tx), py(s.ty), s.face);
      if (i === 0) this.restingPet(pickBreed(), px(s.tx) + tw, py(s.ty), rand); // a buddy by the lake
    });

    // ── NPCs among the buildings ("in the office") ──
    const officeSpots = pickSpread(indoor, 3, 4);
    officeSpots.forEach((s, i) => {
      this.idleNpc(pickNpc(), px(s.tx), py(s.ty), "down");
      if (i === 0) this.restingPet(pickBreed(), px(s.tx) - tw, py(s.ty), rand);
    });

    // ── a few stray dogs on open ground (rest of the pack: pace or rest) ──
    for (const s of pickSpread(open, 4, 6)) {
      if (rand() < 0.5) this.pacingPet(pickBreed(), px(s.tx), py(s.ty), rand);
      else this.restingPet(pickBreed(), px(s.tx), py(s.ty), rand);
    }
  }

  private waterDir(tx: number, ty: number, classify: (x: number, y: number) => 0 | 1 | 2 | 3): Dir | null {
    if (classify(tx, ty - 1) === 1) return "up";
    if (classify(tx, ty + 1) === 1) return "down";
    if (classify(tx - 1, ty) === 1) return "left";
    if (classify(tx + 1, ty) === 1) return "right";
    return null;
  }

  private depthFor(y: number): number {
    // Under the player (500), above the floor layers; a little y-sorting so nearer
    // characters sit in front of farther ones.
    return 400 + Math.min(80, (y / (this.opts.mapH * this.opts.th)) * 80);
  }

  private idleNpc(def: AvatarDef, x: number, y: number, face: Dir): void {
    const { scene } = this.opts;
    buildAvatarAnims(scene, def);
    const spr = scene.add.sprite(x, y, def.texKey, 1);
    const a = avatarAnim(def, face, false);
    spr.play(a.key);
    spr.setFlipX(a.flipX);
    spr.setDepth(this.depthFor(y));
    this.objs.push(spr);
  }

  private pacer(def: AvatarDef, x: number, y: number, horiz: boolean, span: number): void {
    const { scene } = this.opts;
    buildAvatarAnims(scene, def);
    const spr = scene.add.sprite(x, y, def.texKey, 1);
    spr.setDepth(this.depthFor(y));
    this.objs.push(spr);
    const dir: Dir = horiz ? "right" : "down";
    const setFace = (d: Dir): void => {
      const a = avatarAnim(def, d, true);
      spr.play(a.key, true);
      spr.setFlipX(a.flipX);
    };
    setFace(dir);
    const to = horiz ? { x: x + span } : { y: y + span };
    scene.tweens.add({
      targets: spr, ...to, duration: (span / 40) * 1000, yoyo: true, repeat: -1,
      ease: "Linear",
      onYoyo: () => setFace(horiz ? "left" : "up"),
      onRepeat: () => setFace(horiz ? "right" : "down"),
    });
  }

  // A dog at rest — sits, sleeps or lies down; clicking it plays a reaction.
  private restingPet(breed: string, x: number, y: number, rand: () => number): void {
    const { scene } = this.opts;
    buildPetAnims(scene, breed);
    const pose = ["sitting", "sleeping", "lying-down"][Math.floor(rand() * 3)]!;
    const spr = scene.add.sprite(x, y, this.petTex(breed, pose), 0);
    spr.setOrigin(0.5, 0.72).setScale(0.34).setDepth(this.depthFor(y));
    spr.play(this.petTex(breed, pose));
    spr.setFlipX(rand() < 0.5);
    this.makePettable(spr, breed, () => this.petTex(breed, pose));
    this.objs.push(spr);
  }

  // A dog trotting back and forth on open ground.
  private pacingPet(breed: string, x: number, y: number, rand: () => number): void {
    const { scene, tw } = this.opts;
    buildPetAnims(scene, breed);
    const span = (2 + Math.floor(rand() * 2)) * tw;
    const spr = scene.add.sprite(x, y, this.petTex(breed, "walk"), 0);
    spr.setOrigin(0.5, 0.72).setScale(0.34).setDepth(this.depthFor(y));
    spr.play(this.petTex(breed, "walk"));
    this.makePettable(spr, breed, () => this.petTex(breed, "walk"));
    this.objs.push(spr);
    scene.tweens.add({
      targets: spr, x: x + span, duration: (span / 55) * 1000, yoyo: true, repeat: -1, ease: "Linear",
      onYoyo: () => spr.setFlipX(true),
      onRepeat: () => spr.setFlipX(false),
    });
  }

  // Click / tap a stray dog to make it react once, then return to its pose.
  private makePettable(spr: Phaser.GameObjects.Sprite, breed: string, restKey: () => string): void {
    let busy = false;
    spr.setInteractive({ useHandCursor: true });
    spr.on("pointerdown", () => {
      if (busy) return;
      busy = true;
      const anim = PET_REACTIONS[Math.floor(Math.random() * PET_REACTIONS.length)]!;
      spr.play(this.petTex(breed, anim));
      spr.once("animationcomplete", () => { busy = false; spr.play(restKey()); });
    });
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }
}
