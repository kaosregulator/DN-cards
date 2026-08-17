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

  // ── Vertical flow: name → real-card subtitle → stars → art → stats ──
  const pad = Math.max(3, w * 0.035);
  let cursor = -h / 2 + pad;

  // YOUR card's name.
  const nameFs = Math.max(7, Math.round(w / 10.5));
  c.add(scene.add.text(0, cursor, fit(card.name, Math.floor(w / (nameFs * 0.52))), {
    fontFamily: "system-ui, sans-serif", fontSize: `${nameFs}px`,
    color: "#f4ead0", fontStyle: "bold",
  }).setOrigin(0.5, 0));
  cursor += nameFs * 1.12;

  // The real Yu-Gi-Oh card it plays as (only when there's room to read it).
  const showReal = !!card.realName && card.realName !== card.name && w >= 62;
  if (showReal) {
    const subFs = Math.max(6, Math.round(w / 15));
    c.add(scene.add.text(0, cursor, fit(card.realName!, Math.floor(w / (subFs * 0.5))), {
      fontFamily: "system-ui, sans-serif", fontSize: `${subFs}px`, color: "#9db2ff",
    }).setOrigin(0.5, 0).setAlpha(0.95));
    cursor += subFs * 1.15;
  }

  // Level stars.
  if (card.kind === "monster" && card.level > 0) {
    const starFs = Math.max(6, Math.round(w / 16));
    c.add(scene.add.text(0, cursor, fit("★".repeat(Math.min(12, card.level)), Math.floor(w / (starFs * 0.62))), {
      fontSize: `${starFs}px`, color: "#ffd75e",
    }).setOrigin(0.5, 0).setAlpha(0.95));
    cursor += starFs * 1.1;
  }

  // Art window fills what's left above the stat footer.
  const footerH = Math.max(11, w * 0.16);
  const artW = w - pad * 2;
  const artH = Math.max(10, (h / 2 - pad - footerH) - cursor);
  const artY = cursor + artH / 2;
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
    // Spell/Trap "blank" cards show their INITIALS (e.g. "MST") so they read at a
    // glance; monsters without art fall back to a star.
    const initials = card.kind !== "monster" ? extractInitials(card.name) : null;
    if (initials) {
      c.add(scene.add.text(0, artY, initials, {
        fontFamily: "system-ui, sans-serif", fontStyle: "bold",
        fontSize: `${Math.round(artH * (initials.length > 2 ? 0.4 : 0.5))}px`,
        color: "#" + border.toString(16).padStart(6, "0"),
      }).setOrigin(0.5));
    } else {
      const glyph = card.kind === "spell" ? "✦" : card.kind === "trap" ? "▲" : "★";
      c.add(scene.add.text(0, artY, glyph, { fontSize: `${Math.round(artH * 0.6)}px`, color: "#" + border.toString(16).padStart(6, "0") }).setOrigin(0.5));
    }
  }

  // Stat / type footer — shrunk to fit the card's width so it never overflows.
  if (card.kind === "monster") {
    const long = `ATK ${card.atk}  DEF ${card.def}`;
    const short = `${card.atk}/${card.def}`;
    const label = fitsAt(long, w - pad * 2, w / 12) ? long : short;
    const fs = Math.max(7, Math.min(Math.round(w / 12), Math.floor((w - pad * 2) / (label.length * 0.62))));
    c.add(scene.add.text(0, h / 2 - pad, label, {
      fontFamily: "monospace", fontSize: `${fs}px`, color: "#ffe9b0", fontStyle: "bold",
    }).setOrigin(0.5, 1));
  } else {
    const label = card.sub ? `${card.sub.toUpperCase()} ${card.kind === "spell" ? "SPELL" : "TRAP"}` : (card.kind === "spell" ? "SPELL" : "TRAP");
    const fs = Math.max(6, Math.min(Math.round(w / 13), Math.floor((w - pad * 2) / (label.length * 0.6))));
    c.add(scene.add.text(0, h / 2 - pad, label, {
      fontFamily: "system-ui, sans-serif", fontSize: `${fs}px`,
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
  if (max < 1) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + "…";
}

/** Rough width test for a monospace-ish label at a given font size. */
function fitsAt(s: string, maxW: number, fontSize: number): boolean {
  return s.length * fontSize * 0.62 <= maxW;
}

/** Pull the "(XYZ)" initials out of a library card name, if present. */
function extractInitials(name: string): string | null {
  const m = /\(([A-Za-z]{1,4})\)\s*$/.exec(name);
  return m ? m[1]!.toUpperCase() : null;
}
