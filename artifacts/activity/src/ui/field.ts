// ─────────────────────────────────────────────────────────────────────────────
// Duel field geometry — the tilted playmat.
//
// The reference duel client renders its board with
//   transform: perspective(1000px) rotateX(45deg)
// which gives the classic Yu-Gi-Oh "playmat receding into the screen" look. We
// reproduce it in Phaser by projecting board coordinates through a small
// perspective model: the far edge is narrow and its cards are small, the near
// edge is wide with big cards, and row spacing grows with depth exactly as a
// tilted plane's does.
//
// Board space:
//   u ∈ [0,1] across the 5 card zones (values outside reach the side columns)
//   z ∈ [0,1] depth, 0 = far edge (opponent's back row), 1 = near edge (yours)
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldLayout {
  /** Screen position + scale for a board coordinate. */
  project(u: number, z: number): { x: number; y: number; s: number };
  /** Card size at a given depth. */
  cardSize(z: number): { w: number; h: number };
  /** The mat's four screen corners, framing the rows between zFar and zNear. */
  corners(zFar?: number, zNear?: number): Array<{ x: number; y: number }>;
  rowZ: typeof ROW_Z;
  /** Horizontal centre of the mat. */
  cx: number;
}

/** Depth of each board row, far → near. */
export const ROW_Z = {
  oppST: 0.00,
  oppMon: 0.20,
  centre: 0.46,
  playerMon: 0.66,
  playerST: 0.88,
} as const;

export type RowKey = keyof typeof ROW_Z;

export function makeField(width: number, height: number): FieldLayout {
  // Vertical band the ROWS occupy. Leaves room for the LP panels above and the
  // hand below; the mat polygon then extends past these to frame the rows.
  const yFar = height * 0.185;
  const yNear = height * 0.60;
  const cx = width / 2;

  // Perspective strength: how much smaller the far edge is than the near edge.
  const sFar = 0.66;
  const sNear = 1.0;

  // Mat width at scale 1, sized so five zones + both side columns fit.
  const matW = Math.min(width * 0.96, height * 1.2);
  // Base card width at the near edge.
  const baseCardW = Math.min(matW / 7.4, height * 0.105);

  const scaleAt = (z: number): number => sFar + (sNear - sFar) * clamp01(z);

  // Row spacing must be proportional to scale, so integrate scale over z and
  // normalise — this is what makes the recession look physically right.
  const integral = (z: number): number => sFar * z + 0.5 * (sNear - sFar) * z * z;
  const total = integral(1);
  const yAt = (z: number): number => yFar + (yNear - yFar) * (integral(clamp01(z)) / total);

  return {
    cx,
    rowZ: ROW_Z,
    project(u: number, z: number) {
      const s = scaleAt(z);
      return { x: cx + (u - 0.5) * matW * s, y: yAt(z), s };
    },
    cardSize(z: number) {
      const s = scaleAt(z);
      const w = baseCardW * s;
      return { w, h: w * 1.42 };
    },
    corners(zFar = ROW_Z.oppST, zNear = ROW_Z.playerST) {
      const sF = scaleAt(zFar), sN = scaleAt(zNear);
      const halfF = (matW * sF) / 2, halfN = (matW * sN) / 2;
      // Frame the rows: clear the far/near cards' own height, plus a margin.
      const cardHF = baseCardW * sF * 1.42, cardHN = baseCardW * sN * 1.42;
      const yF = yAt(zFar) - cardHF / 2 - 12 * sF;
      const yN = yAt(zNear) + cardHN / 2 + 14 * sN;
      return [
        { x: cx - halfF, y: yF },
        { x: cx + halfF, y: yF },
        { x: cx + halfN, y: yN },
        { x: cx - halfN, y: yN },
      ];
    },
  };
}

/** u coordinate for card zone `i` of 5 (0-indexed), centred on the mat. */
export function zoneU(i: number): number {
  // Five zones spread across the middle 62% of the mat, leaving the outer
  // strips clear for the Deck / Graveyard columns.
  const span = 0.62;
  const start = 0.5 - span / 2;
  return start + (span * (i + 0.5)) / 5;
}

/** u for the outer side columns (Graveyard left, Deck right). */
export const SIDE_U = { left: 0.045, right: 0.955 } as const;

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
