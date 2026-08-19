// ─────────────────────────────────────────────────────────────────────────────
// Babylon 3D world — a true walkable mini-world (Battle City plaza) rendered
// with Babylon.js (pure WebGL, fully self-contained → works inside a Discord
// Activity iframe; no external hosts for the CSP to block). Lazy-loaded from the
// Menu so Babylon's weight only downloads when the player opens the 3D world.
//
// Walk with WASD / arrows / the on-screen pad, approach a red duelist, and press
// E (or the ⚔ button) to challenge them — which hands off to the Phaser duel.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Engine, Scene, Vector3, Color3, Color4, FreeCamera, HemisphericLight,
  DirectionalLight, MeshBuilder, StandardMaterial, DynamicTexture, type Mesh,
} from "@babylonjs/core";

export interface BabylonWorldHandle { dispose(): void; }
export interface BabylonWorldOpts {
  onDuel: (npcName: string) => void;
  onExit: () => void;
}

interface Npc3d { mesh: Mesh; name: string; }

export function startBabylonWorld(opts: BabylonWorldOpts): BabylonWorldHandle {
  // ── Canvas overlay ──────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    zIndex: "50", touchAction: "none", outline: "none",
  } as CSSStyleDeclaration);
  document.body.appendChild(canvas);

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.06, 0.1, 1);

  // ── Camera (manual chase cam behind the player) ─────────────────────────────
  const camera = new FreeCamera("cam", new Vector3(0, 8, -14), scene);
  camera.fov = 0.9;

  // ── Lights ──────────────────────────────────────────────────────────────────
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.75;
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.3), scene);
  sun.intensity = 0.8;

  // ── Ground ──────────────────────────────────────────────────────────────────
  const ground = MeshBuilder.CreateGround("ground", { width: 80, height: 80, subdivisions: 2 }, scene);
  const gmat = new StandardMaterial("gmat", scene);
  gmat.diffuseColor = new Color3(0.16, 0.18, 0.28);
  gmat.specularColor = new Color3(0.05, 0.05, 0.08);
  ground.material = gmat;
  // Grid lines via a big tiled dynamic texture.
  const grid = new DynamicTexture("grid", { width: 1024, height: 1024 }, scene, false);
  const gctx = grid.getContext();
  gctx.fillStyle = "#232a44"; gctx.fillRect(0, 0, 1024, 1024);
  gctx.strokeStyle = "#39456f"; gctx.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 64) { gctx.beginPath(); gctx.moveTo(i, 0); gctx.lineTo(i, 1024); gctx.moveTo(0, i); gctx.lineTo(1024, i); gctx.stroke(); }
  grid.update();
  gmat.diffuseTexture = grid;

  // ── Buildings ───────────────────────────────────────────────────────────────
  function building(x: number, z: number, w: number, h: number, d: number, color: Color3, label: string): void {
    const box = MeshBuilder.CreateBox("b", { width: w, height: h, depth: d }, scene);
    box.position.set(x, h / 2, z);
    const m = new StandardMaterial("bm", scene);
    m.diffuseColor = color;
    box.material = m;
    makeLabel(scene, label, new Vector3(x, h + 1.2, z));
  }
  building(12, 10, 8, 5, 8, new Color3(0.42, 0.29, 0.56), "🏪 Card Shop");
  building(-14, 8, 9, 6, 7, new Color3(0.26, 0.28, 0.4), "🏢 Arena");
  building(0, 22, 16, 7, 6, new Color3(0.35, 0.29, 0.55), "🏙️ Downtown");

  // ── Player ──────────────────────────────────────────────────────────────────
  const player = MeshBuilder.CreateCapsule("player", { height: 1.8, radius: 0.5 }, scene);
  player.position.set(0, 0.9, -6);
  const pmat = new StandardMaterial("pmat", scene);
  pmat.diffuseColor = new Color3(0.18, 0.77, 1);
  player.material = pmat;

  // ── NPC duelists ────────────────────────────────────────────────────────────
  const npcs: Npc3d[] = [];
  function duelist(x: number, z: number, name: string): void {
    const mesh = MeshBuilder.CreateCapsule("npc", { height: 1.8, radius: 0.5 }, scene);
    mesh.position.set(x, 0.9, z);
    const m = new StandardMaterial("nm", scene);
    m.diffuseColor = new Color3(0.75, 0.28, 0.28);
    m.emissiveColor = new Color3(0.2, 0.03, 0.03);
    mesh.material = m;
    makeLabel(scene, `⚔ ${name}`, new Vector3(x, 2.4, z));
    npcs.push({ mesh, name });
  }
  duelist(6, 4, "Rex the Duelist");
  duelist(-6, 6, "Wandering Duelist");
  duelist(0, 14, "City Champion");

  // ── DOM UI: prompt, exit, touch pad, action ─────────────────────────────────
  const ui = document.createElement("div");
  Object.assign(ui.style, { position: "fixed", inset: "0", zIndex: "51", pointerEvents: "none", fontFamily: "system-ui, sans-serif" } as CSSStyleDeclaration);
  document.body.appendChild(ui);

  const title = mkDiv(ui, "🌐 Battle City — 3D", { left: "12px", top: "10px", fontSize: "18px", fontWeight: "700", color: "#fff", textShadow: "0 1px 3px #000" });
  mkDiv(ui, "WASD / arrows to move · E or ⚔ to duel", { left: "12px", top: "36px", fontSize: "11px", color: "#c9d4ff", opacity: "0.85" });
  void title;

  const prompt = mkDiv(ui, "", { left: "50%", top: "16%", transform: "translateX(-50%)", fontSize: "14px", color: "#fff", background: "#000000aa", padding: "6px 10px", borderRadius: "8px", display: "none" });

  const exitBtn = mkButton(ui, "✕ Menu", { right: "12px", top: "10px" });
  exitBtn.onclick = () => opts.onExit();

  const actBtn = mkButton(ui, "⚔", { right: "20px", bottom: "24px", width: "64px", height: "64px", fontSize: "26px", borderRadius: "50%" });

  // On-screen movement pad (touch + mouse).
  const move = { x: 0, z: 0 };
  const pad = document.createElement("div");
  Object.assign(pad.style, { position: "fixed", left: "20px", bottom: "20px", zIndex: "51", width: "132px", height: "132px", pointerEvents: "auto" } as CSSStyleDeclaration);
  ui.appendChild(pad);
  const dirBtn = (glyph: string, gx: number, gy: number, ax: number, az: number) => {
    const b = mkButton(pad, glyph, { left: `${gx}px`, top: `${gy}px`, width: "42px", height: "42px", position: "absolute" });
    const set = (on: boolean) => {
      if (ax) move.x = on ? ax : (move.x === ax ? 0 : move.x);
      if (az) move.z = on ? az : (move.z === az ? 0 : move.z);
    };
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); set(true); });
    b.addEventListener("pointerup", () => set(false));
    b.addEventListener("pointerleave", () => set(false));
  };
  dirBtn("▲", 45, 0, 0, 1); dirBtn("▼", 45, 90, 0, -1); dirBtn("◀", 0, 45, -1, 0); dirBtn("▶", 90, 45, 1, 0);

  // ── Input ─────────────────────────────────────────────────────────────────
  const keys: Record<string, boolean> = {};
  const onKeyDown = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === "e") tryDuel(); };
  const onKeyUp = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  let nearest: Npc3d | null = null;
  function tryDuel(): void { if (nearest) opts.onDuel(nearest.name); }
  actBtn.onclick = tryDuel;

  // ── Loop ────────────────────────────────────────────────────────────────────
  const speed = 8; // units / second
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    let dx = move.x, dz = move.z;
    if (keys["a"] || keys["arrowleft"]) dx = -1;
    else if (keys["d"] || keys["arrowright"]) dx = 1;
    if (keys["w"] || keys["arrowup"]) dz = 1;
    else if (keys["s"] || keys["arrowdown"]) dz = -1;
    const len = Math.hypot(dx, dz) || 1;
    player.position.x = clamp(player.position.x + (dx / len) * speed * dt, -38, 38);
    player.position.z = clamp(player.position.z + (dz / len) * speed * dt, -38, 38);

    // Chase camera behind the player.
    camera.position.set(player.position.x, player.position.y + 7, player.position.z - 12);
    camera.setTarget(new Vector3(player.position.x, player.position.y + 0.5, player.position.z + 2));

    // Proximity.
    nearest = null;
    let best = 3.2;
    for (const n of npcs) {
      const d = Vector3.Distance(n.mesh.position, player.position);
      if (d < best) { best = d; nearest = n; }
    }
    if (nearest) { prompt.textContent = `${nearest.name} — press E / ⚔ to duel`; prompt.style.display = "block"; }
    else prompt.style.display = "none";
  });

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
      canvas.remove();
      ui.remove();
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

function makeLabel(scene: Scene, text: string, pos: Vector3): void {
  const plane = MeshBuilder.CreatePlane("label", { width: 5, height: 1.25 }, scene);
  plane.position.copyFrom(pos);
  plane.billboardMode = 7; // BILLBOARDMODE_ALL
  const tex = new DynamicTexture("labelTex", { width: 512, height: 128 }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = "rgba(10,13,22,0.7)";
  roundRect(ctx, 16, 24, 480, 80, 16);
  ctx.font = "bold 46px system-ui, sans-serif";
  ctx.fillStyle = "#ffe9b0";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 66);
  tex.update();
  const m = new StandardMaterial("labelMat", scene);
  m.diffuseTexture = tex; m.emissiveColor = new Color3(1, 1, 1);
  m.opacityTexture = tex; m.backFaceCulling = false;
  plane.material = m;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
}

function mkDiv(parent: HTMLElement, text: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const d = document.createElement("div");
  d.textContent = text;
  Object.assign(d.style, { position: "fixed", pointerEvents: "none" } as CSSStyleDeclaration, style);
  parent.appendChild(d);
  return d;
}
function mkButton(parent: HTMLElement, text: string, style: Partial<CSSStyleDeclaration>): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  Object.assign(b.style, {
    position: "fixed", pointerEvents: "auto", background: "#101830cc", color: "#e6ecff",
    border: "1px solid #3a4a80", borderRadius: "10px", padding: "8px 12px", fontSize: "14px",
    fontWeight: "700", cursor: "pointer", touchAction: "none",
  } as CSSStyleDeclaration, style);
  parent.appendChild(b);
  return b;
}
