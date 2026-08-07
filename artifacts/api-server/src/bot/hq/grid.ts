// ─────────────────────────────────────────────────────────────────────────────
// HQ — lattice sizes.
//
// The two isometric grids the HQ is built on: the interior room and the outdoor
// grounds. They live in their own leaf module because the command registrar and
// the terrain validator both need them at startup, and neither should have to
// import the canvas renderer (and its native dependencies) to learn a number.
// render.ts derives its projections from these same constants.
// ─────────────────────────────────────────────────────────────────────────────

/** Tiles per side of an interior room's floor. */
export const HQ_GRID = 8;

/** Tiles per side of the outdoor base grounds. */
export const HQ_BASE_GRID = 10;
