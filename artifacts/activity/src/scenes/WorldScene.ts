import Phaser from "phaser";
import { getContext } from "../core/context";
import { WorldHud } from "../hud/worldHud";
import { MiniMap, type MiniMapPoi } from "../hud/miniMap";
import {
  MAPS, START_MAP, type MapDef, type MapKey,
  type WorldManifest,
} from "../world/worldMaps";
import { AVATARS, type AvatarDef, avatarById, buildAvatarAnims, avatarAnim } from "../world/avatars";
import { Pet, loadPetTextures } from "../world/pets";
import { Ambient } from "../world/ambient";
import { HmNpcs, DialogBox, type HmNpcDef } from "../world/hmNpcs";
import { getAvatarId, getPetId } from "../state/profile";

// Dog breeds used to populate a map with stray/companion dogs (kept small so the
// world only streams a few extra sheets). The player's own pet is added too.
const AMBIENT_BREEDS = ["akita", "great-dane", "siberian-husky"];

// The NPC character sheets, de-duplicated by texture (each sheet holds 4 people).
function uniqueNpcSheets(): AvatarDef[] {
  const seen = new Set<string>();
  const out: AvatarDef[] = [];
  for (const a of AVATARS) {
    if (a.layout === "npc3" && !seen.has(a.texKey)) { seen.add(a.texKey); out.push(a); }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// WorldScene — the Phaser 4 top-down overworld, built on the WorkAdventure map
// system. It loads a real Tiled (.tmj) map + its tilesets, renders every layer in
// WorkAdventure order (Floor → Wall → Details → [player] → Above), gives the
// player a walking avatar with collisions, follows with the camera, and connects
// the maps to the real card game: portals and duelist encounters hand off to the
// existing DuelScene / ShopScene / MatchmakingScene (the PR #106 battle side).
//
// One scene instance is reused for every location: scene.restart({ mapKey }).
// ─────────────────────────────────────────────────────────────────────────────

const SPEED = 165;

// Layers whose (case-insensitive) name starts with one of these render ABOVE the
// player; everything else renders below. Covers the WorkAdventure conventions
// across all the source maps: "above*", "roof*", "sign*", overlays and lights.
const ABOVE_PREFIXES = ["above", "roof", "sign", "silent", "overlay", "lights", "light"];

// Names (case-insensitive, exact) treated as the invisible collision layer. The
// starter kit uses "collisions"; the village map uses "collision".
const COLLISION_NAMES = ["collisions", "collision"];

// Minimap terrain categories by tileset name: 1 = water, 2 = trees/foliage,
// 0 = everything else (ground). Buildings (3) are decided by the collision layer.
function categoryForTileset(name: string): 0 | 1 | 2 | 3 {
  const n = name.toLowerCase();
  if (/water/.test(n)) return 1;
  if (/tree|flower|plant|bush|foliage|garden/.test(n)) return 2;
  return 0;
}

// A single thing the player can walk up to and interact with — either a portal
// (navigate / open a battle-side scene) or an enemy encounter (start a duel).
interface Interactable {
  x: number;
  y: number;
  /** Prompt shown when the player is in range, e.g. "Enter Card Shop" / "Duel Rookie Rival". */
  prompt: string;
  /** What interacting does. */
  trigger: () => void;
  ring: Phaser.GameObjects.Arc;
  glyph: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  /** Stable id for the minimap legend. */
  id: string;
  mapGlyph: string;
  mapColor: number;
  mapKind: "portal" | "encounter";
  mapLabel: string;
}

function assetUrl(rel: string): string {
  // Vite serves public/ at BASE_URL ("/" here, preserved through the Discord proxy).
  return `${import.meta.env.BASE_URL}${rel}`;
}

export class WorldScene extends Phaser.Scene {
  private mapKey: MapKey = START_MAP;
  private def!: MapDef;

  private player!: Phaser.Physics.Arcade.Sprite;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private avatar!: AvatarDef;
  private petId: string | null = null;
  private pet: Pet | null = null;
  private petNear = false;
  private lastPrompt: string | null = null;
  private ambient: Ambient | null = null;
  private collisionLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right" | "interact", Phaser.Input.Keyboard.Key>;

  private hud!: WorldHud;
  private miniMap: MiniMap | null = null;
  private mapPixels = { w: 0, h: 0 };

  // Terrain classification for the minimap (water / trees / buildings). Visual
  // tile layers are scanned per cell; gid ranges map to a category by tileset.
  private visualLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private gidCats: { first: number; last: number; cat: 0 | 1 | 2 | 3 }[] = [];

  private interactables: Interactable[] = [];
  private activeInteractable: Interactable | null = null;
  private facing: "down" | "left" | "right" | "up" = "down";
  private transitioning = false;
  private ready = false;

  // Touch dpad direction (‑1..1) fed by the on-screen control.
  private touchDir = { x: 0, y: 0 };

  // ── Harvest Moon (image-backed) map support ──
  private tileW = 32;
  private spawnOverride: { tx: number; ty: number } | null = null;
  private bgObjects: Phaser.GameObjects.Image[] = [];
  private exitArmed = false; // suppress exit re-trigger until the player steps clear
  private isHm = false;
  private playerScale = 1;
  private npcs: HmNpcs | null = null;
  private dialog: DialogBox | null = null;
  private npcNear: HmNpcDef | null = null;

  constructor() {
    super("World");
  }

  init(data: { mapKey?: MapKey; spawnAt?: { tx: number; ty: number } }): void {
    this.mapKey = data?.mapKey ?? START_MAP;
    this.def = MAPS[this.mapKey];
    this.spawnOverride = data?.spawnAt ?? null;
    this.tileW = this.def.tile ?? 32;
    this.isHm = !!(this.def.bgImage || this.def.bgChunks);
    this.bgObjects = [];
    this.exitArmed = false;
    this.npcs = null;
    this.dialog = null;
    this.npcNear = null;
    // In the Harvest Moon world the player is Jack; elsewhere it's the chosen avatar.
    this.avatar = this.isHm ? avatarById("jack") : avatarById(getAvatarId());
    this.petId = getPetId();
    this.pet = null;
    this.petNear = false;
    this.lastPrompt = null;
    this.ambient = null;
    this.transitioning = false;
    this.ready = false;
    this.interactables = [];
    this.activeInteractable = null;
    this.collisionLayer = null;
    this.touchDir = { x: 0, y: 0 };
    this.facing = "down";
    this.miniMap = null;
    this.mapPixels = { w: 0, h: 0 };
    this.visualLayers = [];
    this.gidCats = [];
  }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    this.cameras.main.setBackgroundColor("#10151f");

    // Loading label — the bigger maps (the village) take a few seconds to stream
    // their tilesets, so show progress instead of a black frame.
    const loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, `Entering ${this.def.name}…`, {
        fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#9db2ff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100000);

    let map: Phaser.Tilemaps.Tilemap;
    try {
      map = await this.loadMap(this.mapKey);
    } catch (err) {
      loading.destroy();
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, "Couldn't load the world map.", {
          fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#ff9db2",
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
      // eslint-disable-next-line no-console
      console.error("[World] map load failed:", err);
      return;
    }

    loading.destroy();

    // The physics world must span the whole map, or setCollideWorldBounds clamps
    // the player to the (tiny) default canvas-sized bounds.
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.mapPixels = { w: map.widthInPixels, h: map.heightInPixels };
    this.tileW = map.tileWidth;
    this.drawHmBackground(map);

    const { spawnX, spawnY } = this.buildMap(map);
    this.createPlayer(spawnX, spawnY);
    if (this.collisionLayer) this.physics.add.collider(this.player, this.collisionLayer);

    // Companion pet (if chosen) — trails the player and reacts when played with.
    if (this.petId && this.textures.exists(`pet-${this.petId}-idle`)) {
      this.pet = new Pet(this, this.petId, spawnX - 26, spawnY + 10,
        () => ({ x: this.player.x, y: this.player.y }));
      // Proportion the dog to the map's art on Harvest Moon (20px-tile) maps.
      if (this.isHm) this.pet.sprite.setScale(0.4);
    }

    this.setupCamera(map);
    this.setupInput();
    this.placeInteractables(map, spawnX, spawnY);

    // Populate the map with pacing NPCs, lakeside watchers, office folk and stray
    // dogs — placed procedurally in sensible spots, kept clear of the beacons.
    const avoid = [{ x: spawnX, y: spawnY }, ...this.interactables.map((it) => ({ x: it.x, y: it.y }))];
    const seed = Array.from(this.mapKey).reduce((h, c) => ((h * 31) + c.charCodeAt(0)) | 0, 7);
    if (this.def.ambient !== false) this.ambient = new Ambient({
      scene: this,
      tw: map.tileWidth, th: map.tileHeight, mapW: map.width, mapH: map.height,
      isWalkable: (tx, ty) => {
        const t = this.collisionLayer?.getTileAt(tx, ty);
        return !t || t.index < 0;
      },
      classify: (tx, ty) => this.classifyTile(tx, ty),
      avoid,
      npcDefs: AVATARS.filter((a) => a.layout === "npc3"),
      breeds: [...AMBIENT_BREEDS, ...(this.petId ? [this.petId] : [])],
      seed,
    });

    // Harvest Moon townsfolk + a dialog box for talking to them.
    if (this.isHm) {
      this.npcs = new HmNpcs(this, this.mapKey, this.tileW);
      this.dialog = new DialogBox(() => { /* closed */ });
    }

    // DOM HUD: location banner, player chip, mobile dpad + interact button.
    const snap = getContext(this).playerState.get();
    this.hud = new WorldHud({
      title: this.def.name,
      subtitle: this.def.subtitle,
      player: snap
        ? { name: snap.user.username, level: snap.player.level, shards: snap.player.shards }
        : null,
      onDir: (x, y) => { this.touchDir = { x, y }; },
      onInteract: () => this.tryInteract(),
      onMenu: () => this.leaveToMenu(),
    });

    // True top-right compass minimap — follows the player, click / M to expand.
    this.miniMap = new MiniMap({
      scene: this,
      mapW: map.widthInPixels,
      mapH: map.heightInPixels,
      collision: this.collisionLayer,
      title: this.def.name,
      subtitle: this.def.subtitle,
      getPlayer: () => ({ x: this.player.x, y: this.player.y, facing: this.facing }),
      getPois: () => this.poisForMap(),
      classify: (tx, ty) => this.classifyTile(tx, ty),
      mapImageUrl: assetUrl(this.def.mapImage ?? `world/maps/minimaps/${this.mapKey}.jpg`),
    });
    this.ready = true;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.touchDir = { x: 0, y: 0 };
      this.hud?.destroy();
      this.miniMap?.destroy();
      this.miniMap = null;
      this.pet?.destroy();
      this.pet = null;
      this.ambient?.destroy();
      this.ambient = null;
      this.dialog?.destroy();
      this.dialog = null;
      this.npcs = null;
    });
  }

  private poisForMap(): MiniMapPoi[] {
    return this.interactables.map((it) => ({
      id: it.id,
      x: it.x,
      y: it.y,
      label: it.mapLabel,
      glyph: it.mapGlyph,
      color: it.mapColor,
      kind: it.mapKind,
    }));
  }

  // Terrain category at a tile for the minimap: 1 water, 2 trees, 3 building, 0 ground.
  private classifyTile(tx: number, ty: number): 0 | 1 | 2 | 3 {
    let water = false, tree = false;
    for (const layer of this.visualLayers) {
      const t = layer.getTileAt(tx, ty);
      if (!t || t.index < 0) continue;
      const cat = this.gidCat(t.index);
      if (cat === 1) water = true;
      else if (cat === 2) tree = true;
    }
    const bt = this.collisionLayer?.getTileAt(tx, ty);
    const blocked = !!bt && bt.index >= 0;
    return water ? 1 : tree ? 2 : blocked ? 3 : 0;
  }

  private gidCat(gid: number): 0 | 1 | 2 | 3 {
    for (const r of this.gidCats) if (gid >= r.first && gid <= r.last) return r.cat;
    return 0;
  }

  // Draw a Harvest Moon map's background art (single image, or chunks placed at
  // their offsets) beneath everything else.
  private drawHmBackground(map: Phaser.Tilemaps.Tilemap): void {
    const hmKey = this.mapKey.replace(/^hm-/, "");
    const add = (texKey: string, x: number, y: number): void => {
      if (!this.textures.exists(texKey)) return;
      const img = this.add.image(x, y, texKey).setOrigin(0, 0).setDepth(-100);
      this.bgObjects.push(img);
    };
    if (this.def.bgImage) add(`hmbg-${hmKey}`, 0, 0);
    for (const c of this.def.bgChunks ?? []) add(`hmbg-${hmKey}-${c.x}-${c.y}`, c.x, c.y);
    void map;
  }

  // ── map loading ─────────────────────────────────────────────────────────────
  private async loadMap(key: MapKey): Promise<Phaser.Tilemaps.Tilemap> {
    if (this.def.bgImage || this.def.bgChunks) return this.loadHmMap(key);
    return this.loadTiledMap(key);
  }

  // Harvest Moon maps: a full background image (or chunks) + a light collision-only
  // Tiled map. The player + collision run on the tmj; the art is drawn as images.
  private async loadHmMap(key: MapKey): Promise<Phaser.Tilemaps.Tilemap> {
    const hmKey = key.replace(/^hm-/, "");
    if (!this.textures.exists("hm-collide")) {
      this.load.image("hm-collide", assetUrl("world/hm/collide.png"));
    }
    if (!this.cache.tilemap.has(key)) {
      this.load.tilemapTiledJSON(key, assetUrl(`world/hm/maps/${hmKey}.tmj`));
    }
    if (!this.textures.exists(this.avatar.texKey)) {
      this.load.spritesheet(this.avatar.texKey, assetUrl(this.avatar.url), {
        frameWidth: this.avatar.fw, frameHeight: this.avatar.fh,
      });
    }
    if (this.petId) loadPetTextures(this, this.petId);
    for (const s of HmNpcs.spritesForMap(key)) {
      if (!this.textures.exists(s.key)) this.load.image(s.key, assetUrl(s.url));
    }
    // Background art: one image, or chunks for maps beyond the GPU texture cap.
    const bgKeys: string[] = [];
    if (this.def.bgImage) {
      const k = `hmbg-${hmKey}`; bgKeys.push(k);
      if (!this.textures.exists(k)) this.load.image(k, assetUrl(this.def.bgImage));
    }
    for (const c of this.def.bgChunks ?? []) {
      const k = `hmbg-${hmKey}-${c.x}-${c.y}`;
      if (!this.textures.exists(k)) this.load.image(k, assetUrl(c.url));
    }
    await this.runLoader();

    const map = this.make.tilemap({ key });
    map.addTilesetImage("collide", "hm-collide", this.def.tile ?? 20, this.def.tile ?? 20, 0, 0, 1);
    this.gidCats = [];
    return map;
  }

  // ── WorkAdventure maps (two-stage: tmj + manifest, then tileset images) ──────
  private async loadTiledMap(key: MapKey): Promise<Phaser.Tilemaps.Tilemap> {
    // Stage 1: the map JSON, the tileset manifest, and the character sheet.
    if (!this.cache.json.has("world-manifest")) {
      this.load.json("world-manifest", assetUrl("world/maps/_manifest.json"));
    }
    if (!this.cache.tilemap.has(key)) {
      this.load.tilemapTiledJSON(key, assetUrl(`world/maps/${key}.tmj`));
    }
    if (!this.textures.exists(this.avatar.texKey)) {
      this.load.spritesheet(this.avatar.texKey, assetUrl(this.avatar.url), {
        frameWidth: this.avatar.fw, frameHeight: this.avatar.fh,
      });
    }
    if (this.petId) loadPetTextures(this, this.petId);
    // Ambient life: the NPC sheets + a few dog breeds to scatter around the map.
    for (const def of uniqueNpcSheets()) {
      if (!this.textures.exists(def.texKey)) {
        this.load.spritesheet(def.texKey, assetUrl(def.url), { frameWidth: def.fw, frameHeight: def.fh });
      }
    }
    for (const breed of AMBIENT_BREEDS) loadPetTextures(this, breed);
    await this.runLoader();

    const manifest = this.cache.json.get("world-manifest") as WorldManifest;
    const entry = manifest?.[key];
    if (!entry) throw new Error(`no manifest entry for map "${key}"`);

    // Stage 2: every tileset image this map references.
    for (const ts of entry.tilesets) {
      const imgKey = `${key}__${ts.name}`;
      if (!this.textures.exists(imgKey)) this.load.image(imgKey, assetUrl(ts.image));
    }
    await this.runLoader();

    const map = this.make.tilemap({ key });
    // Register each tileset against its loaded image, keyed by explicit firstgid.
    for (const ts of entry.tilesets) {
      map.addTilesetImage(
        ts.name, `${key}__${ts.name}`, ts.tilewidth, ts.tileheight, ts.margin, ts.spacing, ts.firstgid,
      );
    }
    // Classify each tileset's gid range so the minimap can tell water / trees /
    // ground apart (buildings come from the collision layer, not tileset name).
    this.gidCats = entry.tilesets.map((ts) => ({
      first: ts.firstgid,
      last: ts.firstgid + ts.tilecount - 1,
      cat: categoryForTileset(ts.name),
    }));
    return map;
  }

  private runLoader(): Promise<void> {
    return new Promise((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });
  }

  // ── layer rendering ─────────────────────────────────────────────────────────
  private buildMap(map: Phaser.Tilemaps.Tilemap): { spawnX: number; spawnY: number } {
    const tilesets = map.tilesets;
    let spawn: { x: number; y: number } | null = null;

    for (let index = 0; index < map.layers.length; index++) {
      const ld = map.layers[index]!;
      const name = ld.name ?? "";
      const lower = name.toLowerCase();

      if (lower === "start") {
        spawn = this.findSpawn(ld, map);
        continue; // start markers are logic-only, never drawn
      }
      if (COLLISION_NAMES.includes(lower)) {
        const layer = this.makeLayer(map, index, tilesets);
        if (layer) {
          layer.setVisible(false);
          layer.setCollisionByExclusion([-1], true);
          this.collisionLayer = layer;
        }
        continue;
      }

      const layer = this.makeLayer(map, index, tilesets);
      if (!layer) continue;
      const isAbove = ABOVE_PREFIXES.some((p) => lower.startsWith(p));
      layer.setDepth(isAbove ? 1000 + index : index);
      if (typeof ld.alpha === "number") layer.setAlpha(ld.alpha);
      this.visualLayers.push(layer);
    }

    const tw = map.tileWidth, th = map.tileHeight;
    const cx = (map.widthInPixels || map.width * tw) / 2;
    const cy = (map.heightInPixels || map.height * th) / 2;

    // Arrival spawn (coming through a door/exit) wins — nudged to the nearest
    // walkable tile so we never drop the player inside a wall.
    const override = this.spawnOverride ?? this.def.spawnTile ?? null;
    if (override) {
      const px = override.tx * tw + tw / 2, py = override.ty * th + th / 2;
      const open = this.nearestWalkable(map, px, py) ?? { x: px, y: py };
      return { spawnX: open.x, spawnY: open.y };
    }

    // The big hub map's `start` marker sits inside a cramped office; spawn in the
    // open plaza instead (nearest walkable tile to the map centre).
    if (this.def.spawn === "center") {
      const open = this.nearestWalkable(map, cx, cy);
      if (open) return { spawnX: open.x, spawnY: open.y };
    }
    return { spawnX: spawn ? spawn.x : cx, spawnY: spawn ? spawn.y : cy };
  }

  // Spiral out from a pixel point to the nearest walkable tile centre.
  private nearestWalkable(
    map: Phaser.Tilemaps.Tilemap, px: number, py: number,
  ): { x: number; y: number } | null {
    const tw = map.tileWidth, th = map.tileHeight;
    const stx = Math.floor(px / tw), sty = Math.floor(py / th);
    for (let r = 0; r <= 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
          const tx = stx + dx, ty = sty + dy;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const t = this.collisionLayer?.getTileAt(tx, ty);
          if (!t || t.index < 0) return { x: tx * tw + tw / 2, y: ty * th + th / 2 };
        }
      }
    }
    return null;
  }

  // createLayer's return type is a TilemapLayer | TilemapGPULayer union; with the
  // gpu flag false (the default) it is always a standard TilemapLayer, which is
  // what arcade collision + tile queries need. Narrow it here in one place.
  private makeLayer(
    map: Phaser.Tilemaps.Tilemap, index: number, tilesets: Phaser.Tilemaps.Tileset[],
  ): Phaser.Tilemaps.TilemapLayer | null {
    const layer = map.createLayer(index, tilesets, 0, 0, false);
    return (layer as Phaser.Tilemaps.TilemapLayer) ?? null;
  }

  private findSpawn(ld: Phaser.Tilemaps.LayerData, map: Phaser.Tilemaps.Tilemap): { x: number; y: number } | null {
    for (let y = 0; y < ld.height; y++) {
      for (let x = 0; x < ld.width; x++) {
        const t = ld.data[y]?.[x];
        if (t && t.index >= 0) {
          return { x: x * map.tileWidth + map.tileWidth / 2, y: y * map.tileHeight + map.tileHeight / 2 };
        }
      }
    }
    return null;
  }

  // ── player ──────────────────────────────────────────────────────────────────
  private createPlayer(x: number, y: number): void {
    buildAvatarAnims(this, this.avatar);
    this.player = this.physics.add.sprite(x, y, this.avatar.texKey, 1);
    this.player.setDepth(500);
    // Proportion the avatar to the map's art: on Harvest Moon (20px-tile) maps the
    // player stands ~1.7 tiles tall regardless of the source sheet's size.
    const s = this.isHm ? (this.tileW * 1.7) / this.avatar.fh : 1;
    this.playerScale = s;
    this.player.setScale(s);
    // Ground shadow so the player reads as grounded like the NPCs/pets.
    this.playerShadow = this.add.ellipse(x, y + (this.avatar.fh / 2 - 4) * s, 20 * s, 8 * s, 0x000000, 0.28).setDepth(499);
    // A slim body around the feet so the avatar tucks behind furniture nicely.
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(18, 14).setOffset((this.avatar.fw - 18) / 2, this.avatar.fh - 16);
    this.player.setCollideWorldBounds(true);
    const a = avatarAnim(this.avatar, "down", false);
    this.player.anims.play(a.key);
    this.player.setFlipX(a.flipX);
  }

  // ── camera ──────────────────────────────────────────────────────────────────
  private setupCamera(map: Phaser.Tilemaps.Tilemap): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.setZoom(this.pickZoom());
    cam.roundPixels = true;
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this),
    );
  }

  private pickZoom(): number {
    // Fit ~15 tiles across the smaller screen dimension so the world feels roomy
    // on desktop and readable on a phone. Scales with the map's tile size (HM
    // maps use 20px tiles, so they need a higher zoom to show the same span).
    const min = Math.min(this.scale.width, this.scale.height);
    const lo = this.tileW <= 24 ? 1.8 : 1.4, hi = this.tileW <= 24 ? 4.2 : 3.2;
    return Phaser.Math.Clamp(Math.round((min / (15 * this.tileW)) * 100) / 100, lo, hi);
  }

  private onResize(): void {
    this.cameras.main.setZoom(this.pickZoom());
  }

  // ── input ─────────────────────────────────────────────────────────────────
  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = {
        up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        interact: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      };
      kb.on("keydown-E", () => this.tryInteract());
      kb.on("keydown-SPACE", () => this.tryInteract());
    }
  }

  // ── interactables (portals + encounters) ────────────────────────────────────
  private placeInteractables(map: Phaser.Tilemaps.Tilemap, spawnX: number, spawnY: number): void {
    const encounters = this.def.encounters ?? [];
    // Portals with a fixed tile (e.g. the cave mouth) are placed exactly; the
    // rest share a spread of walkable spots around spawn, with encounters ringing
    // a little further out.
    const fixedPortals = this.def.portals.filter((p) => p.at);
    const ringPortals = this.def.portals.filter((p) => !p.at);
    const spots = this.walkableRing(map, spawnX, spawnY, ringPortals.length + encounters.length);
    const tw = map.tileWidth, th = map.tileHeight;
    const addPortal = (def: import("../world/worldMaps").PortalDef, x: number, y: number): void => {
      if (def.art === "cave") this.drawCaveMouth(x, y);
      const verb = def.action.kind === "map" ? "Enter" : def.action.kind === "shop" ? "Open" : "Go to";
      this.interactables.push(
        this.makeInteractable(
          def.id, x, y, def.glyph, def.label, def.color, `${verb} ${def.label}`,
          "portal", () => this.runAction(def.action),
        ),
      );
    };
    ringPortals.forEach((def, i) => {
      const p = spots[i] ?? { x: spawnX + (i + 1) * 48, y: spawnY };
      addPortal(def, p.x, p.y);
    });
    for (const def of fixedPortals) {
      addPortal(def, def.at!.tx * tw + tw / 2, def.at!.ty * th + th / 2);
    }
    encounters.forEach((def, i) => {
      const p = spots[ringPortals.length + i];
      if (!p) return;
      const it = this.makeInteractable(
        def.id, p.x, p.y, def.glyph, def.name, def.color, `Duel ${def.name}`,
        "encounter", () => this.startDuel(def.name),
      );
      // Bob the enemy so it reads as a character rather than a signpost.
      this.tweens.add({ targets: it.glyph, y: it.glyph.y - 4, yoyo: true, repeat: -1, duration: 700, ease: "Sine.InOut" });
      this.interactables.push(it);
    });
    this.miniMap?.refreshPois();
  }

  // Spiral outward from spawn collecting walkable, well-spaced tile centres.
  private walkableRing(
    map: Phaser.Tilemaps.Tilemap, sx: number, sy: number, count: number,
  ): { x: number; y: number }[] {
    const tw = map.tileWidth, th = map.tileHeight;
    const stx = Math.floor(sx / tw), sty = Math.floor(sy / th);
    const out: { x: number; y: number }[] = [];
    const minGap = 3; // tiles between beacons
    const isWalkable = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
      const t = this.collisionLayer?.getTileAt(tx, ty);
      return !t || t.index < 0;
    };
    for (let r = 2; r <= 24 && out.length < count; r++) {
      for (let a = 0; a < 360 && out.length < count; a += 20) {
        const tx = stx + Math.round(Math.cos((a * Math.PI) / 180) * r);
        const ty = sty + Math.round(Math.sin((a * Math.PI) / 180) * r);
        if (!isWalkable(tx, ty)) continue;
        const px = tx * tw + tw / 2, py = ty * th + th / 2;
        if (Math.hypot(px - sx, py - sy) < minGap * tw) continue;
        if (out.some((o) => Math.hypot(o.x - px, o.y - py) < minGap * tw)) continue;
        out.push({ x: px, y: py });
      }
    }
    return out;
  }

  private makeInteractable(
    id: string,
    x: number, y: number, glyph: string, label: string, color: number, prompt: string,
    kind: "portal" | "encounter",
    trigger: () => void,
  ): Interactable {
    const ring = this.add.circle(x, y, 15, color, 0.28).setDepth(430);
    ring.setStrokeStyle(2, color, 0.9);
    this.tweens.add({
      targets: ring, scale: 1.25, alpha: 0.5, yoyo: true, repeat: -1, duration: 900, ease: "Sine.InOut",
    });
    const glyphText = this.add.text(x, y - 1, glyph, { fontSize: "16px" }).setOrigin(0.5).setDepth(431);
    const labelText = this.add
      .text(x, y - 26, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#eaf0ff",
        backgroundColor: "#141a2ecc", padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(432);
    return {
      id, x, y, prompt, trigger, ring, glyph: glyphText, label: labelText,
      mapGlyph: glyph, mapColor: color, mapKind: kind, mapLabel: label,
    };
  }

  // A little cave mouth: a rocky mound with a dark opening, drawn under the beacon
  // so the entrance reads as a real doorway into the hillside.
  private drawCaveMouth(x: number, y: number): void {
    const g = this.add.graphics().setDepth(420);
    // rocky mound
    g.fillStyle(0x3b3a44, 1); g.fillEllipse(x, y + 4, 60, 42);
    g.fillStyle(0x4a4956, 1); g.fillEllipse(x, y - 2, 54, 34);
    // dark opening
    g.fillStyle(0x0a0a10, 1); g.fillEllipse(x, y + 2, 30, 30);
    g.fillStyle(0x05050a, 1); g.fillEllipse(x, y + 6, 22, 20);
    // a couple of boulders at the base
    g.fillStyle(0x33323c, 1);
    g.fillCircle(x - 26, y + 12, 7); g.fillCircle(x + 25, y + 13, 8); g.fillCircle(x + 14, y + 18, 5);
  }

  // ── interaction / transitions ───────────────────────────────────────────────
  private tryInteract(): void {
    if (this.transitioning) return;
    // An open conversation advances / closes first.
    if (this.dialog?.isOpen) { this.dialog.advance(); return; }
    if (this.activeInteractable) { this.activeInteractable.trigger(); return; }
    if (this.npcNear && this.dialog) { this.dialog.open(this.npcNear.name, this.npcNear.lines); return; }
    if (this.petNear && this.pet) this.pet.react();
  }

  // Dispatch a portal action to the right real scene (the PR #106 battle side).
  private runAction(action: import("../world/worldMaps").WorldAction): void {
    switch (action.kind) {
      case "map": this.goToMap(action.to, action.spawnAt); break;
      case "duel": void this.startDuel(); break;
      case "shop": this.fadeThen(() => this.scene.start("Shop", { returnTo: "World" })); break;
      case "pvp": this.fadeThen(() => this.scene.start("Matchmaking")); break;
      case "menu": this.leaveToMenu(); break;
    }
  }

  // Start a real Yu-Gi-Oh duel vs the AI. Pulls a deck setup from the backend
  // (falls back to DuelScene's default when offline) and names the opponent.
  private async startDuel(opponentName = "Duelist"): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.flash(90, 255, 255, 255);
    let setup: import("../duel/types").DuelSetup | undefined;
    try {
      const s = await getContext(this).api.duel();
      setup = { ...s, opponent: { ...s.opponent, name: opponentName } };
    } catch {
      setup = undefined;
    }
    this.cameras.main.fadeOut(220, 6, 9, 16);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start("Duel", { setup, returnTo: "World", opponentName });
    });
  }

  private fadeThen(go: () => void): void {
    this.transitioning = true;
    this.cameras.main.fadeOut(200, 6, 9, 16);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
  }

  private leaveToMenu(): void {
    this.fadeThen(() => this.scene.start("Menu"));
  }

  private goToMap(to: MapKey, spawnAt?: { tx: number; ty: number }): void {
    this.transitioning = true;
    this.cameras.main.fadeOut(220, 6, 9, 16);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ mapKey: to, spawnAt });
    });
  }

  // Harvest Moon doors/edges: walking onto an exit region moves to the linked map.
  // The exit is "armed" only after the player has stepped clear of every exit, so
  // arriving on top of a door doesn't immediately bounce you back.
  private checkExits(): void {
    const exits = this.def.hmExits;
    if (!exits || !exits.length) return;
    const tw = this.tileW;
    const ptx = this.player.x / tw, pty = this.player.y / tw;
    let onAny = false;
    for (const e of exits) {
      const pad = 0.5;
      if (ptx >= e.tx - pad && ptx <= e.tx + e.w + pad && pty >= e.ty - pad && pty <= e.ty + e.h + pad) {
        onAny = true;
        if (this.exitArmed) { this.takeExit(e); return; }
      }
    }
    if (!onAny) this.exitArmed = true;
  }

  private takeExit(e: import("../world/worldMaps").MapExit): void {
    // Arrival tile: an explicit spawnAt, else the target's reciprocal exit back to
    // this map, nudged a couple tiles inward so we don't land on the doorway.
    let spawn = e.spawnAt;
    if (!spawn) {
      const back = MAPS[e.to]?.hmExits?.find((x) => x.to === this.mapKey);
      if (back) spawn = this.nudgeInward(e.to, back);
    }
    this.goToMap(e.to, spawn);
  }

  // Move a spawn tile toward the target map's interior so the player steps off the
  // edge exit rather than straight back onto it.
  private nudgeInward(mapKey: MapKey, exit: { tx: number; ty: number; w: number; h: number }): { tx: number; ty: number } {
    const def = MAPS[mapKey];
    const w = def?.gridW ?? 9999, h = def?.gridH ?? 9999;
    let tx = exit.tx + Math.floor(exit.w / 2), ty = exit.ty + Math.floor(exit.h / 2);
    if (exit.tx <= 1) tx += 2; else if (exit.tx + exit.w >= w - 2) tx -= 2;
    if (exit.ty <= 1) ty += 2; else if (exit.ty + exit.h >= h - 2) ty -= 2;
    return { tx, ty };
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  update(): void {
    if (!this.ready || this.transitioning || !this.player?.body) return;

    // Freeze the player while a conversation is open.
    if (this.dialog?.isOpen) {
      this.player.setVelocity(0, 0);
      const a = avatarAnim(this.avatar, this.facing, false);
      this.player.anims.play(a.key, true);
      this.player.setFlipX(a.flipX);
      this.pet?.update();
      this.miniMap?.update();
      return;
    }

    let vx = 0, vy = 0;
    if (this.cursors) {
      if (this.cursors.left?.isDown || this.wasd.left.isDown) vx -= 1;
      if (this.cursors.right?.isDown || this.wasd.right.isDown) vx += 1;
      if (this.cursors.up?.isDown || this.wasd.up.isDown) vy -= 1;
      if (this.cursors.down?.isDown || this.wasd.down.isDown) vy += 1;
    }
    // Touch stick is analogue — don't renormalize away its magnitude, but clamp
    // the combined vector so keyboard + stick never exceed full SPEED.
    vx += this.touchDir.x;
    vy += this.touchDir.y;

    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    // Snap near-zero so a sticky 0.01 residue can't keep the walk anim going.
    if (len < 0.04) { vx = 0; vy = 0; }
    this.player.setVelocity(vx * SPEED, vy * SPEED);

    const moving = Math.hypot(vx, vy) > 0.01;
    if (moving) {
      // Face the dominant axis.
      if (Math.abs(vx) > Math.abs(vy)) this.facing = vx < 0 ? "left" : "right";
      else this.facing = vy < 0 ? "up" : "down";
    }
    const a = avatarAnim(this.avatar, this.facing, moving);
    this.player.anims.play(a.key, true);
    this.player.setFlipX(a.flipX);
    this.player.setDepth(500); // stays between below-layers and Above
    this.playerShadow.setPosition(this.player.x, this.player.y + (this.avatar.fh / 2 - 4) * this.playerScale);

    this.pet?.update();
    this.checkExits();
    this.updateProximity();
    this.miniMap?.update();
  }

  private updateProximity(): void {
    let nearest: Interactable | null = null;
    let best = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(it.x - this.player.x, it.y - this.player.y);
      if (d < 40 && d < best) { best = d; nearest = it; }
    }
    this.activeInteractable = nearest;

    // Fallback prompts when no portal/encounter is in range: townsfolk first, then
    // the pet — so talking or playing never steals a duel/shop interaction.
    this.npcNear = null;
    if (!nearest && this.npcs) {
      this.npcNear = this.npcs.nearest(this.player.x, this.player.y, this.tileW * 1.8);
    }
    this.petNear = false;
    if (!nearest && !this.npcNear && this.pet) {
      const p = this.pet.sprite;
      this.petNear = Math.hypot(p.x - this.player.x, p.y - this.player.y) < 46;
    }
    const prompt = nearest ? nearest.prompt
      : this.npcNear ? `Talk to ${this.npcNear.name}`
      : this.petNear ? `Play with ${this.pet!.name}` : null;
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.hud?.setPrompt(prompt);
    }
  }
}
