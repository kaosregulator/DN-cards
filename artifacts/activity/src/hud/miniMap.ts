import type Phaser from "phaser";

// ─────────────────────────────────────────────────────────────────────────────
// MiniMap — DOM compass overlay (top-right) that follows the player. Click / M
// opens a full-map panel for the current location. Implemented in the DOM so
// camera zoom cannot push it off-screen (Phaser scrollFactor(0) still scales
// with zoom).
// ─────────────────────────────────────────────────────────────────────────────

export interface MiniMapPoi {
  id: string;
  x: number;
  y: number;
  label: string;
  glyph: string;
  color: number;
  kind: "portal" | "encounter" | "poi";
}

export interface MiniMapOpts {
  scene: Phaser.Scene;
  mapW: number;
  mapH: number;
  collision?: Phaser.Tilemaps.TilemapLayer | null;
  title: string;
  subtitle: string;
  getPlayer: () => { x: number; y: number; facing: "down" | "left" | "right" | "up" };
  getPois: () => MiniMapPoi[];
  /**
   * Classify a tile for the terrain bake so the map reads at a glance:
   * 0 = ground, 1 = water, 2 = trees/foliage, 3 = building/wall. Optional —
   * without it the minimap falls back to walls-vs-grass from the collision layer.
   */
  classify?: (tileX: number, tileY: number) => 0 | 1 | 2 | 3;
}

const MINI_R = 58;
const VIEW_TILES = 16; // tighter crop so walking clearly scrolls the compass
const TILE = 32;
const TERRAIN_STEP = 2;

export class MiniMap {
  private opts: MiniMapOpts;
  private scene: Phaser.Scene;
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private expanded = false;
  private overlay: HTMLDivElement | null = null;
  private destroyed = false;
  private scalePx: number;
  private onKey: (e: KeyboardEvent) => void;

  constructor(opts: MiniMapOpts) {
    this.opts = opts;
    this.scene = opts.scene;
    this.scalePx = (MINI_R * 2) / (VIEW_TILES * TILE);

    this.injectStyles();
    this.terrain = this.bakeTerrain();

    this.root = document.createElement("div");
    this.root.id = "mini-map";
    this.root.title = "Open full map (M)";
    this.root.innerHTML = `<span class="mm-n">N</span>`;
    this.canvas = document.createElement("canvas");
    this.canvas.width = MINI_R * 2;
    this.canvas.height = MINI_R * 2;
    this.canvas.className = "mm-canvas";
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.root.addEventListener("click", (e) => {
      e.preventDefault();
      this.toggleFull();
    });
    document.body.appendChild(this.root);

    this.onKey = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        this.toggleFull();
      } else if (e.key === "Escape" && this.expanded) {
        this.closeFull();
      }
    };
    window.addEventListener("keydown", this.onKey);

    this.scene.events.once("shutdown", () => this.destroy());
    this.paint();
  }

  update(): void {
    if (this.destroyed) return;
    this.paint();
    if (this.expanded) this.paintOverlay();
  }

  refreshPois(): void {
    this.paint();
    if (this.expanded) this.paintOverlay();
  }

  toggleFull(): void {
    if (this.expanded) this.closeFull();
    else this.openFull();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeFull();
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  // ── draw the circular compass ───────────────────────────────────────────────
  private paint(): void {
    const ctx = this.ctx;
    const R = MINI_R;
    const d = R * 2;
    ctx.clearRect(0, 0, d, d);

    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 4, 0, Math.PI * 2);
    ctx.clip();

    const p = this.opts.getPlayer();
    // Terrain centred on the player.
    const drawW = this.opts.mapW * this.scalePx;
    const drawH = this.opts.mapH * this.scalePx;
    const ox = R - p.x * this.scalePx;
    const oy = R - p.y * this.scalePx;
    ctx.fillStyle = "#1a2a1a";
    ctx.fillRect(0, 0, d, d);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, ox, oy, drawW, drawH);

    // POIs
    for (const poi of this.opts.getPois()) {
      const x = ox + poi.x * this.scalePx;
      const y = oy + poi.y * this.scalePx;
      if (x < -8 || y < -8 || x > d + 8 || y > d + 8) continue;
      ctx.beginPath();
      ctx.fillStyle = cssColor(poi.color);
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();

    // Player arrow at centre.
    const facing = this.opts.getPlayer().facing;
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[facing];
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-6, 7);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fillStyle = "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ── terrain bake (one-shot offscreen canvas) ────────────────────────────────
  private bakeTerrain(): HTMLCanvasElement {
    const { mapW, mapH, collision } = this.opts;
    const cols = Math.ceil(mapW / TILE);
    const rows = Math.ceil(mapH / TILE);
    const tw = Math.max(1, Math.ceil(cols / TERRAIN_STEP));
    const th = Math.max(1, Math.ceil(rows / TERRAIN_STEP));
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(tw, th);
    const data = img.data;
    const classify = this.opts.classify;
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const gx = tx * TERRAIN_STEP, gy = ty * TERRAIN_STEP;
        const i = (ty * tw + tx) * 4;
        const shade = ((tx + ty) & 1) === 0 ? 0 : 8;
        // Category: 0 ground · 1 water · 2 trees · 3 building. Prefer the rich
        // classifier; fall back to walls-vs-grass from the collision layer.
        let cat: 0 | 1 | 2 | 3;
        if (classify) {
          cat = classify(gx, gy);
        } else {
          const tile = collision?.getTileAt(gx, gy);
          cat = tile && tile.index >= 0 ? 3 : 0;
        }
        let r: number, g: number, b: number;
        switch (cat) {
          case 1: r = 0x2c + shade; g = 0x6a + shade; b = 0xb4; break; // water — blue
          case 2: r = 0x22; g = 0x54 + shade; b = 0x28; break;          // trees — deep green
          case 3: r = 0x6b; g = 0x6b; b = 0x74 + shade; break;          // building — grey
          default: r = 0x3a + shade; g = 0x6e + shade; b = 0x3a; break; // ground — grass
        }
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ── full map overlay ────────────────────────────────────────────────────────
  private openFull(): void {
    if (this.expanded || this.destroyed) return;
    this.expanded = true;
    const overlay = document.createElement("div");
    overlay.className = "mm-overlay";
    overlay.innerHTML =
      `<div class="mm-panel" role="dialog" aria-label="World map">` +
      `<div class="mm-head">` +
      `<div><div class="mm-title">${esc(this.opts.title)}</div>` +
      `<div class="mm-sub">${esc(this.opts.subtitle)}</div></div>` +
      `<button type="button" class="mm-close" aria-label="Close">✕</button>` +
      `</div>` +
      `<div class="mm-stage"><canvas class="mm-full"></canvas></div>` +
      `<div class="mm-legend">` +
      `<div class="mm-leg-h">LEGEND</div>` +
      `<div class="mm-leg-grid">` +
      `<span>▲ You</span><span>🃏 Shop / Services</span><span>⚔️ Duel Arena</span>` +
      `<span><i class="mm-sw" style="background:#2c6ab4"></i> Water</span>` +
      `<span><i class="mm-sw" style="background:#225428"></i> Trees</span>` +
      `<span><i class="mm-sw" style="background:#6b6b74"></i> Buildings</span>` +
      `</div></div>` +
      `<div class="mm-tip">★ Tip: Press M to open the full world map</div>` +
      `</div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closeFull();
    });
    overlay.querySelector(".mm-close")?.addEventListener("click", () => this.closeFull());
    // Stop clicks inside the panel from closing via the dimmer only.
    overlay.querySelector(".mm-panel")?.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.paintOverlay();
  }

  private paintOverlay(): void {
    if (!this.overlay) return;
    const canvas = this.overlay.querySelector(".mm-full") as HTMLCanvasElement | null;
    if (!canvas) return;
    const stage = this.overlay.querySelector(".mm-stage") as HTMLElement;
    const size = Math.min(stage.clientWidth || 320, stage.clientHeight || 320, 360);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#1a2a1a";
    ctx.fillRect(0, 0, size, size);

    const fullScale = (size - 8) / Math.max(this.opts.mapW, this.opts.mapH);
    const drawW = this.opts.mapW * fullScale;
    const drawH = this.opts.mapH * fullScale;
    const ox = (size - drawW) / 2;
    const oy = (size - drawH) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, ox, oy, drawW, drawH);

    for (const poi of this.opts.getPois()) {
      const x = ox + poi.x * fullScale;
      const y = oy + poi.y * fullScale;
      ctx.beginPath();
      ctx.fillStyle = cssColor(poi.color);
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = "11px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(poi.glyph, x, y);
    }

    // Player
    const p = this.opts.getPlayer();
    const px = ox + p.x * fullScale;
    const py = oy + p.y * fullScale;
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[p.facing];
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-7, 9);
    ctx.lineTo(7, 9);
    ctx.closePath();
    ctx.fillStyle = "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // Gold rim
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = "#d4a84b";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(26,20,40,.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private closeFull(): void {
    this.expanded = false;
    this.overlay?.remove();
    this.overlay = null;
  }

  private injectStyles(): void {
    if (document.getElementById("mini-map-style")) return;
    const s = document.createElement("style");
    s.id = "mini-map-style";
    s.textContent = `
      #mini-map {
        position: fixed;
        top: calc(12px + env(safe-area-inset-top, 0px));
        right: calc(12px + env(safe-area-inset-right, 0px));
        width: ${MINI_R * 2}px; height: ${MINI_R * 2}px;
        border-radius: 50%;
        border: 3px solid #d4a84b;
        box-shadow: 0 0 0 2px #1a1428, 0 8px 24px rgba(0,0,0,.45);
        overflow: hidden;
        cursor: pointer;
        z-index: 20;
        background: #0c1220;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      #mini-map .mm-canvas { display: block; width: 100%; height: 100%; border-radius: 50%; }
      #mini-map .mm-n {
        position: absolute; top: 4px; left: 50%; transform: translateX(-50%);
        font: 700 11px system-ui, sans-serif; color: #ffe9b0;
        text-shadow: 0 0 3px #1a1428, 0 1px 2px #1a1428; z-index: 1; pointer-events: none;
      }
      #mini-map:active { transform: scale(.96); }

      .mm-overlay {
        position: fixed; inset: 0; z-index: 40;
        background: rgba(5,7,15,.82);
        display: flex; align-items: center; justify-content: center;
        padding: 12px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .mm-panel {
        width: min(520px, 100%); max-height: min(640px, 100%);
        background: rgba(18,24,44,.98); border: 2px solid #d4a84b;
        border-radius: 16px; padding: 14px 16px 12px;
        box-shadow: 0 16px 48px rgba(0,0,0,.5);
        display: flex; flex-direction: column; gap: 10px;
      }
      .mm-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .mm-title { font-size: 18px; font-weight: 700; color: #ffe9b0; }
      .mm-sub { font-size: 12px; color: #9db2ff; margin-top: 2px; }
      .mm-close {
        border: none; background: transparent; color: #c9d4ff; font-size: 20px;
        cursor: pointer; padding: 4px 8px; line-height: 1;
        touch-action: manipulation;
      }
      .mm-stage {
        display: flex; align-items: center; justify-content: center;
        min-height: 220px; flex: 1;
      }
      .mm-full { border-radius: 50%; }
      .mm-legend { color: #dbe4ff; }
      .mm-leg-h { font-size: 11px; font-weight: 700; color: #8b97c4; margin-bottom: 6px; }
      .mm-leg-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: 12px;
      }
      .mm-sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
        vertical-align: middle; margin-right: 3px; }
      .mm-tip { text-align: center; font-size: 11px; color: #ffe9b0; padding-top: 4px; }
    `;
    document.head.appendChild(s);
  }
}

function cssColor(n: number): string {
  return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
