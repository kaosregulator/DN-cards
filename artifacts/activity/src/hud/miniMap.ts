import Phaser from "phaser";
import { onTap, padHit, isTouchUi } from "../ui/tap";

// ─────────────────────────────────────────────────────────────────────────────
// MiniMap — a true top-right compass map that follows the player in the Phaser
// world. Click (or press M) to expand into a full-map overlay of the current
// location (city, village, shop, duel hall…) with POI markers and a legend.
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
  /** Collision layer used to paint buildings / walls on the map. */
  collision?: Phaser.Tilemaps.TilemapLayer | null;
  title: string;
  subtitle: string;
  getPlayer: () => { x: number; y: number; facing: "down" | "left" | "right" | "up" };
  getPois: () => MiniMapPoi[];
}

const MINI_R = 58;          // outer radius of the circular minimap
const VIEW_TILES = 22;      // how many tiles across the mini view covers
const TILE = 32;            // world tile size (matches Tiled maps)
const TERRAIN_STEP = 2;     // sample every N tiles when baking the terrain tex
const DEPTH = 50_000;

export class MiniMap {
  private scene: Phaser.Scene;
  private opts: MiniMapOpts;
  private root: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.Container;
  private playerArrow!: Phaser.GameObjects.Graphics;
  private terrainKey: string;
  private expanded = false;
  private overlay: Phaser.GameObjects.Container | null = null;
  private scalePx: number; // world→mini pixels
  private destroyed = false;

  constructor(opts: MiniMapOpts) {
    this.opts = opts;
    this.scene = opts.scene;
    this.terrainKey = `minimap-terrain-${opts.title}-${opts.mapW}x${opts.mapH}`;
    this.scalePx = (MINI_R * 2) / (VIEW_TILES * TILE);

    this.root = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH);
    this.content = this.scene.add.container(0, 0);
    this.root.add(this.content);

    this.bakeTerrain();
    this.buildChrome();
    this.layout();
    this.bindOpen();

    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  update(): void {
    if (this.destroyed) return;
    const p = this.opts.getPlayer();
    // Content scrolls so the player sits at the circle centre.
    this.content.setPosition(-p.x * this.scalePx, -p.y * this.scalePx);
    this.drawPlayerArrow(p.facing);
    if (this.expanded) this.refreshOverlayPlayer();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeFull();
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.root.destroy(true);
  }

  toggleFull(): void {
    if (this.expanded) this.closeFull();
    else this.openFull();
  }

  // ── chrome (rim, N, hit target) ─────────────────────────────────────────────
  private buildChrome(): void {
    // Circular mask so the terrain + POIs clip cleanly.
    const maskG = this.scene.make.graphics({ x: 0, y: 0 });
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(0, 0, MINI_R - 4);
    this.content.setMask(maskG.createGeometryMask());
    // Keep the mask graphics as a child of root so it tracks position (mask
    // graphics world transform follows the object they're attached to when
    // parented — Phaser geometry masks use the graphics' world matrix).
    this.root.add(maskG);
    maskG.setVisible(false);

    // Gold rim + inner ring.
    const rim = this.scene.add.graphics();
    rim.lineStyle(4, 0xd4a84b, 1);
    rim.strokeCircle(0, 0, MINI_R);
    rim.lineStyle(2, 0x1a1428, 0.9);
    rim.strokeCircle(0, 0, MINI_R - 3);
    rim.fillStyle(0x0c1220, 0.35);
    rim.fillCircle(0, 0, MINI_R - 4);
    this.root.add(rim);

    // North marker.
    const n = this.scene.add.text(0, -MINI_R + 10, "N", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffe9b0", fontStyle: "bold",
      stroke: "#1a1428", strokeThickness: 3,
    }).setOrigin(0.5);
    this.root.add(n);

    // Player arrow (stays at the circle centre).
    this.playerArrow = this.scene.add.graphics();
    this.root.add(this.playerArrow);
    this.drawPlayerArrow("down");

    // Invisible hit pad — generous on touch.
    const hit = this.scene.add.circle(0, 0, MINI_R + (isTouchUi() ? 10 : 4), 0xffffff, 0.001);
    this.root.add(hit);
    onTap(hit, padHit(-MINI_R, -MINI_R, MINI_R * 2, MINI_R * 2, 12), () => this.toggleFull());
  }

  private drawPlayerArrow(facing: "down" | "left" | "right" | "up"): void {
    const g = this.playerArrow;
    g.clear();
    const rot = { up: 0, right: 90, down: 180, left: -90 }[facing];
    g.save();
    // Phaser Graphics has no rotate-about-point helper that persists across
    // clear; draw the triangle in local space then rotate the whole GO.
    g.fillStyle(0x3b82f6, 1);
    g.lineStyle(1.5, 0xffffff, 0.95);
    g.fillTriangle(0, -8, -6, 7, 6, 7);
    g.strokeTriangle(0, -8, -6, 7, 6, 7);
    g.restore();
    this.playerArrow.setAngle(rot);
  }

  private layout = (): void => {
    const pad = 14;
    const chipClearance = 0; // chip moved off the top-right in WorldHud
    const x = this.scene.scale.width - pad - MINI_R - chipClearance;
    const y = pad + MINI_R + (isTouchUi() ? 4 : 0);
    this.root.setPosition(x, y);
  };

  private bindOpen(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;
    const onM = () => this.toggleFull();
    kb.on("keydown-M", onM);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.off("keydown-M", onM));
  }

  // ── terrain bake ────────────────────────────────────────────────────────────
  private bakeTerrain(): void {
    const { mapW, mapH, collision } = this.opts;
    const cols = Math.ceil(mapW / TILE);
    const rows = Math.ceil(mapH / TILE);
    const tw = Math.ceil(cols / TERRAIN_STEP);
    const th = Math.ceil(rows / TERRAIN_STEP);

    // Offscreen canvas → Phaser texture (one-shot, reused across restarts via key).
    if (!this.scene.textures.exists(this.terrainKey)) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, tw);
      canvas.height = Math.max(1, th);
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(tw, th);
      const data = img.data;

      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const tileX = tx * TERRAIN_STEP;
          const tileY = ty * TERRAIN_STEP;
          const blocked = !!collision?.getTileAt(tileX, tileY)?.index
            && (collision.getTileAt(tileX, tileY)!.index >= 0);
          // Soft grass vs building mass — readable at mini scale.
          const i = (ty * tw + tx) * 4;
          if (blocked) {
            data[i] = 0x5a; data[i + 1] = 0x4a; data[i + 2] = 0x38; data[i + 3] = 255;
          } else {
            // Checker-ish meadow so the map doesn't look flat.
            const shade = ((tx + ty) & 1) === 0 ? 0 : 8;
            data[i] = 0x3a + shade; data[i + 1] = 0x6e + shade; data[i + 2] = 0x3a; data[i + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      this.scene.textures.addCanvas(this.terrainKey, canvas);
    }

    const img = this.scene.add.image(0, 0, this.terrainKey).setOrigin(0);
    // Stretch the low-res bake to cover the whole world in mini-space.
    img.setDisplaySize(mapW * this.scalePx, mapH * this.scalePx);
    this.content.add(img);

    // Soft path hints: faint cross through the spawn-ish centre so empty maps
    // still read as a place.
    const paths = this.scene.add.graphics();
    paths.lineStyle(1.5 * this.scalePx * TILE, 0xc4a574, 0.45);
    const cx = (mapW / 2) * this.scalePx, cy = (mapH / 2) * this.scalePx;
    paths.lineBetween(cx - 80 * this.scalePx, cy, cx + 80 * this.scalePx, cy);
    paths.lineBetween(cx, cy - 80 * this.scalePx, cx, cy + 80 * this.scalePx);
    this.content.add(paths);

    this.redrawPois();
  }

  private redrawPois(): void {
    // Drop prior POI children (keep index 0 terrain + 1 paths).
    while (this.content.length > 2) {
      const last = this.content.getAt(this.content.length - 1);
      this.content.remove(last, true);
    }
    for (const poi of this.opts.getPois()) {
      const mx = poi.x * this.scalePx;
      const my = poi.y * this.scalePx;
      const dot = this.scene.add.circle(mx, my, 3.2, poi.color, 0.95)
        .setStrokeStyle(1, 0xffffff, 0.7);
      this.content.add(dot);
    }
  }

  /** Call after interactables are (re)placed so the mini view stays in sync. */
  refreshPois(): void {
    this.redrawPois();
  }

  // ── full map overlay ────────────────────────────────────────────────────────
  private openFull(): void {
    if (this.expanded || this.destroyed) return;
    this.expanded = true;
    const W = this.scene.scale.width, H = this.scene.scale.height;
    const overlay = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH + 10);
    this.overlay = overlay;

    const dim = this.scene.add.rectangle(0, 0, W, H, 0x05070f, 0.82).setOrigin(0);
    onTap(dim, new Phaser.Geom.Rectangle(0, 0, W, H), () => this.closeFull());
    overlay.add(dim);

    const panelW = Math.min(W - 24, 520);
    const panelH = Math.min(H - 24, 640);
    const px = (W - panelW) / 2, py = (H - panelH) / 2;

    const panel = this.scene.add.graphics();
    panel.fillStyle(0x12182c, 0.98);
    panel.fillRoundedRect(px, py, panelW, panelH, 16);
    panel.lineStyle(2, 0xd4a84b, 0.85);
    panel.strokeRoundedRect(px, py, panelW, panelH, 16);
    overlay.add(panel);
    // Swallow taps on the panel so they don't close via the dimmer.
    const panelHit = this.scene.add.rectangle(px + panelW / 2, py + panelH / 2, panelW, panelH, 0x000000, 0)
      .setInteractive();
    overlay.add(panelHit);

    overlay.add(this.scene.add.text(px + 18, py + 14, this.opts.title, {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ffe9b0", fontStyle: "bold",
    }));
    overlay.add(this.scene.add.text(px + 18, py + 36, this.opts.subtitle, {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#9db2ff",
    }));

    const close = this.scene.add.text(px + panelW - 18, py + 16, "✕", {
      fontFamily: "system-ui, sans-serif", fontSize: "20px", color: "#c9d4ff", fontStyle: "bold",
    }).setOrigin(1, 0);
    onTap(close, padHit(-18, -4, 36, 28, 14), () => this.closeFull());
    overlay.add(close);

    // Map stage — circular on wide panels, fit-to-box otherwise.
    const mapBox = Math.min(panelW - 40, panelH - 210, 360);
    const mapCx = px + panelW / 2;
    const mapCy = py + 56 + mapBox / 2;
    const fullScale = mapBox / Math.max(this.opts.mapW, this.opts.mapH);

    const mapRoot = this.scene.add.container(mapCx, mapCy);
    overlay.add(mapRoot);

    const maskG = this.scene.make.graphics({ x: 0, y: 0 });
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(mapCx, mapCy, mapBox / 2 - 2);
    mapRoot.setMask(maskG.createGeometryMask());
    overlay.add(maskG);
    maskG.setVisible(false);

    const rim = this.scene.add.graphics();
    rim.lineStyle(4, 0xd4a84b, 1);
    rim.strokeCircle(mapCx, mapCy, mapBox / 2);
    rim.lineStyle(2, 0x1a1428, 0.9);
    rim.strokeCircle(mapCx, mapCy, mapBox / 2 - 3);
    overlay.add(rim);

    const terrain = this.scene.add.image(0, 0, this.terrainKey).setOrigin(0.5);
    terrain.setDisplaySize(this.opts.mapW * fullScale, this.opts.mapH * fullScale);
    mapRoot.add(terrain);

    // POIs on the full map.
    for (const poi of this.opts.getPois()) {
      const lx = (poi.x - this.opts.mapW / 2) * fullScale;
      const ly = (poi.y - this.opts.mapH / 2) * fullScale;
      const g = this.scene.add.container(lx, ly);
      const disc = this.scene.add.circle(0, 0, 10, poi.color, 0.95).setStrokeStyle(1.5, 0xffffff, 0.85);
      const glyph = this.scene.add.text(0, 0, poi.glyph, { fontSize: "11px" }).setOrigin(0.5);
      g.add([disc, glyph]);
      mapRoot.add(g);
    }

    // Player blip on full map (refreshed each frame while open).
    const you = this.scene.add.graphics().setName("full-you");
    mapRoot.add(you);
    (overlay as Phaser.GameObjects.Container & { __fullScale?: number; __you?: Phaser.GameObjects.Graphics })
      .__fullScale = fullScale;
    (overlay as Phaser.GameObjects.Container & { __you?: Phaser.GameObjects.Graphics }).__you = you;
    this.refreshOverlayPlayer();

    // Legend.
    const legendY = py + panelH - 118;
    overlay.add(this.scene.add.text(px + 18, legendY, "LEGEND", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#8b97c4", fontStyle: "bold",
    }));
    const legend: Array<[string, string]> = [
      ["▲", "You"],
      ["🏠", "Village / NPC"],
      ["🃏", "Shop / Services"],
      ["⚔️", "Duel Arena"],
      ["🌐", "Online / Portal"],
    ];
    legend.forEach(([g, label], i) => {
      const col = i < 3 ? 0 : 1;
      const row = i < 3 ? i : i - 3;
      const lx = px + 18 + col * (panelW / 2);
      const ly = legendY + 18 + row * 18;
      overlay.add(this.scene.add.text(lx, ly, `${g}  ${label}`, {
        fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#dbe4ff",
      }));
    });

    overlay.add(this.scene.add.text(px + panelW / 2, py + panelH - 14,
      "★  Tip: Press M to open the full world map", {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffe9b0",
      }).setOrigin(0.5, 1));

    // Esc closes.
    const kb = this.scene.input.keyboard;
    if (kb) {
      const onEsc = () => this.closeFull();
      kb.once("keydown-ESC", onEsc);
    }
  }

  private refreshOverlayPlayer(): void {
    if (!this.overlay) return;
    const o = this.overlay as Phaser.GameObjects.Container & {
      __fullScale?: number; __you?: Phaser.GameObjects.Graphics;
    };
    const you = o.__you;
    const fullScale = o.__fullScale;
    if (!you || !fullScale) return;
    const p = this.opts.getPlayer();
    const lx = (p.x - this.opts.mapW / 2) * fullScale;
    const ly = (p.y - this.opts.mapH / 2) * fullScale;
    you.clear();
    you.fillStyle(0x3b82f6, 1);
    you.lineStyle(2, 0xffffff, 1);
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[p.facing];
    const pts = [
      { x: 0, y: -9 }, { x: -7, y: 8 }, { x: 7, y: 8 },
    ].map((q) => ({
      x: lx + q.x * Math.cos(rot) - q.y * Math.sin(rot),
      y: ly + q.x * Math.sin(rot) + q.y * Math.cos(rot),
    }));
    you.fillTriangle(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y, pts[2]!.x, pts[2]!.y);
    you.strokeTriangle(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y, pts[2]!.x, pts[2]!.y);
  }

  private closeFull(): void {
    this.expanded = false;
    this.overlay?.destroy(true);
    this.overlay = null;
  }
}
