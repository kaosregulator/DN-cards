// ─────────────────────────────────────────────────────────────────────────────
// HQ — recognizable stylized props.
//
 // Primitive placeholders (colored diamonds, pegs, cubes) are forbidden.
 // Every drawer paints a readable object: rugs with weave/border, couches with
 // cushions, chairs, tables, beds, cabinets, bookshelves, fireplaces, plants,
 // banners, statues, weapon racks, chests, crystals, lamps, and NPCs.
 // ─────────────────────────────────────────────────────────────────────────────

import { hexToRgba, type Ctx } from "../animations/engine.js";
import { ellipse, diamond, polyPath, shiftColor } from "./paint.js";
import type { DecoCategory } from "./defs/decorations.js";

export type PropKind =
  | "rug" | "couch" | "chair" | "table" | "bed" | "cabinet" | "bookshelf"
  | "fireplace" | "plant" | "banner" | "statue" | "weapon-rack" | "chest"
  | "crystal" | "lamp" | "npc" | "trophy" | "monument" | "case" | "emblem"
  | "tree" | "rock" | "fence" | "path" | "flowers" | "portrait";

export function propKindFor(category: DecoCategory, name = ""): PropKind {
  const n = name.toLowerCase();
  if (category === "rug") return "rug";
  if (category === "plant") return "plant";
  if (category === "banner") return "banner";
  if (category === "statue") {
    if (n.includes("table") || n.includes("desk") || n.includes("study") || n.includes("feast")) return "table";
    if (n.includes("bust") || n.includes("figurine") || n.includes("figure")) return "statue";
    return "statue";
  }
  if (category === "trophy") return "trophy";
  if (category === "monument") {
    if (n.includes("log")) return "chest";
    return "monument";
  }
  if (category === "light") return "lamp";
  if (category === "case") {
    if (n.includes("chest") || n.includes("barrel") || n.includes("crate") || n.includes("log")) return "chest";
    if (n.includes("cabinet") || n.includes("archive") || n.includes("display")) return "cabinet";
    return "case";
  }
  if (category === "crystal") return "crystal";
  if (category === "emblem") return "emblem";
  if (category === "tree") return "tree";
  if (category === "rock") return "rock";
  if (category === "fence") return "fence";
  if (category === "path") return "path";
  if (category === "flowers") return "flowers";
  if (category === "portrait") return "portrait";
  return "statue";
}

/** Map blueprint furniture ids → prop kinds. */
export function propKindFromId(id: string): PropKind {
  const map: Record<string, PropKind> = {
    rug: "rug", "welcome-rug": "rug", "woven-rug": "rug", "plush-rug": "rug", "royal-runner": "rug",
    "command-rug": "rug", "vault-rug": "rug",
    couch: "couch", sofa: "couch", chair: "chair", armchair: "chair", "officer-chair": "chair",
    table: "table", "feast-table": "table", "study-table": "table", desk: "table",
    "round-table": "table", "dining-set": "table", "briefing-table": "table",
    bed: "bed", cabinet: "cabinet", bookshelf: "bookshelf", shelves: "bookshelf",
    fireplace: "fireplace", plant: "plant", "starter-plant": "plant", "potted-palm": "plant",
    banner: "banner", "banner-first-win": "banner", "champion-banner": "banner",
    statue: "statue", "marble-bust": "statue", "collector-statue": "statue",
    "stone-column": "statue", "wood-column": "statue", "archway-deco": "monument",
    "door-frame": "monument", "window-bay": "monument", "stairs-deco": "monument", "wall-segment": "monument",
    "weapon-rack": "weapon-rack", rack: "weapon-rack",
    chest: "chest", "treasure-chest": "chest", "treasure-chest-open": "chest",
    "storage-barrel": "chest", "supply-crate": "chest", "barrels-stacked-tall": "chest",
    crystal: "crystal", "treasury-crystal": "crystal", "polished-geode": "crystal",
    lamp: "lamp", "floor-lamp": "lamp", "wall-sconce": "lamp", "streak-lantern": "lamp",
    npc: "npc", knight: "npc", mage: "npc", "npc-aide": "npc", "npc-scout": "npc",
    trophy: "trophy", "gilded-trophy": "trophy", "commander-trophy": "trophy",
    monument: "monument", case: "case", emblem: "emblem",
    tree: "tree", rock: "rock", fence: "fence", path: "path", flowers: "flowers",
  };
  return map[id] ?? (id.includes("figure") || id.startsWith("npc-") ? "npc" : "statue");
}

function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath(); ellipse(ctx, x, y, rx, ry); ctx.fill();
}

function isoTop(ctx: Ctx, cx: number, cy: number, hw: number, hh: number, fill: string, stroke?: string): void {
  polyPath(ctx, diamond(cx, cy, hw, hh));
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function isoBox(
  ctx: Ctx, cx: number, cy: number, hw: number, hh: number, h: number,
  top: string, left: string, right: string,
): void {
  const [t, r, b, l] = diamond(cx, cy, hw, hh);
  // left face
  polyPath(ctx, [l!, b!, { x: b!.x, y: b!.y + h }, { x: l!.x, y: l!.y + h }]);
  ctx.fillStyle = left; ctx.fill();
  // right face
  polyPath(ctx, [r!, b!, { x: b!.x, y: b!.y + h }, { x: r!.x, y: r!.y + h }]);
  ctx.fillStyle = right; ctx.fill();
  // top
  polyPath(ctx, [t!, r!, b!, l!]);
  ctx.fillStyle = top; ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; ctx.stroke();
}

/** Draw a recognizable prop anchored at feet (cx, feetY). */
export function drawProp(
  ctx: Ctx,
  kind: PropKind,
  cx: number,
  feetY: number,
  scale = 1,
  tint = 0xc0392b,
  seed = 1,
): void {
  const s = scale;
  ctx.save();
  switch (kind) {
    case "rug": drawRug(ctx, cx, feetY, s, tint); break;
    case "couch": drawCouch(ctx, cx, feetY, s, tint); break;
    case "chair": drawChair(ctx, cx, feetY, s, tint); break;
    case "table": drawTable(ctx, cx, feetY, s); break;
    case "bed": drawBed(ctx, cx, feetY, s, tint); break;
    case "cabinet": drawCabinet(ctx, cx, feetY, s); break;
    case "bookshelf": drawBookshelf(ctx, cx, feetY, s); break;
    case "fireplace": drawFireplace(ctx, cx, feetY, s); break;
    case "plant": drawPlant(ctx, cx, feetY, s); break;
    case "banner": drawBanner(ctx, cx, feetY, s, tint); break;
    case "statue": drawStatue(ctx, cx, feetY, s, tint); break;
    case "weapon-rack": drawWeaponRack(ctx, cx, feetY, s); break;
    case "chest": drawChest(ctx, cx, feetY, s, tint); break;
    case "crystal": drawCrystal(ctx, cx, feetY, s, tint); break;
    case "lamp": drawLamp(ctx, cx, feetY, s, tint); break;
    case "npc": drawNpc(ctx, cx, feetY, s, seed); break;
    case "trophy": drawTrophy(ctx, cx, feetY, s, tint); break;
    case "monument": drawMonument(ctx, cx, feetY, s, tint); break;
    case "case": drawCase(ctx, cx, feetY, s, tint); break;
    case "emblem": drawEmblem(ctx, cx, feetY, s, tint); break;
    case "tree": drawTree(ctx, cx, feetY, s); break;
    case "rock": drawRockProp(ctx, cx, feetY, s); break;
    case "fence": drawFenceProp(ctx, cx, feetY, s); break;
    case "path": drawPathProp(ctx, cx, feetY, s); break;
    case "flowers": drawFlowers(ctx, cx, feetY, s); break;
    default: drawStatue(ctx, cx, feetY, s, tint); break;
  }
  ctx.restore();
}

function drawRug(ctx: Ctx, cx: number, cy: number, s: number, tint: number): void {
  // Woven rug with border + medallion — never a flat colored diamond.
  const hw = 54 * s, hh = 28 * s;
  const hex = `#${tint.toString(16).padStart(6, "0")}`;
  shadow(ctx, cx, cy + 4 * s, hw * 0.9, hh * 0.35);
  isoTop(ctx, cx, cy, hw, hh, hexToRgba(tint, 0.92), "rgba(255,255,255,0.25)");
  isoTop(ctx, cx, cy, hw * 0.78, hh * 0.78, shiftColor(hex, -28));
  ctx.strokeStyle = "rgba(240,220,160,0.85)"; ctx.lineWidth = 2 * s;
  polyPath(ctx, diamond(cx, cy, hw * 0.72, hh * 0.72)); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.4, cy + i * 5 * s);
    ctx.lineTo(cx + hw * 0.4, cy + i * 5 * s);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(240,220,160,0.9)";
  ctx.beginPath(); ellipse(ctx, cx, cy, 8 * s, 5 * s); ctx.fill();
  ctx.fillStyle = hexToRgba(tint, 0.95);
  ctx.beginPath(); ellipse(ctx, cx, cy, 4 * s, 2.5 * s); ctx.fill();
}

function drawCouch(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 48 * s, 16 * s);
  const hex = `#${tint.toString(16).padStart(6, "0")}`;
  const seat = hexToRgba(tint, 0.95);
  const dark = shiftColor(hex, -40);
  const mid = shiftColor(hex, -18);
  // Wooden feet
  ctx.fillStyle = "#5a3d22";
  for (const dx of [-28, -10, 10, 28]) ctx.fillRect(cx + dx * s - 2 * s, feetY - 8 * s, 4 * s, 8 * s);
  // Seat slab (long rectangle in iso)
  isoBox(ctx, cx, feetY - 12 * s, 44 * s, 20 * s, 12 * s, seat, mid, dark);
  // Backrest — tall thin slab behind seat
  isoBox(ctx, cx - 4 * s, feetY - 28 * s, 40 * s, 8 * s, 22 * s, shiftColor(hex, 10), mid, dark);
  // Two seat cushions with seam
  isoTop(ctx, cx - 16 * s, feetY - 14 * s, 16 * s, 10 * s, "rgba(255,255,255,0.22)");
  isoTop(ctx, cx + 14 * s, feetY - 14 * s, 16 * s, 10 * s, "rgba(255,255,255,0.18)");
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(cx, feetY - 22 * s); ctx.lineTo(cx, feetY - 8 * s); ctx.stroke();
  // Arms
  isoBox(ctx, cx - 42 * s, feetY - 16 * s, 8 * s, 12 * s, 18 * s, seat, mid, dark);
  isoBox(ctx, cx + 42 * s, feetY - 16 * s, 8 * s, 12 * s, 18 * s, seat, mid, dark);
}

function drawChair(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 18 * s, 7 * s);
  const y = feetY - 8 * s;
  // Legs
  ctx.fillStyle = "#5a3d22";
  for (const [dx, dy] of [[-10, 2], [10, 2], [-6, -6], [6, -6]] as const) {
    ctx.fillRect(cx + dx * s - 1.5 * s, y + dy * s, 3 * s, 14 * s);
  }
  isoBox(ctx, cx, y, 16 * s, 10 * s, 6 * s, hexToRgba(tint, 0.95), hexToRgba(tint, 0.7), hexToRgba(tint, 0.55));
  isoBox(ctx, cx, y - 14 * s, 14 * s, 6 * s, 18 * s, hexToRgba(tint, 0.9), hexToRgba(tint, 0.65), hexToRgba(tint, 0.5));
}

function drawTable(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 36 * s, 12 * s);
  const y = feetY - 18 * s;
  ctx.fillStyle = "#5a3d22";
  for (const [dx, dy] of [[-22, 4], [22, 4], [-14, -8], [14, -8]] as const) {
    ctx.fillRect(cx + dx * s - 2 * s, y + dy * s, 4 * s, 22 * s);
  }
  isoBox(ctx, cx, y, 34 * s, 16 * s, 6 * s, "#c4a06a", "#8a6a3f", "#6b4f2c");
  // Papers / map glow on top
  isoTop(ctx, cx, y - 1 * s, 16 * s, 8 * s, "rgba(220,230,240,0.9)");
  ctx.fillStyle = "rgba(80,180,255,0.45)";
  ctx.beginPath(); ellipse(ctx, cx, y - 8 * s, 10 * s, 6 * s); ctx.fill();
}

function drawBed(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 40 * s, 14 * s);
  const y = feetY - 8 * s;
  isoBox(ctx, cx, y, 36 * s, 18 * s, 10 * s, "#8a6a3f", "#6b4f2c", "#5a3d22");
  isoTop(ctx, cx + 4 * s, y - 4 * s, 28 * s, 14 * s, hexToRgba(tint, 0.9));
  // Pillow
  isoBox(ctx, cx - 18 * s, y - 10 * s, 12 * s, 8 * s, 6 * s, "#f0e8d8", "#d8d0c0", "#c0b8a8");
  // Headboard
  isoBox(ctx, cx - 30 * s, y - 16 * s, 8 * s, 14 * s, 22 * s, "#8a6a3f", "#6b4f2c", "#5a3d22");
}

function drawCabinet(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 22 * s, 8 * s);
  const y = feetY - 28 * s;
  isoBox(ctx, cx, y, 20 * s, 12 * s, 36 * s, "#b8894e", "#8a6a3f", "#6b4f2c");
  // Doors
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(cx, y - 10 * s); ctx.lineTo(cx, y + 28 * s); ctx.stroke();
  ctx.fillStyle = "#d4af37";
  ctx.beginPath(); ctx.arc(cx - 6 * s, y + 8 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 6 * s, y + 8 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
}

function drawBookshelf(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 26 * s, 9 * s);
  const y = feetY - 32 * s;
  isoBox(ctx, cx, y, 24 * s, 12 * s, 42 * s, "#a87840", "#7a5530", "#5a3d22");
  const colors = ["#8b3a3a", "#3a5a8b", "#3a8b5a", "#8b7a3a", "#6a3a8b", "#8b5a3a"];
  for (let row = 0; row < 3; row++) {
    const ry = y + 4 * s + row * 12 * s;
    for (let b = 0; b < 5; b++) {
      ctx.fillStyle = colors[(row + b) % colors.length]!;
      ctx.fillRect(cx - 16 * s + b * 7 * s, ry, 5.5 * s, 10 * s);
    }
    ctx.fillStyle = "#5a3d22";
    ctx.fillRect(cx - 20 * s, ry + 10 * s, 40 * s, 2.5 * s);
  }
}

function drawFireplace(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 32 * s, 11 * s);
  const y = feetY - 20 * s;
  isoBox(ctx, cx, y, 30 * s, 16 * s, 28 * s, "#8a8680", "#6a6660", "#4a4640");
  // Opening
  ctx.fillStyle = "#1a1210";
  ctx.beginPath();
  ctx.moveTo(cx - 14 * s, y + 18 * s); ctx.lineTo(cx + 14 * s, y + 18 * s);
  ctx.lineTo(cx + 12 * s, y + 2 * s); ctx.lineTo(cx - 12 * s, y + 2 * s);
  ctx.closePath(); ctx.fill();
  // Fire
  ctx.fillStyle = "#ff9030";
  ctx.beginPath(); ctx.moveTo(cx, y + 2 * s); ctx.lineTo(cx + 8 * s, y + 16 * s); ctx.lineTo(cx - 8 * s, y + 16 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffe060";
  ctx.beginPath(); ctx.moveTo(cx, y + 6 * s); ctx.lineTo(cx + 4 * s, y + 15 * s); ctx.lineTo(cx - 4 * s, y + 15 * s); ctx.closePath(); ctx.fill();
  // Mantel
  isoBox(ctx, cx, y - 14 * s, 34 * s, 10 * s, 5 * s, "#a09a90", "#7a746c", "#5a544c");
}

function drawPlant(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 14 * s, 5 * s);
  // Pot
  ctx.fillStyle = "#a06a3a";
  ctx.beginPath();
  ctx.moveTo(cx - 10 * s, feetY - 14 * s); ctx.lineTo(cx + 10 * s, feetY - 14 * s);
  ctx.lineTo(cx + 7 * s, feetY); ctx.lineTo(cx - 7 * s, feetY);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#5a3d22"; ctx.fillRect(cx - 11 * s, feetY - 16 * s, 22 * s, 3 * s);
  // Leaves
  const leaf = (dx: number, dy: number, rot: number) => {
    ctx.save();
    ctx.translate(cx + dx * s, feetY - 28 * s + dy * s);
    ctx.rotate(rot);
    ctx.fillStyle = "#2f8a44";
    ctx.beginPath(); ellipse(ctx, 0, 0, 6 * s, 14 * s); ctx.fill();
    ctx.fillStyle = "#4aba5a";
    ctx.beginPath(); ellipse(ctx, -1.5 * s, -2 * s, 2.5 * s, 10 * s); ctx.fill();
    ctx.restore();
  };
  leaf(0, -8, 0); leaf(-10, 0, -0.5); leaf(10, 0, 0.5); leaf(-6, -14, -0.25); leaf(6, -14, 0.25);
}

function drawBanner(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 10 * s, 4 * s);
  ctx.strokeStyle = "#c9c1a8"; ctx.lineWidth = 3 * s;
  ctx.beginPath(); ctx.moveTo(cx, feetY); ctx.lineTo(cx, feetY - 70 * s); ctx.stroke();
  ctx.fillStyle = hexToRgba(tint, 0.95);
  ctx.beginPath();
  ctx.moveTo(cx - 16 * s, feetY - 68 * s); ctx.lineTo(cx + 16 * s, feetY - 68 * s);
  ctx.lineTo(cx + 16 * s, feetY - 28 * s); ctx.lineTo(cx, feetY - 36 * s); ctx.lineTo(cx - 16 * s, feetY - 28 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(cx, feetY - 58 * s); ctx.lineTo(cx + 5 * s, feetY - 50 * s); ctx.lineTo(cx, feetY - 42 * s); ctx.lineTo(cx - 5 * s, feetY - 50 * s);
  ctx.closePath(); ctx.fill();
}

function drawStatue(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 16 * s, 6 * s);
  isoBox(ctx, cx, feetY - 6 * s, 16 * s, 8 * s, 8 * s, "#b0a898", "#8a8278", "#6a6258");
  const stone = hexToRgba(tint, 0.55);
  ctx.fillStyle = stone;
  // Body
  ctx.beginPath();
  ctx.moveTo(cx - 8 * s, feetY - 14 * s); ctx.lineTo(cx + 8 * s, feetY - 14 * s);
  ctx.lineTo(cx + 10 * s, feetY - 40 * s); ctx.lineTo(cx - 10 * s, feetY - 40 * s);
  ctx.closePath(); ctx.fill();
  // Head
  ctx.beginPath(); ellipse(ctx, cx, feetY - 48 * s, 7 * s, 8 * s); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ellipse(ctx, cx - 2 * s, feetY - 50 * s, 3 * s, 4 * s); ctx.fill();
}

function drawWeaponRack(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 22 * s, 7 * s);
  ctx.fillStyle = "#6b4f2c";
  ctx.fillRect(cx - 20 * s, feetY - 4 * s, 40 * s, 5 * s);
  ctx.fillRect(cx - 18 * s, feetY - 50 * s, 5 * s, 46 * s);
  ctx.fillRect(cx + 13 * s, feetY - 50 * s, 5 * s, 46 * s);
  ctx.fillRect(cx - 18 * s, feetY - 52 * s, 36 * s, 4 * s);
  // Swords / spears
  const blades = ["#c0c8d0", "#a8b0b8", "#d0d8e0"];
  for (let i = 0; i < 3; i++) {
    const x = cx - 10 * s + i * 10 * s;
    ctx.strokeStyle = blades[i]!; ctx.lineWidth = 2.5 * s;
    ctx.beginPath(); ctx.moveTo(x, feetY - 8 * s); ctx.lineTo(x + (i - 1) * 4 * s, feetY - 48 * s); ctx.stroke();
    ctx.fillStyle = "#c9a24a";
    ctx.fillRect(x - 3 * s, feetY - 14 * s, 6 * s, 3 * s);
  }
}

function drawChest(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 24 * s, 9 * s);
  const y = feetY - 10 * s;
  isoBox(ctx, cx, y, 22 * s, 12 * s, 16 * s, "#b8894e", "#8a6a3f", "#6b4f2c");
  // Lid
  isoBox(ctx, cx, y - 12 * s, 22 * s, 12 * s, 8 * s, "#c99a5a", "#9a7545", "#7a5530");
  ctx.fillStyle = hexToRgba(tint, 0.95);
  ctx.fillRect(cx - 3 * s, y - 4 * s, 6 * s, 8 * s);
  ctx.fillStyle = "#d4af37";
  ctx.beginPath(); ctx.arc(cx, y, 3 * s, 0, Math.PI * 2); ctx.fill();
}

function drawCrystal(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 14 * s, 5 * s);
  isoBox(ctx, cx, feetY - 4 * s, 12 * s, 6 * s, 5 * s, "#6a6570", "#4a4550", "#3a3540");
  ctx.save();
  ctx.shadowColor = hexToRgba(tint, 0.8); ctx.shadowBlur = 16 * s;
  ctx.fillStyle = hexToRgba(tint, 0.9);
  ctx.beginPath();
  ctx.moveTo(cx, feetY - 48 * s); ctx.lineTo(cx + 12 * s, feetY - 18 * s);
  ctx.lineTo(cx + 4 * s, feetY - 8 * s); ctx.lineTo(cx - 4 * s, feetY - 8 * s); ctx.lineTo(cx - 12 * s, feetY - 18 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.moveTo(cx, feetY - 48 * s); ctx.lineTo(cx + 4 * s, feetY - 20 * s); ctx.lineTo(cx - 2 * s, feetY - 12 * s); ctx.lineTo(cx - 6 * s, feetY - 22 * s);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawLamp(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 12 * s, 4 * s);
  ctx.fillStyle = "#5a5a60";
  ctx.fillRect(cx - 2 * s, feetY - 36 * s, 4 * s, 36 * s);
  isoBox(ctx, cx, feetY - 2 * s, 10 * s, 5 * s, 3 * s, "#707078", "#505058", "#404048");
  ctx.save();
  ctx.shadowColor = hexToRgba(tint, 0.85); ctx.shadowBlur = 20 * s;
  ctx.fillStyle = hexToRgba(tint, 0.9);
  ctx.beginPath();
  ctx.moveTo(cx - 10 * s, feetY - 36 * s); ctx.lineTo(cx + 10 * s, feetY - 36 * s);
  ctx.lineTo(cx + 6 * s, feetY - 50 * s); ctx.lineTo(cx - 6 * s, feetY - 50 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,220,0.85)";
  ctx.beginPath(); ellipse(ctx, cx, feetY - 40 * s, 4 * s, 3 * s); ctx.fill();
  ctx.restore();
}

const NPC_PALETTES = [
  { tunic: "#3a5a8b", trim: "#c9a24a", hair: "#2a2a2a" },
  { tunic: "#8b3a3a", trim: "#d0d0d0", hair: "#5a3d22" },
  { tunic: "#2f6b34", trim: "#8a6a3f", hair: "#1a1a1a" },
  { tunic: "#5a3a8b", trim: "#70c0e8", hair: "#c0c0c0" },
  { tunic: "#8b6a2a", trim: "#4a4a4a", hair: "#3a2818" },
];

function drawNpc(ctx: Ctx, cx: number, feetY: number, s: number, seed: number): void {
  const p = NPC_PALETTES[Math.abs(seed) % NPC_PALETTES.length]!;
  shadow(ctx, cx, feetY, 14 * s, 5 * s);
  // Boots
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(cx - 8 * s, feetY - 6 * s, 6 * s, 6 * s);
  ctx.fillRect(cx + 2 * s, feetY - 6 * s, 6 * s, 6 * s);
  // Legs
  ctx.fillStyle = "#4a3a2a";
  ctx.fillRect(cx - 7 * s, feetY - 18 * s, 5 * s, 12 * s);
  ctx.fillRect(cx + 2 * s, feetY - 18 * s, 5 * s, 12 * s);
  // Torso with shoulder pads / cape hint
  ctx.fillStyle = p.tunic;
  ctx.beginPath();
  ctx.moveTo(cx - 11 * s, feetY - 18 * s); ctx.lineTo(cx + 11 * s, feetY - 18 * s);
  ctx.lineTo(cx + 9 * s, feetY - 40 * s); ctx.lineTo(cx - 9 * s, feetY - 40 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = p.trim;
  ctx.fillRect(cx - 9 * s, feetY - 28 * s, 18 * s, 3 * s);
  // Arms
  ctx.fillStyle = p.tunic;
  ctx.fillRect(cx - 15 * s, feetY - 38 * s, 5 * s, 16 * s);
  ctx.fillRect(cx + 10 * s, feetY - 38 * s, 5 * s, 16 * s);
  // Head
  ctx.fillStyle = "#e6b98f";
  ctx.beginPath(); ellipse(ctx, cx, feetY - 48 * s, 7 * s, 8 * s); ctx.fill();
  // Hair
  ctx.fillStyle = p.hair;
  ctx.beginPath(); ctx.arc(cx, feetY - 50 * s, 7.5 * s, Math.PI, 0); ctx.closePath(); ctx.fill();
  // Eyes
  ctx.fillStyle = "#2a2a2a";
  ctx.beginPath(); ctx.arc(cx - 2.5 * s, feetY - 48 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 2.5 * s, feetY - 48 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
}

function drawTrophy(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 12 * s, 4 * s);
  isoBox(ctx, cx, feetY - 4 * s, 12 * s, 6 * s, 4 * s, "#5a5a60", "#404048", "#303038");
  ctx.fillStyle = hexToRgba(tint, 0.95);
  ctx.fillRect(cx - 2 * s, feetY - 18 * s, 4 * s, 12 * s);
  ctx.beginPath();
  ctx.moveTo(cx - 12 * s, feetY - 40 * s); ctx.lineTo(cx + 12 * s, feetY - 40 * s);
  ctx.quadraticCurveTo(cx + 12 * s, feetY - 18 * s, cx, feetY - 14 * s);
  ctx.quadraticCurveTo(cx - 12 * s, feetY - 18 * s, cx - 12 * s, feetY - 40 * s);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hexToRgba(tint, 0.95); ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.arc(cx - 12 * s, feetY - 32 * s, 6 * s, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 12 * s, feetY - 32 * s, 6 * s, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
}

function drawMonument(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 16 * s, 6 * s);
  isoBox(ctx, cx, feetY - 4 * s, 16 * s, 8 * s, 5 * s, "#9a968e", "#7a766e", "#5a564e");
  ctx.fillStyle = hexToRgba(tint, 0.9);
  ctx.beginPath();
  ctx.moveTo(cx - 6 * s, feetY - 8 * s); ctx.lineTo(cx - 3 * s, feetY - 55 * s);
  ctx.lineTo(cx + 3 * s, feetY - 55 * s); ctx.lineTo(cx + 6 * s, feetY - 8 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(cx - 2 * s, feetY - 55 * s); ctx.lineTo(cx + 3 * s, feetY - 55 * s);
  ctx.lineTo(cx + 4 * s, feetY - 20 * s); ctx.lineTo(cx - 1 * s, feetY - 20 * s);
  ctx.closePath(); ctx.fill();
}

function drawCase(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 18 * s, 6 * s);
  isoBox(ctx, cx, feetY - 20 * s, 16 * s, 10 * s, 28 * s, "#d8e8f0", "#a0b0c0", "#8090a0");
  ctx.strokeStyle = hexToRgba(tint, 0.8); ctx.lineWidth = 2 * s;
  polyPath(ctx, diamond(cx, feetY - 20 * s, 16 * s, 10 * s)); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(cx - 4 * s, feetY - 40 * s, 3 * s, 24 * s);
}

function drawEmblem(ctx: Ctx, cx: number, feetY: number, s: number, tint: number): void {
  shadow(ctx, cx, feetY, 10 * s, 4 * s);
  ctx.save();
  ctx.shadowColor = hexToRgba(tint, 0.7); ctx.shadowBlur = 12 * s;
  ctx.fillStyle = hexToRgba(tint, 0.95);
  ctx.beginPath(); ctx.arc(cx, feetY - 22 * s, 16 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.arc(cx, feetY - 22 * s, 10 * s, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(cx, feetY - 30 * s); ctx.lineTo(cx + 4 * s, feetY - 22 * s); ctx.lineTo(cx, feetY - 14 * s); ctx.lineTo(cx - 4 * s, feetY - 22 * s);
  ctx.closePath(); ctx.fill();
}

function drawTree(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 16 * s, 6 * s);
  ctx.fillStyle = "#5a3d22";
  ctx.fillRect(cx - 3 * s, feetY - 18 * s, 6 * s, 18 * s);
  const layers = [
    { y: 0.15, w: 0.38, c: "#2a6a32" },
    { y: -0.12, w: 0.32, c: "#328a3c" },
    { y: -0.36, w: 0.24, c: "#3aaa48" },
  ];
  for (const L of layers) {
    const ty = feetY + L.y * 70 * s;
    ctx.fillStyle = L.c;
    ctx.beginPath();
    ctx.moveTo(cx, ty - 28 * s);
    ctx.lineTo(cx + L.w * 70 * s, ty);
    ctx.lineTo(cx - L.w * 70 * s, ty);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(cx, ty - 28 * s); ctx.lineTo(cx - L.w * 70 * s, ty); ctx.lineTo(cx - L.w * 35 * s, ty);
    ctx.closePath(); ctx.fill();
  }
}

function drawRockProp(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 18 * s, 6 * s);
  ctx.fillStyle = "#8b9099";
  ctx.beginPath();
  ctx.moveTo(cx - 18 * s, feetY); ctx.lineTo(cx - 10 * s, feetY - 18 * s);
  ctx.lineTo(cx + 6 * s, feetY - 22 * s); ctx.lineTo(cx + 18 * s, feetY - 6 * s);
  ctx.lineTo(cx + 12 * s, feetY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#a9aeb6";
  ctx.beginPath();
  ctx.moveTo(cx - 10 * s, feetY - 18 * s); ctx.lineTo(cx + 6 * s, feetY - 22 * s);
  ctx.lineTo(cx + 2 * s, feetY - 10 * s); ctx.lineTo(cx - 4 * s, feetY - 10 * s);
  ctx.closePath(); ctx.fill();
}

function drawFenceProp(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 28 * s, 6 * s);
  const wood = "#c19a5b";
  ctx.strokeStyle = wood; ctx.lineWidth = Math.max(2, 3 * s);
  ctx.beginPath(); ctx.moveTo(cx - 28 * s, feetY - 14 * s); ctx.lineTo(cx + 28 * s, feetY - 14 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 28 * s, feetY - 26 * s); ctx.lineTo(cx + 28 * s, feetY - 26 * s); ctx.stroke();
  ctx.fillStyle = wood;
  for (let i = -2; i <= 2; i++) {
    const px = cx + i * 12 * s;
    ctx.beginPath();
    ctx.moveTo(px - 3 * s, feetY); ctx.lineTo(px - 3 * s, feetY - 32 * s);
    ctx.lineTo(px, feetY - 38 * s); ctx.lineTo(px + 3 * s, feetY - 32 * s); ctx.lineTo(px + 3 * s, feetY);
    ctx.closePath(); ctx.fill();
  }
}

function drawPathProp(ctx: Ctx, cx: number, feetY: number, s: number): void {
  isoTop(ctx, cx, feetY, 28 * s, 14 * s, "#b9a888", "rgba(90,78,58,0.5)");
  ctx.strokeStyle = "rgba(90,78,58,0.45)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 10 * s, feetY - 2 * s); ctx.lineTo(cx + 4 * s, feetY + 4 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 2 * s, feetY - 4 * s); ctx.lineTo(cx + 12 * s, feetY + 2 * s); ctx.stroke();
}

function drawFlowers(ctx: Ctx, cx: number, feetY: number, s: number): void {
  shadow(ctx, cx, feetY, 16 * s, 5 * s);
  isoTop(ctx, cx, feetY, 18 * s, 9 * s, "#5a3d22");
  const petals = ["#e05a7a", "#f2c14e", "#8e6bd6", "#ffffff", "#4ec0e8"];
  for (let i = 0; i < 5; i++) {
    const bx = cx + (i - 2) * 7 * s;
    const by = feetY - 8 * s - Math.abs(i - 2) * 2 * s;
    ctx.fillStyle = "#2f6b34";
    ctx.fillRect(bx - 1 * s, by, 2 * s, 8 * s);
    ctx.fillStyle = petals[i]!;
    ctx.beginPath(); ctx.arc(bx, by, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f7e07a";
    ctx.beginPath(); ctx.arc(bx, by, 1.5 * s, 0, Math.PI * 2); ctx.fill();
  }
}
