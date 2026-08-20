// ─────────────────────────────────────────────────────────────────────────────
// Pets — the optional dog companion that follows the player around the world.
//
// The Pet Dogs Pack ships one 100×100 horizontal strip per animation per breed
// (idle, walk, run, bark, …). Each strip becomes its own texture + anim keyed
// `pet-<breed>-<anim>`. The Pet entity trails the player (walk / run / idle) and,
// when you interact with it, plays a random reaction once ("shuffle repeat"), then
// settles back to idle. Dogs face RIGHT in the art, so we mirror when heading left.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";

export interface PetBreed {
  id: string;
  name: string;
}

export const PETS: PetBreed[] = [
  { id: "golden-retriever", name: "Golden Retriever" },
  { id: "akita", name: "Akita" },
  { id: "great-dane", name: "Great Dane" },
  { id: "schnauzer", name: "Schnauzer" },
  { id: "saint-bernard", name: "Saint Bernard" },
  { id: "siberian-husky", name: "Siberian Husky" },
];

export function petById(id: string | null): PetBreed | null {
  if (!id) return null;
  return PETS.find((p) => p.id === id) ?? null;
}

const PET_FW = 100, PET_FH = 100;

// Every animation in the pack + its frame count (uniform across breeds).
const ANIMS: Record<string, number> = {
  idle: 10, walk: 8, run: 8, bark: 3, itching: 2,
  licking1: 4, licking2: 4, "lying-down": 7, stretching: 10, sitting: 1, sleeping: 1,
};

const LOOPS = new Set(["idle", "walk", "run"]);

// Reactions the pet shuffles through when you play with it (multi-frame only, so
// each one actually animates). Single-frame poses (sitting/sleeping) are skipped.
export const PET_REACTIONS = ["bark", "itching", "licking1", "licking2", "lying-down", "stretching"];

function petTex(breed: string, anim: string): string {
  return `pet-${breed}-${anim}`;
}

function assetUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}${rel}`;
}

/** Path to a breed's idle strip — used by the picker for a still preview. */
export function petPreviewUrl(breed: string): string {
  return assetUrl(`world/pets/${breed}/idle.png`);
}

/** Queue every animation strip for a breed onto the scene loader. */
export function loadPetTextures(scene: Phaser.Scene, breed: string): void {
  for (const anim of Object.keys(ANIMS)) {
    const key = petTex(breed, anim);
    if (!scene.textures.exists(key)) {
      scene.load.spritesheet(key, assetUrl(`world/pets/${breed}/${anim}.png`), {
        frameWidth: PET_FW, frameHeight: PET_FH,
      });
    }
  }
}

/** Build walk/idle/run + reaction animations for a breed (idempotent). */
export function buildPetAnims(scene: Phaser.Scene, breed: string): void {
  for (const [anim, count] of Object.entries(ANIMS)) {
    const key = petTex(breed, anim);
    if (scene.anims.exists(key) || !scene.textures.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key, { start: 0, end: count - 1 }),
      frameRate: anim === "bark" ? 9 : 8,
      repeat: LOOPS.has(anim) ? -1 : 0,
    });
  }
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// A companion dog that follows a moving target and reacts when played with.
export class Pet {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly name: string;
  private reacting = false;
  private bag: string[] = [];
  private facingLeft = false;

  constructor(
    scene: Phaser.Scene,
    readonly breed: string,
    x: number, y: number,
    private getTarget: () => { x: number; y: number },
  ) {
    this.name = petById(breed)?.name ?? "Pet";
    buildPetAnims(scene, breed);
    this.sprite = scene.physics.add.sprite(x, y, petTex(breed, "idle"), 0);
    this.sprite.setOrigin(0.5, 0.72); // art sits low in the 100px frame; anchor near the paws
    this.sprite.setScale(0.6); // the dog fills ~half the 100px frame, so ~0.6 reads dog-sized next to the player
    this.sprite.setDepth(499); // just beneath the player (500)
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    this.play("idle");
    this.sprite.setInteractive({ useHandCursor: true });
    this.sprite.on("pointerdown", () => this.react());
  }

  private play(anim: string): void {
    const key = petTex(this.breed, anim);
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
  }

  private setFacingLeft(left: boolean): void {
    if (left === this.facingLeft) return;
    this.facingLeft = left;
    this.sprite.setFlipX(left);
  }

  update(): void {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (this.reacting) { body.setVelocity(0, 0); return; }
    const t = this.getTarget();
    const dx = t.x - this.sprite.x, dy = t.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 30) {
      const far = dist > 130;
      const spd = far ? 200 : 150;
      body.setVelocity((dx / dist) * spd, (dy / dist) * spd);
      this.play(far ? "run" : "walk");
      if (Math.abs(dx) > 1) this.setFacingLeft(dx < 0);
    } else {
      body.setVelocity(0, 0);
      this.play("idle");
    }
  }

  /** Play a random reaction once, then return to following. */
  react(): void {
    if (this.reacting) return;
    this.reacting = true;
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    if (this.bag.length === 0) this.bag = shuffle([...PET_REACTIONS]);
    const anim = this.bag.pop()!;
    this.sprite.play(petTex(this.breed, anim));
    this.sprite.once("animationcomplete", () => {
      this.reacting = false;
      this.play("idle");
    });
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
