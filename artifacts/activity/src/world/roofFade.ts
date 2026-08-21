// ─────────────────────────────────────────────────────────────────────────────
// Roof fade — when the player walks under a roof (or a tree canopy) in the WA
// maps, the piece they're beneath fades out so they can see inside, then fades
// back when they leave. Roof layers are flood-filled into connected regions once
// at load, so only the building you're actually under fades — not every roof.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";

interface Region { tiles: Phaser.Tilemaps.Tile[]; alpha: number; target: number; fadeable: boolean; }

const UNDER_ALPHA = 0.18; // how see-through a roof becomes while you're under it
const LERP = 0.22;        // fade speed per frame

export class RoofFade {
  private regions: Region[] = [];
  private tileRegion: Int32Array;
  private active = new Set<number>();
  private current = -1;

  constructor(
    layers: Phaser.Tilemaps.TilemapLayer[],
    private cols: number,
    private rows: number,
    private tw: number,
    private th: number,
  ) {
    const n = cols * rows;
    this.tileRegion = new Int32Array(n).fill(-1);
    const occ = new Uint8Array(n);
    for (const L of layers) {
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const t = L.getTileAt(tx, ty);
          if (t && t.index >= 0) occ[ty * cols + tx] = 1;
        }
      }
    }
    // Flood-fill occupied cells into connected regions (4-connectivity).
    for (let i = 0; i < n; i++) {
      if (!occ[i] || this.tileRegion[i] !== -1) continue;
      const id = this.regions.length;
      const tiles: Phaser.Tilemaps.Tile[] = [];
      const stack = [i];
      this.tileRegion[i] = id;
      while (stack.length) {
        const j = stack.pop()!;
        const tx = j % cols, ty = (j / cols) | 0;
        for (const L of layers) {
          const t = L.getTileAt(tx, ty);
          if (t && t.index >= 0) tiles.push(t);
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const k = ny * cols + nx;
          if (occ[k] && this.tileRegion[k] === -1) { this.tileRegion[k] = id; stack.push(k); }
        }
      }
      this.regions.push({ tiles, alpha: 1, target: 1, fadeable: true });
    }
    // A region covering a big share of the map is a map-wide overlay (lights,
    // ambient shade, tree bands), not a building — never fade those.
    const maxTiles = cols * rows * 0.12;
    for (const r of this.regions) if (r.tiles.length > maxTiles) r.fadeable = false;
  }

  update(px: number, py: number): void {
    const tx = Math.floor(px / this.tw), ty = Math.floor(py / this.th);
    let rid = -1;
    if (tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows) rid = this.tileRegion[ty * this.cols + tx]!;
    if (rid >= 0 && !this.regions[rid]!.fadeable) rid = -1; // don't fade map-wide overlays
    if (rid !== this.current) {
      if (this.current >= 0) { this.regions[this.current]!.target = 1; this.active.add(this.current); }
      if (rid >= 0) { this.regions[rid]!.target = UNDER_ALPHA; this.active.add(rid); }
      this.current = rid;
    }
    for (const id of Array.from(this.active)) {
      const r = this.regions[id]!;
      r.alpha += (r.target - r.alpha) * LERP;
      if (Math.abs(r.target - r.alpha) < 0.02) { r.alpha = r.target; this.active.delete(id); }
      for (const t of r.tiles) t.alpha = r.alpha;
    }
  }
}
