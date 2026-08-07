// ─────────────────────────────────────────────────────────────────────────────
// /hqbuild — the typed half of the HQ world editor.
//
// `/hq → 🛠️ Build` is the visual editor: nudge a cursor around a rendered
// lattice and press Place. This is the same editor for people who would rather
// say what they want: exact coordinates, exact spans, one command.
//
// Both halves share the SAME state — the cursor in `player_hq.stats.build`, the
// rectangles in `hq_terrain`, the validation in bot/hq/terrain.ts — so you can
// line a shape up with the arrows and then fine-tune it by typing, or the other
// way round. Every subcommand replies with a freshly rendered picture of the
// canvas, so a build is never done blind.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";

import { getOrCreateHq, getUnlockedItemIds } from "../hq/db.js";
import { isRoomUnlocked, isSurfaceUnlocked, isWallpaperUnlocked } from "../hq/engine.js";
import { resolveRoom } from "../hq/defs/rooms.js";
import { getSurfaceById, surfacesFor } from "../hq/defs/surfaces.js";
import { resolveWallpaper, getWallpaperById, DEFAULT_WALLPAPER_ID } from "../hq/defs/wallpapers.js";
import {
  listTerrain, placeTerrain, removeTerrainAt, removeTerrainById, clearTerrain,
  describeFeature, BASE_CANVAS_ID, MAX_FEATURES_PER_CANVAS, MAX_RECT_SPAN, MAX_ELEVATION,
} from "../hq/terrain.js";
import { readCursor, saveCursor, clampCursor, type BuildCursor, type StoredBuild } from "../hq/build-state.js";
import { withHqLock } from "../hq/lock.js";
import { HQ_GRID, HQ_BASE_GRID } from "../hq/grid.js";
import { renderBuildCanvas, setHqWallpaper, HQ_FILE } from "./hq-hub.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

function gridFor(canvas: string): number {
  return canvas === BASE_CANVAS_ID ? HQ_BASE_GRID : HQ_GRID;
}

function canvasName(canvas: string): string {
  return canvas === BASE_CANVAS_ID ? "Base grounds" : resolveRoom(canvas).name;
}

// Resolve which canvas a subcommand targets: an explicit `where` option, else
// wherever the cursor was last parked (so typed and visual edits agree).
async function resolveCanvas(
  guildId: string, userId: string, requested: string | null, cursor: BuildCursor,
): Promise<{ canvas: string; error?: string }> {
  if (!requested) return { canvas: cursor.canvas };
  if (requested === BASE_CANVAS_ID) return { canvas: BASE_CANVAS_ID };
  const room = resolveRoom(requested);
  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  if (!isRoomUnlocked(room, owned)) {
    return { canvas: cursor.canvas, error: `🔒 You haven't unlocked **${room.name}** yet.` };
  }
  return { canvas: room.id };
}

async function loadCursor(guildId: string, userId: string): Promise<BuildCursor> {
  const hq = await getOrCreateHq(guildId, userId);
  const stored = (hq.stats as { build?: StoredBuild } | null)?.build;
  const canvas = stored?.canvas ?? BASE_CANVAS_ID;
  return readCursor(stored, canvas, gridFor(canvas));
}

// Every reply shows the canvas as it now stands, with the cursor where the
// command left it — the point of a world editor is seeing the result.
async function replyWithCanvas(
  interaction: ChatInputCommandInteraction, canvas: string, cursor: BuildCursor,
  title: string, body: string, color: number,
): Promise<void> {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(body.slice(0, 4000));
  const file = await renderBuildCanvas(interaction, canvas, cursor).catch(() => null);
  if (file) embed.setImage(`attachment://${HQ_FILE}`);
  await interaction.editReply({ embeds: [embed], files: file ? [file] : [] }).catch(() => {});
}

export async function handleHqBuildCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ This command can only be used in a server.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  await interaction.deferReply(EPHEMERAL).catch(() => {});
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(false) ?? "view";

  switch (sub) {
    case "place": return buildPlace(interaction, guildId, userId);
    case "remove": return buildRemove(interaction, guildId, userId);
    case "clear": return buildClear(interaction, guildId, userId);
    case "list": return buildList(interaction, guildId, userId);
    case "wallpaper": return buildWallpaper(interaction, guildId, userId);
    case "materials": return buildMaterials(interaction, guildId, userId);
    default: return buildViewOnly(interaction, guildId, userId);
  }
}

// ── /hqbuild view ─────────────────────────────────────────────────────────────
async function buildViewOnly(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const cursor = await loadCursor(guildId, userId);
  const { canvas, error } = await resolveCanvas(guildId, userId, interaction.options.getString("where"), cursor);
  const grid = gridFor(canvas);
  const features = await listTerrain(guildId, userId, canvas).catch(() => []);
  const shown = clampCursor({ ...cursor, canvas }, grid);
  await replyWithCanvas(interaction, canvas, shown,
    `🛠️ ${canvasName(canvas)}`,
    (error ? `${error}\n\n` : "") +
    `A **${grid}×${grid}** grid. The rulers on the picture are the **X** and **Y** you pass to ` +
    "`/hqbuild place`.\n" +
    `🧱 Built here: **${features.length}** / ${MAX_FEATURES_PER_CANVAS}\n` +
    "Try `/hqbuild place material:Pond x:3 y:4 width:3 height:2`.",
    0x2fd4d4);
}

// ── /hqbuild place ────────────────────────────────────────────────────────────
async function buildPlace(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const cursor = await loadCursor(guildId, userId);
  const { canvas, error } = await resolveCanvas(guildId, userId, interaction.options.getString("where"), cursor);
  const grid = gridFor(canvas);

  const materialId = interaction.options.getString("material") ?? cursor.materialId;
  const mat = getSurfaceById(materialId);
  if (!mat) {
    await interaction.editReply({ content: `❌ Unknown material \`${materialId}\`. Try \`/hqbuild materials\`.` }).catch(() => {});
    return;
  }
  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  if (!isSurfaceUnlocked(mat, owned)) {
    await interaction.editReply({
      content: `🔒 You haven't unlocked ${mat.emoji} **${mat.name}** yet — it's in **/hq → 🛒 Shop → Surfaces**.`,
    }).catch(() => {});
    return;
  }

  const rect = {
    materialId: mat.id,
    x: interaction.options.getInteger("x") ?? cursor.x,
    y: interaction.options.getInteger("y") ?? cursor.y,
    w: interaction.options.getInteger("width") ?? cursor.w,
    h: interaction.options.getInteger("height") ?? cursor.h,
    elevation: interaction.options.getInteger("lift") ?? cursor.elevation,
  };

  const result = await withHqLock(`hq:build:${guildId}:${userId}`, () =>
    placeTerrain(guildId, userId, canvas, grid, rect));

  // Park the cursor on whatever was just asked for, so the visual editor picks
  // up exactly where the command left off (and a rejected build can be nudged).
  const moved = clampCursor({
    canvas, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    materialId: mat.id, elevation: rect.elevation,
  }, grid);
  await saveCursor(guildId, userId, moved).catch(() => {});

  if (!result.ok) {
    await replyWithCanvas(interaction, canvas, moved,
      "🛠️ Couldn't build that",
      `${error ? `${error}\n\n` : ""}❌ ${result.reason}`,
      0xc0392b);
    return;
  }
  const count = (await listTerrain(guildId, userId, canvas).catch(() => [])).length;
  await replyWithCanvas(interaction, canvas, moved,
    "🛠️ Built",
    `${error ? `${error}\n\n` : ""}✅ Placed ${describeFeature(result.feature)} on **${canvasName(canvas)}**.\n` +
    `🧱 **${count}** / ${MAX_FEATURES_PER_CANVAS} surfaces here.`,
    0x4fd06a);
}

// ── /hqbuild remove ───────────────────────────────────────────────────────────
async function buildRemove(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const cursor = await loadCursor(guildId, userId);
  const { canvas } = await resolveCanvas(guildId, userId, interaction.options.getString("where"), cursor);
  const grid = gridFor(canvas);
  const id = interaction.options.getInteger("id");
  const x = interaction.options.getInteger("x") ?? cursor.x;
  const y = interaction.options.getInteger("y") ?? cursor.y;

  const removed = await withHqLock(`hq:build:${guildId}:${userId}`, async () => {
    if (id != null) return (await removeTerrainById(guildId, userId, id)) ? "id" : null;
    const hit = await removeTerrainAt(guildId, userId, canvas, x, y);
    return hit ? describeFeature(hit) : null;
  });

  const shown = clampCursor({ ...cursor, canvas, x, y }, grid);
  await saveCursor(guildId, userId, shown).catch(() => {});
  await replyWithCanvas(interaction, canvas, shown,
    removed ? "🛠️ Removed" : "🛠️ Nothing there",
    removed
      ? (removed === "id" ? `🗑️ Removed surface **#${id}**.` : `🗑️ Removed ${removed}.`)
      : `Nothing built at **(${x}, ${y})** on **${canvasName(canvas)}**.`,
    removed ? 0xe0b83a : 0x9aa0a8);
}

// ── /hqbuild clear ────────────────────────────────────────────────────────────
async function buildClear(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const cursor = await loadCursor(guildId, userId);
  const { canvas } = await resolveCanvas(guildId, userId, interaction.options.getString("where"), cursor);
  const n = await withHqLock(`hq:build:${guildId}:${userId}`, () => clearTerrain(guildId, userId, canvas));
  await replyWithCanvas(interaction, canvas, clampCursor({ ...cursor, canvas }, gridFor(canvas)),
    "🛠️ Bulldozed",
    n > 0
      ? `🧹 Cleared **${n}** built surface${n === 1 ? "" : "s"} from **${canvasName(canvas)}**.`
      : `**${canvasName(canvas)}** had nothing built on it.`,
    0xc0392b);
}

// ── /hqbuild list ─────────────────────────────────────────────────────────────
async function buildList(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const cursor = await loadCursor(guildId, userId);
  const { canvas } = await resolveCanvas(guildId, userId, interaction.options.getString("where"), cursor);
  const features = await listTerrain(guildId, userId, canvas).catch(() => []);
  const body = features.length === 0
    ? `Nothing built on **${canvasName(canvas)}** yet. Start with \`/hqbuild place\`.`
    : features.map(f => `\`#${f.id}\` ${describeFeature(f)}`).join("\n");
  await replyWithCanvas(interaction, canvas, clampCursor({ ...cursor, canvas }, gridFor(canvas)),
    `🛠️ ${canvasName(canvas)} — ${features.length}/${MAX_FEATURES_PER_CANVAS} surfaces`,
    `${body}\n\nRemove one with \`/hqbuild remove id:<number>\`.`,
    0x2fd4d4);
}

// ── /hqbuild wallpaper ────────────────────────────────────────────────────────
async function buildWallpaper(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const wanted = interaction.options.getString("style", true);
  const wp = getWallpaperById(wanted) ?? resolveWallpaper(wanted);
  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  if (!isWallpaperUnlocked(wp, owned)) {
    await interaction.editReply({
      content: `🔒 You haven't unlocked ${wp.emoji} **${wp.name}** yet — it's in **/hq → 🛒 Shop → Surfaces**.`,
    }).catch(() => {});
    return;
  }
  await setHqWallpaper(guildId, userId, wp.id);

  // Show the room it was hung in, not the grounds.
  const hq = await getOrCreateHq(guildId, userId);
  const cursor = await loadCursor(guildId, userId);
  const room = resolveRoom(hq.activeRoomId);
  await replyWithCanvas(interaction, room.id, clampCursor({ ...cursor, canvas: room.id }, HQ_GRID),
    "🖼️ Wallpaper hung",
    wp.id === DEFAULT_WALLPAPER_ID
      ? `Stripped the paper back to the plain **${room.name}** wall style.`
      : `Hung ${wp.emoji} **${wp.name}** in **${room.name}** — _${wp.motif}_ motif with ` +
        `${wp.dado ? "a dado rail and " : ""}skirting.`,
    0x9b59b6);
}

// ── /hqbuild materials ────────────────────────────────────────────────────────
async function buildMaterials(
  interaction: ChatInputCommandInteraction, guildId: string, userId: string,
): Promise<void> {
  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  const cursor = await loadCursor(guildId, userId);
  const space = cursor.canvas === BASE_CANVAS_ID ? "outdoor" : "indoor";
  const list = surfacesFor(space);
  const lines = list.map(s => {
    const have = isSurfaceUnlocked(s, owned);
    const cost = typeof s.price === "number" ? ` · 💠 ${s.price}` : "";
    return `${have ? s.emoji : "🔒"} **${s.name}** — ${s.kind}${cost}`;
  });
  const embed = new EmbedBuilder().setColor(0x2fd4d4)
    .setTitle(`🎨 Build materials — ${space}`)
    .setDescription(
      `Materials you can paint onto **${canvasName(cursor.canvas)}**. Locked ones are sold in ` +
      "**/hq → 🛒 Shop → Surfaces**.\n\n" + lines.join("\n").slice(0, 3500),
    )
    .addFields(
      { name: "Max rectangle", value: `${MAX_RECT_SPAN}×${MAX_RECT_SPAN} tiles`, inline: true },
      { name: "Max lift", value: `${MAX_ELEVATION} steps`, inline: true },
      { name: "Per-space limit", value: `${MAX_FEATURES_PER_CANVAS} surfaces`, inline: true },
    );
  await interaction.editReply({ embeds: [embed] }).catch(() => {});
}
