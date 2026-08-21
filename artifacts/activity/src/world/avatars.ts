// ─────────────────────────────────────────────────────────────────────────────
// Avatars — the player-selectable characters. Two sheet layouts are supported:
//
//   "duelist"  the built-in generated sheet: 3 cols × 4 rows (down/left/right/up),
//              middle column = idle.
//   "npc3"     the NPC Character pack sheets: 8 cols × 12 rows, 4 characters per
//              sheet, each character = 3 rows [down, side, up]; cols 0–3 idle,
//              4–7 walk. Left/right reuse the "side" row (right is mirrored).
//
// A tiny descriptor per avatar lets one code path load the sheet, build walk/idle
// animations, and pick the right anim + flip for a facing.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";

export type Dir = "down" | "left" | "right" | "up";

export interface AvatarDef {
  id: string;
  name: string;
  gender: "male" | "female" | "neutral";
  /** Phaser texture key (shared across avatars from the same file). */
  texKey: string;
  /** Asset URL relative to the Vite base. */
  url: string;
  fw: number;
  fh: number;
  layout: "duelist" | "npc3" | "jack";
  /** Which character within an npc3 sheet (0–3). Ignored for "duelist". */
  charIndex: number;
}

// Jack — the Harvest Moon farmer, used as the player only inside the HM world.
// Sheet is 2×4 frames of 80×120: down [0,1], up [2,3], left [4,5], right [6,7].
// Kept out of the character picker (avatarById resolves it by id).
export const JACK: AvatarDef = {
  id: "jack", name: "Jack", gender: "male",
  texKey: "jack", url: "world/hm/chars/jack-walking.png",
  fw: 80, fh: 120, layout: "jack", charIndex: 0,
};

const NPC_FILES: { file: string; gender: "male" | "female" }[] = [
  { file: "Female1", gender: "female" },
  { file: "Female2", gender: "female" },
  { file: "Male1", gender: "male" },
  { file: "Male2", gender: "male" },
  { file: "Male3", gender: "male" },
  { file: "Male4", gender: "male" },
];

function buildList(): AvatarDef[] {
  const list: AvatarDef[] = [
    {
      id: "duelist", name: "Duelist", gender: "neutral",
      texKey: "duelist", url: "world/characters/duelist.png",
      fw: 32, fh: 48, layout: "duelist", charIndex: 0,
    },
  ];
  // Running per-gender counter so every NPC gets a unique, on-theme label
  // ("Ms. Duelist 3", "Mr. Duelist 7") instead of colliding "Ms. Female 1" x2.
  let fem = 0, masc = 0;
  for (const { file, gender } of NPC_FILES) {
    for (let ci = 0; ci < 4; ci++) {
      const n = gender === "female" ? ++fem : ++masc;
      list.push({
        id: `${file.toLowerCase()}-${ci}`,
        name: `${gender === "female" ? "Ms." : "Mr."} Duelist ${n}`,
        gender,
        texKey: `npc-${file}`,
        url: `world/characters/npc/${file}.png`,
        fw: 32, fh: 48, layout: "npc3", charIndex: ci,
      });
    }
  }
  return list;
}

export const AVATARS: AvatarDef[] = buildList();

export function avatarById(id: string): AvatarDef {
  if (id === "jack") return JACK;
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0]!;
}

// ── frame math ───────────────────────────────────────────────────────────────
// duelist: cols=3 → down 0-2, left 3-5, right 6-8, up 9-11 (idle = middle).
// npc3:    cols=8 → row = charIndex*3 + {down:0, side:1, up:2}; idle col 0, walk 4-7.

interface DirFrames { idle: number; walk: number[]; }

function duelistFrames(dir: Exclude<Dir, never>): DirFrames {
  const base = { down: 0, left: 3, right: 6, up: 9 }[dir];
  return { idle: base + 1, walk: [base, base + 1, base + 2] };
}

function npc3Frames(charIndex: number, row: "down" | "side" | "up"): DirFrames {
  const r = charIndex * 3 + { down: 0, side: 1, up: 2 }[row];
  const b = r * 8;
  return { idle: b, walk: [b + 4, b + 5, b + 6, b + 7] };
}

/** Create walk + idle animations for an avatar (idempotent by anim key). */
export function buildAvatarAnims(scene: Phaser.Scene, def: AvatarDef): void {
  const mk = (suffix: string, frames: number[], repeat: number, rate: number) => {
    const key = `${def.id}__${suffix}`;
    if (scene.anims.exists(key)) return;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(def.texKey, { frames }),
      frameRate: rate,
      repeat,
    });
  };
  if (def.layout === "jack") {
    const dirs = { down: [0, 1], up: [2, 3], left: [4, 5], right: [6, 7] } as const;
    for (const dir of ["down", "up", "left", "right"] as const) {
      const f = dirs[dir];
      mk(`walk-${dir}`, [...f], -1, 6);
      mk(`idle-${dir}`, [f[0]], -1, 1);
    }
  } else if (def.layout === "duelist") {
    for (const dir of ["down", "left", "right", "up"] as const) {
      const f = duelistFrames(dir);
      mk(`walk-${dir}`, f.walk, -1, 8);
      mk(`idle-${dir}`, [f.idle], -1, 1);
    }
  } else {
    for (const row of ["down", "side", "up"] as const) {
      const f = npc3Frames(def.charIndex, row);
      mk(`walk-${row}`, f.walk, -1, 8);
      mk(`idle-${row}`, [f.idle], -1, 1);
    }
  }
}

/** The anim key + horizontal flip to show for a facing / motion state. */
export function avatarAnim(def: AvatarDef, facing: Dir, moving: boolean): { key: string; flipX: boolean } {
  const verb = moving ? "walk" : "idle";
  if (def.layout === "duelist" || def.layout === "jack") {
    // jack has distinct left/right frames — no mirroring needed.
    return { key: `${def.id}__${verb}-${facing}`, flipX: false };
  }
  // npc3: left/right share the "side" row; mirror for right.
  if (facing === "left" || facing === "right") {
    return { key: `${def.id}__${verb}-side`, flipX: facing === "right" };
  }
  return { key: `${def.id}__${verb}-${facing}`, flipX: false };
}
