// Animated Tamagotchi GIF renderer — procedural creatures (dragon/cat/dog/hamster)
// using the shared @napi-rs/canvas + gifencoder pipeline from animations/engine.
// Mood, dirt, hunger, stage, and cosmetics all drive the frame loop.

import { encodeAnimation, type Ctx } from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import type { Pet } from "@workspace/db";
import { SPECIES_META, moodOf, isDirty, isHungry, type PetSpecies } from "./engine.js";

export const PET_CANVAS = { width: 420, height: 320 } as const;

type Mood = ReturnType<typeof moodOf>;

function palette(pet: Pet): { body: string; accent: string; bg0: string; bg1: string } {
  const sp = (pet.species as PetSpecies) in SPECIES_META ? (pet.species as PetSpecies) : "cat";
  const hues = SPECIES_META[sp].hues;
  const [body, accent] = hues[pet.variant % hues.length]!;
  const mood = moodOf(pet);
  const bg =
    mood === "dead" ? ["#1a1214", "#3a2024"] as const
    : mood === "critical" ? ["#2a1a14", "#4a3020"] as const
    : mood === "sad" ? ["#1a2230", "#2a3850"] as const
    : ["#142028", "#1e3a4a"] as const;
  return { body, accent, bg0: bg[0], bg1: bg[1] };
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
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

function drawBg(ctx: Ctx, w: number, h: number, p: ReturnType<typeof palette>, t: number, mood: Mood) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.bg0);
  g.addColorStop(1, p.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Soft floating particles / stars.
  ctx.save();
  for (let i = 0; i < 18; i++) {
    const px = ((i * 97 + t * (mood === "dead" ? 20 : 40)) % (w + 20)) - 10;
    const py = (i * 53) % h;
    ctx.globalAlpha = 0.15 + (i % 5) * 0.05;
    ctx.fillStyle = mood === "dead" ? "#ff8899" : "#c8e8ff";
    ellipse(ctx, px, py, 1.5 + (i % 3), 1.5 + (i % 3));
    ctx.fill();
  }
  ctx.restore();

  // Floor ellipse.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ellipse(ctx, w / 2, h - 48, 110, 18);
  ctx.fill();
}

function drawMeter(ctx: Ctx, x: number, y: number, label: string, value: number, color: string) {
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, x, y, 100, 10, 4);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(2, 100 * (value / 100)), 10, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "10px sans-serif";
  ctx.fillText(`${label} ${Math.round(value)}`, x, y - 3);
}

function eye(ctx: Ctx, x: number, y: number, r: number, mood: Mood, blink: boolean) {
  if (blink) {
    ctx.strokeStyle = "#12161c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.stroke();
    return;
  }
  if (mood === "dead") {
    ctx.strokeStyle = "#12161c";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
    return;
  }
  ellipse(ctx, x, y, r, r);
  ctx.fillStyle = "#f7fbff";
  ctx.fill();
  const pupil = mood === "sad" || mood === "critical" ? r * 0.35 : r * 0.5;
  ellipse(ctx, x + r * 0.15, y + (mood === "critical" ? r * 0.15 : 0), pupil, pupil * 1.1);
  ctx.fillStyle = "#12161c";
  ctx.fill();
}

function drawEgg(ctx: Ctx, cx: number, cy: number, pet: Pet, t: number, p: ReturnType<typeof palette>) {
  const wobble = Math.sin(t * Math.PI * 4) * 4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((wobble * Math.PI) / 180);
  // Shell.
  ellipse(ctx, 0, 0, 42, 54);
  ctx.fillStyle = "#f5efe6";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Speckles.
  ctx.fillStyle = p.body;
  for (const [sx, sy, sr] of [[-12, -8, 5], [14, 6, 4], [-4, 18, 6], [10, -20, 3]] as const) {
    ellipse(ctx, sx, sy, sr, sr * 0.8);
    ctx.fill();
  }
  // Crack when close to hatch (high care).
  if (pet.happiness > 70 && pet.hunger > 60) {
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -10);
    ctx.lineTo(0, 0);
    ctx.lineTo(10, -6);
    ctx.lineTo(4, 12);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCreature(ctx: Ctx, cx: number, feetY: number, pet: Pet, t: number, p: ReturnType<typeof palette>) {
  const mood = moodOf(pet);
  const stage = pet.stage;
  const scale =
    stage === "hatchling" ? 0.72
    : stage === "juvenile" ? 0.9
    : 1.05;
  const bounce = mood === "dead" ? 0
    : mood === "ecstatic" ? Math.abs(Math.sin(t * Math.PI * 6)) * 10
    : mood === "happy" ? Math.abs(Math.sin(t * Math.PI * 4)) * 6
    : Math.abs(Math.sin(t * Math.PI * 2)) * 3;
  const blink = !pet.isDead && Math.floor(t * 12) % 17 === 0;
  const hungry = isHungry(pet);
  const dirty = isDirty(pet);
  const sp = pet.species as PetSpecies;

  ctx.save();
  ctx.translate(cx, feetY - bounce);
  ctx.scale(scale, scale);

  // Dirt cloud.
  if (dirty && !pet.isDead) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(t * 8) * 0.1;
    ctx.fillStyle = "#6b5a40";
    for (let i = 0; i < 6; i++) {
      ellipse(ctx, -30 + i * 12 + Math.sin(t * 5 + i) * 3, -20 - (i % 3) * 8, 4, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  // Hunger rumble lines.
  if (hungry && !pet.isDead) {
    ctx.strokeStyle = "rgba(255,200,120,0.55)";
    ctx.lineWidth = 2;
    const ox = 48;
    for (let i = 0; i < 3; i++) {
      const yy = -40 - i * 8 + Math.sin(t * 10 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(ox, yy);
      ctx.quadraticCurveTo(ox + 8, yy - 4, ox + 14, yy);
      ctx.stroke();
    }
  }

  switch (sp) {
    case "dragon":
      drawDragon(ctx, p, mood, blink, t);
      break;
    case "cat":
      drawCat(ctx, p, mood, blink, t);
      break;
    case "dog":
      drawDog(ctx, p, mood, blink, t);
      break;
    default:
      drawHamster(ctx, p, mood, blink, t);
  }

  // Cosmetic overlays.
  if (pet.activeCosmetic === "hat") {
    ctx.fillStyle = "#1f2937";
    roundRect(ctx, -18, -88, 36, 10, 2);
    ctx.fill();
    roundRect(ctx, -10, -108, 20, 22, 3);
    ctx.fill();
  } else if (pet.activeCosmetic === "ribbon") {
    ctx.fillStyle = "#ec4899";
    ctx.beginPath();
    ctx.moveTo(-22, -70);
    ctx.lineTo(-6, -62);
    ctx.lineTo(-22, -54);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, -70);
    ctx.lineTo(6, -62);
    ctx.lineTo(22, -54);
    ctx.closePath();
    ctx.fill();
  } else if (pet.activeCosmetic === "armor") {
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 4;
    ellipse(ctx, 0, -30, 34, 28);
    ctx.stroke();
  }

  // Death veil.
  if (pet.isDead) {
    ctx.fillStyle = "rgba(20,10,12,0.35)";
    ellipse(ctx, 0, -36, 50, 55);
    ctx.fill();
    // Floating spirit.
    ctx.globalAlpha = 0.55 + Math.sin(t * 6) * 0.2;
    ctx.fillStyle = "#e8f0ff";
    ellipse(ctx, 20 + Math.sin(t * 3) * 8, -110 - t * 20, 10, 14);
    ctx.fill();
  }

  ctx.restore();
}

function drawDragon(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number) {
  // Tail.
  ctx.strokeStyle = p.body;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-28, -18);
  ctx.quadraticCurveTo(-55, -30 - Math.sin(t * 6) * 8, -48, -55);
  ctx.stroke();
  // Body.
  ellipse(ctx, 0, -28, 36, 28);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Belly.
  ellipse(ctx, 4, -22, 18, 16);
  ctx.fillStyle = p.accent;
  ctx.fill();
  // Wings.
  ctx.fillStyle = p.accent;
  ctx.globalAlpha = 0.85;
  const wing = Math.sin(t * Math.PI * 5) * 8;
  ctx.beginPath();
  ctx.moveTo(-8, -40);
  ctx.quadraticCurveTo(-50, -70 - wing, -20, -20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -40);
  ctx.quadraticCurveTo(50, -70 - wing, 20, -20);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // Head.
  ellipse(ctx, 22, -52, 18, 16);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.stroke();
  // Horns.
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.moveTo(14, -64); ctx.lineTo(10, -82); ctx.lineTo(20, -66); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, -64); ctx.lineTo(34, -84); ctx.lineTo(34, -64); ctx.fill();
  // Eyes + snout.
  eye(ctx, 18, -54, 4, mood, blink);
  eye(ctx, 28, -54, 4, mood, blink);
  ellipse(ctx, 34, -48, 7, 5);
  ctx.fillStyle = p.accent;
  ctx.fill();
  // Flame breath when happy.
  if (mood === "ecstatic" || mood === "happy") {
    ctx.fillStyle = `rgba(255,${140 + Math.floor(Math.sin(t * 20) * 40)},40,0.85)`;
    ellipse(ctx, 48 + Math.sin(t * 15) * 4, -48, 8 + Math.sin(t * 20) * 3, 5);
    ctx.fill();
  }
  // Legs.
  ctx.fillStyle = p.body;
  for (const lx of [-16, -4, 8, 18]) {
    roundRect(ctx, lx - 4, -8, 8, 16, 3);
    ctx.fill();
  }
}

function drawCat(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number) {
  // Tail curl.
  ctx.strokeStyle = p.body;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-30, -24);
  ctx.quadraticCurveTo(-48, -50 - Math.sin(t * 5) * 6, -28, -70);
  ctx.stroke();
  // Body.
  ellipse(ctx, 0, -26, 32, 22);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Head.
  ellipse(ctx, 18, -48, 16, 15);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.stroke();
  // Ears.
  ctx.fillStyle = p.body;
  ctx.beginPath();
  ctx.moveTo(8, -56); ctx.lineTo(4, -76); ctx.lineTo(16, -58); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, -56); ctx.lineTo(36, -78); ctx.lineTo(34, -56); ctx.fill();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.moveTo(10, -58); ctx.lineTo(8, -70); ctx.lineTo(14, -58); ctx.fill();
  // Face.
  eye(ctx, 14, -50, 3.5, mood, blink);
  eye(ctx, 24, -50, 3.5, mood, blink);
  ellipse(ctx, 20, -44, 3, 2);
  ctx.fillStyle = "#f472b6";
  ctx.fill();
  // Legs.
  ctx.fillStyle = p.body;
  for (const lx of [-18, -6, 6, 16]) {
    roundRect(ctx, lx - 3, -10, 6, 14, 2);
    ctx.fill();
  }
}

function drawDog(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number) {
  // Wagging tail.
  ctx.strokeStyle = p.body;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  const wag = Math.sin(t * Math.PI * 8) * 18;
  ctx.beginPath();
  ctx.moveTo(-28, -22);
  ctx.quadraticCurveTo(-40 + wag * 0.2, -40, -30 + wag * 0.4, -55);
  ctx.stroke();
  // Body.
  ellipse(ctx, 0, -26, 34, 22);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Head.
  ellipse(ctx, 22, -46, 17, 15);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.stroke();
  // Floppy ear.
  ctx.fillStyle = p.accent;
  ellipse(ctx, 10, -42, 8, 14);
  ctx.fill();
  // Snout.
  ellipse(ctx, 34, -42, 9, 7);
  ctx.fillStyle = p.accent;
  ctx.fill();
  ellipse(ctx, 40, -44, 3, 2.5);
  ctx.fillStyle = "#111";
  ctx.fill();
  eye(ctx, 18, -50, 3.5, mood, blink);
  eye(ctx, 28, -50, 3.5, mood, blink);
  // Tongue when happy.
  if (mood === "happy" || mood === "ecstatic") {
    ctx.fillStyle = "#f87171";
    ellipse(ctx, 36, -36 + Math.abs(Math.sin(t * 10)) * 2, 4, 5);
    ctx.fill();
  }
  ctx.fillStyle = p.body;
  for (const lx of [-18, -6, 8, 18]) {
    roundRect(ctx, lx - 3.5, -10, 7, 14, 2);
    ctx.fill();
  }
}

function drawHamster(ctx: Ctx, p: ReturnType<typeof palette>, mood: Mood, blink: boolean, t: number) {
  // Round body.
  ellipse(ctx, 0, -28, 30, 26);
  ctx.fillStyle = p.body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Belly.
  ellipse(ctx, 0, -20, 16, 14);
  ctx.fillStyle = p.accent;
  ctx.fill();
  // Ears.
  ctx.fillStyle = p.body;
  ellipse(ctx, -16, -48, 8, 8);
  ctx.fill();
  ellipse(ctx, 16, -48, 8, 8);
  ctx.fill();
  ctx.fillStyle = "#f9a8d4";
  ellipse(ctx, -16, -48, 4, 4);
  ctx.fill();
  ellipse(ctx, 16, -48, 4, 4);
  ctx.fill();
  // Cheeks (stuffed when happy).
  const cheek = mood === "ecstatic" ? 10 : 7;
  ellipse(ctx, -18, -30, cheek, cheek - 1);
  ctx.fillStyle = p.accent;
  ctx.fill();
  ellipse(ctx, 18, -30, cheek, cheek - 1);
  ctx.fill();
  eye(ctx, -8, -36, 3.5, mood, blink);
  eye(ctx, 8, -36, 3.5, mood, blink);
  // Nose.
  ellipse(ctx, 0, -30, 3, 2.5);
  ctx.fillStyle = "#e11d48";
  ctx.fill();
  // Tiny paws bounce.
  ctx.fillStyle = p.body;
  const paw = Math.sin(t * 8) * 2;
  roundRect(ctx, -14, -8 + paw, 8, 8, 3);
  ctx.fill();
  roundRect(ctx, 6, -8 - paw, 8, 8, 3);
  ctx.fill();
}

function drawHud(ctx: Ctx, pet: Pet, w: number) {
  const mood = moodOf(pet);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, 12, 12, w - 24, 58, 10);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px sans-serif";
  const sp = SPECIES_META[(pet.species as PetSpecies)]?.emoji ?? "🐾";
  ctx.fillText(`${sp} ${pet.name}`, 24, 32);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(`${pet.stage} · Lv ${pet.level} · PWR ${pet.power} · ${mood}`, 24, 48);

  drawMeter(ctx, 24, 70, "HP", pet.health, "#34d399");
  drawMeter(ctx, 140, 70, "HUN", pet.hunger, "#fbbf24");
  drawMeter(ctx, 256, 70, "CLN", pet.cleanliness, "#60a5fa");
  // Happiness on second row-ish right.
  drawMeter(ctx, 24, 292, "HAP", pet.happiness, "#f472b6");

  if (pet.neglectCount > 0 && !pet.isDead) {
    ctx.fillStyle = "#fb7185";
    ctx.font = "10px sans-serif";
    ctx.fillText(`Neglect ${pet.neglectCount}`, w - 90, 32);
  }
  if (pet.isDead) {
    ctx.fillStyle = "#fb7185";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("✝ PASSED ON", w - 120, 48);
  }
}

/** Idle / care loop GIF for the pet hub. */
export async function renderPetGif(pet: Pet, opts?: { durationMs?: number }): Promise<AnimationResult | null> {
  const { width, height } = PET_CANVAS;
  const p = palette(pet);
  const mood = moodOf(pet);
  const durationMs = opts?.durationMs ?? (mood === "dead" ? 2200 : 1800);

  return encodeAnimation({
    width,
    height,
    speed: "normal",
    durationMs,
    maxFrames: 24,
    quality: 12,
    renderScale: 1,
    render: (frame) => {
      const { ctx, t } = frame;
      drawBg(ctx, width, height, p, t, mood);
      drawHud(ctx, pet, width);
      if (pet.stage === "egg" && !pet.isDead) {
        drawEgg(ctx, width / 2, height / 2 + 20, pet, t, p);
      } else {
        drawCreature(ctx, width / 2, height - 56, pet, t, p);
      }
    },
  });
}

/** Short hatch-crack celebration GIF. */
export async function renderHatchGif(pet: Pet): Promise<AnimationResult | null> {
  const { width, height } = PET_CANVAS;
  const p = palette(pet);
  return encodeAnimation({
    width,
    height,
    speed: "fast",
    durationMs: 1600,
    maxFrames: 20,
    quality: 12,
    render: (frame) => {
      const { ctx, t } = frame;
      drawBg(ctx, width, height, p, t, "ecstatic");
      // Egg shrinks / cracks then creature pops.
      if (t < 0.55) {
        drawEgg(ctx, width / 2, height / 2 + 10, pet, t, p);
        // Burst shards.
        ctx.fillStyle = "#f5efe6";
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2 + t * 4;
          const r = 30 + t * 80;
          ellipse(ctx, width / 2 + Math.cos(ang) * r, height / 2 + Math.sin(ang) * r, 4, 3);
          ctx.fill();
        }
      } else {
        drawCreature(ctx, width / 2, height - 56, { ...pet, stage: "hatchling" }, t, p);
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 18px sans-serif";
        ctx.fillText("It's alive!", width / 2 - 48, 40);
      }
    },
  });
}

/** Challenge clash GIF — two pets bump, winner flashes. */
export async function renderChallengeGif(
  a: Pet,
  b: Pet,
  winnerId: string,
): Promise<AnimationResult | null> {
  const width = 520;
  const height = 300;
  const pa = palette(a);
  const pb = palette(b);
  return encodeAnimation({
    width,
    height,
    speed: "fast",
    durationMs: 2000,
    maxFrames: 24,
    quality: 14,
    render: (frame) => {
      const { ctx, t } = frame;
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, "#1a1520");
      g.addColorStop(1, "#243044");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      const clash = t < 0.55;
      const shake = clash ? Math.sin(t * 60) * 6 : 0;
      const ax = width * 0.28 + (clash ? t * 40 : 30) + shake;
      const bx = width * 0.72 - (clash ? t * 40 : 30) - shake;

      drawCreature(ctx, ax, height - 40, a, t, pa);
      drawCreature(ctx, bx, height - 40, b, t, pb);

      if (t > 0.55) {
        const winner = winnerId === a.userId ? a : b;
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(`${winner.name} wins!`, width / 2 - 70, 40);
        // Sparkles on winner side.
        const wx = winnerId === a.userId ? ax : bx;
        ctx.fillStyle = "#fbbf24";
        for (let i = 0; i < 10; i++) {
          const ang = t * 8 + i;
          ellipse(ctx, wx + Math.cos(ang) * 40, height - 100 + Math.sin(ang * 1.3) * 30, 3, 3);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px sans-serif";
        ctx.fillText("VS", width / 2 - 16, height / 2);
      }
    },
  });
}
