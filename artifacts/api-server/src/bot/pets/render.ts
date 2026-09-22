// Tamagotchi-style GIF renderer — Onocentaur egg sprites + cute chibi pets
// inside a big, readable LCD device frame. Inspired by classic Connection
// care UX (meters, attention, hatch ritual) — original art + free egg pack.

import { encodeAnimation, type Ctx } from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import type { Pet } from "@workspace/db";
import { SPECIES_META, moodOf, isDirty, isHungry, type PetSpecies } from "./engine.js";
import {
  loadEggSheet, loadPetBackground, blitEggTile, eggFrameAt, eggCol, eggRowFor,
} from "./sprites.js";

/** Bigger canvas so Discord mobile users can actually see the pet. */
export const PET_CANVAS = { width: 480, height: 400 } as const;

type Mood = ReturnType<typeof moodOf>;

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  (ctx as unknown as { ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void })
    .ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function palette(pet: Pet) {
  const sp = (pet.species as PetSpecies) in SPECIES_META ? (pet.species as PetSpecies) : "cat";
  const hues = SPECIES_META[sp].hues;
  const [body, accent] = hues[pet.variant % hues.length]!;
  return { body, accent, species: sp };
}

/** Soft pastel device shell + LCD window (original — not Bandai art).
 * Flat fills only — GIF quantization destroys gradients/alpha. */
function drawDevice(ctx: Ctx, w: number, h: number, t: number) {
  // Outer atmosphere (flat, GIF-safe)
  ctx.fillStyle = "#1a2740";
  ctx.fillRect(0, 0, w, h);

  // Sparse constellation dots (opaque)
  ctx.fillStyle = "#3a5070";
  for (let i = 0; i < 18; i++) {
    const dx = Math.floor((i * 73 + t * 20) % w);
    const dy = Math.floor((i * 41) % h);
    ctx.fillRect(dx, dy, 2, 2);
  }

  // Device body
  const pad = 28;
  ctx.fillStyle = "#d8e0ec";
  roundRect(ctx, pad, pad - 4, w - pad * 2, h - pad * 2 + 18, 36);
  ctx.fill();
  ctx.fillStyle = "#b8c4d4";
  roundRect(ctx, pad + 6, pad + 2, w - pad * 2 - 12, h - pad * 2 + 6, 30);
  ctx.fill();

  // LCD bezel
  const lx = 58, ly = 56, lw = w - 116, lh = h - 150;
  ctx.fillStyle = "#2a3344";
  roundRect(ctx, lx - 8, ly - 8, lw + 16, lh + 16, 14);
  ctx.fill();
  // Yellow classic bezel ring
  ctx.fillStyle = "#e8b830";
  roundRect(ctx, lx - 4, ly - 4, lw + 8, lh + 8, 10);
  ctx.fill();
  // Screen — warm cream, no checker (avoids GIF banding triangles)
  ctx.fillStyle = "#fff8e7";
  roundRect(ctx, lx, ly, lw, lh, 6);
  ctx.fill();

  // Three classic buttons under screen
  const by = h - 58;
  for (const bx of [w / 2 - 54, w / 2, w / 2 + 54]) {
    ctx.fillStyle = "#e8b830";
    ellipse(ctx, bx, by, 14, 10);
    ctx.fill();
    ctx.fillStyle = "#c49218";
    ellipse(ctx, bx, by + 2, 10, 6);
    ctx.fill();
  }

  return { lx, ly, lw, lh };
}

/** Clip subsequent draws to the LCD screen. */
function clipScreen(ctx: Ctx, lx: number, ly: number, lw: number, lh: number) {
  ctx.save();
  roundRect(ctx, lx, ly, lw, lh, 6);
  ctx.clip();
}

function drawHearts(ctx: Ctx, x: number, y: number, value: number, label: string, color: string) {
  const filled = Math.round(value / 25); // 0–4 hearts
  ctx.fillStyle = "#3a4558";
  ctx.font = "bold 11px Early GameBoy, monospace";
  ctx.fillText(label, x, y - 2);
  for (let i = 0; i < 4; i++) {
    const hx = x + i * 18;
    // Block hearts — no bezier (GIF-safe)
    ctx.fillStyle = i < filled ? color : "#d4cbb8";
    ctx.fillRect(hx + 2, y + 2, 4, 4);
    ctx.fillRect(hx + 8, y + 2, 4, 4);
    ctx.fillRect(hx + 1, y + 5, 12, 5);
    ctx.beginPath();
    ctx.moveTo(hx + 1, y + 10);
    ctx.lineTo(hx + 7, y + 15);
    ctx.lineTo(hx + 13, y + 10);
    ctx.closePath();
    ctx.fill();
  }
}

function drawIconRow(ctx: Ctx, lx: number, ly: number, lw: number, pet: Pet) {
  // Classic top care icons (text glyphs — emoji often render poorly in canvas GIFs)
  const icons = [
    { label: "Fd", warn: isHungry(pet) },
    { label: "Lt", warn: false },
    { label: "Pl", warn: pet.happiness < 35 },
    { label: "Md", warn: pet.health < 40 },
  ];
  const gap = lw / (icons.length + 1);
  icons.forEach((ic, i) => {
    const x = lx + gap * (i + 1);
    if (ic.warn) {
      ctx.fillStyle = "#ffcccc";
      roundRect(ctx, x - 14, ly + 6, 28, 18, 4);
      ctx.fill();
    }
    ctx.fillStyle = ic.warn ? "#b91c1c" : "#5a6578";
    ctx.font = "bold 11px Early GameBoy, monospace";
    ctx.textAlign = "center";
    ctx.fillText(ic.label, x, ly + 19);
  });
  ctx.textAlign = "left";

  // Attention bang
  if (isHungry(pet) || isDirty(pet) || pet.happiness < 30 || pet.health < 40) {
    const blink = Math.floor(Date.now() / 400) % 2 === 0;
    if (blink) {
      ctx.fillStyle = "#e11d48";
      ctx.font = "bold 16px Early GameBoy, monospace";
      ctx.fillText("!", lx + lw - 22, ly + 22);
    }
  }
}

function drawMess(ctx: Ctx, cx: number, feetY: number, t: number) {
  ctx.fillStyle = "#6b4f2a";
  for (let i = 0; i < 3; i++) {
    const ox = -36 + i * 18 + Math.sin(t * 3 + i) * 2;
    ellipse(ctx, cx + ox, feetY - 4, 8, 5);
    ctx.fill();
    ctx.fillStyle = "#8a6840";
    ellipse(ctx, cx + ox - 2, feetY - 7, 3, 2);
    ctx.fill();
    ctx.fillStyle = "#6b4f2a";
  }
}

/** Cute chibi creature — big head, simple face, readable at Discord scale. */
function drawChibi(ctx: Ctx, pet: Pet, cx: number, feetY: number, t: number, scale = 1) {
  const mood = moodOf(pet);
  const p = palette(pet);
  const stageScale =
    pet.stage === "hatchling" ? 0.7
    : pet.stage === "juvenile" ? 0.88
    : pet.stage === "egg" ? 0.55
    : 1;
  const s = scale * stageScale;
  const bounce = mood === "dead" ? 0
    : mood === "ecstatic" ? Math.abs(Math.sin(t * Math.PI * 5)) * 10
    : mood === "happy" ? Math.abs(Math.sin(t * Math.PI * 3)) * 6
    : Math.abs(Math.sin(t * Math.PI * 2)) * 3;
  const blink = !pet.isDead && Math.floor(t * 10) % 15 === 0;

  ctx.save();
  ctx.translate(cx, feetY - bounce);

  // Shadow (flat oval, no alpha)
  ctx.fillStyle = "#c9b896";
  ellipse(ctx, 0, 0, 34 * s, 10 * s);
  ctx.fill();

  if (isDirty(pet) && !pet.isDead) drawMess(ctx, 0, 0, t);

  const bodyY = -28 * s;
  const headY = -62 * s;

  // Species silhouette
  switch (p.species) {
    case "dragon":
      drawChibiDragon(ctx, p, mood, blink, t, s, bodyY, headY);
      break;
    case "cat":
      drawChibiCat(ctx, p, mood, blink, t, s, bodyY, headY);
      break;
    case "dog":
      drawChibiDog(ctx, p, mood, blink, t, s, bodyY, headY);
      break;
    default:
      drawChibiHamster(ctx, p, mood, blink, t, s, bodyY, headY);
  }

  // Cosmetics
  if (pet.activeCosmetic === "hat") {
    ctx.fillStyle = "#1f2937";
    roundRect(ctx, -16 * s, headY - 28 * s, 32 * s, 8 * s, 2);
    ctx.fill();
    roundRect(ctx, -10 * s, headY - 44 * s, 20 * s, 18 * s, 3);
    ctx.fill();
  } else if (pet.activeCosmetic === "ribbon") {
    ctx.fillStyle = "#ec4899";
    ctx.beginPath();
    ctx.moveTo(-20 * s, headY - 8 * s);
    ctx.lineTo(-4 * s, headY);
    ctx.lineTo(-20 * s, headY + 8 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20 * s, headY - 8 * s);
    ctx.lineTo(4 * s, headY);
    ctx.lineTo(20 * s, headY + 8 * s);
    ctx.fill();
  } else if (pet.activeCosmetic === "armor") {
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 3 * s;
    ellipse(ctx, 0, bodyY, 28 * s, 22 * s);
    ctx.stroke();
  }

  if (pet.isDead) {
    ctx.fillStyle = "#8a7a6a";
    ellipse(ctx, 0, headY + 10 * s, 40 * s, 50 * s);
    ctx.fill();
    ctx.fillStyle = "#e8f0ff";
    ellipse(ctx, 18 * s, headY - 50 * s - t * 30, 8 * s, 12 * s);
    ctx.fill();
  }

  ctx.restore();
}

function face(ctx: Ctx, hx: number, hy: number, s: number, mood: Mood, blink: boolean, eyeGap = 14) {
  const drawEye = (ex: number) => {
    if (mood === "dead") {
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(ex - 4 * s, hy - 4 * s); ctx.lineTo(ex + 4 * s, hy + 4 * s);
      ctx.moveTo(ex + 4 * s, hy - 4 * s); ctx.lineTo(ex - 4 * s, hy + 4 * s);
      ctx.stroke();
      return;
    }
    if (blink) {
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(ex - 5 * s, hy);
      ctx.lineTo(ex + 5 * s, hy);
      ctx.stroke();
      return;
    }
    ellipse(ctx, ex, hy, 5.5 * s, 6.5 * s);
    ctx.fillStyle = "#fffef8";
    ctx.fill();
    const py = mood === "sad" || mood === "critical" ? 1.5 * s : 0;
    ellipse(ctx, ex + 1 * s, hy + py, 2.8 * s, 3.2 * s);
    ctx.fillStyle = "#1a1a22";
    ctx.fill();
    ellipse(ctx, ex + 2.2 * s, hy - 1.5 * s, 1.2 * s, 1.2 * s);
    ctx.fillStyle = "#fff";
    ctx.fill();
  };
  drawEye(hx - eyeGap * s / 2);
  drawEye(hx + eyeGap * s / 2);

  // Blush
  if (mood === "happy" || mood === "ecstatic") {
    ctx.fillStyle = "#f9a8d4";
    ellipse(ctx, hx - 18 * s, hy + 8 * s, 5 * s, 3 * s);
    ctx.fill();
    ellipse(ctx, hx + 18 * s, hy + 8 * s, 5 * s, 3 * s);
    ctx.fill();
  }

  // Mouth
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 2 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (mood === "ecstatic") {
    ellipse(ctx, hx, hy + 12 * s, 5 * s, 4 * s);
    ctx.fillStyle = "#1a1a22";
    ctx.fill();
  } else if (mood === "happy") {
    ctx.arc(hx, hy + 8 * s, 6 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else if (mood === "sad" || mood === "critical") {
    ctx.arc(hx, hy + 16 * s, 6 * s, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
  } else if (mood === "dead") {
    /* x eyes already */
  } else {
    ctx.moveTo(hx - 3 * s, hy + 11 * s);
    ctx.lineTo(hx + 3 * s, hy + 11 * s);
    ctx.stroke();
  }
}

function drawChibiDragon(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number, s: number, bodyY: number, headY: number) {
  // Bat wings — solid triangles (GIF-safe, readable at Discord scale)
  const flap = Math.sin(t * Math.PI * 4) * 5 * s;
  ctx.fillStyle = p.accent;
  // Left wing
  ctx.beginPath();
  ctx.moveTo(-8 * s, bodyY - 4 * s);
  ctx.lineTo(-44 * s, bodyY - 26 * s - flap);
  ctx.lineTo(-38 * s, bodyY + 8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  // Right wing
  ctx.beginPath();
  ctx.moveTo(8 * s, bodyY - 4 * s);
  ctx.lineTo(44 * s, bodyY - 26 * s - flap);
  ctx.lineTo(38 * s, bodyY + 8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Body
  ellipse(ctx, 0, bodyY, 26 * s, 22 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 2.5 * s;
  ctx.stroke();
  ellipse(ctx, 0, bodyY + 4 * s, 14 * s, 11 * s);
  ctx.fillStyle = p.accent;
  ctx.fill();

  // Head (BIG)
  ellipse(ctx, 0, headY, 26 * s, 24 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.stroke();

  // Horns
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.moveTo(-10 * s, headY - 16 * s); ctx.lineTo(-14 * s, headY - 34 * s); ctx.lineTo(-2 * s, headY - 18 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10 * s, headY - 16 * s); ctx.lineTo(14 * s, headY - 34 * s); ctx.lineTo(2 * s, headY - 18 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  face(ctx, 0, headY, s, mood, blink);

  if (mood === "happy" || mood === "ecstatic") {
    ctx.fillStyle = "#ff8c28";
    ellipse(ctx, 0, headY + 26 * s + Math.sin(t * 12) * 2, 5 * s, 7 * s);
    ctx.fill();
  }

  ctx.fillStyle = p.body;
  roundRect(ctx, -16 * s, -8 * s, 11 * s, 10 * s, 3 * s);
  ctx.fill();
  roundRect(ctx, 5 * s, -8 * s, 11 * s, 10 * s, 3 * s);
  ctx.fill();
}

function drawChibiCat(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number, s: number, bodyY: number, headY: number) {
  // Tail
  ctx.strokeStyle = p.body;
  ctx.lineWidth = 7 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-24 * s, bodyY);
  ctx.quadraticCurveTo(-40 * s, bodyY - 30 * s - Math.sin(t * 4) * 8 * s, -22 * s, bodyY - 48 * s);
  ctx.stroke();

  ellipse(ctx, 0, bodyY, 28 * s, 22 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 2 * s;
  ctx.stroke();

  ellipse(ctx, 0, headY, 26 * s, 24 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.stroke();

  // Ears
  ctx.fillStyle = p.body;
  ctx.beginPath();
  ctx.moveTo(-16 * s, headY - 14 * s); ctx.lineTo(-22 * s, headY - 40 * s); ctx.lineTo(-4 * s, headY - 18 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(16 * s, headY - 14 * s); ctx.lineTo(22 * s, headY - 40 * s); ctx.lineTo(4 * s, headY - 18 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f9a8d4";
  ctx.beginPath();
  ctx.moveTo(-14 * s, headY - 16 * s); ctx.lineTo(-18 * s, headY - 32 * s); ctx.lineTo(-8 * s, headY - 18 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14 * s, headY - 16 * s); ctx.lineTo(18 * s, headY - 32 * s); ctx.lineTo(8 * s, headY - 18 * s);
  ctx.closePath();
  ctx.fill();

  face(ctx, 0, headY + 2 * s, s, mood, blink);
  // Nose
  ellipse(ctx, 0, headY + 8 * s, 2.5 * s, 2 * s);
  ctx.fillStyle = "#f472b6";
  ctx.fill();

  // Whiskers
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 1.5 * s;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 8 * s, headY + 10 * s);
    ctx.lineTo(side * 28 * s, headY + 6 * s);
    ctx.moveTo(side * 8 * s, headY + 14 * s);
    ctx.lineTo(side * 28 * s, headY + 16 * s);
    ctx.stroke();
  }

  ctx.fillStyle = p.body;
  roundRect(ctx, -16 * s, -8 * s, 10 * s, 10 * s, 3 * s);
  ctx.fill();
  roundRect(ctx, 6 * s, -8 * s, 10 * s, 10 * s, 3 * s);
  ctx.fill();
}

function drawChibiDog(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number, s: number, bodyY: number, headY: number) {
  // Wag
  const wag = Math.sin(t * Math.PI * 7) * 14 * s;
  ctx.strokeStyle = p.body;
  ctx.lineWidth = 8 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-22 * s, bodyY);
  ctx.quadraticCurveTo(-30 * s + wag * 0.3, bodyY - 28 * s, -18 * s + wag * 0.5, bodyY - 42 * s);
  ctx.stroke();

  // Body
  ellipse(ctx, 0, bodyY, 30 * s, 22 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 2 * s;
  ctx.stroke();

  // Head
  ellipse(ctx, 0, headY, 24 * s, 22 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.stroke();

  // Floppy ears
  ctx.fillStyle = p.accent;
  ellipse(ctx, -22 * s, headY + 6 * s, 9 * s, 16 * s);
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.stroke();
  ellipse(ctx, 22 * s, headY + 6 * s, 9 * s, 16 * s);
  ctx.fill();
  ctx.stroke();

  // Muzzle
  ellipse(ctx, 0, headY + 12 * s, 11 * s, 8 * s);
  ctx.fillStyle = "#fff8e7";
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.stroke();
  ellipse(ctx, 0, headY + 8 * s, 3.5 * s, 2.5 * s);
  ctx.fillStyle = "#1a1a22";
  ctx.fill();

  face(ctx, 0, headY - 2 * s, s, mood, blink, 16);

  if (mood === "happy" || mood === "ecstatic") {
    ctx.fillStyle = "#f87171";
    ellipse(ctx, 5 * s, headY + 20 * s + Math.abs(Math.sin(t * 10)) * 2 * s, 4 * s, 5 * s);
    ctx.fill();
  }

  ctx.fillStyle = p.body;
  roundRect(ctx, -16 * s, -8 * s, 10 * s, 10 * s, 3 * s);
  ctx.fill();
  roundRect(ctx, 6 * s, -8 * s, 10 * s, 10 * s, 3 * s);
  ctx.fill();
}

function drawChibiHamster(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number, s: number, bodyY: number, headY: number) {
  // Round body+head almost merged (classic blob pet)
  ellipse(ctx, 0, bodyY - 8 * s, 34 * s, 32 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth = 2 * s;
  ctx.stroke();

  ellipse(ctx, 0, bodyY, 18 * s, 14 * s);
  ctx.fillStyle = p.accent;
  ctx.fill();

  // Ears
  ellipse(ctx, -20 * s, headY - 8 * s, 10 * s, 10 * s);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, 20 * s, headY - 8 * s, 10 * s, 10 * s);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f9a8d4";
  ellipse(ctx, -20 * s, headY - 8 * s, 5 * s, 5 * s);
  ctx.fill();
  ellipse(ctx, 20 * s, headY - 8 * s, 5 * s, 5 * s);
  ctx.fill();

  // Cheeks
  const cheek = mood === "ecstatic" ? 12 : 9;
  ctx.fillStyle = p.accent;
  ellipse(ctx, -22 * s, bodyY - 18 * s, cheek * s, (cheek - 2) * s);
  ctx.fill();
  ellipse(ctx, 22 * s, bodyY - 18 * s, cheek * s, (cheek - 2) * s);
  ctx.fill();

  face(ctx, 0, bodyY - 22 * s, s, mood, blink, 16);
  ellipse(ctx, 0, bodyY - 14 * s, 3 * s, 2.5 * s);
  ctx.fillStyle = "#e11d48";
  ctx.fill();

  const paw = Math.sin(t * 8) * 2 * s;
  ctx.fillStyle = p.body;
  roundRect(ctx, -14 * s, -6 * s + paw, 10 * s, 8 * s, 3 * s);
  ctx.fill();
  roundRect(ctx, 4 * s, -6 * s - paw, 10 * s, 8 * s, 3 * s);
  ctx.fill();
}

function drawHudInside(ctx: Ctx, pet: Pet, lx: number, ly: number, lw: number) {
  const sp = SPECIES_META[pet.species as PetSpecies];
  ctx.fillStyle = "#2a3344";
  ctx.font = "bold 13px Early GameBoy, monospace";
  const title = pet.isDead
    ? `${pet.name} — passed on`
    : pet.name;
  ctx.fillText(title, lx + 12, ly + 48);
  ctx.font = "10px Early GameBoy, monospace";
  ctx.fillStyle = "#5a6578";
  ctx.fillText(
    `${(sp?.label ?? pet.species).toUpperCase()}  ${pet.stage.toUpperCase()}  Lv${pet.level}  PWR ${pet.power}`,
    lx + 12,
    ly + 64,
  );

  drawHearts(ctx, lx + 12, ly + 82, pet.health, "HP", "#34d399");
  drawHearts(ctx, lx + 100, ly + 82, pet.hunger, "HUN", "#fbbf24");
  drawHearts(ctx, lx + 188, ly + 82, pet.cleanliness, "CLN", "#60a5fa");
  drawHearts(ctx, lx + 276, ly + 82, pet.happiness, "HAP", "#f472b6");
}

async function drawEggSprite(
  ctx: Ctx,
  pet: Pet,
  cx: number,
  cy: number,
  size: number,
  frame: ReturnType<typeof eggFrameAt>,
  /** Integer pixel nudge only — never rotate (GIF destroys rotated pixels). */
  shakeX = 0,
) {
  const sheet = await loadEggSheet();
  const row = eggRowFor(pet.species, pet.variant);
  const dx = Math.round(cx + shakeX);
  const dy = Math.round(cy);
  if (!sheet) {
    ellipse(ctx, dx, dy, size * 0.35, size * 0.45);
    ctx.fillStyle = "#f5efe6";
    ctx.fill();
    ctx.strokeStyle = "#1a1a22";
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  if (frame === "open") {
    // Top shell floats up; bottom sits as a nest
    blitEggTile(ctx, sheet, row, eggCol("top"), dx - size / 2, dy - size * 0.95, size);
    blitEggTile(ctx, sheet, row, eggCol("bottom"), dx - size / 2, dy - size * 0.1, size);
  } else {
    blitEggTile(ctx, sheet, row, eggCol(frame), dx - size / 2, dy - size / 2, size);
  }
}

/** Idle / care loop for the hub — big device frame. */
export async function renderPetGif(pet: Pet, opts?: { durationMs?: number }): Promise<AnimationResult | null> {
  const { width, height } = PET_CANVAS;
  const mood = moodOf(pet);
  const durationMs = opts?.durationMs ?? (mood === "dead" ? 2400 : 2000);
  await loadEggSheet();
  await loadPetBackground("pink");

  return encodeAnimation({
    width, height, speed: "normal", durationMs, maxFrames: 24, quality: 3, renderScale: 1,
    render: async (frame) => {
      const { ctx, t } = frame;
      const screen = drawDevice(ctx, width, height, t);
      clipScreen(ctx, screen.lx, screen.ly, screen.lw, screen.lh);
      drawIconRow(ctx, screen.lx, screen.ly, screen.lw, pet);
      drawHudInside(ctx, pet, screen.lx, screen.ly, screen.lw);

      const feetY = screen.ly + screen.lh - 36;
      const cx = screen.lx + screen.lw / 2;

      if (pet.stage === "egg" && !pet.isDead) {
        const shake = Math.round(Math.sin(t * Math.PI * 4) * 6);
        await drawEggSprite(ctx, pet, cx, feetY - 50, 110, "idle", shake);
        ctx.fillStyle = "#2a3344";
        ctx.font = "bold 12px Early GameBoy, monospace";
        ctx.textAlign = "center";
        ctx.fillText("Your egg is warming…", cx, feetY + 8);
        ctx.textAlign = "left";
      } else {
        drawChibi(ctx, pet, cx, feetY, t, 1.15);
      }
      ctx.restore();
    },
  });
}

/** Full hatch cinematic: wobble → Onocentaur crack frames → baby pops out. */
export async function renderHatchGif(pet: Pet): Promise<AnimationResult | null> {
  const { width, height } = PET_CANVAS;
  await loadEggSheet();

  return encodeAnimation({
    width, height, speed: "fast", durationMs: 3000, maxFrames: 36, quality: 3, renderScale: 1,
    render: async (frame) => {
      const { ctx, t } = frame;
      const screen = drawDevice(ctx, width, height, t);
      clipScreen(ctx, screen.lx, screen.ly, screen.lw, screen.lh);
      const cx = screen.lx + screen.lw / 2;
      const cy = screen.ly + screen.lh / 2 + 16;
      const sp = SPECIES_META[pet.species as PetSpecies];

      // Title card
      if (t < 0.1) {
        ctx.fillStyle = "#2a3344";
        ctx.font = "bold 18px Early GameBoy, monospace";
        ctx.textAlign = "center";
        ctx.fillText("A new life…", cx, cy - 12);
        ctx.font = "12px Early GameBoy, monospace";
        ctx.fillText("Something is moving inside!", cx, cy + 14);
        ctx.textAlign = "left";
        ctx.restore();
        return;
      }

      const hatchT = (t - 0.1) / 0.9;
      // Stay on crack frames until birth cut — never open during shake phase
      const eggFrame = eggFrameAt(Math.min(0.65, hatchT));
      // Pixel shake only (no rotation — GIF quantization destroys rotated sprites)
      const shake = eggFrame === "idle"
        ? Math.round(Math.sin(t * Math.PI * 6) * 5)
        : Math.round(Math.sin(t * 40) * 8);

      if (hatchT < 0.68) {
        await drawEggSprite(ctx, pet, cx, cy, 120, eggFrame, shake);
        // Opaque sparkles while cracking
        if (eggFrame !== "idle") {
          ctx.fillStyle = "#e8b830";
          for (let i = 0; i < 6; i++) {
            const ang = t * 8 + i * 1.1;
            const px = Math.round(cx + Math.cos(ang) * (48 + hatchT * 30));
            const py = Math.round(cy + Math.sin(ang * 1.3) * (36 + hatchT * 18));
            ctx.fillRect(px, py, 4, 4);
          }
        }
        ctx.fillStyle = "#2a3344";
        ctx.font = "bold 14px Early GameBoy, monospace";
        ctx.textAlign = "center";
        const caption =
          eggFrame === "idle" ? "Wobble… wobble…"
          : eggFrame === "crack1" ? "Tap… tap…"
          : eggFrame === "crack2" ? "Crack!"
          : "CRACK!!";
        ctx.fillText(caption, cx, screen.ly + screen.lh - 18);
        ctx.textAlign = "left";
      } else {
        // Birth: bottom nest + peeking baby + top shell flying away
        const birth = (hatchT - 0.68) / 0.32;
        const sheet = await loadEggSheet();
        const row = eggRowFor(pet.species, pet.variant);
        const shellSize = 96;
        if (sheet) {
          const topLift = Math.round(birth * 70);
          const topDrift = Math.round(birth * 40);
          blitEggTile(ctx, sheet, row, eggCol("top"), cx - shellSize / 2 + topDrift, cy - shellSize * 0.85 - topLift, shellSize);
          blitEggTile(ctx, sheet, row, eggCol("bottom"), cx - shellSize / 2, cy + 8, shellSize);
        }
        const baby = { ...pet, stage: "hatchling" as const };
        drawChibi(ctx, baby, cx, cy + 28, t, 0.95 + birth * 0.25);

        // Burst stars (opaque squares)
        ctx.fillStyle = "#e8b830";
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 + t * 3;
          const r = 30 + birth * 90;
          ctx.fillRect(
            Math.round(cx + Math.cos(ang) * r),
            Math.round(cy - 10 + Math.sin(ang) * r),
            5, 5,
          );
        }

        ctx.fillStyle = "#2a3344";
        ctx.font = "bold 16px Early GameBoy, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`It's ${pet.name}!`, cx, screen.ly + 38);
        ctx.font = "11px Early GameBoy, monospace";
        ctx.fillText(`A ${sp?.label ?? pet.species} was born!`, cx, screen.ly + 56);
        ctx.textAlign = "left";
      }
      ctx.restore();
    },
  });
}

/** Short nursery / intro banner GIF — shown before first hatch. */
export async function renderIntroGif(species?: PetSpecies): Promise<AnimationResult | null> {
  const { width, height } = PET_CANVAS;
  const sheet = await loadEggSheet();

  return encodeAnimation({
    width, height, speed: "normal", durationMs: 2200, maxFrames: 20, quality: 3, renderScale: 1,
    render: async (frame) => {
      const { ctx, t } = frame;
      const screen = drawDevice(ctx, width, height, t);
      clipScreen(ctx, screen.lx, screen.ly, screen.lw, screen.lh);
      const cx = screen.lx + screen.lw / 2;
      const cy = screen.ly + screen.lh / 2 - 4;

      ctx.fillStyle = "#2a3344";
      ctx.font = "bold 16px Early GameBoy, monospace";
      ctx.textAlign = "center";
      ctx.fillText("TAMAGOTCHI NURSERY", cx, screen.ly + 34);
      ctx.font = "11px Early GameBoy, monospace";
      ctx.fillText("Pick a species · Name it · Hatch!", cx, screen.ly + 52);

      const kinds: PetSpecies[] = ["dragon", "cat", "dog", "hamster"];
      kinds.forEach((k, i) => {
        const ex = cx - 120 + i * 80;
        const shake = Math.round(Math.sin(t * Math.PI * 3 + i) * 4);
        if (sheet) {
          blitEggTile(ctx, sheet, eggRowFor(k, 0), 0, ex - 28, cy - 28 + shake, 56);
        }
        ctx.fillStyle = species === k ? "#b45309" : "#2a3344";
        ctx.font = "bold 10px Early GameBoy, monospace";
        ctx.fillText(SPECIES_META[k].label, ex, cy + 44);
      });

      ctx.fillStyle = "#5a6578";
      ctx.font = "10px Early GameBoy, monospace";
      ctx.fillText("Feed · Clean · Play — or it may leave you…", cx, screen.ly + screen.lh - 16);
      ctx.textAlign = "left";
      ctx.restore();
    },
  });
}

export async function renderChallengeGif(
  a: Pet,
  b: Pet,
  winnerId: string,
): Promise<AnimationResult | null> {
  const width = 520;
  const height = 360;
  return encodeAnimation({
    width, height, speed: "fast", durationMs: 2200, maxFrames: 24, quality: 3, renderScale: 1,
    render: (frame) => {
      const { ctx, t } = frame;
      const screen = drawDevice(ctx, width, height, t);
      clipScreen(ctx, screen.lx, screen.ly, screen.lw, screen.lh);
      const clash = t < 0.55;
      const shake = clash ? Math.sin(t * 60) * 5 : 0;
      const ax = screen.lx + screen.lw * 0.28 + (clash ? t * 30 : 10) + shake;
      const bx = screen.lx + screen.lw * 0.72 - (clash ? t * 30 : 10) - shake;
      const feet = screen.ly + screen.lh - 40;

      drawChibi(ctx, a, ax, feet, t, 0.95);
      drawChibi(ctx, b, bx, feet, t, 0.95);

      ctx.fillStyle = "#2a3344";
      ctx.font = "bold 18px Early GameBoy, monospace";
      ctx.textAlign = "center";
      if (t > 0.55) {
        const winner = winnerId === a.userId ? a : b;
        ctx.fillText(`${winner.name} wins!`, screen.lx + screen.lw / 2, screen.ly + 40);
      } else {
        ctx.fillText("VS", screen.lx + screen.lw / 2, screen.ly + screen.lh / 2);
      }
      ctx.textAlign = "left";
      ctx.restore();
    },
  });
}
