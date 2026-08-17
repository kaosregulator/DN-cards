// ─────────────────────────────────────────────────────────────────────────────
// Card renderer — turns a DuelCard into a Phaser display object. Monster art is
// the server's own card image (streamed through the Discord proxy); spells,
// traps and art-less cards get a clean procedural frame so nothing ever depends
// on an external host (Discord's CSP would block it).
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import type { DuelCard, DuelAttribute } from "../duel/types";

export const ATTR_COLOR: Record<DuelAttribute, number> = {
  EARTH: 0x8d6b3f, WIND: 0x35c48a, WATER: 0x3b7ddb, FIRE: 0xe0552b,
  LIGHT: 0xd9c34a, DARK: 0x6c3fb0, DIVINE: 0xcaa64a,
};

const KIND_TINT: Record<string, number> = {
  monster: 0xcaa24a, spell: 0x1e9e5a, trap: 0x9b2fae,
};

export function artKey(cardId: number): string { return `art:${cardId}`; }

function roundRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number): void {
  g.fillRoundedRect(x, y, w, h, r);
}

/** Build a face-up card. Returns a container centred on (0,0). */
export function makeCardFace(
  scene: Phaser.Scene, card: DuelCard, w: number, h: number,
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  const border = card.kind === "monster" ? ATTR_COLOR[card.attribute] : KIND_TINT[card.kind]!;
  const bg = KIND_TINT[card.kind] ?? 0xcaa24a;

  const g = scene.add.graphics();
  g.fillStyle(0x0c0f17, 1); roundRect(g, -w / 2, -h / 2, w, h, 6);
  g.lineStyle(2, border, 1); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  g.fillStyle(bg, 0.16); roundRect(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 5);
  c.add(g);

  // Name bar.
  const name = scene.add.text(0, -h / 2 + 4, fit(card.name, Math.floor(w / 6)), {
    fontFamily: "system-ui, sans-serif", fontSize: `${Math.max(8, Math.round(w / 11))}px`,
    color: "#f4ead0", fontStyle: "bold",
  }).setOrigin(0.5, 0);
  c.add(name);

  // Art window.
  const artY = -h * 0.06;
  const artW = w - 12, artH = h * 0.5;
  const key = card.cardId != null ? artKey(card.cardId) : null;
  if (key && scene.textures.exists(key)) {
    const img = scene.add.image(0, artY, key);
    const scale = Math.max(artW / img.width, artH / img.height);
    img.setScale(scale);
    // Mask the art to the window.
    const maskG = scene.make.graphics({});
    maskG.fillStyle(0xffffff);
    maskG.fillRect(-artW / 2, artY - artH / 2, artW, artH);
    img.setMask(maskG.createGeometryMask());
    c.add(img);
  } else {
    // Procedural art panel.
    const p = scene.add.graphics();
    p.fillStyle(border, 0.30); p.fillRect(-artW / 2, artY - artH / 2, artW, artH);
    p.lineStyle(1, border, 0.6); p.strokeRect(-artW / 2, artY - artH / 2, artW, artH);
    c.add(p);
    const glyph = card.kind === "spell" ? "✦" : card.kind === "trap" ? "▲" : "★";
    c.add(scene.add.text(0, artY, glyph, { fontSize: `${Math.round(artH * 0.6)}px`, color: "#" + border.toString(16).padStart(6, "0") }).setOrigin(0.5));
  }

  // Stat / type footer.
  if (card.kind === "monster") {
    // Level stars (top).
    const stars = "★".repeat(Math.min(12, card.level));
    c.add(scene.add.text(0, -h / 2 + 4 + Math.round(w / 10), fit(stars, Math.floor(w / 6)), {
      fontSize: `${Math.max(7, Math.round(w / 16))}px`, color: "#ffd75e",
    }).setOrigin(0.5, 0).setAlpha(0.9));
    const atkDef = scene.add.text(0, h / 2 - 4, `ATK ${card.atk}  DEF ${card.def}`, {
      fontFamily: "monospace", fontSize: `${Math.max(8, Math.round(w / 12))}px`, color: "#ffe9b0", fontStyle: "bold",
    }).setOrigin(0.5, 1);
    c.add(atkDef);
  } else {
    c.add(scene.add.text(0, h / 2 - 4, card.kind === "spell" ? "SPELL" : "TRAP", {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.max(8, Math.round(w / 12))}px`,
      color: card.kind === "spell" ? "#8ef0bd" : "#e5a6f5", fontStyle: "bold",
    }).setOrigin(0.5, 1));
  }

  c.setSize(w, h);
  return c;
}

/** Build a face-down card back. */
export function makeCardBack(scene: Phaser.Scene, w: number, h: number): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  g.fillStyle(0x241132, 1); roundRect(g, -w / 2, -h / 2, w, h, 6);
  g.lineStyle(2, 0x7b46b0, 1); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  g.fillStyle(0x9b6bd8, 0.25); roundRect(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 5);
  c.add(g);
  c.add(scene.add.text(0, 0, "DN", {
    fontFamily: "system-ui, sans-serif", fontSize: `${Math.round(w / 3)}px`, color: "#d8b8ff", fontStyle: "bold",
  }).setOrigin(0.5).setAlpha(0.85));
  c.setSize(w, h);
  return c;
}

function fit(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + "…";
}
