import Phaser from "phaser";
import { getContext } from "../core/context";
import { WorldHud } from "../hud/worldHud";
import { MiniMap, type MiniMapPoi } from "../hud/miniMap";
import {
  MAPS, START_MAP, type MapDef, type MapKey,
  type WorldManifest,
} from "../world/worldMaps";

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

const CHAR_KEY = "duelist";
const CHAR_FW = 32;
const CHAR_FH = 48;
const SPEED = 165;

// Layers whose (case-insensitive) name starts with one of these render ABOVE the
// player; everything else renders below. Covers the WorkAdventure conventions
// across all the source maps: "above*", "roof*", "sign*", overlays and lights.
const ABOVE_PREFIXES = ["above", "roof", "sign", "silent", "overlay", "lights", "light"];

// Names (case-insensitive, exact) treated as the invisible collision layer. The
// starter kit uses "collisions"; the village map uses "collision".
const COLLISION_NAMES = ["collisions", "collision"];

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
  private collisionLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right" | "interact", Phaser.Input.Keyboard.Key>;

  private hud!: WorldHud;
  private miniMap: MiniMap | null = null;
  private mapPixels = { w: 0, h: 0 };

  private interactables: Interactable[] = [];
  private activeInteractable: Interactable | null = null;
  private facing: "down" | "left" | "right" | "up" = "down";
  private transitioning = false;
  private ready = false;

  // Touch dpad direction (‑1..1) fed by the on-screen control.
  private touchDir = { x: 0, y: 0 };

  constructor() {
    super("World");
  }

  init(data: { mapKey?: MapKey }): void {
    this.mapKey = data?.mapKey ?? START_MAP;
    this.def = MAPS[this.mapKey];
    this.transitioning = false;
    this.ready = false;
    this.interactables = [];
    this.activeInteractable = null;
    this.collisionLayer = null;
    this.touchDir = { x: 0, y: 0 };
    this.facing = "down";
    this.miniMap = null;
    this.mapPixels = { w: 0, h: 0 };
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

    const { spawnX, spawnY } = this.buildMap(map);
    this.createPlayer(spawnX, spawnY);
    if (this.collisionLayer) this.physics.add.collider(this.player, this.collisionLayer);

    this.setupCamera(map);
    this.setupInput();
    this.placeInteractables(map, spawnX, spawnY);

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
    });
    this.ready = true;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.touchDir = { x: 0, y: 0 };
      this.hud?.destroy();
      this.miniMap?.destroy();
      this.miniMap = null;
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

  // ── map loading (two-stage: tmj + manifest, then tileset images) ────────────
  private async loadMap(key: MapKey): Promise<Phaser.Tilemaps.Tilemap> {
    // Stage 1: the map JSON, the tileset manifest, and the character sheet.
    if (!this.cache.json.has("world-manifest")) {
      this.load.json("world-manifest", assetUrl("world/maps/_manifest.json"));
    }
    if (!this.cache.tilemap.has(key)) {
      this.load.tilemapTiledJSON(key, assetUrl(`world/maps/${key}.tmj`));
    }
    if (!this.textures.exists(CHAR_KEY)) {
      this.load.spritesheet(CHAR_KEY, assetUrl("world/characters/duelist.png"), {
        frameWidth: CHAR_FW, frameHeight: CHAR_FH,
      });
    }
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
    }

    const cx = (map.widthInPixels || map.width * map.tileWidth) / 2;
    const cy = (map.heightInPixels || map.height * map.tileHeight) / 2;

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
    this.ensureAnims();
    this.player = this.physics.add.sprite(x, y, CHAR_KEY, 1);
    this.player.setDepth(500);
    // A slim body around the feet so the avatar tucks behind furniture nicely.
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(18, 14).setOffset((CHAR_FW - 18) / 2, CHAR_FH - 16);
    this.player.setCollideWorldBounds(true);
    this.player.anims.play("idle-down");
  }

  private ensureAnims(): void {
    if (this.anims.exists("walk-down")) return;
    const dirs: [string, number][] = [["down", 0], ["left", 3], ["right", 6], ["up", 9]];
    for (const [dir, start] of dirs) {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(CHAR_KEY, { start, end: start + 2 }),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({ key: `idle-${dir}`, frames: [{ key: CHAR_KEY, frame: start + 1 }], frameRate: 1 });
    }
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
    // on desktop and readable on a phone.
    const min = Math.min(this.scale.width, this.scale.height);
    return Phaser.Math.Clamp(Math.round((min / (15 * 32)) * 100) / 100, 1.4, 3.2);
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
    const portals = this.def.portals;
    const encounters = this.def.encounters ?? [];
    // One spread of walkable spots around spawn; portals take the inner slots,
    // encounters the outer ones so enemies ring the plaza a little further out.
    const spots = this.walkableRing(map, spawnX, spawnY, portals.length + encounters.length);
    portals.forEach((def, i) => {
      const p = spots[i] ?? { x: spawnX + (i + 1) * 48, y: spawnY };
      const verb = def.action.kind === "map" ? "Enter" : def.action.kind === "shop" ? "Open" : "Go to";
      this.interactables.push(
        this.makeInteractable(
          def.id, p.x, p.y, def.glyph, def.label, def.color, `${verb} ${def.label}`,
          "portal", () => this.runAction(def.action),
        ),
      );
    });
    encounters.forEach((def, i) => {
      const p = spots[portals.length + i];
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

  // ── interaction / transitions ───────────────────────────────────────────────
  private tryInteract(): void {
    if (this.transitioning || !this.activeInteractable) return;
    this.activeInteractable.trigger();
  }

  // Dispatch a portal action to the right real scene (the PR #106 battle side).
  private runAction(action: import("../world/worldMaps").WorldAction): void {
    switch (action.kind) {
      case "map": this.goToMap(action.to); break;
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

  private goToMap(to: MapKey): void {
    this.transitioning = true;
    this.cameras.main.fadeOut(220, 6, 9, 16);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ mapKey: to });
    });
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  update(): void {
    if (!this.ready || this.transitioning || !this.player?.body) return;

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
      this.player.anims.play(`walk-${this.facing}`, true);
    } else {
      this.player.anims.play(`idle-${this.facing}`, true);
    }
    this.player.setDepth(500); // stays between below-layers and Above

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
    if (nearest !== this.activeInteractable) {
      this.activeInteractable = nearest;
      this.hud?.setPrompt(nearest ? nearest.prompt : null);
    }
  }
}
