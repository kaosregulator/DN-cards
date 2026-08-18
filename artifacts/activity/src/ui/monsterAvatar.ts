// ─────────────────────────────────────────────────────────────────────────────
// Monster avatars — living creature tokens that stand on the field in front of
// each face-up monster card. Everything is drawn from primitive shapes at
// runtime (no image files), so it's CSP-safe like the rest of the board and
// deterministic from the card — both online clients draw the same creature.
//
// The silhouette (dragon, beast, warrior, fiend, caster, machine, aqua, undead)
// is chosen by hashing the card, tinted by its Attribute, and scaled by Level.
// The scene animates the returned container: idle bob (time-based), an entrance
// pop, an attack lunge, and a hurt recoil.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import type { DuelCard } from "../duel/types";
import { ATTR_COLOR } from "./card";

export interface MonsterAvatar {
  container: Phaser.GameObjects.Container;
  /** Rest Y (for time-based idle bob) and a per-monster phase offset. */
  baseY: number;
  phase: number;
  bob: number;
}

type Arche = "dragon" | "beast" | "warrior" | "fiend" | "caster" | "machine" | "aqua" | "undead";
const ARCHES: Arche[] = ["dragon", "beast", "warrior", "fiend", "caster", "machine", "aqua", "undead"];

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function archetypeFor(card: DuelCard): Arche {
  const key = card.cardId != null ? `id${card.cardId}` : card.name;
  return ARCHES[hash(key) % ARCHES.length]!;
}

interface Pal { body: number; dark: number; light: number; eye: number; }
function paletteFor(card: DuelCard): Pal {
  // Keep the attribute colour rich and saturated so the creature reads as a
  // solid token, not a ghost; contrast comes from the dark rim + light accents.
  const body = ATTR_COLOR[card.attribute] ?? 0xcaa24a;
  return { body, dark: shade(body, -0.55), light: shade(body, 0.55), eye: 0xfff2a8 };
}
function shade(c: number, f: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

/**
 * Build a creature avatar sized to roughly `w`×`h`, centred at (0,0) with its
 * feet near the bottom. Returns the container plus idle-bob bookkeeping.
 */
export function makeMonsterAvatar(
  scene: Phaser.Scene, card: DuelCard, w: number, h: number, defending = false,
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const pal = paletteFor(card);
  const arche = archetypeFor(card);
  // Subtle coloured glow so the token separates from the card behind it.
  for (const [rf, a] of [[1.0, 0.05], [0.66, 0.08]] as const) {
    g.fillStyle(pal.body, a);
    g.fillEllipse(0, -h * 0.04, w * 0.98 * rf, h * 0.9 * rf);
  }
  // Ground shadow.
  g.fillStyle(0x000000, 0.34);
  g.fillEllipse(0, h * 0.42, w * 0.74, h * 0.17);
  // A dark silhouette one notch larger reads as a crisp outline behind the
  // coloured creature.
  drawCreature(g, arche, w * 1.1, h * 1.1, { ...pal, body: pal.dark, light: pal.dark }, card.level, defending, true);
  drawCreature(g, arche, w, h, pal, card.level, defending);
  c.add(g);
  c.setSize(w, h);
  c.setData("arche", arche);
  return c;
}

function drawCreature(
  g: Phaser.GameObjects.Graphics, arche: Arche, w: number, h: number, pal: Pal, level: number,
  defending: boolean, outlineOnly = false,
): void {
  const s = 0.82 + Math.min(12, level) * 0.02; // bigger for higher level
  const W = w * s, H = h * s;
  const yb = H * 0.34; // feet baseline (below centre)
  const body = pal.body, dark = pal.dark, light = pal.light;
  const eyes = (x1: number, x2: number, y: number, r: number) => {
    g.fillStyle(0x0a0d16, 1); g.fillCircle(x1, y, r * 1.5); g.fillCircle(x2, y, r * 1.5);
    g.fillStyle(pal.eye, 1); g.fillCircle(x1, y, r); g.fillCircle(x2, y, r);
  };

  switch (arche) {
    case "dragon": {
      // Wings behind.
      g.fillStyle(dark, 1);
      g.fillTriangle(-W * 0.1, -H * 0.1, -W * 0.55, -H * 0.42, -W * 0.5, yb * 0.2);
      g.fillTriangle(W * 0.1, -H * 0.1, W * 0.55, -H * 0.42, W * 0.5, yb * 0.2);
      // Body + neck + head.
      g.fillStyle(body, 1);
      g.fillEllipse(0, yb - H * 0.12, W * 0.42, H * 0.36);
      g.fillEllipse(W * 0.02, -H * 0.18, W * 0.2, H * 0.34);   // neck
      g.fillEllipse(W * 0.12, -H * 0.34, W * 0.26, H * 0.2);   // head
      // Snout + horn.
      g.fillStyle(light, 1); g.fillTriangle(W * 0.22, -H * 0.4, W * 0.42, -H * 0.32, W * 0.22, -H * 0.26);
      g.fillStyle(dark, 1); g.fillTriangle(W * 0.05, -H * 0.46, W * 0.13, -H * 0.6, W * 0.18, -H * 0.44);
      // Tail.
      g.fillStyle(body, 1); g.fillTriangle(-W * 0.3, yb - H * 0.14, -W * 0.62, yb * 0.1, -W * 0.3, yb * 0.02);
      eyes(W * 0.1, W * 0.2, -H * 0.36, W * 0.028);
      break;
    }
    case "beast": {
      g.fillStyle(body, 1);
      g.fillEllipse(0, yb - H * 0.16, W * 0.5, H * 0.34);   // body
      g.fillCircle(W * 0.06, -H * 0.22, W * 0.24);          // head
      // Ears.
      g.fillStyle(dark, 1);
      g.fillTriangle(-W * 0.14, -H * 0.36, -W * 0.02, -H * 0.5, W * 0.04, -H * 0.3);
      g.fillTriangle(W * 0.26, -H * 0.36, W * 0.14, -H * 0.5, W * 0.08, -H * 0.3);
      // Legs.
      g.fillStyle(dark, 1);
      g.fillRect(-W * 0.28, yb - H * 0.04, W * 0.12, H * 0.14);
      g.fillRect(W * 0.16, yb - H * 0.04, W * 0.12, H * 0.14);
      // Snout.
      g.fillStyle(light, 1); g.fillEllipse(W * 0.14, -H * 0.16, W * 0.16, H * 0.1);
      eyes(-W * 0.02, W * 0.12, -H * 0.26, W * 0.028);
      break;
    }
    case "warrior": {
      // Torso.
      g.fillStyle(body, 1); g.fillRoundedRect(-W * 0.22, -H * 0.14, W * 0.44, H * 0.4, W * 0.06);
      // Head + helmet.
      g.fillStyle(light, 1); g.fillCircle(0, -H * 0.28, W * 0.16);
      g.fillStyle(dark, 1); g.fillRect(-W * 0.18, -H * 0.4, W * 0.36, H * 0.1);
      // Legs.
      g.fillStyle(dark, 1);
      g.fillRect(-W * 0.16, yb - H * 0.02, W * 0.12, H * 0.14);
      g.fillRect(W * 0.04, yb - H * 0.02, W * 0.12, H * 0.14);
      // Sword.
      g.fillStyle(0xd8dce8, 1); g.fillRect(W * 0.28, -H * 0.42, W * 0.05, H * 0.5);
      g.fillStyle(dark, 1); g.fillRect(W * 0.24, -H * 0.02, W * 0.13, H * 0.05);
      eyes(-W * 0.06, W * 0.06, -H * 0.29, W * 0.024);
      break;
    }
    case "fiend": {
      g.fillStyle(body, 1); g.fillCircle(0, -H * 0.02, W * 0.4);
      // Horns.
      g.fillStyle(dark, 1);
      g.fillTriangle(-W * 0.3, -H * 0.22, -W * 0.42, -H * 0.5, -W * 0.14, -H * 0.28);
      g.fillTriangle(W * 0.3, -H * 0.22, W * 0.42, -H * 0.5, W * 0.14, -H * 0.28);
      // Jagged mouth.
      g.fillStyle(0x1a0d16, 1); g.fillTriangle(-W * 0.16, H * 0.06, W * 0.16, H * 0.06, 0, H * 0.2);
      eyes(-W * 0.14, W * 0.14, -H * 0.06, W * 0.035);
      // Claw feet.
      g.fillStyle(dark, 1);
      g.fillTriangle(-W * 0.24, yb, -W * 0.12, yb, -W * 0.18, yb + H * 0.1);
      g.fillTriangle(W * 0.24, yb, W * 0.12, yb, W * 0.18, yb + H * 0.1);
      break;
    }
    case "caster": {
      // Robe.
      g.fillStyle(body, 1); g.fillTriangle(-W * 0.32, yb, W * 0.32, yb, 0, -H * 0.24);
      g.fillStyle(light, 0.9); g.fillTriangle(-W * 0.12, yb, W * 0.12, yb, 0, -H * 0.1);
      // Head + wizard hat.
      g.fillStyle(0xf0c9a0, 1); g.fillCircle(0, -H * 0.28, W * 0.14);
      g.fillStyle(dark, 1); g.fillTriangle(-W * 0.2, -H * 0.34, W * 0.2, -H * 0.34, 0, -H * 0.66);
      // Staff.
      g.fillStyle(0x8a6a3a, 1); g.fillRect(W * 0.26, -H * 0.5, W * 0.04, H * 0.7);
      g.fillStyle(pal.eye, 1); g.fillCircle(W * 0.28, -H * 0.5, W * 0.08);
      eyes(-W * 0.05, W * 0.05, -H * 0.29, W * 0.022);
      break;
    }
    case "machine": {
      g.fillStyle(body, 1); g.fillRoundedRect(-W * 0.3, -H * 0.18, W * 0.6, H * 0.44, W * 0.05);
      g.fillStyle(dark, 1); g.fillRect(-W * 0.3, H * 0.04, W * 0.6, H * 0.06); // seam
      // Head unit.
      g.fillStyle(light, 1); g.fillRect(-W * 0.16, -H * 0.36, W * 0.32, H * 0.2);
      g.fillStyle(0x1a1f2e, 1); g.fillRect(-W * 0.12, -H * 0.3, W * 0.24, H * 0.08); // visor
      g.fillStyle(pal.eye, 1); g.fillRect(-W * 0.08, -H * 0.28, W * 0.16, H * 0.03);
      // Antenna.
      g.lineStyle(Math.max(1.5, W * 0.02), light, 1); g.lineBetween(0, -H * 0.36, 0, -H * 0.5);
      g.fillStyle(0xff5a6a, 1); g.fillCircle(0, -H * 0.52, W * 0.04);
      // Legs.
      g.fillStyle(dark, 1);
      g.fillRect(-W * 0.22, yb - H * 0.02, W * 0.14, H * 0.12);
      g.fillRect(W * 0.08, yb - H * 0.02, W * 0.14, H * 0.12);
      break;
    }
    case "aqua": {
      // Fins.
      g.fillStyle(dark, 1);
      g.fillTriangle(0, -H * 0.2, -W * 0.1, -H * 0.5, W * 0.06, -H * 0.24);
      // Teardrop body.
      g.fillStyle(body, 1); g.fillEllipse(0, yb - H * 0.16, W * 0.44, H * 0.4);
      g.fillStyle(light, 0.6); g.fillEllipse(-W * 0.08, yb - H * 0.22, W * 0.16, H * 0.16);
      // Tail fin.
      g.fillStyle(dark, 1); g.fillTriangle(-W * 0.28, yb - H * 0.1, -W * 0.5, yb - H * 0.24, -W * 0.5, yb + H * 0.02);
      eyes(-W * 0.08, W * 0.1, -H * 0.06, W * 0.03);
      break;
    }
    case "undead": {
      // Tattered cloak.
      g.fillStyle(dark, 1); g.fillTriangle(-W * 0.3, yb, W * 0.3, yb, 0, -H * 0.28);
      g.fillStyle(body, 0.85); g.fillTriangle(-W * 0.2, yb - H * 0.02, W * 0.2, yb - H * 0.02, 0, -H * 0.16);
      // Skull.
      g.fillStyle(0xe8e4d0, 1); g.fillCircle(0, -H * 0.3, W * 0.16);
      g.fillStyle(0x1a1a1a, 1);
      g.fillCircle(-W * 0.06, -H * 0.31, W * 0.04); g.fillCircle(W * 0.06, -H * 0.31, W * 0.04);
      g.fillRect(-W * 0.02, -H * 0.26, W * 0.04, H * 0.05);
      break;
    }
  }

  // Defending monsters hunker down behind a faint shield glyph.
  if (defending && !outlineOnly) {
    g.fillStyle(0x9fb8ff, 0.16); g.fillEllipse(0, -H * 0.02, W * 0.62, H * 0.66);
    g.lineStyle(Math.max(1.5, W * 0.02), 0x9fb8ff, 0.5); g.strokeEllipse(0, -H * 0.02, W * 0.62, H * 0.66);
  }
}
