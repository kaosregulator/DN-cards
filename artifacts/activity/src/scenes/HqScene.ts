import Phaser from "phaser";
import { getContext } from "../core/context";
import { HqStore } from "../state/hqStore";
import { HqHud } from "../hud/hqHud";
import type { CatalogAsset, HqWorld, LayoutObject } from "../net/api";
import {
  TILE_W, TILE_H, HALF_H, DEPTH, tileToScreen, screenToTile, snapTile, depthFor,
} from "../world/iso";

// The Kenney iso art pack is drawn on a 256-wide grid; the tile's top-face
// diamond centre sits near 0.875 down the 512-tall canvas. Anchoring every
// sprite there makes floors tessellate and props stand correctly on their tile.
const PACK_W = 256;
const ANCHOR_Y = 0.875;

interface WorldObjectView {
  uid: string;
  img: Phaser.GameObjects.Image;
  asset: CatalogAsset;
  wx: number; // current VISUAL tile (npc wander only; never persisted)
  wy: number;
}

export class HqScene extends Phaser.Scene {
  private world!: HqWorld;
  private store!: HqStore;
  private hud!: HqHud;

  private catalogById = new Map<string, CatalogAsset>();
  private floorSpriteById = new Map<string, string>();

  private groundImgs: Phaser.GameObjects.Image[] = [];
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private objectViews = new Map<string, WorldObjectView>();
  private npcs: WorldObjectView[] = [];

  private editing = false;
  private placingAssetId: string | null = null;
  private selectedUid: string | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private selectionRing: Phaser.GameObjects.Graphics | null = null;
  private gridGfx: Phaser.GameObjects.Graphics | null = null;
  private shieldGfx: Phaser.GameObjects.Graphics | null = null;

  // camera drag
  private dragging = false;
  private dragObjUid: string | null = null;
  private lastPtr = { x: 0, y: 0 };
  private movedDuringDrag = false;

  constructor() {
    super("Hq");
  }

  init(data: { world: HqWorld }): void {
    this.world = data.world;
  }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    const ctx = getContext(this);

    for (const a of this.world.catalog) this.catalogById.set(a.id, a);
    for (const f of this.world.floors) this.floorSpriteById.set(f.id, f.sprite);
    this.store = new HqStore(this.world.layout);

    this.cameras.main.setBackgroundColor("#0d1526");

    // Load the textures this world needs: ground, floors in use, and every owned
    // asset (so build-mode placement is instant). ~a few dozen — well within the
    // lazy-load budget vs. the whole pack.
    const keys = new Set<string>([this.world.ground]);
    for (const f of this.world.floors) keys.add(f.sprite);
    for (const a of this.world.catalog) if (a.owned) keys.add(a.sprite);
    await ctx.assets.ensure(this, [...keys]);

    this.buildGround();
    this.rebuildWorld();
    this.buildShield();
    this.buildAmbient();
    this.setupCamera();
    this.setupInput();

    this.hud = new HqHud(this.world, {
      onToggleEdit: (e) => this.setEditing(e),
      onPickAsset: (id) => this.setPlacing(id),
      onRotate: () => this.rotateSelected(),
      onDuplicate: () => this.duplicateSelected(),
      onDelete: () => this.deleteSelected(),
      onUndo: () => this.store.undo(),
      onRedo: () => this.store.redo(),
      onSave: () => void this.save(),
      spriteUrl: (key) => ctx.assets.urlFor(key),
    });

    this.store.onChange(() => {
      this.rebuildWorld();
      this.refreshHudHistory();
    });
    this.refreshHudHistory();

    // NPC idle wander — a subtle step to a neighbouring tile now and then. Only
    // when not editing, so build mode stays predictable.
    this.time.addEvent({
      delay: 2200, loop: true, callback: () => this.wanderNpcs(),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.hud?.destroy());
  }

  // ── texture helpers ───────────────────────────────────────────────────────
  private applyPlacement(
    img: Phaser.GameObjects.Image, footW: number, extraScale = 1, rot: 0 | 1 | 2 | 3 = 0,
  ): void {
    img.setOrigin(0.5, ANCHOR_Y);
    const texW = img.width || PACK_W;
    // 256-wide pack tiles map 1 tile → TILE_W; non-pack sprites fit to ~0.8 tile.
    const base = texW >= 200 ? (TILE_W / PACK_W) : (TILE_W * 0.8) / texW;
    img.setScale(base * footW * extraScale);
    // Rotations flip the sprite horizontally for the two "east-facing" steps —
    // a cheap, readable way to face props along the other iso axis.
    img.setFlipX(rot === 1 || rot === 2);
  }

  private buildGround(): void {
    const N = this.world.worldTiles;
    const key = this.textureOr(this.world.ground, "base/square-grass");
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const p = tileToScreen(x, y);
        const img = this.add.image(p.x, p.y, key);
        this.applyPlacement(img, 1);
        img.setDepth(DEPTH.GROUND + (x + y));
        // Gentle checker so the plot reads as ground, not a flat sheet.
        img.setTint((x + y) % 2 === 0 ? 0xffffff : 0xf0f4e8);
        this.groundImgs.push(img);
      }
    }
  }

  private textureOr(key: string, fallback: string): string {
    if (this.textures.exists(key)) return key;
    if (this.textures.exists(fallback)) return fallback;
    return key; // Phaser draws a green box if missing — visible-but-safe.
  }

  // ── world rebuild (floors + walls + objects) ───────────────────────────────
  private rebuildWorld(): void {
    for (const go of this.dynamic) go.destroy();
    this.dynamic = [];
    this.objectViews.clear();
    this.npcs = [];

    this.renderFloors();
    this.renderRooms();
    this.renderObjects();
    if (this.editing) this.drawGrid();
    this.updateSelectionRing();
  }

  private renderFloors(): void {
    for (const room of this.store.layout.rooms) {
      const key = this.textureOr(
        this.floorSpriteById.get(room.floorId) ?? "base/square-stone", "base/square-stone",
      );
      for (let dy = 0; dy < room.h; dy++) {
        for (let dx = 0; dx < room.w; dx++) {
          const tx = room.x + dx, ty = room.y + dy;
          const p = tileToScreen(tx, ty);
          const img = this.add.image(p.x, p.y, key);
          this.applyPlacement(img, 1);
          img.setDepth(DEPTH.FLOOR + (tx + ty));
          this.dynamic.push(img);
        }
      }
    }
  }

  // Rear walls (the two back edges) per room — reads as an enclosed space
  // without hiding the interior, Sims-style.
  private renderRooms(): void {
    const wallKey = this.textureOr("roomwall/plain", "roomwall/aged");
    if (!this.textures.exists(wallKey)) return;
    for (const room of this.store.layout.rooms) {
      // back-left edge (constant x = room.x), and back-right edge (constant y = room.y)
      for (let dy = 0; dy < room.h; dy++) {
        const tx = room.x, ty = room.y + dy;
        this.addWall(tx, ty, false);
      }
      for (let dx = 0; dx < room.w; dx++) {
        const tx = room.x + dx, ty = room.y;
        this.addWall(tx, ty, true);
      }
    }
  }

  private addWall(tx: number, ty: number, eastFace: boolean): void {
    const key = this.textureOr(eastFace ? "roomwall/plain-e" : "roomwall/plain", "roomwall/plain");
    const p = tileToScreen(tx, ty);
    const img = this.add.image(p.x, p.y, key);
    img.setOrigin(0.5, ANCHOR_Y);
    const texW = img.width || PACK_W;
    img.setScale(TILE_W / PACK_W * (texW >= 200 ? 1 : 1));
    img.setDepth(DEPTH.WALL_BACK + (tx + ty));
    img.setAlpha(0.96);
    this.dynamic.push(img);
  }

  private renderObjects(): void {
    for (const obj of this.store.layout.objects) {
      const view = this.makeObjectView(obj);
      if (view) {
        this.dynamic.push(view.img);
        this.objectViews.set(obj.uid, view);
        if (view.asset.category === "npc") this.npcs.push(view);
      }
    }
  }

  private makeObjectView(obj: LayoutObject): WorldObjectView | null {
    const asset = this.catalogById.get(obj.assetId);
    if (!asset) return null;
    const key = this.textureOr(asset.sprite, "deco/supply-crate");
    const p = tileToScreen(obj.x, obj.y);
    const img = this.add.image(p.x, p.y, key);
    this.applyPlacement(img, Math.max(asset.footprint.w, asset.footprint.h), asset.scale ?? 1, obj.rot);
    img.setDepth(depthFor(obj.x, obj.y, asset.footprint.w, asset.footprint.h));
    img.setData("uid", obj.uid);
    if (this.editing) img.setInteractive({ useHandCursor: true });
    return { uid: obj.uid, img, asset, wx: obj.x, wy: obj.y };
  }

  // ── shield (subtle animated blue perimeter, NOT a dome) ─────────────────────
  private buildShield(): void {
    if (!this.world.shield.active) return;
    const g = this.add.graphics();
    g.setDepth(DEPTH.FX);
    this.shieldGfx = g;
    const N = this.world.worldTiles;
    const inset = 3;
    const corners = [
      tileToScreen(inset, inset),
      tileToScreen(N - inset, inset),
      tileToScreen(N - inset, N - inset),
      tileToScreen(inset, N - inset),
    ];
    const redraw = (t: number) => {
      g.clear();
      const pulse = 0.35 + 0.15 * Math.sin(t / 500);
      g.lineStyle(3, 0x5ec8ff, pulse + 0.25);
      g.beginPath();
      g.moveTo(corners[0].x, corners[0].y - HALF_H);
      for (let i = 1; i <= corners.length; i++) {
        const c = corners[i % corners.length];
        g.lineTo(c.x, c.y - HALF_H);
      }
      g.strokePath();
      g.fillStyle(0x2a9fff, 0.05 + 0.03 * Math.sin(t / 700));
      g.fillPath();
    };
    redraw(0);
    this.time.addEvent({
      delay: 40, loop: true, callback: () => redraw(this.time.now),
    });
  }

  private buildAmbient(): void {
    // A few drifting motes — atmosphere only, no giant background objects.
    const N = this.world.worldTiles;
    for (let i = 0; i < 14; i++) {
      const t = tileToScreen(Phaser.Math.Between(2, N - 2), Phaser.Math.Between(2, N - 2));
      const mote = this.add.circle(t.x, t.y - Phaser.Math.Between(20, 120), Phaser.Math.Between(1, 2), 0xbfe3ff, 0.5);
      mote.setDepth(DEPTH.FX + 1);
      this.tweens.add({
        targets: mote, y: mote.y - Phaser.Math.Between(60, 140), alpha: 0,
        duration: Phaser.Math.Between(4000, 8000), repeat: -1, yoyo: false,
        onRepeat: () => { mote.y = t.y; mote.alpha = 0.5; },
      });
    }
  }

  // ── camera ──────────────────────────────────────────────────────────────────
  private setupCamera(): void {
    const N = this.world.worldTiles;
    const c = tileToScreen(N / 2, N / 2);
    this.cameras.main.centerOn(c.x, c.y);
    this.cameras.main.setZoom(0.62);
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();

    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer, hits: Phaser.GameObjects.GameObject[]) => {
      this.lastPtr = { x: ptr.x, y: ptr.y };
      this.movedDuringDrag = false;

      if (this.placingAssetId) {
        this.placeAtPointer(ptr);
        return;
      }
      const objHit = hits.find((h) => h.getData && h.getData("uid"));
      if (this.editing && objHit) {
        const uid = objHit.getData("uid") as string;
        this.select(uid);
        this.dragObjUid = uid;
        return;
      }
      // empty space → pan (and deselect)
      this.dragging = true;
      if (this.editing && !objHit) this.select(null);
    });

    this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => {
      if (this.placingAssetId) {
        this.updateGhost(ptr);
        return;
      }
      if (!ptr.isDown) return;
      const dx = ptr.x - this.lastPtr.x;
      const dy = ptr.y - this.lastPtr.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.movedDuringDrag = true;

      if (this.dragObjUid) {
        this.dragObjectTo(ptr);
      } else if (this.dragging) {
        const zoom = this.cameras.main.zoom;
        this.cameras.main.scrollX -= dx / zoom;
        this.cameras.main.scrollY -= dy / zoom;
      }
      this.lastPtr = { x: ptr.x, y: ptr.y };
    });

    this.input.on("pointerup", () => {
      this.dragging = false;
      this.dragObjUid = null;
    });

    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const z = Phaser.Math.Clamp(cam.zoom - dy * 0.0011, 0.32, 1.5);
      cam.setZoom(z);
    });

    this.input.keyboard?.on("keydown-R", () => this.rotateSelected());
    this.input.keyboard?.on("keydown-DELETE", () => this.deleteSelected());
    this.input.keyboard?.on("keydown-ESC", () => this.setPlacing(null));
    this.input.keyboard?.on("keydown-Z", (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) (e.shiftKey ? this.store.redo() : this.store.undo());
    });
  }

  private pointerTile(ptr: Phaser.Input.Pointer): { x: number; y: number } {
    const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    // shift up by half a tile so the cursor targets the tile the foot sits on
    return snapTile(screenToTile(wp.x, wp.y - HALF_H));
  }

  // ── editor actions ──────────────────────────────────────────────────────────
  private setEditing(on: boolean): void {
    this.editing = on;
    this.setPlacing(null);
    this.select(null);
    this.rebuildWorld();
    if (!on) this.clearGrid();
  }

  private setPlacing(assetId: string | null): void {
    this.placingAssetId = assetId;
    this.ghost?.destroy();
    this.ghost = null;
    if (assetId) {
      this.select(null);
      const asset = this.catalogById.get(assetId);
      if (asset) {
        const key = this.textureOr(asset.sprite, "deco/supply-crate");
        this.ghost = this.add.image(0, 0, key).setAlpha(0.6).setDepth(DEPTH.UI);
        this.applyPlacement(this.ghost, Math.max(asset.footprint.w, asset.footprint.h), asset.scale ?? 1);
        this.ghost.setTint(0x9fd8ff);
      }
    }
  }

  private updateGhost(ptr: Phaser.Input.Pointer): void {
    if (!this.ghost) return;
    const t = this.pointerTile(ptr);
    const p = tileToScreen(t.x, t.y);
    this.ghost.setPosition(p.x, p.y);
  }

  private placeAtPointer(ptr: Phaser.Input.Pointer): void {
    if (!this.placingAssetId) return;
    const t = this.pointerTile(ptr);
    const N = this.world.worldTiles;
    if (t.x < 0 || t.y < 0 || t.x >= N || t.y >= N) return;
    this.store.addObject(this.placingAssetId, t.x, t.y);
    // stay in placing mode for rapid decorating
  }

  private dragObjectTo(ptr: Phaser.Input.Pointer): void {
    if (!this.dragObjUid) return;
    const t = this.pointerTile(ptr);
    const view = this.objectViews.get(this.dragObjUid);
    if (!view) return;
    // live-move the sprite for responsiveness; commit tile on change
    const p = tileToScreen(t.x, t.y);
    view.img.setPosition(p.x, p.y);
    view.img.setDepth(depthFor(t.x, t.y, view.asset.footprint.w, view.asset.footprint.h));
    this.store.moveObject(this.dragObjUid, t.x, t.y);
    this.updateSelectionRing();
  }

  private select(uid: string | null): void {
    this.selectedUid = uid;
    this.updateSelectionRing();
    this.hud?.setSelection(!!uid);
  }

  private rotateSelected(): void {
    if (this.selectedUid) this.store.rotateObject(this.selectedUid);
  }

  private duplicateSelected(): void {
    if (!this.selectedUid) return;
    const copy = this.store.duplicateObject(this.selectedUid);
    if (copy) this.select(copy.uid);
  }

  private deleteSelected(): void {
    if (!this.selectedUid) return;
    const uid = this.selectedUid;
    this.select(null);
    this.store.deleteObject(uid);
  }

  private updateSelectionRing(): void {
    this.selectionRing?.destroy();
    this.selectionRing = null;
    if (!this.selectedUid) return;
    const obj = this.store.layout.objects.find((o) => o.uid === this.selectedUid);
    if (!obj) return;
    const g = this.add.graphics().setDepth(DEPTH.UI - 1);
    const p = tileToScreen(obj.x, obj.y);
    g.lineStyle(2.5, 0x66ddff, 0.95);
    this.strokeIsoTile(g, p.x, p.y);
    this.selectionRing = g;
  }

  private strokeIsoTile(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    g.beginPath();
    g.moveTo(cx, cy - HALF_H);
    g.lineTo(cx + TILE_W / 2, cy);
    g.lineTo(cx, cy + HALF_H);
    g.lineTo(cx - TILE_W / 2, cy);
    g.closePath();
    g.strokePath();
  }

  private drawGrid(): void {
    this.clearGrid();
    const N = this.world.worldTiles;
    const g = this.add.graphics().setDepth(DEPTH.FLOOR + N * 2);
    g.lineStyle(1, 0x35507a, 0.35);
    for (let x = 0; x <= N; x++) {
      const a = tileToScreen(x, 0), b = tileToScreen(x, N);
      g.lineBetween(a.x, a.y - HALF_H, b.x, b.y - HALF_H);
    }
    for (let y = 0; y <= N; y++) {
      const a = tileToScreen(0, y), b = tileToScreen(N, y);
      g.lineBetween(a.x, a.y - HALF_H, b.x, b.y - HALF_H);
    }
    this.gridGfx = g;
    this.dynamic.push(g);
  }

  private clearGrid(): void {
    this.gridGfx?.destroy();
    this.gridGfx = null;
  }

  private refreshHudHistory(): void {
    this.hud?.setHistory(this.store.canUndo, this.store.canRedo, this.store.dirty);
  }

  private async save(): Promise<void> {
    try {
      const res = await getContext(this).api.saveLayout(this.store.layout);
      this.store.acceptSaved(res.layout);
      this.hud.flashSave("✓ Saved", true);
    } catch {
      this.hud.flashSave("✗ Failed", false);
    }
  }

  private wanderNpcs(): void {
    if (this.editing || this.npcs.length === 0) return;
    for (const npc of this.npcs) {
      if (Math.random() > 0.5) continue;
      const N = this.world.worldTiles;
      const nx = Phaser.Math.Clamp(npc.wx + Phaser.Math.Between(-1, 1), 1, N - 2);
      const ny = Phaser.Math.Clamp(npc.wy + Phaser.Math.Between(-1, 1), 1, N - 2);
      const p = tileToScreen(nx, ny);
      npc.img.setFlipX(nx < npc.wx);
      npc.wx = nx; npc.wy = ny;
      this.tweens.add({
        targets: npc.img, x: p.x, y: p.y, duration: 900, ease: "Sine.InOut",
        onComplete: () => npc.img.setDepth(depthFor(nx, ny)),
      });
    }
  }

  update(_time: number, _delta: number): void {
    // per-frame hook reserved; animation is tween/timer driven
  }
}
