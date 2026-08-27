// ─────────────────────────────────────────────────────────────────────────────
// WorldBuilder — F9 in-world editor controller attached to WorldScene.
// Overlays saved world data onto the live Tiled/HM map without replacing it.
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";
import { getContext } from "../../core/context";
import { registerCustomMaps } from "../worldMaps";
import { BuilderUi } from "./ui/BuilderUi";
import { mountMapManager, renderDoorProps, renderSpawnProps } from "./ui/MapManagerUi";
import { EditHistory } from "./history";
import {
  emptyWorldDoc,
  docTilesetFromAsset,
  nextFirstGid,
  paintGidFromDocTilesets,
  type CreateMapRequest,
  type CustomMapMeta,
  type EditorTool,
  type WorldAssetCategory,
  type WorldAssetEntry,
  type WorldAssetPack,
  type WorldDocTileset,
  type WorldDoor,
  type WorldEditDocument,
  type WorldObject,
  type WorldSpawn,
} from "./types";

export interface WorldBuilderHost {
  scene: Phaser.Scene;
  mapKey: string;
  mapName?: string;
  tileW: number;
  getPlayerPos: () => { x: number; y: number };
  setPlayerPos: (x: number, y: number) => void;
  getCollisionLayer: () => Phaser.Tilemaps.TilemapLayer | null;
  getVisualLayers: () => Phaser.Tilemaps.TilemapLayer[];
  getTilemap: () => Phaser.Tilemaps.Tilemap | null;
  /** Prefer a Floor / ground layer for paint. */
  getPaintLayer: () => Phaser.Tilemaps.TilemapLayer | null;
  setEditing: (on: boolean) => void;
  hideGameHud: (hide: boolean) => void;
  goToMap: (to: string, spawnAt?: { tx: number; ty: number }) => void;
  setRuntimeOverlay: (doors: WorldDoor[], spawns: WorldSpawn[]) => void;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Map a map key to the built-in source pack the palette should default to. */
function mapSourceId(mapKey: string): string {
  if (mapKey === "world") return "world";
  if (mapKey === "village") return "village";
  if (mapKey === "card-shop" || mapKey === "duel-hall" || mapKey === "cave") return "other-worlds";
  if (mapKey.startsWith("hm-")) return "jacks-world";
  return "all"; // custom / blank maps — show every source
}

function resolveAssetUrl(rel: string, apiBase: string): string {
  if (!rel) return "";
  if (rel.startsWith("http")) return rel;
  if (rel.startsWith("/activity/")) return `${apiBase}${rel}`;
  return `${import.meta.env.BASE_URL}${rel.replace(/^\//, "")}`;
}

export class WorldBuilder {
  private host: WorldBuilderHost;
  private enabled = false;
  private canEdit = false;
  private ui: BuilderUi | null = null;
  private doc: WorldEditDocument;
  private history = new EditHistory();
  private tool: EditorTool = "select";
  private asset: WorldAssetEntry | null = null;
  private packs: WorldAssetPack[] = [];
  private assets: WorldAssetEntry[] = [];
  private selectedUid: string | null = null;
  private sprites = new Map<string, Phaser.GameObjects.GameObject>();
  private selectionGfx: Phaser.GameObjects.Rectangle | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private paintGid = 1;
  private paintLayerName = "Floor";
  private dirty = false;
  private pointerDown = false;
  private apiBase = "/api";
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private localKey = "";
  private mapList: CustomMapMeta[] = [];
  private mapManager: ReturnType<typeof mountMapManager> | null = null;
  private selectedDoorUid: string | null = null;
  private selectedSpawnUid: string | null = null;

  constructor(host: WorldBuilderHost) {
    this.host = host;
    this.doc = emptyWorldDoc(host.mapKey);
    this.localKey = `dn.worldBuilder.${host.mapKey}`;
    try {
      const ctx = getContext(host.scene);
      this.apiBase = ctx.api.assetBase();
    } catch {
      this.apiBase = "/api";
    }
  }

  async boot(): Promise<void> {
    await this.refreshPermissions();
    await this.loadDoc();
    // Catalog needed so saved objects resolve to real textures for all players.
    await this.loadCatalog();
    await this.refreshMapList();
    // Register imported tile-sheets onto the live map BEFORE painting tiles, so
    // saved paint (blank maps included) renders real artwork for everyone, not
    // the blank stamp. Sync applyDocToWorld can then putTileAt against them.
    await this.ensureDocTilesetsRegistered();
    this.applyDocToWorld();
    this.host.setRuntimeOverlay(this.doc.doors, this.doc.spawns);
    this.bindHotkeys();
  }

  destroy(): void {
    this.exitEditor(false);
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    this.clearSprites();
    this.selectionGfx?.destroy();
    this.ghost?.destroy();
  }

  isEditing(): boolean {
    return this.enabled;
  }

  private bindHotkeys(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "F9") {
        e.preventDefault();
        void this.toggle();
        return;
      }
      if (!this.enabled) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        this.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          this.deleteSelected();
        }
      } else if (e.key.toLowerCase() === "v") this.setTool("select");
      else if (e.key.toLowerCase() === "b") this.setTool("paint");
      else if (e.key.toLowerCase() === "p") this.setTool("place");
      else if (e.key.toLowerCase() === "x") this.setTool("erase");
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  private async refreshPermissions(): Promise<void> {
    try {
      const ctx = getContext(this.host.scene);
      const st = await ctx.api.worldBuilderStatus();
      this.canEdit = !!st.canEdit;
    } catch {
      // Offline / no API — allow local-only editing in demo URLs.
      this.canEdit = typeof location !== "undefined" && /(?:\?|&)demo\b/.test(location.search);
    }
  }

  private async loadDoc(): Promise<void> {
    try {
      const ctx = getContext(this.host.scene);
      const { doc } = await ctx.api.worldBuilderLoadMap(this.host.mapKey);
      this.doc = doc;
      try { localStorage.setItem(this.localKey, JSON.stringify(doc)); } catch { /* */ }
    } catch {
      try {
        const raw = localStorage.getItem(this.localKey);
        this.doc = raw ? JSON.parse(raw) as WorldEditDocument : emptyWorldDoc(this.host.mapKey);
      } catch {
        this.doc = emptyWorldDoc(this.host.mapKey);
      }
    }
    this.history.reset(this.doc);
  }

  async toggle(): Promise<void> {
    if (this.enabled) {
      this.exitEditor(true);
      return;
    }
    await this.refreshPermissions();
    if (!this.canEdit) {
      this.toast("World Builder is admin-only.");
      return;
    }
    await this.enterEditor();
  }

  private async enterEditor(): Promise<void> {
    this.enabled = true;
    this.host.setEditing(true);
    this.host.hideGameHud(true);
    this.ui = new BuilderUi({
      onTool: (t) => this.setTool(t),
      onCategory: (_c: WorldAssetCategory | "all") => { /* filtered in UI */ },
      onSelectAsset: (a) => void this.selectAsset(a),
      onSave: () => { void this.save(); },
      onExit: () => this.exitEditor(true),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onOpenAssetManager: () => { /* panel opens in UI */ },
      onOpenMapManager: () => {
        void this.refreshMapList().then(() => this.mapManager?.open(true));
      },
      onPropertyChange: (uid, patch) => this.patchObject(uid, patch),
      onDeleteSelected: () => this.deleteSelected(),
      onDuplicateSelected: () => this.duplicateSelected(),
      onImportZip: (f) => this.importZip(f),
      onImportFolder: (files) => this.importFolder(files),
      onDeletePack: (id) => this.deletePack(id),
      onRefreshCatalog: () => this.loadCatalog(),
      resolveUrl: (u) => resolveAssetUrl(u, this.apiBase),
    });
    await this.loadCatalog();
    await this.refreshMapList();
    this.mapManager = mountMapManager(this.ui.root, {
      currentKey: this.host.mapKey,
      maps: this.mapList,
      cb: {
        onRefreshMaps: () => this.refreshMapList(),
        onOpenMap: (key) => { void this.openMap(key); },
        onCreateMap: (req) => this.createMap(req),
        onRenameMap: (key, name) => this.renameMap(key, name),
        onDuplicateMap: (key) => this.duplicateMap(key),
        onDeleteMap: (key) => this.deleteMap(key),
      },
    });
    this.ui.setStatus(`Editing: ${this.host.mapName ?? this.host.mapKey} · ${this.ui.describeDoc(this.doc)}`);
    this.ui.setHint("Build mode — Maps · paint / place · Ctrl+S save · F9 Playtest");
    this.bindPointer();
    this.ensureSelectionGfx();
  }

  private exitEditor(playtest: boolean): void {
    if (!this.enabled && !this.ui) return;
    this.enabled = false;
    this.host.setEditing(false);
    this.host.hideGameHud(false);
    this.unbindPointer();
    this.ghost?.destroy();
    this.ghost = null;
    this.selectionGfx?.setVisible(false);
    this.mapManager = null;
    this.ui?.destroy();
    this.ui = null;
    this.host.setRuntimeOverlay(this.doc.doors, this.doc.spawns);
    if (playtest) this.toast(this.dirty ? "Playtest — unsaved changes still in memory" : "Playtest mode");
  }

  private async refreshMapList(): Promise<void> {
    try {
      const ctx = getContext(this.host.scene);
      const { maps } = await ctx.api.worldBuilderListMaps();
      this.mapList = maps;
      registerCustomMaps(maps.filter((m) => m.blank || m.source === "custom"));
      this.mapManager?.setMaps(maps, this.host.mapKey);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[WorldBuilder] map list", err);
    }
  }

  private async openMap(key: string): Promise<void> {
    if (key === this.host.mapKey) return;
    if (this.dirty) {
      try { await this.save(); } catch { /* still switch */ }
    }
    this.mapManager?.open(false);
    this.exitEditor(false);
    this.host.goToMap(key);
  }

  private async createMap(req: CreateMapRequest): Promise<void> {
    try {
      const ctx = getContext(this.host.scene);
      const { meta } = await ctx.api.worldBuilderCreateMap(req);
      registerCustomMaps([meta]);
      this.toast(`Created ${meta.name}`);
      if (this.dirty) await this.save().catch(() => undefined);
      this.mapManager?.open(false);
      this.exitEditor(false);
      this.host.goToMap(meta.key);
    } catch (err) {
      this.toast("Create map failed");
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }

  private async renameMap(key: string, name: string): Promise<void> {
    try {
      await getContext(this.host.scene).api.worldBuilderRenameMap(key, name);
      await this.refreshMapList();
      this.toast("Renamed");
    } catch {
      this.toast("Rename failed");
    }
  }

  private async duplicateMap(key: string): Promise<void> {
    try {
      const { meta } = await getContext(this.host.scene).api.worldBuilderDuplicateMap(key);
      registerCustomMaps([meta]);
      await this.refreshMapList();
      this.toast(`Duplicated → ${meta.name}`);
    } catch {
      this.toast("Duplicate failed");
    }
  }

  private async deleteMap(key: string): Promise<void> {
    try {
      await getContext(this.host.scene).api.worldBuilderDeleteMap(key);
      await this.refreshMapList();
      this.toast("Map deleted");
    } catch {
      this.toast("Delete failed (shipped maps cannot be deleted)");
    }
  }

  private async loadCatalog(): Promise<void> {
    try {
      const ctx = getContext(this.host.scene);
      const cat = await ctx.api.worldBuilderCatalog();
      this.packs = cat.packs;
      this.assets = cat.assets;
      this.ui?.setCatalog(this.packs, this.assets);
      // Focus the palette on the source that matches the map being edited.
      this.ui?.setActiveSource(mapSourceId(this.host.mapKey));
    } catch (err) {
      this.ui?.setStatus("Catalog unavailable — using local tools only");
      // eslint-disable-next-line no-console
      console.warn("[WorldBuilder] catalog", err);
      this.assets = [
        { id: "builtin/tool/collision", name: "Collision Block", category: "collision", url: "", packId: "builtin", kind: "collision" },
        { id: "builtin/tool/spawn-player", name: "Player Spawn", category: "spawns", url: "", packId: "builtin", kind: "spawn" },
        { id: "builtin/tool/zone-interaction", name: "Interaction Zone", category: "zones", url: "", packId: "builtin", kind: "zone" },
      ];
      this.packs = [{ id: "builtin", name: "Local Tools", source: "builtin", assetCount: 3, categories: ["collision", "spawns", "zones"] }];
      this.ui?.setCatalog(this.packs, this.assets);
    }
  }

  private setTool(tool: EditorTool): void {
    this.tool = tool;
    this.ui?.setTool(tool);
    if (tool === "select") this.ui?.setHint("Select — click objects · drag to move · Delete to remove");
    if (tool === "paint") this.ui?.setHint("Paint — click/drag tiles on the floor layer");
    if (tool === "place") this.ui?.setHint("Place — click to drop the selected asset");
    if (tool === "erase") this.ui?.setHint("Erase — click objects or painted tiles");
    if (tool === "collision") this.ui?.setHint("Collision — click tiles to toggle solid");
    if (tool === "zone") this.ui?.setHint("Zone — click to place a 2×2 interaction zone");
    if (tool === "spawn") this.ui?.setHint("Spawn — click to set a player spawn point");
  }

  private async selectAsset(asset: WorldAssetEntry | null): Promise<void> {
    this.asset = asset;
    this.ui?.setSelectedAsset(asset?.id ?? null);
    if (asset?.tile) {
      // Imported sheets aren't part of a blank map's tilesets, so register the
      // sheet on the live map first; then paintGid maps to real artwork.
      if (asset.tile.sheet || (asset.tile.count ?? 0) > 1) {
        this.ui?.setHint("Loading tileset…");
        await this.ensureTileset(asset);
      }
      // Use localId as a relative stamp; firstgid comes from the registered sheet.
      this.paintGid = this.resolvePaintGid(asset);
    }
  }

  private resolvePaintGid(asset: WorldAssetEntry): number {
    // Prefer the doc's persisted tileset table (stable across reload/playtest).
    const fromDoc = paintGidFromDocTilesets(this.doc.tilesets, asset);
    if (fromDoc != null) return fromDoc;
    const map = this.host.getTilemap();
    const name = asset.tile?.tileset;
    if (map && name) {
      const ts = map.tilesets.find((t) => t.name === name || t.name.includes(name) || name.includes(t.name));
      if (ts) return ts.firstgid + (asset.tile?.localId ?? 0);
    }
    // Fallback: sample an existing floor tile near the player so paint stays in-family.
    const layer = this.host.getPaintLayer();
    const pos = this.host.getPlayerPos();
    const tw = this.host.tileW;
    const sample = layer?.getTileAt(Math.floor(pos.x / tw), Math.floor(pos.y / tw));
    if (sample && sample.index > 0) return sample.index;
    return 1;
  }

  // ── Imported tile-sheets → live Phaser tilesets ────────────────────────────
  // A blank map ships only the 1×1 `wb-blank` stamp. To paint imported 48×48 MV
  // (or 16/32 LimeZu) tiles as real artwork we must: (1) load the sheet image,
  // (2) addTilesetImage it onto the map at a stable firstgid, (3) bind it to the
  // paint layer so gids in its range render. The record is stored in the doc so
  // the same sheet re-registers at the same firstgid after reload / playtest.

  private async ensureTileset(asset: WorldAssetEntry): Promise<WorldDocTileset | null> {
    const map = this.host.getTilemap();
    if (!map || !asset.tile) return null;
    if (!this.doc.tilesets) this.doc.tilesets = [];
    let rec = this.doc.tilesets.find((x) => x.name === asset.tile!.tileset);
    if (!rec) {
      const mapMaxGid = map.tilesets.reduce(
        (m, ts) => Math.max(m, ts.firstgid + ts.total - 1), 1,
      );
      const firstgid = nextFirstGid(this.doc.tilesets, mapMaxGid);
      const built = docTilesetFromAsset(asset, firstgid);
      if (!built) return null;
      this.doc.tilesets.push(built);
      this.dirty = true;
      rec = built;
    }
    await this.registerTileset(rec);
    return rec;
  }

  private async ensureDocTilesetsRegistered(): Promise<void> {
    for (const rec of this.doc.tilesets ?? []) {
      await this.registerTileset(rec);
    }
  }

  private async registerTileset(rec: WorldDocTileset): Promise<void> {
    const scene = this.host.scene;
    const map = this.host.getTilemap();
    if (!map) return;
    const texKey = `wbts:${rec.name}`;
    if (!scene.textures.exists(texKey)) {
      const url = resolveAssetUrl(rec.image, this.apiBase);
      if (!url) return;
      await new Promise<void>((resolve) => {
        scene.load.image(texKey, url);
        scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => resolve());
        scene.load.start();
      });
    }
    if (!scene.textures.exists(texKey)) return; // load failed — paint falls back
    let ts = map.tilesets.find((x) => x.name === rec.name);
    if (!ts) {
      ts = map.addTilesetImage(
        rec.name, texKey, rec.tileWidth, rec.tileHeight, 0, 0, rec.firstgid,
      ) ?? undefined;
    }
    if (!ts) return;
    // A layer only renders gids from tilesets bound to it; blank maps bind only
    // `wb-blank` at creation, so add ours to every visual + collision layer.
    const layers = [
      this.host.getPaintLayer(),
      ...this.host.getVisualLayers(),
      this.host.getCollisionLayer(),
    ];
    for (const layer of layers) {
      if (layer && !layer.tileset.includes(ts)) layer.tileset.push(ts);
    }
  }

  private commit(next: WorldEditDocument): void {
    this.doc = next;
    this.dirty = true;
    this.history.push(next);
    this.applyDocToWorld();
    this.host.setRuntimeOverlay(this.doc.doors, this.doc.spawns);
    this.ui?.setStatus(`Editing: ${this.host.mapName ?? this.host.mapKey} · ${this.ui.describeDoc(next)} · unsaved`);
  }

  private mutate(fn: (draft: WorldEditDocument) => void): void {
    const draft = structuredClone(this.doc) as WorldEditDocument;
    fn(draft);
    this.commit(draft);
  }

  private undo(): void {
    const prev = this.history.undo(this.doc);
    if (!prev) return;
    this.doc = prev;
    this.dirty = true;
    this.applyDocToWorld();
    this.ui?.setStatus("Undo");
  }

  private redo(): void {
    const next = this.history.redo(this.doc);
    if (!next) return;
    this.doc = next;
    this.dirty = true;
    this.applyDocToWorld();
    this.ui?.setStatus("Redo");
  }

  private async save(): Promise<void> {
    this.ui?.setStatus("Saving…");
    try {
      const ctx = getContext(this.host.scene);
      const { doc } = await ctx.api.worldBuilderSaveMap(this.host.mapKey, this.doc);
      this.doc = doc;
      this.dirty = false;
      this.history.reset(doc);
      try { localStorage.setItem(this.localKey, JSON.stringify(doc)); } catch { /* */ }
      this.ui?.setStatus(`Saved · rev ${doc.revision}`);
      this.toast("World saved");
    } catch (err) {
      try { localStorage.setItem(this.localKey, JSON.stringify(this.doc)); } catch { /* */ }
      this.dirty = false;
      this.ui?.setStatus("Saved locally (API unavailable)");
      this.toast("Saved to local storage");
      // eslint-disable-next-line no-console
      console.warn("[WorldBuilder] save fallback", err);
    }
  }

  private toast(msg: string): void {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = "position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:60;background:#121a30ee;border:1px solid #3a4d80;color:#e8eefc;padding:8px 14px;border-radius:999px;font:600 12px system-ui";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  // ── Apply overlay to live world ─────────────────────────────────────────────

  private clearSprites(): void {
    for (const g of this.sprites.values()) g.destroy();
    this.sprites.clear();
  }

  applyDocToWorld(): void {
    const scene = this.host.scene;
    const map = this.host.getTilemap();
    const paint = this.host.getPaintLayer();
    const collide = this.host.getCollisionLayer();

    // Tile patches
    if (map && paint) {
      for (const t of this.doc.tiles) {
        const layer =
          this.host.getVisualLayers().find((l) => l.layer.name === t.layer) ??
          (t.layer.toLowerCase().includes("coll") ? collide : paint);
        if (!layer) continue;
        if (t.gid <= 0) layer.removeTileAt(t.x, t.y);
        else layer.putTileAt(t.gid, t.x, t.y);
      }
    }

    // Collision toggles
    if (collide) {
      for (const c of this.doc.collision) {
        if (c.solid) {
          const existing = collide.getTileAt(c.x, c.y);
          if (!existing || existing.index < 0) collide.putTileAt(1, c.x, c.y);
        } else {
          collide.removeTileAt(c.x, c.y);
        }
      }
      collide.setCollisionByExclusion([-1], true);
    }

    this.clearSprites();

    // Objects
    for (const obj of this.doc.objects) {
      void this.spawnObjectSprite(obj);
    }

    // Spawns / zones / doors as markers
    for (const s of this.doc.spawns) {
      const g = scene.add.circle(s.x, s.y, 10, 0x38bdf8, 0.35).setDepth(920);
      g.setStrokeStyle(2, 0x38bdf8, 0.95);
      const label = scene.add.text(s.x, s.y - 16, s.name || "SPAWN", {
        fontSize: "10px", color: "#9cdcfe", backgroundColor: "#0b1220cc", padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(921);
      this.sprites.set(s.uid, g);
      this.sprites.set(`${s.uid}:l`, label);
    }
    for (const z of this.doc.zones) {
      const r = scene.add.rectangle(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, 0xfbbf24, 0.18)
        .setDepth(910).setStrokeStyle(2, 0xfbbf24, 0.8);
      this.sprites.set(z.uid, r);
    }
    for (const d of this.doc.doors) {
      const g = scene.add.rectangle(d.x, d.y, this.host.tileW, this.host.tileW, 0xa78bfa, 0.25)
        .setDepth(915).setStrokeStyle(2, 0xa78bfa, 0.9);
      const label = scene.add.text(d.x, d.y - this.host.tileW * 0.7,
        d.targetMap ? `→ ${d.targetMap}` : (d.label || "DOOR"), {
          fontSize: "10px", color: "#e9d5ff", backgroundColor: "#1a1028cc", padding: { x: 4, y: 2 },
        }).setOrigin(0.5).setDepth(916);
      this.sprites.set(d.uid, g);
      this.sprites.set(`${d.uid}:l`, label);
    }

    if (this.selectedUid) this.highlight(this.selectedUid);
  }

  private async spawnObjectSprite(obj: WorldObject): Promise<void> {
    const scene = this.host.scene;
    const entry = this.assets.find((a) => a.id === obj.assetId);
    const url = entry ? resolveAssetUrl(entry.url || entry.thumb || "", this.apiBase) : "";
    const texKey = `wb:${obj.assetId}`;

    const makeFallback = (): void => {
      const color =
        obj.kind === "npc" || obj.kind === "enemy" ? 0xf87171 :
        obj.kind === "building" ? 0x60a5fa :
        obj.kind === "door" ? 0xc084fc : 0x34d399;
      const r = scene.add.rectangle(obj.x, obj.y, this.host.tileW, this.host.tileW, color, 0.55)
        .setDepth(obj.depth ?? 450)
        .setAngle(obj.rotation ?? 0);
      this.sprites.set(obj.uid, r);
    };

    if (!url) {
      makeFallback();
      return;
    }

    if (!scene.textures.exists(texKey)) {
      await new Promise<void>((resolve) => {
        scene.load.image(texKey, url);
        scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => resolve());
        scene.load.start();
      });
    }
    if (!scene.textures.exists(texKey)) {
      makeFallback();
      return;
    }
    const img = scene.add.image(obj.x, obj.y, texKey)
      .setDepth(obj.depth ?? 450)
      .setAngle(obj.rotation ?? 0)
      .setScale(obj.scale ?? 1);
    // Keep large buildings readable but not gigantic on first place.
    if ((obj.scale ?? 1) === 1 && img.width > this.host.tileW * 8) {
      img.setScale((this.host.tileW * 6) / img.width);
    }
    this.sprites.set(obj.uid, img);
  }

  private ensureSelectionGfx(): void {
    if (this.selectionGfx) return;
    this.selectionGfx = this.host.scene.add.rectangle(0, 0, 20, 20)
      .setStrokeStyle(2, 0x7dd3fc, 1)
      .setFillStyle(0x7dd3fc, 0.08)
      .setDepth(5000)
      .setVisible(false);
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  private onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled || !pointer.leftButtonDown()) return;
    // Ignore clicks on DOM UI.
    if ((pointer.event?.target as HTMLElement | undefined)?.closest?.(".wb-root")) return;
    this.pointerDown = true;
    this.handlePointer(pointer, true);
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return;
    if (this.pointerDown && (this.tool === "paint" || this.tool === "collision" || this.tool === "erase")) {
      this.handlePointer(pointer, false);
    }
    if (this.pointerDown && this.tool === "select" && this.selectedUid) {
      const wp = this.host.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (this.selectedDoorUid) {
        this.mutateDoorPos(this.selectedDoorUid, wp.x, wp.y, false);
      } else if (this.selectedSpawnUid) {
        this.mutateSpawnPos(this.selectedSpawnUid, wp.x, wp.y, false);
      } else {
        this.patchObject(this.selectedUid, { x: wp.x, y: wp.y }, false);
      }
    }
  };

  private onPointerUp = (): void => {
    if (this.pointerDown && this.tool === "select" && this.selectedUid) {
      // Commit drag as one history entry
      this.history.push(this.doc);
    }
    this.pointerDown = false;
  };

  private bindPointer(): void {
    const input = this.host.scene.input;
    input.on("pointerdown", this.onPointerDown);
    input.on("pointermove", this.onPointerMove);
    input.on("pointerup", this.onPointerUp);
  }

  private unbindPointer(): void {
    const input = this.host.scene.input;
    input.off("pointerdown", this.onPointerDown);
    input.off("pointermove", this.onPointerMove);
    input.off("pointerup", this.onPointerUp);
  }

  private handlePointer(pointer: Phaser.Input.Pointer, isDown: boolean): void {
    const wp = this.host.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tw = this.host.tileW;
    const tx = Math.floor(wp.x / tw);
    const ty = Math.floor(wp.y / tw);

    if (this.tool === "select") {
      const hit = this.hitTest(wp.x, wp.y);
      this.highlight(hit);
      return;
    }

    if (this.tool === "paint") {
      const layer = this.host.getPaintLayer();
      if (!layer) { this.ui?.setStatus("No paint layer on this map"); return; }
      const gid = this.paintGid;
      this.mutate((d) => {
        d.tiles = d.tiles.filter((t) => !(t.x === tx && t.y === ty && t.layer === (layer.layer.name || this.paintLayerName)));
        d.tiles.push({ layer: layer.layer.name || this.paintLayerName, x: tx, y: ty, gid });
      });
      return;
    }

    if (this.tool === "collision") {
      this.mutate((d) => {
        d.collision = d.collision.filter((c) => !(c.x === tx && c.y === ty));
        d.collision.push({ x: tx, y: ty, solid: true });
      });
      return;
    }

    if (this.tool === "erase") {
      const hit = this.hitTest(wp.x, wp.y);
      if (hit) {
        this.mutate((d) => {
          d.objects = d.objects.filter((o) => o.uid !== hit);
          d.spawns = d.spawns.filter((s) => s.uid !== hit);
          d.zones = d.zones.filter((z) => z.uid !== hit);
          d.doors = d.doors.filter((door) => door.uid !== hit);
        });
        this.highlight(null);
      } else {
        this.mutate((d) => {
          d.tiles = d.tiles.filter((t) => !(t.x === tx && t.y === ty));
          d.collision = d.collision.filter((c) => !(c.x === tx && c.y === ty));
        });
      }
      return;
    }

    if (this.tool === "spawn" && isDown) {
      const name = prompt("Spawn name", "Entrance") || "Entrance";
      this.mutate((d) => {
        const isFirst = d.spawns.length === 0;
        d.spawns.push({
          uid: uid("spawn"),
          name,
          kind: "player",
          x: tx * tw + tw / 2,
          y: ty * tw + tw / 2,
          facing: "down",
          isDefault: isFirst,
        });
      });
      return;
    }

    if (this.tool === "zone" && isDown) {
      this.mutate((d) => {
        d.zones.push({
          uid: uid("zone"),
          name: "Interaction",
          kind: "interaction",
          x: tx * tw,
          y: ty * tw,
          w: tw * 2,
          h: tw * 2,
        });
      });
      return;
    }

    if (this.tool === "place" && isDown) {
      if (!this.asset) { this.ui?.setStatus("Pick an asset first"); return; }
      if (this.asset.kind === "collision") {
        this.setTool("collision");
        return;
      }
      if (this.asset.kind === "spawn") {
        this.setTool("spawn");
        return;
      }
      if (this.asset.kind === "zone") {
        this.setTool("zone");
        return;
      }
      if (this.asset.kind === "door") {
        const doorUid = uid("door");
        this.mutate((d) => {
          d.doors.push({
            uid: doorUid,
            x: tx * tw + tw / 2,
            y: ty * tw + tw / 2,
            label: this.asset!.name,
            transition: "fade",
            locked: false,
          });
          d.objects.push({
            uid: uid("obj"),
            kind: "door",
            assetId: this.asset!.id,
            x: tx * tw + tw / 2,
            y: ty * tw + tw / 2,
            depth: 450,
            properties: { name: this.asset!.name, doorUid },
          });
        });
        this.highlightDoor(doorUid);
        return;
      }

      const kind = this.asset.kind;
      const obj: WorldObject = {
        uid: uid("obj"),
        kind,
        assetId: this.asset.id,
        x: wp.x,
        y: wp.y,
        rotation: 0,
        scale: 1,
        depth: kind === "building" ? 400 : 450,
        collide: kind === "building" || kind === "prop",
        floor: this.doc.metadata.defaultFloor ?? 0,
        spaceKind: "exterior",
        properties: kind === "npc" || kind === "enemy"
          ? {
              name: this.asset.name,
              characterType: kind,
              facing: "down",
              behavior: "stand",
              dialogue: kind === "npc" ? ["Hello, traveler."] : [],
              collision: true,
            }
          : { name: this.asset.name },
      };
      this.mutate((d) => { d.objects.push(obj); });
      this.highlight(obj.uid);
    }
  }

  private hitTest(x: number, y: number): string | null {
    // Prefer top-most object by depth.
    const objs = [...this.doc.objects].sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
    for (const o of objs) {
      const go = this.sprites.get(o.uid) as Phaser.GameObjects.Image | undefined;
      if (go && "getBounds" in go) {
        const b = go.getBounds();
        if (b.contains(x, y)) return o.uid;
      } else if (Math.hypot(o.x - x, o.y - y) < this.host.tileW) {
        return o.uid;
      }
    }
    for (const d of this.doc.doors) {
      if (Math.hypot(d.x - x, d.y - y) < this.host.tileW) return d.uid;
    }
    for (const s of this.doc.spawns) {
      if (Math.hypot(s.x - x, s.y - y) < this.host.tileW) return s.uid;
    }
    for (const z of this.doc.zones) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.uid;
    }
    return null;
  }

  private highlight(uid: string | null): void {
    this.selectedUid = uid;
    this.selectedDoorUid = null;
    this.selectedSpawnUid = null;
    this.ensureSelectionGfx();
    if (!uid || !this.selectionGfx) {
      this.selectionGfx?.setVisible(false);
      this.ui?.showProperties(null);
      return;
    }
    const door = this.doc.doors.find((d) => d.uid === uid);
    if (door) {
      this.highlightDoor(uid);
      return;
    }
    const spawn = this.doc.spawns.find((s) => s.uid === uid);
    if (spawn) {
      this.highlightSpawn(uid);
      return;
    }
    const obj = this.doc.objects.find((o) => o.uid === uid);
    const go = this.sprites.get(uid) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.GetBounds | undefined;
    if (obj) this.ui?.showProperties(obj);
    if (go && "getBounds" in go) {
      const b = (go as Phaser.GameObjects.Image).getBounds();
      this.selectionGfx.setPosition(b.centerX, b.centerY).setSize(b.width + 8, b.height + 8).setVisible(true);
    } else if (obj) {
      this.selectionGfx.setPosition(obj.x, obj.y).setSize(this.host.tileW + 8, this.host.tileW + 8).setVisible(true);
    }
  }

  private highlightDoor(uid: string): void {
    this.selectedDoorUid = uid;
    this.selectedUid = uid;
    this.selectedSpawnUid = null;
    this.ensureSelectionGfx();
    const door = this.doc.doors.find((d) => d.uid === uid);
    if (!door || !this.selectionGfx) return;
    this.selectionGfx.setPosition(door.x, door.y).setSize(this.host.tileW + 8, this.host.tileW + 8).setVisible(true);
    void this.showDoorProperties(door);
  }

  private highlightSpawn(uid: string): void {
    this.selectedSpawnUid = uid;
    this.selectedUid = uid;
    this.selectedDoorUid = null;
    this.ensureSelectionGfx();
    const spawn = this.doc.spawns.find((s) => s.uid === uid);
    if (!spawn || !this.selectionGfx) return;
    this.selectionGfx.setPosition(spawn.x, spawn.y).setSize(this.host.tileW + 8, this.host.tileW + 8).setVisible(true);
    const body = this.ui?.root.querySelector("[data-props-body]") as HTMLElement | null;
    const props = this.ui?.root.querySelector("[data-props]") as HTMLElement | null;
    if (body && props) {
      props.classList.add("open");
      renderSpawnProps(body, spawn, (patch) => {
        this.mutate((d) => {
          const i = d.spawns.findIndex((s) => s.uid === uid);
          if (i < 0) return;
          if (patch.isDefault) {
            for (const s of d.spawns) s.isDefault = false;
          }
          d.spawns[i] = { ...d.spawns[i]!, ...patch };
        });
      });
      // Attach delete/dup buttons
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<button type="button" class="wb-danger" data-del>Delete</button>`;
      body.appendChild(row);
      row.querySelector("[data-del]")?.addEventListener("click", () => this.deleteSelected());
    }
  }

  private async showDoorProperties(door: WorldDoor): Promise<void> {
    const body = this.ui?.root.querySelector("[data-props-body]") as HTMLElement | null;
    const props = this.ui?.root.querySelector("[data-props]") as HTMLElement | null;
    if (!body || !props) return;
    props.classList.add("open");
    let destSpawns: Array<{ uid: string; name: string }> = [];
    if (door.targetMap) {
      try {
        const { spawns } = await getContext(this.host.scene).api.worldBuilderListSpawns(door.targetMap);
        destSpawns = spawns;
      } catch { /* */ }
    }
    renderDoorProps(body, door, this.mapList, destSpawns, (patch) => {
      this.mutate((d) => {
        const i = d.doors.findIndex((x) => x.uid === door.uid);
        if (i < 0) return;
        d.doors[i] = { ...d.doors[i]!, ...patch };
      });
      // Refresh spawn list when destination map changes.
      if (patch.targetMap !== undefined) void this.showDoorProperties({ ...door, ...patch });
    });
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<button type="button" class="wb-danger" data-del>Delete</button>`;
    body.appendChild(row);
    row.querySelector("[data-del]")?.addEventListener("click", () => this.deleteSelected());
  }

  private mutateDoorPos(uid: string, x: number, y: number, recordHistory: boolean): void {
    const apply = (d: WorldEditDocument): void => {
      const i = d.doors.findIndex((door) => door.uid === uid);
      if (i >= 0) d.doors[i] = { ...d.doors[i]!, x, y };
    };
    if (recordHistory) this.mutate(apply);
    else { apply(this.doc); this.dirty = true; this.applyDocToWorld(); this.host.setRuntimeOverlay(this.doc.doors, this.doc.spawns); }
  }

  private mutateSpawnPos(uid: string, x: number, y: number, recordHistory: boolean): void {
    const apply = (d: WorldEditDocument): void => {
      const i = d.spawns.findIndex((s) => s.uid === uid);
      if (i >= 0) d.spawns[i] = { ...d.spawns[i]!, x, y };
    };
    if (recordHistory) this.mutate(apply);
    else { apply(this.doc); this.dirty = true; this.applyDocToWorld(); this.host.setRuntimeOverlay(this.doc.doors, this.doc.spawns); }
  }

  private patchObject(uid: string, patch: Partial<WorldObject>, recordHistory = true): void {
    const apply = (d: WorldEditDocument): void => {
      const i = d.objects.findIndex((o) => o.uid === uid);
      if (i < 0) return;
      d.objects[i] = { ...d.objects[i]!, ...patch, properties: { ...(d.objects[i]!.properties ?? {}), ...(patch.properties ?? {}) } };
    };
    if (recordHistory) this.mutate(apply);
    else {
      apply(this.doc);
      this.dirty = true;
      this.applyDocToWorld();
      const obj = this.doc.objects.find((o) => o.uid === uid);
      if (obj) this.ui?.showProperties(obj);
    }
  }

  private deleteSelected(): void {
    if (!this.selectedUid) return;
    const uid = this.selectedUid;
    this.mutate((d) => {
      d.objects = d.objects.filter((o) => o.uid !== uid);
      d.spawns = d.spawns.filter((s) => s.uid !== uid);
      d.zones = d.zones.filter((z) => z.uid !== uid);
      d.doors = d.doors.filter((door) => door.uid !== uid);
    });
    this.highlight(null);
  }

  private duplicateSelected(): void {
    const src = this.doc.objects.find((o) => o.uid === this.selectedUid);
    if (!src) return;
    const copy: WorldObject = {
      ...structuredClone(src),
      uid: uid("obj"),
      x: src.x + this.host.tileW,
      y: src.y + this.host.tileW,
    };
    this.mutate((d) => { d.objects.push(copy); });
    this.highlight(copy.uid);
  }

  private async importZip(file: File): Promise<void> {
    this.ui?.setStatus(`Importing ${file.name}…`);
    try {
      const ctx = getContext(this.host.scene);
      const { summary } = await ctx.api.worldBuilderImportZip(file, file.name.replace(/\.zip$/i, ""));
      this.ui?.showImportSummary(summary);
      await this.loadCatalog();
      this.ui?.setStatus(`Imported ${summary.imported} assets`);
      this.toast(`Imported ${summary.name}`);
    } catch (err) {
      this.ui?.setStatus("Import failed");
      this.toast("ZIP import failed");
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }

  private async importFolder(files: FileList): Promise<void> {
    this.ui?.setStatus(`Importing folder (${files.length} files)…`);
    try {
      const payload: { path: string; dataBase64: string }[] = [];
      const max = Math.min(files.length, 400);
      for (let i = 0; i < max; i++) {
        const f = files[i]!;
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const buf = await f.arrayBuffer();
        // Cap individual file size (~2MB) for JSON transport.
        if (buf.byteLength > 2_000_000) continue;
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]!);
        payload.push({ path, dataBase64: btoa(binary) });
      }
      const name = payload[0]?.path.split("/")[0] || "Folder Import";
      const ctx = getContext(this.host.scene);
      const { summary } = await ctx.api.worldBuilderImportFolder(name, payload);
      this.ui?.showImportSummary(summary);
      await this.loadCatalog();
      this.ui?.setStatus(`Imported ${summary.imported} assets`);
    } catch (err) {
      this.ui?.setStatus("Folder import failed");
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }

  private async deletePack(packId: string): Promise<void> {
    try {
      const ctx = getContext(this.host.scene);
      await ctx.api.worldBuilderDeletePack(packId);
      this.toast("Pack deleted");
    } catch {
      this.toast("Could not delete pack");
    }
  }
}
