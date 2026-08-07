// ─────────────────────────────────────────────────────────────────────────────
// /hq — Player Headquarters hub.
//
// The persistent, per-server player home & showcase. `/hq` opens YOUR editable
// HQ (ephemeral); `/hq user:@member` visits someone else's, read-only. The HQ
// image is rendered by bot/hq/render.ts; progression/unlocks are derived by
// bot/hq/engine.ts from the systems you already play. Follows the repo hub
// pattern (user-hub / collection-hub): EPHEMERAL, Section dropdown, one
// component router, buildView → { embeds, components, files }. customIds are
// `hq-hub:<action>[:arg]`.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import {
  getAllCardsCached, getUserCollection, getOrCreateGuildSettings,
  getRarityContext, getRarityDisplayOverrides, getCardDisplayRarity,
  getOrCreateCurrency, spendShards, addShards,
} from "../db.js";
import { rarityColor, SHINY_EMOJI, BUILTIN_RARITIES, type Rarity } from "../cards-data.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { renderCardRevealCanvas, CARD_REVEAL_FILE } from "../cards/card-reveal-canvas.js";
import { buildCardLevelEmbed } from "../cards/level-command.js";
import {
  getOrCreateHq, updateHq, getDisplays, pinDisplay, clearDisplay,
  getPlacements, placeDecoration, clearPlacement, pruneUnownedPlacements,
  getUnlockedItemIds, grantUnlock,
  getDefenders, setDefender, clearDefender, getGuildBases,
  getBaseState, applySiegeToBase, logSiege, recentAttackCount, reclaimBase,
  getConquestLeaders, getHeldBases, markTributesCollected, getReignLeaders,
  setBaseShield,
} from "../hq/db.js";
import {
  computeFortification, baseTier, nextBaseTier, SHIELD_PRODUCTS, shieldProduct,
} from "../hq/fortify.js";
import {
  shopRotation, formatRefreshIn,
  SHOP_AISLES, purchasableInAisle, shopPriceFor,
  buyableSurfaces, surfaceById,
} from "../hq/shop.js";
import {
  resolveSiege, SIEGE_SHIELD_MS, SIEGE_COOLDOWN_MS, SIEGE_MAX_PER_WINDOW,
  tributeOwed, TRIBUTE_PER_HOUR, type SiegeCombatant,
} from "../hq/siege.js";
import { simulateSiegeBattle, buildSiegeSquad, type SiegeBattleResult } from "../hq/siege-battle.js";
import {
  startSiege, handleSiegeComponent, isSiegeTargetActive,
  // Aliased: `SiegeOutcome` below is the AUTO-resolver's richer shape, which
  // predates the turn-for-turn runtime and carries the render plan.
  type SiegeOutcome as TurnSiegeOutcome, type SiegeResultView as TurnSiegeResultView,
} from "../hq/siege-runtime.js";
import {
  getSiegeConfig, siegeModeMeta, type HqSiegeConfig,
} from "../hq/settings.js";
import {
  listTerritories, captureTerritory, markTerritoryAttacked, getHeldTerritories,
  markTerritoryTributesCollected, territoryTributeOwed, buildGarrison, holderLabel,
  WORLD_SHIELD_MS, WORLD_COOLDOWN_MS, WORLD_MAX_PER_WINDOW, type WorldTerritoryView,
} from "../hq/world.js";
import {
  getTerritory, tierProfile, tierStars, PLAYER_BASE_ANCHORS, HQ_ROUTES,
} from "../hq/defs/world.js";
import { renderSiegeCinematic, SIEGE_CINEMATIC_FILE, type SiegeCinematicView } from "../hq/cinematic.js";
import { getBattleSettings } from "../battle/config-engine.js";
import { getOwnedBattleCards, type OwnedBattleCard } from "../battle/db.js";
import { rarityLadderRank } from "../rarity-runtime.js";
import { withHqLock } from "../hq/lock.js";
import {
  reconcileUnlocks, ownedDecorations, unlockedRooms, unlockedThemes,
  isRoomUnlocked, isThemeUnlocked, unlockedWalls, unlockedFloors,
  isWallUnlocked, isFloorUnlocked, unlockedBackdrops, isBackdropUnlocked,
  isWallpaperUnlocked, isSurfaceUnlocked, ownedCompanions,
} from "../hq/engine.js";
import {
  resolveCompanion, companionsByRarityDesc, COMPANION_NONE, HQ_COMPANIONS,
} from "../hq/defs/companions.js";
import { resolveTheme, HQ_THEMES } from "../hq/defs/themes.js";
import { resolveWall } from "../hq/defs/walls.js";
import { resolveFloor, HQ_FLOORS } from "../hq/defs/floors.js";
import { resolveBackdrop, HQ_BACKDROPS, DEFAULT_BACKDROP_ID } from "../hq/defs/backdrops.js";
import {
  resolveWallpaper, HQ_WALLPAPERS, DEFAULT_WALLPAPER_ID,
} from "../hq/defs/wallpapers.js";
import { resolveSurface, getSurfaceById, surfacesFor } from "../hq/defs/surfaces.js";
import {
  listTerrain, placeTerrain, removeTerrainAt, clearTerrain, describeFeature,
  BASE_CANVAS_ID, MAX_FEATURES_PER_CANVAS, MAX_RECT_SPAN, MAX_ELEVATION,
} from "../hq/terrain.js";
import {
  readCursor, saveCursor, clampCursor, cursorLabel,
  type BuildCursor, type StoredBuild,
} from "../hq/build-state.js";
import { resolveRoom, HQ_ROOMS, DEFAULT_ROOM_ID } from "../hq/defs/rooms.js";
import {
  resolveDecoration, decorationsByRarityDesc, HQ_DECORATIONS,
  PORTRAIT_FRAME_ID, PORTRAIT_PREFIX,
} from "../hq/defs/decorations.js";
import { unlockLabel, type UnlockRule } from "../hq/defs/unlock-rules.js";
import { spriteFor, spriteForPrefix } from "../hq/assets.js";
import {
  renderHq, renderBase, renderSiege, floorSlot, wallSlot, slotIsWall, slotToTile,
  HQ_WALL_SLOT_BASE, HQ_WALL_ANCHOR_COUNT, HQ_DEFENDER_SLOTS, HQ_BASE_DECO_SLOTS,
  HQ_GRID, HQ_BASE_GRID,
  type HqRenderView, type HqRenderCard, type HqRenderDeco, type HqRenderDefender,
  type HqBaseView, type HqBaseBuilding, type HqBuildingRole, type SiegePlan,
  type HqRenderCompanion, type HqBuildCursor,
} from "../hq/render.js";
import {
  renderWorldMap, type HqWorldView, type WorldMarker,
} from "../hq/render-world.js";
import type { PlayerHq } from "@workspace/db";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
export const HQ_FILE = "hq.png";
const MAX_HQ_NAME = 40;
const MAX_HQ_MOTTO = 80;

// Any interaction that can drive the hub. All four expose guildId + user, which
// is all buildView reads.
type HubInteraction =
  | ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction;

// Player-set personalization lives in the additive `stats` jsonb — no schema
// change. `title` renames the HQ banner; `motto` is a short tagline in the embed.
interface HqStats { title?: string; motto?: string; backdropId?: string; wallpaperId?: string; wallsOff?: boolean; glassOff?: boolean; companionId?: string; baseTier?: number }
function readHqStats(hq: PlayerHq): HqStats {
  const s = hq.stats as HqStats | null | undefined;
  return { title: s?.title, motto: s?.motto, backdropId: s?.backdropId, wallpaperId: s?.wallpaperId, wallsOff: s?.wallsOff, glassOff: s?.glassOff, companionId: s?.companionId, baseTier: s?.baseTier };
}

// A base's live fortification (its upgrade tier + the defensive structures it has
// built on the grounds), as the % that hardens its garrison in a siege. Derived,
// never stored. Best-effort — any failure means "unfortified" (0%).
async function baseFortification(guildId: string, userId: string): Promise<ReturnType<typeof computeFortification>> {
  try {
    const [features, hq] = await Promise.all([
      listTerrain(guildId, userId, BASE_CANVAS_ID).catch(() => []),
      getOrCreateHq(guildId, userId),
    ]);
    return computeFortification(features, readHqStats(hq).baseTier);
  } catch {
    return computeFortification([], 0);
  }
}
function hqDisplayTitle(hq: PlayerHq, ownerName: string): string {
  const t = readHqStats(hq).title?.trim();
  return t && t.length > 0 ? t : `${ownerName}'s HQ`;
}
// Ambient NPC guests grow with HQ prestige (0 at low levels → 4 for a maxed HQ),
// so a well-developed Headquarters visibly draws a crowd. Derived, not stored.
function visitorCount(hqLevel: number): number {
  return Math.max(0, Math.min(4, Math.floor((hqLevel - 1) / 4)));
}
// The active companion in the renderer's shape (null = none). The picker only
// sets a pet the player owns, so this trusts stats.companionId.
function companionRenderFor(hq: PlayerHq): HqRenderCompanion | null {
  const id = readHqStats(hq).companionId;
  const c = id && id !== COMPANION_NONE ? resolveCompanion(id) : undefined;
  return c ? { kind: c.kind, name: c.name, body: c.body, accent: c.accent } : null;
}
// Set (or clear with null) the active companion, merging into the `stats` jsonb.
async function setCompanion(guildId: string, userId: string, companionId: string | null): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  const stats = { ...readHqStats(hq) };
  if (companionId) stats.companionId = companionId; else delete stats.companionId;
  await updateHq(guildId, userId, { stats });
}

// A placement id is either a plain decoration id or a compound "portrait-frame:<cardId>"
// for a framed card. Split it into the base (registry) id and any card argument.
function parsePlacementId(itemId: string): { baseId: string; cardId: number | null } {
  if (itemId.startsWith(PORTRAIT_PREFIX)) {
    const n = Number(itemId.slice(PORTRAIT_PREFIX.length));
    return { baseId: PORTRAIT_FRAME_ID, cardId: Number.isInteger(n) ? n : null };
  }
  return { baseId: itemId, cardId: null };
}
// Human label for a placement id (handles framed cards, which aren't registry ids).
function placementLabel(itemId: string): { emoji: string; name: string } {
  const { baseId, cardId } = parsePlacementId(itemId);
  if (baseId === PORTRAIT_FRAME_ID) return { emoji: "🖼️", name: cardId != null ? `Framed card #${cardId}` : "Portrait Frame" };
  const d = resolveDecoration(baseId);
  return { emoji: d?.emoji ?? "•", name: d?.name ?? baseId };
}

type Section = "overview" | "trophy" | "defenders" | "defenses" | "world" | "build" | "decorations" | "shop" | "rooms" | "theme";
interface SectionMeta { id: Section; label: string; emoji: string; description: string }
const SECTIONS: SectionMeta[] = [
  { id: "overview",    label: "Overview",    emoji: "🏠", description: "Your HQ at a glance" },
  { id: "trophy",      label: "Trophy Hall",  emoji: "🏆", description: "Pin your proudest cards on pedestals" },
  { id: "defenders",   label: "Base",        emoji: "🏰", description: "Your town base — station defenders" },
  { id: "defenses",    label: "Defenses",    emoji: "🛡️", description: "Upgrade your base, build walls & buy shields" },
  { id: "world",       label: "World Map",   emoji: "🗺️", description: "Conquer AI castles & raid rival bases" },
  { id: "build",       label: "Build",       emoji: "🛠️", description: "Paint surfaces, water, hills & platforms" },
  { id: "decorations", label: "Decorations", emoji: "🎏", description: "Place the cosmetics you've earned" },
  { id: "shop",        label: "Shop",        emoji: "🛒", description: "Buy furniture — rotates daily" },
  { id: "rooms",       label: "Rooms",       emoji: "🚪", description: "Switch & unlock rooms" },
  { id: "theme",       label: "Style",       emoji: "🎨", description: "Theme, wallpaper & floor" },
];

// ── Slash entry ───────────────────────────────────────────────────────────────
export async function handleHqCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ This command can only be used in a server.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  await interaction.deferReply(EPHEMERAL).catch(() => {});
  const target = interaction.options.getUser("user");

  if (target && target.id !== interaction.user.id) {
    if (target.bot) {
      await interaction.editReply({ content: "🤖 Bots don't have a Headquarters." }).catch(() => {});
      return;
    }
    const view = await buildVisitView(interaction.guildId, target.id, target.username, target.displayAvatarURL(), interaction.user.id);
    await interaction.editReply(view).catch(() => {});
    return;
  }

  // Own HQ: reconcile earned unlocks first (self-backfills), then render.
  const reconcile = await reconcileUnlocks(interaction.guildId, interaction.user.id).catch(() => null);
  const view = await buildView(interaction, "overview", reconcile?.newlyUnlocked ?? []);
  await interaction.editReply(view).catch(() => {});
}

export async function openHqHubFromButton(interaction: ButtonInteraction): Promise<void> {
  const view = await buildView(interaction, "overview", []);
  await interaction.update(view).catch(() => {});
}

// ── Component router ──────────────────────────────────────────────────────────
export async function handleHqHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const parts = interaction.customId.split(":"); // hq-hub:<action>[:arg]
  const action = parts[1] ?? "select";
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // Interactive turn-by-turn siege runs its own session/board.
  if (action === "ls") { await handleSiegeComponent(interaction); return; }

  // Open a featured card's detail (works in both own & visit views) → ephemeral.
  if (action === "open" && interaction.isStringSelectMenu()) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
    await replyCardDetail(interaction, guildId, userId, Number(interaction.values[0]));
    return;
  }

  // Set (or clear) the active companion — only a pet the player has EARNED.
  if (action === "companion" && interaction.isStringSelectMenu()) {
    const choice = interaction.values[0]!;
    if (choice === COMPANION_NONE) {
      await setCompanion(guildId, userId, null).catch(() => {});
    } else {
      const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
      if (owned.has(choice) && resolveCompanion(choice)) await setCompanion(guildId, userId, choice).catch(() => {});
    }
    await interaction.update(await buildView(interaction, "overview", [])).catch(() => {});
    return;
  }

  // ── Base siege: choose an assault mode, then resolve it ──────────────────────
  if (action === "attack" && interaction.isButton()) {
    await interaction.update(await buildAttackBriefing(guildId, userId, parts[2]!)).catch(() => {});
    return;
  }
  // World map → pick a target → mode picker. `t:<nodeId>` is an AI territory,
  // `p:<userId>` a member base (a bare value is a legacy member-base id).
  if (action === "raidpick" && interaction.isStringSelectMenu()) {
    const value = interaction.values[0]!;
    if (value.startsWith("t:")) {
      await interaction.update(await buildTerritoryBriefing(guildId, userId, value.slice(2))).catch(() => {});
    } else {
      await interaction.update(await buildAttackBriefing(guildId, userId, value.replace(/^p:/, ""))).catch(() => {});
    }
    return;
  }
  // The style comes from the guild's siege settings, not the button. A trailing
  // `:<mode>` segment is tolerated so buttons already posted in a channel from
  // the old mode picker still start a siege instead of erroring.
  if (action === "siege" && interaction.isButton()) {
    await runSiege(interaction, guildId, userId, parts[2]!);
    return;
  }
  // Assault an AI-held (or member-held) world territory.
  if (action === "wsiege" && interaction.isButton()) {
    await runTerritorySiege(interaction, guildId, userId, parts[2]!);
    return;
  }

  // Show the card picker for a specific pedestal slot.
  if (action === "setslot" && interaction.isButton()) {
    const slot = Number(parts[2]);
    await interaction.update(await buildPinPicker(guildId, userId, slot)).catch(() => {});
    return;
  }
  // A card was chosen for a pedestal slot.
  if (action === "pin" && interaction.isStringSelectMenu()) {
    const slot = Number(parts[2]);
    const cardId = Number(interaction.values[0]);
    // Only a card the invoker owns may be pinned.
    const owns = (await getUserCollection(guildId, userId)).some(i => i.cardId === cardId);
    if (owns) await pinDisplay(guildId, userId, slot, cardId).catch(() => {});
    await interaction.update(await buildView(interaction, "trophy", [])).catch(() => {});
    return;
  }
  if (action === "clearslot" && interaction.isButton()) {
    await clearDisplay(guildId, userId, Number(parts[2])).catch(() => {});
    await interaction.update(await buildView(interaction, "trophy", [])).catch(() => {});
    return;
  }

  // Defenders: pick a card for a defence post / assign / clear.
  if (action === "setdef" && interaction.isButton()) {
    await interaction.update(await buildDefenderPicker(guildId, userId, Number(parts[2]))).catch(() => {});
    return;
  }
  if (action === "def" && interaction.isStringSelectMenu()) {
    const slot = Number(parts[2]);
    const cardId = Number(interaction.values[0]);
    const owns = (await getUserCollection(guildId, userId)).some(i => i.cardId === cardId);
    if (owns) await setDefender(guildId, userId, slot, cardId).catch(() => {});
    await interaction.update(await buildView(interaction, "defenders", [])).catch(() => {});
    return;
  }
  if (action === "cleardef" && interaction.isButton()) {
    await clearDefender(guildId, userId, Number(parts[2])).catch(() => {});
    await interaction.update(await buildView(interaction, "defenders", [])).catch(() => {});
    return;
  }
  // Decorate the outdoor base grounds (its own layout) / reclaim a held base.
  if (action === "basedeco" && interaction.isStringSelectMenu()) {
    await placeBaseDecoration(guildId, userId, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "defenders", [])).catch(() => {});
    return;
  }
  if (action === "baseundeco" && interaction.isStringSelectMenu()) {
    await clearPlacement(guildId, userId, BASE_ROOM_ID, Number(interaction.values[0])).catch(() => {});
    await interaction.update(await buildView(interaction, "defenders", [])).catch(() => {});
    return;
  }
  if (action === "reclaim" && interaction.isButton()) {
    const cap = activeCapture(await getBaseState(guildId, userId));
    if (cap && !(cap.shieldUntil && cap.shieldUntil.getTime() > Date.now())) await reclaimBase(guildId, userId).catch(() => {});
    await interaction.update(await buildView(interaction, "defenders", [])).catch(() => {});
    return;
  }
  // ── Base upgrades + shields (the 🛡️ Defenses panel) ─────────────────────────
  if (action === "upgrade" && interaction.isButton()) {
    const notice = await withHqLock(`hq:defenses:${guildId}:${userId}`, async () => {
      const hq = await getOrCreateHq(guildId, userId);
      const next = nextBaseTier(readHqStats(hq).baseTier);
      if (!next) return "🏛️ Your base is already fully upgraded.";
      if (!(await spendShards(guildId, userId, next.cost).catch(() => false))) {
        return `💠 Not enough shards — **${next.label}** costs **${next.cost.toLocaleString()}**.`;
      }
      try {
        await updateHq(guildId, userId, { stats: { ...readHqStats(hq), baseTier: next.level } });
        return `${next.emoji} Base upgraded to **${next.label}** — garrison fortification is now guaranteed **+${next.fortifyPct}%**.`;
      } catch {
        await addShards(guildId, userId, next.cost).catch(() => {});
        return "❌ The upgrade could not be saved; your shards were refunded.";
      }
    });
    await interaction.update(await buildView(interaction, "defenses", [], notice)).catch(() => {});
    return;
  }
  if (action === "buyshield" && interaction.isButton()) {
    const notice = await withHqLock(`hq:defenses:${guildId}:${userId}`, async () => {
      const product = shieldProduct(parts[2]!);
      if (!product) return "That shield is no longer available.";
      if (!(await spendShards(guildId, userId, product.cost).catch(() => false))) {
        return `💠 Not enough shards — **${product.label}** costs **${product.cost.toLocaleString()}**.`;
      }
      const state = await getBaseState(guildId, userId).catch(() => null);
      const from = Math.max(Date.now(), state?.shieldUntil?.getTime() ?? 0);
      const until = new Date(from + product.hours * 3_600_000);
      try {
        await setBaseShield(guildId, userId, until);
        return `🛡️ Shield active until <t:${Math.floor(until.getTime() / 1000)}:R> — your base is locked to attackers.`;
      } catch {
        await addShards(guildId, userId, product.cost).catch(() => {});
        return "❌ The shield could not be saved; your shards were refunded.";
      }
    });
    await interaction.update(await buildView(interaction, "defenses", [], notice)).catch(() => {});
    return;
  }

  // ── Build mode: a movable cursor on the isometric lattice ──────────────────
  if (action === "bmove" && interaction.isButton()) {
    await nudgeCursor(guildId, userId, parts[2]!);
    await interaction.update(await buildView(interaction, "build", [])).catch(() => {});
    return;
  }
  if (action === "bsize" && interaction.isButton()) {
    await cycleCursorSize(guildId, userId, parts[2] === "h" ? "h" : "w");
    await interaction.update(await buildView(interaction, "build", [])).catch(() => {});
    return;
  }
  if (action === "belev" && interaction.isButton()) {
    await cycleCursorElevation(guildId, userId);
    await interaction.update(await buildView(interaction, "build", [])).catch(() => {});
    return;
  }
  if (action === "bmat" && interaction.isStringSelectMenu()) {
    await setCursorMaterial(guildId, userId, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "build", [])).catch(() => {});
    return;
  }
  if (action === "bcanvas" && interaction.isStringSelectMenu()) {
    await setCursorCanvas(guildId, userId, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "build", [])).catch(() => {});
    return;
  }
  if (action === "bplace" && interaction.isButton()) {
    const notice = await placeAtCursor(guildId, userId);
    await interaction.update(await buildView(interaction, "build", [], notice)).catch(() => {});
    return;
  }
  if (action === "bremove" && interaction.isButton()) {
    const notice = await removeAtCursor(guildId, userId);
    await interaction.update(await buildView(interaction, "build", [], notice)).catch(() => {});
    return;
  }
  if (action === "bclear" && interaction.isButton()) {
    const notice = await clearCanvasAtCursor(guildId, userId);
    await interaction.update(await buildView(interaction, "build", [], notice)).catch(() => {});
    return;
  }

  // Decorations: choosing one opens a slot picker so the player decides the
  // layout (which slot, swap into an occupied one) — decorating, not auto-fill.
  if (action === "placedeco" && interaction.isStringSelectMenu()) {
    await interaction.update(await buildSlotPicker(guildId, userId, interaction.values[0]!)).catch(() => {});
    return;
  }
  if (action === "placeat" && interaction.isStringSelectMenu()) {
    await placeDecorationAt(guildId, userId, parts[2]!, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "decorations", [])).catch(() => {});
    return;
  }
  if (action === "removedeco" && interaction.isStringSelectMenu()) {
    const hq = await getOrCreateHq(guildId, userId);
    await clearPlacement(guildId, userId, resolveRoom(hq.activeRoomId).id, Number(interaction.values[0])).catch(() => {});
    await interaction.update(await buildView(interaction, "decorations", [])).catch(() => {});
    return;
  }
  // Card wall-art: pick a card to frame → choose a wall spot → hang it.
  if (action === "framecard" && interaction.isStringSelectMenu()) {
    await interaction.update(await buildFrameSlotPicker(guildId, userId, Number(interaction.values[0]))).catch(() => {});
    return;
  }
  if (action === "frameat" && interaction.isStringSelectMenu()) {
    await placeFramedCardAt(guildId, userId, Number(parts[2]), interaction.values[0]!);
    await interaction.update(await buildView(interaction, "decorations", [])).catch(() => {});
    return;
  }

  // Switch room / theme (persisted).
  if (action === "room" && interaction.isStringSelectMenu()) {
    await updateHq(guildId, userId, { activeRoomId: interaction.values[0]! }).catch(() => {});
    await interaction.update(await buildView(interaction, "rooms", [])).catch(() => {});
    return;
  }
  if (action === "theme" && interaction.isStringSelectMenu()) {
    await updateHq(guildId, userId, { themeId: interaction.values[0]! }).catch(() => {});
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  // Switch walls / floor (persisted). Guarded to unlocked styles only.
  if (action === "wall" && interaction.isStringSelectMenu()) {
    const w = resolveWall(interaction.values[0]!);
    if (isWallUnlocked(w, await getUnlockedItemIds(guildId, userId))) {
      await updateHq(guildId, userId, { wallId: w.id }).catch(() => {});
    }
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  if (action === "floor" && interaction.isStringSelectMenu()) {
    const f = resolveFloor(interaction.values[0]!);
    if (isFloorUnlocked(f, await getUnlockedItemIds(guildId, userId))) {
      await updateHq(guildId, userId, { floorId: f.id }).catch(() => {});
    }
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  // Hang a real repeating wallpaper on the walls.
  if (action === "wallpaper" && interaction.isStringSelectMenu()) {
    const wp = resolveWallpaper(interaction.values[0]!);
    if (isWallpaperUnlocked(wp, await getUnlockedItemIds(guildId, userId))) {
      const hq = await getOrCreateHq(guildId, userId);
      await updateHq(guildId, userId, { stats: { ...readHqStats(hq), wallpaperId: wp.id } }).catch(() => {});
    }
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  // Switch the world backdrop (persisted to stats). Guarded to unlocked backdrops.
  if (action === "backdrop" && interaction.isStringSelectMenu()) {
    const bd = resolveBackdrop(interaction.values[0]!);
    if (isBackdropUnlocked(bd, await getUnlockedItemIds(guildId, userId))) {
      const hq = await getOrCreateHq(guildId, userId);
      await updateHq(guildId, userId, { stats: { ...readHqStats(hq), backdropId: bd.id } }).catch(() => {});
    }
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  // Room-shell toggles & inside/outside presets — all persisted to stats.
  if (action === "togglewalls" && interaction.isButton()) {
    const hq = await getOrCreateHq(guildId, userId);
    const s = readHqStats(hq);
    await updateHq(guildId, userId, { stats: { ...s, wallsOff: !s.wallsOff } }).catch(() => {});
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  if (action === "toggleglass" && interaction.isButton()) {
    const hq = await getOrCreateHq(guildId, userId);
    const s = readHqStats(hq);
    await updateHq(guildId, userId, { stats: { ...s, glassOff: !s.glassOff } }).catch(() => {});
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }
  if (action === "preset" && interaction.isButton()) {
    const hq = await getOrCreateHq(guildId, userId);
    const s = readHqStats(hq);
    // "outside" opens the walls; "inside" closes them. A gentle default: going
    // outside also drops the glass cases (an open-air showcase), inside restores.
    const outside = parts[2] === "outside";
    await updateHq(guildId, userId, { stats: { ...s, wallsOff: outside, glassOff: outside } }).catch(() => {});
    await interaction.update(await buildView(interaction, "theme", [])).catch(() => {});
    return;
  }

  // Shop: switch aisle (category). The aisle is carried in the customId so the
  // view stays put across buys/crate cracks.
  if (action === "shopcat" && interaction.isStringSelectMenu()) {
    await interaction.update(await buildView(interaction, "shop", [], undefined, interaction.values[0]!)).catch(() => {});
    return;
  }
  // Shop: buy the selected item (price validated server-side via shopPriceFor).
  if (action === "buy" && interaction.isStringSelectMenu()) {
    const notice = await buyShopItem(guildId, userId, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "shop", [], notice, parts[2])).catch(() => {});
    return;
  }
  // Shop: buy a surface (floor/wall) — grants the style unlock.
  if (action === "buysurface" && interaction.isStringSelectMenu()) {
    const notice = await buySurface(guildId, userId, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "shop", [], notice, "surfaces")).catch(() => {});
    return;
  }
  // Shop: open a mystery crate for a random furniture item.
  if (action === "crate" && interaction.isButton()) {
    const notice = await openMysteryCrate(guildId, userId);
    await interaction.update(await buildView(interaction, "shop", [], notice, parts[2])).catch(() => {});
    return;
  }

  // Personalize: open the rename/motto modal (handled by handleHqHubModal).
  if (action === "renamehq" && interaction.isButton()) {
    const hq = await getOrCreateHq(guildId, userId);
    const s = readHqStats(hq);
    const modal = new ModalBuilder().setCustomId("hq-hub:modal:rename").setTitle("Personalize your HQ")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("title").setLabel("HQ name (leave blank for default)")
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(MAX_HQ_NAME)
            .setValue(s.title ?? ""),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("motto").setLabel("Motto / tagline (optional)")
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(MAX_HQ_MOTTO)
            .setValue(s.motto ?? ""),
        ),
      );
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  if (action === "back") {
    await interaction.update(await buildView(interaction, (parts[2] as Section) ?? "trophy", [])).catch(() => {});
    return;
  }

  // Default: section dropdown changed.
  const section: Section = interaction.isStringSelectMenu()
    ? ((interaction.values[0] as Section) ?? "overview") : "overview";
  await interaction.update(await buildView(interaction, section, [])).catch(() => {});
}

// ── Modal submissions (personalize: HQ name + motto) ──────────────────────────
export async function handleHqHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId) return;
  if (interaction.customId !== "hq-hub:modal:rename") return;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const title = interaction.fields.getTextInputValue("title").trim().slice(0, MAX_HQ_NAME);
  const motto = interaction.fields.getTextInputValue("motto").trim().slice(0, MAX_HQ_MOTTO);
  const hq = await getOrCreateHq(guildId, userId);
  const stats: HqStats = { ...readHqStats(hq), title: title || undefined, motto: motto || undefined };
  await updateHq(guildId, userId, { stats }).catch(() => {});

  // Re-render the overview in place. The modal was opened from the ephemeral hub
  // message, so it can update that message directly.
  const view = await buildView(interaction, "overview", []);
  if (interaction.isFromMessage()) {
    await interaction.update(view).catch(() => {});
  } else {
    await interaction.reply({ ...view, ...EPHEMERAL }).catch(() => {});
  }
}

// ── Shared data load ──────────────────────────────────────────────────────────
async function loadCtx(guildId: string) {
  const [settings, ctx, displayMap, cards] = await Promise.all([
    getOrCreateGuildSettings(guildId),
    getRarityContext(guildId),
    getRarityDisplayOverrides(guildId),
    getAllCardsCached(guildId),
  ]);
  return { settings, ctx, displayMap, cards };
}

// Build the renderer's view from persisted state. `includeDefenders` overlays
// the base's guarding cards (used by the Defenders section and on visits).
async function buildRenderView(
  guildId: string, userId: string, ownerName: string, ownerAvatarUrl: string | null, hq: PlayerHq,
  includeDefenders = false, cursor?: BuildCursor,
): Promise<HqRenderView> {
  const theme = resolveTheme(hq.themeId);
  const wall = resolveWall(hq.wallId);
  const floor = resolveFloor(hq.floorId);
  // Build mode edits whichever canvas the cursor is on, which may not be the
  // active room; everything below keys off `room` so the picture matches.
  const room = resolveRoom(cursor && cursor.canvas !== BASE_ROOM_ID ? cursor.canvas : hq.activeRoomId);
  const style = readHqStats(hq);
  const backdrop = resolveBackdrop(style.backdropId);
  const backdropSprite = backdrop.id === DEFAULT_BACKDROP_ID ? null : spriteForPrefix("backdrop", backdrop.id);
  // Wallpaper = a real repeating covering papered onto the wall faces in iso
  // perspective. "none" keeps the wall style's own look.
  const wallpaper = resolveWallpaper(style.wallpaperId);
  const activeWallpaper = wallpaper.id === DEFAULT_WALLPAPER_ID ? null : wallpaper;
  const [{ settings, ctx, displayMap, cards }, displays, placements, defenderMap, terrain] = await Promise.all([
    loadCtx(guildId),
    getDisplays(guildId, userId),
    getPlacements(guildId, userId, room.id),
    includeDefenders ? getDefenders(guildId, userId) : Promise.resolve(new Map<number, number>()),
    listTerrain(guildId, userId, room.id).catch(() => []),
  ]);

  const pedestals: (HqRenderCard | null)[] = [];
  for (let slot = 0; slot < room.pedestals; slot++) {
    const cardId = displays.get(slot);
    const card = cardId != null ? cards.find(c => c.id === cardId) : undefined;
    if (!card) { pedestals.push(null); continue; }
    const d = getCardDisplayRarity(card, ctx, settings, displayMap);
    pedestals.push({
      cardId: card.id, name: card.name, artUrl: toAbsoluteImageUrl(card.imageUrl),
      rarityLabel: d.label, rarityColor: d.color,
    });
  }

  const decorations: HqRenderDeco[] = [];
  for (const [slot, itemId] of placements) {
    const { baseId, cardId } = parsePlacementId(itemId);
    const deco = resolveDecoration(baseId);
    if (!deco) continue;
    // Framed card wall-art: pull the real card's art + rarity colour.
    if (baseId === PORTRAIT_FRAME_ID && cardId != null) {
      const card = cards.find(c => c.id === cardId);
      if (!card) continue;
      const d = getCardDisplayRarity(card, ctx, settings, displayMap);
      decorations.push({
        slot, category: "portrait", name: `${card.name} (framed)`,
        rarityColor: d.color, spritePath: null, cardArtUrl: toAbsoluteImageUrl(card.imageUrl),
      });
      continue;
    }
    decorations.push({
      slot, category: deco.category, name: deco.name,
      rarityColor: rarityColor(deco.rarity as Rarity, settings, displayMap),
      spritePath: spriteFor(theme, deco.spriteKey),
    });
  }

  const featured = pedestals.filter(Boolean).length;
  const subtitle = room.pedestals > 0
    ? `${room.name} • ${featured}/${room.pedestals} featured`
    : `${room.name} • ${decorations.length} decoration${decorations.length === 1 ? "" : "s"}`;

  const defenders: HqRenderDefender[] = [];
  if (includeDefenders) {
    const basePath = spriteForPrefix("base", "round");
    for (const [slot, cardId] of [...defenderMap.entries()].sort((a, b) => a[0] - b[0])) {
      const card = cards.find(c => c.id === cardId);
      if (!card) continue;
      const d = getCardDisplayRarity(card, ctx, settings, displayMap);
      defenders.push({ slot, cardId: card.id, name: card.name, artUrl: toAbsoluteImageUrl(card.imageUrl), rarityColor: d.color, basePath });
    }
  }

  return {
    ownerName, displayTitle: hqDisplayTitle(hq, ownerName), ownerAvatarUrl, theme, wall, floor,
    wallSprite: spriteForPrefix(wall.spritePrefix, "wall"),
    floorSprite: spriteForPrefix(floor.spritePrefix, "tile"),
    wallpaper: activeWallpaper,
    roomName: room.name, roomEmoji: room.emoji, hqLevel: hq.hqLevel,
    subtitle, pedestals, decorations, defenders, terrain,
    cursor: cursor ? cursorOverlay(cursor) : null,
    backdropSprite, wallsOff: !!style.wallsOff, glassOff: !!style.glassOff,
    companion: companionRenderFor(hq), visitors: visitorCount(hq.hqLevel),
  };
}

async function renderRoomImage(view: HqRenderView): Promise<AttachmentBuilder | null> {
  const buf = await renderHq(view).catch(() => null);
  return buf ? new AttachmentBuilder(buf, { name: HQ_FILE }) : null;
}

async function renderBaseImage(view: HqBaseView): Promise<AttachmentBuilder | null> {
  const buf = await renderBase(view).catch(() => null);
  return buf ? new AttachmentBuilder(buf, { name: HQ_FILE }) : null;
}

// ── World map ─────────────────────────────────────────────────────────────────
const WORLD_COLORS = [0x3f78c8, 0x9b59b6, 0x2ecc71, 0xe67e22, 0x1abc9c, 0xe84393, 0xf1c40f, 0x5865f2];

// A member's base on the shared map.
interface PlayerBaseEntry { userId: string; name: string; defenders: number; held: boolean }

// Everything the World section needs: the AI-held territories that ship with the
// map, plus the member bases pinned around the southern coast.
interface WorldSnapshot {
  territories: WorldTerritoryView[];
  bases: PlayerBaseEntry[];
}

async function loadWorld(guildId: string, userId: string): Promise<WorldSnapshot> {
  const territories = await listTerritories(guildId).catch(() => [] as WorldTerritoryView[]);
  const raw = await getGuildBases(guildId, userId, PLAYER_BASE_ANCHORS.length).catch(() => []);
  const bases: PlayerBaseEntry[] = [];
  for (const b of raw) {
    const bhq = await getOrCreateHq(guildId, b.userId);
    const held = !!activeCapture(await getBaseState(guildId, b.userId));
    const name = readHqStats(bhq).title?.trim() || `Rival ${b.userId.slice(-4)}`;
    bases.push({ userId: b.userId, name, defenders: b.defenders, held });
  }
  return { territories, bases };
}

async function renderWorldImage(
  theme: ReturnType<typeof resolveTheme>, avatarUrl: string | null, level: number,
  world: WorldSnapshot, viewerId: string,
): Promise<AttachmentBuilder | null> {
  const now = Date.now();
  const markers: WorldMarker[] = world.territories.map(t => ({
    nodeId: t.territory.id,
    name: t.territory.name,
    factionShort: t.faction.short,
    color: t.heldByUserId === viewerId ? 0x4fd06a : t.heldByUserId ? 0x4aa3ff : t.faction.color,
    tier: t.territory.tier,
    biome: t.territory.biome,
    u: t.territory.u,
    v: t.territory.v,
    structure: t.territory.structure,
    garrison: t.territory.garrison,
    kind: "territory",
    held: !!t.heldByUserId,
    heldByYou: t.heldByUserId === viewerId,
    shielded: !!t.shieldUntil && t.shieldUntil.getTime() > now,
  }));
  // Member bases share the map, anchored along the settled coast.
  world.bases.slice(0, PLAYER_BASE_ANCHORS.length).forEach((b, i) => {
    const a = PLAYER_BASE_ANCHORS[i]!;
    markers.push({
      nodeId: `base:${b.userId}`,
      name: b.name,
      factionShort: "Member base",
      color: b.held ? 0xc0392b : WORLD_COLORS[i % WORLD_COLORS.length]!,
      tier: Math.max(1, Math.min(4, Math.ceil(b.defenders / 2) + 1)),
      biome: "plains",
      u: a.u, v: a.v,
      structure: "houses",
      garrison: b.defenders,
      kind: "base",
      held: b.held,
      heldByYou: false,
      shielded: b.held,
    });
  });

  const open = world.territories.filter(t => !t.heldByUserId).length;
  const view: HqWorldView = {
    ownerAvatarUrl: avatarUrl,
    displayTitle: "World Map",
    subtitle: `${open} AI territor${open === 1 ? "y" : "ies"} · ${world.bases.length} member base${world.bases.length === 1 ? "" : "s"}`,
    theme, roomEmoji: "🗺️", roomName: "World", hqLevel: level,
    markers, routes: HQ_ROUTES,
  };
  const buf = await renderWorldMap(view).catch(() => null);
  return buf ? new AttachmentBuilder(buf, { name: HQ_FILE }) : null;
}

// Build the EXTERIOR town-base view: the four structures (art resolved by role,
// procedural fallback in the renderer) plus the stationed defenders as standees.
// This is the attackable/defendable town, distinct from the interior showcase.
const BASE_BUILDING_ROLES: HqBuildingRole[] = [
  "castle", "keep", "tower", "cathedral", "houses", "village", "camp", "hut", "wall",
];
async function buildBaseRenderView(
  guildId: string, userId: string, ownerName: string, ownerAvatarUrl: string | null, hq: PlayerHq,
  cursor?: BuildCursor,
): Promise<HqBaseView> {
  const theme = resolveTheme(hq.themeId);
  const [{ settings, ctx, displayMap, cards }, defenderMap, terrain] = await Promise.all([
    loadCtx(guildId),
    getDefenders(guildId, userId),
    listTerrain(guildId, userId, BASE_ROOM_ID).catch(() => []),
  ]);
  const basePath = spriteForPrefix("base", "round");
  const defenders: HqRenderDefender[] = [];
  for (const [slot, cardId] of [...defenderMap.entries()].sort((a, b) => a[0] - b[0])) {
    const card = cards.find(c => c.id === cardId);
    if (!card) continue;
    const d = getCardDisplayRarity(card, ctx, settings, displayMap);
    defenders.push({ slot, cardId: card.id, name: card.name, artUrl: toAbsoluteImageUrl(card.imageUrl), rarityColor: d.color, basePath });
  }
  const buildings: HqBaseBuilding[] = BASE_BUILDING_ROLES.map(role => ({ role, spritePath: spriteForPrefix("building", role) }));
  const capture = activeCapture(await getBaseState(guildId, userId));
  // Player-placed grounds decorations (the base is its own decoratable "room").
  const groundsMap = await getPlacements(guildId, userId, BASE_ROOM_ID);
  const decorations: HqRenderDeco[] = [];
  for (const [slot, itemId] of groundsMap) {
    const d = resolveDecoration(itemId);
    if (!d) continue;
    decorations.push({ slot, category: d.category, name: d.name, rarityColor: rarityColor(d.rarity as Rarity, settings, displayMap), spritePath: spriteFor(theme, d.spriteKey) });
  }
  return {
    ownerName, displayTitle: hqDisplayTitle(hq, ownerName), ownerAvatarUrl, theme,
    roomEmoji: "🏰", roomName: "Base", hqLevel: hq.hqLevel,
    subtitle: capture ? `Base • held by ${capture.heldName}` : `Base • ${defenders.length}/${HQ_DEFENDER_SLOTS} defenders`,
    buildings, defenders, decorations, terrain, captured: !!capture,
    cursor: cursor ? cursorOverlay(cursor) : null,
    companion: companionRenderFor(hq), visitors: visitorCount(hq.hqLevel),
  };
}

// ── Owner view ────────────────────────────────────────────────────────────────
async function buildView(
  interaction: HubInteraction,
  section: Section, justUnlocked: { name: string; emoji: string; story: string }[],
  notice?: string,
  shopAisle?: string,
) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const hq = await getOrCreateHq(guildId, userId);
  const owned = await getUnlockedItemIds(guildId, userId);
  // Keep placements honest if an unlock was ever lost.
  await pruneUnownedPlacements(guildId, userId, new Set([
    ...owned,
    ...HQ_DECORATIONS.filter(d => d.unlock.kind === "always").map(d => d.id),
  ])).catch(() => {});

  // The stored active room can be one the player hasn't unlocked (the table's
  // default is the flagship Trophy Hall, which is gated). Never leave someone
  // stranded in a locked room — fall back to the always-open entrance and
  // persist the correction so switches/placements target a room they own.
  if (!isRoomUnlocked(resolveRoom(hq.activeRoomId), owned)) {
    await updateHq(guildId, userId, { activeRoomId: DEFAULT_ROOM_ID }).catch(() => {});
    hq.activeRoomId = DEFAULT_ROOM_ID;
  }

  const room = resolveRoom(hq.activeRoomId);
  const theme = resolveTheme(hq.themeId);
  const wall = resolveWall(hq.wallId);
  const floor = resolveFloor(hq.floorId);

  // Section picks the image: World = the campaign map; Base = the exterior town
  // (with defenders); everything else = the interior room.
  let world: WorldSnapshot = { territories: [], bases: [] };
  let file: AttachmentBuilder | null;
  if (section === "world") {
    world = await loadWorld(guildId, userId);
    file = await renderWorldImage(theme, interaction.user.displayAvatarURL(), hq.hqLevel, world, userId);
  } else if (section === "build") {
    // Build mode renders whichever canvas the cursor is parked on, with the
    // lattice rulers and the selection rectangle overlaid.
    const cur = await loadCursor(guildId, userId, hq);
    file = cur.canvas === BASE_ROOM_ID
      ? await renderBaseImage(await buildBaseRenderView(
          guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq, cur))
      : await renderRoomImage(await buildRenderView(
          guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq, false, cur));
  } else if (section === "defenders" || section === "defenses") {
    file = await renderBaseImage(await buildBaseRenderView(guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq));
  } else {
    file = await renderRoomImage(await buildRenderView(guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq));
  }
  const files = file ? [file] : [];

  const rows: ActionRowBuilder<any>[] = [sectionRow(section)];
  const embed = new EmbedBuilder().setColor(theme.palette.accent);
  if (file) embed.setImage(`attachment://${HQ_FILE}`);

  switch (section) {
    case "overview": {
      const decoOwned = ownedDecorations(owned).length;
      const roomsOpen = unlockedRooms(owned).length;
      const stats = readHqStats(hq);
      const title = hqDisplayTitle(hq, interaction.user.username);
      embed.setTitle(`🏠 ${title}`)
        .setDescription(
          (stats.motto ? `_“${stats.motto}”_\n\n` : "") +
          `**${theme.emoji} ${theme.name}** · **HQ Level ${hq.hqLevel}**\n` +
          `Now viewing **${room.emoji} ${room.name}**. Use the dropdown to decorate, restyle, or feature cards.`,
        )
        .addFields(
          { name: "🎏 Decorations earned", value: `**${decoOwned}** / ${HQ_DECORATIONS.length}`, inline: true },
          { name: "🚪 Rooms unlocked", value: `**${roomsOpen}** / ${HQ_ROOMS.length}`, inline: true },
          { name: "🎨 Themes", value: `**${unlockedThemes(owned).length}** / ${HQ_THEMES.length}`, inline: true },
        );
      // Companions + ambient visitors — the HQ's living touches.
      const pets = ownedCompanions(owned);
      const activePet = resolveCompanion(stats.companionId);
      embed.addFields(
        { name: "🐾 Companion", value: activePet ? `${activePet.emoji} **${activePet.name}**` : (pets.length ? "_none set_" : "_none earned yet_"), inline: true },
        { name: "👥 Visitors", value: `**${visitorCount(hq.hqLevel)}** roaming`, inline: true },
        { name: "🐾 Companions earned", value: `**${pets.length}** / ${HQ_COMPANIONS.length}`, inline: true },
      );
      const nextHint = nextUnlockHint(owned);
      if (nextHint) embed.addFields({ name: "🔓 Next up", value: nextHint, inline: false });
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("hq-hub:renamehq")
          .setLabel(stats.title ? "Rename HQ" : "Name your HQ")
          .setEmoji("✏️").setStyle(ButtonStyle.Secondary),
      ));
      // Companion picker — choose from the pets you've EARNED (or send it away).
      if (pets.length > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:companion").setPlaceholder("🐾 Choose a companion…")
            .addOptions([
              { label: "None", value: COMPANION_NONE, description: "Send your companion away", emoji: "🚫", default: !activePet },
              ...companionsByRarityDesc(pets.map(p => p.id)).slice(0, 24).map(c => ({
                label: c.name.slice(0, 90), value: c.id, description: c.rarity, emoji: c.emoji, default: c.id === stats.companionId,
              })),
            ]),
        ));
      }
      break;
    }

    case "trophy": {
      const displays = await getDisplays(guildId, userId);
      if (room.pedestals === 0) {
        embed.setTitle("🏆 Trophy Hall").setDescription(
          `Your current room (**${room.name}**) has no pedestals. Switch to the **Trophy Hall** in **🚪 Rooms** to feature cards.` +
          (isRoomUnlocked(resolveRoom("trophy-hall"), owned) ? "" : `\n\n🔒 Trophy Hall unlocks: ${unlockLabel(resolveRoom("trophy-hall").unlock)}.`),
        );
        break;
      }
      embed.setTitle(`🏆 ${room.name}`).setDescription(
        "Pin your proudest cards on the pedestals. Everyone who visits your HQ sees them first.\n" +
        "Use **Set** to feature a card in a pedestal, **Clear** to empty one, or open a featured card below.",
      );
      // Open-a-featured-card select (only if something is pinned).
      const pinned = [...displays.entries()].sort((a, b) => a[0] - b[0]);
      if (pinned.length > 0) {
        const { cards, settings, ctx, displayMap } = await loadCtx(guildId);
        const opts = pinned.map(([slot, cardId]) => {
          const card = cards.find(c => c.id === cardId);
          const label = card ? card.name.slice(0, 90) : `Card #${cardId}`;
          const d = card ? getCardDisplayRarity(card, ctx, settings, displayMap) : null;
          return { label: `Pedestal ${slot + 1}: ${label}`, value: String(cardId), description: d ? d.label : undefined, emoji: "🔎" };
        });
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:open").setPlaceholder("Open a featured card…").addOptions(opts),
        ));
      }
      rows.push(pedestalButtonRow("setslot", "Set", room.pedestals, ButtonStyle.Primary));
      rows.push(pedestalButtonRow("clearslot", "Clear", room.pedestals, ButtonStyle.Secondary, displays));
      break;
    }

    case "defenders": {
      const defenders = await getDefenders(guildId, userId);
      const capture = activeCapture(await getBaseState(guildId, userId));
      const grounds = await getPlacements(guildId, userId, BASE_ROOM_ID);
      embed.setTitle("🏰 Your Base").setDescription(
        "Your **town base** — station cards to **guard it** (they stand out front) and **decorate the grounds** with trees & items. " +
        "Other players scout and **siege** this base; win and they **hold it until you reclaim it**.\n" +
        (capture ? `\n🚩 **Held by ${capture.heldName}.**` : "") +
        (defenders.size === 0 ? "\nNo defenders yet — set one below to start fortifying." : ""),
      );
      if (defenders.size > 0) {
        const { cards, settings, ctx, displayMap } = await loadCtx(guildId);
        embed.addFields({
          name: `🛡️ On guard (${defenders.size}/${HQ_DEFENDER_SLOTS})`,
          value: [...defenders.entries()].sort((a, b) => a[0] - b[0]).map(([slot, cardId]) => {
            const card = cards.find(c => c.id === cardId);
            const d = card ? getCardDisplayRarity(card, ctx, settings, displayMap) : null;
            return `Post ${slot + 1}: ${d?.emoji ?? "•"} **${card?.name ?? `Card #${cardId}`}**${d ? ` · ${d.label}` : ""}`;
          }).join("\n").slice(0, 1024),
        });
      }
      if (grounds.size > 0) {
        embed.addFields({
          name: `🌳 Grounds (${grounds.size}/${HQ_BASE_DECO_SLOTS})`,
          value: [...grounds.entries()].sort((a, b) => a[0] - b[0])
            .map(([slot, id]) => `Spot ${slot + 1}: ${resolveDecoration(id)?.emoji ?? "•"} ${resolveDecoration(id)?.name ?? id}`).join("\n").slice(0, 1024),
        });
      }
      rows.push(pedestalButtonRow("setdef", "Set", HQ_DEFENDER_SLOTS, ButtonStyle.Primary));
      rows.push(pedestalButtonRow("cleardef", "Clear", HQ_DEFENDER_SLOTS, ButtonStyle.Secondary, defenders));

      // Decorate the grounds: place an owned decoration (incl. free trees/rocks)
      // on the next open spot; remove a placed one. Base is its own layout.
      const groundsPlaced = new Set(grounds.values());
      const placeable = ownedDecorations(owned).filter(d => !groundsPlaced.has(d.id));
      if (grounds.size < HQ_BASE_DECO_SLOTS && placeable.length > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:basedeco").setPlaceholder(`Add to grounds… (${HQ_BASE_DECO_SLOTS - grounds.size} spots free)`)
            .addOptions(placeable.slice(0, 25).map(d => ({ label: d.name.slice(0, 90), value: d.id, description: d.rarity, emoji: d.emoji }))),
        ));
      }
      if (grounds.size > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:baseundeco").setPlaceholder("Remove from grounds…")
            .addOptions([...grounds.entries()].sort((a, b) => a[0] - b[0]).map(([slot, id]) => ({
              label: `Spot ${slot + 1}: ${(resolveDecoration(id)?.name ?? id).slice(0, 72)}`, value: String(slot), emoji: "🗑️",
            }))),
        ));
      }
      // Reclaim your base once the conqueror's shield lapses.
      if (capture) {
        const locked = !!capture.shieldUntil && capture.shieldUntil.getTime() > Date.now();
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("hq-hub:reclaim").setEmoji("🚩")
            .setLabel(locked ? "Reclaim (shielded)" : "Reclaim your base")
            .setStyle(ButtonStyle.Danger).setDisabled(locked),
        ));
      }
      break;
    }

    case "defenses": {
      // The tower-defence + upgrades panel. Fortification (base tier + built
      // defences) is the % that hardens this base's garrison in a siege.
      const forti = await baseFortification(guildId, userId);
      const state = await getBaseState(guildId, userId).catch(() => null);
      const bal = (await getOrCreateCurrency(guildId, userId).catch(() => ({ shards: 0 }))).shards ?? 0;
      const next = nextBaseTier(forti.tier.level);
      const shieldOn = !!state?.shieldUntil && state.shieldUntil.getTime() > Date.now();

      embed.setTitle("🛡️ Base Defenses").setDescription(
        "Harden your base so its garrison actually **fights back** when raided.\n" +
        `• **Upgrade** the base for a guaranteed fortification floor.\n` +
        `• **Build** walls, towers, moats & traps in **🛠️ Build** (on the *Base grounds*) to raise it further.\n` +
        `• **Buy a shield** to lock out attackers for a while.`,
      ).addFields(
        {
          name: "🏯 Fortification",
          value: `**+${forti.totalPct}%** to your garrison\n` +
            `${forti.tier.emoji} ${forti.tier.label} tier: **+${forti.tierPct}%** · 🧱 Built: **+${forti.buildPct}%** (${forti.points} pts)`,
          inline: false,
        },
        { name: "🏰 Base tier", value: `${forti.tier.emoji} **${forti.tier.label}** (Lv ${forti.tier.level})`, inline: true },
        { name: "🛡️ Shield", value: shieldOn ? `active <t:${Math.floor(state!.shieldUntil!.getTime() / 1000)}:R>` : "_none_", inline: true },
        { name: "💠 Balance", value: `**${bal.toLocaleString()}**`, inline: true },
      );
      if (forti.buildPct === 0) {
        embed.addFields({ name: "🧱 Tip", value: "Open **🛠️ Build**, switch to the **Base grounds**, and place a **Stone Wall**, **Watchtower**, **Moat** or **Caltrops** — each hardens your garrison." });
      }

      // Upgrade button (or maxed).
      const upgradeRow = new ActionRowBuilder<ButtonBuilder>();
      if (next) {
        upgradeRow.addComponents(
          new ButtonBuilder().setCustomId("hq-hub:upgrade")
            .setLabel(`Upgrade → ${next.label} (+${next.fortifyPct}%) · ${next.cost.toLocaleString()}💠`.slice(0, 80))
            .setEmoji(next.emoji).setStyle(ButtonStyle.Success).setDisabled(bal < next.cost),
        );
      } else {
        upgradeRow.addComponents(
          new ButtonBuilder().setCustomId("hq-hub:upgrade").setLabel("Base fully upgraded")
            .setEmoji("🏛️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        );
      }
      rows.push(upgradeRow);

      // Shield purchase row.
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        SHIELD_PRODUCTS.map(p => new ButtonBuilder()
          .setCustomId(`hq-hub:buyshield:${p.id}`)
          .setLabel(`${p.label} · ${p.cost.toLocaleString()}💠`.slice(0, 80))
          .setEmoji("🛡️").setStyle(ButtonStyle.Primary).setDisabled(bal < p.cost)),
      ));
      if (notice) embed.addFields({ name: "🧾 Result", value: notice.slice(0, 1024) });
      break;
    }

    case "world": {
      // Pay out hold-tribute for everything the viewer holds — member bases AND
      // world territories — then read the longest-reign board.
      const tribute = await collectHoldTribute(guildId, userId).catch(() => null);
      const reignLeaders = await getReignLeaders(guildId, 5)
        .catch(() => [] as Awaited<ReturnType<typeof getReignLeaders>>);
      const sovereign = reignLeaders[0];
      const yours = world.territories.filter(t => t.heldByUserId === userId);
      const openAi = world.territories.filter(t => !t.heldByUserId);

      embed.setTitle("🗺️ World Map").setDescription(
        (tribute ? `${tribute}\n\n` : "") +
        "Six AI factions already hold this continent. **March on a castle, take it, and it pays you 💠 every hour you keep it** — " +
        "until a faction's neighbour, or another member, comes to take it back.\n" +
        (sovereign && sovereign.bestSec > 0
          ? `\n👑 **Sovereign:** ${sovereign.userId === userId ? "**you**" : `<@${sovereign.userId}>`} — longest hold **${formatReign(sovereign.bestSec)}**${sovereign.active ? " (still holding)" : ""}.`
          : ""),
      );

      // Your holdings first — the thing a returning player wants to see.
      if (yours.length > 0) {
        embed.addFields({
          name: `🚩 Your territories (${yours.length})`,
          value: yours.map(t =>
            `${t.faction.emoji} **${t.territory.name}** · ${tierProfile(t.territory.tier).label} · +${tierProfile(t.territory.tier).tributePerHour}💠/hr`,
          ).join("\n").slice(0, 1024),
        });
      }
      if (openAi.length > 0) {
        embed.addFields({
          name: `⚔️ Faction-held (${openAi.length})`,
          value: openAi.slice(0, 8).map(t =>
            `${t.faction.emoji} **${t.territory.name}** — ${tierStars(t.territory.tier)} · ${t.territory.garrison}🛡️ · ${t.faction.short}`,
          ).join("\n").slice(0, 1024),
        });
      }

      // One picker for every attackable thing on the map. Territories are
      // prefixed `t:`, member bases `p:`, so the router can tell them apart.
      const now = Date.now();
      const options = [
        ...world.territories
          .filter(t => t.heldByUserId !== userId)
          .map(t => ({
            label: t.territory.name.slice(0, 90),
            value: `t:${t.territory.id}`,
            description: `${tierProfile(t.territory.tier).label} · ${t.territory.garrison} defenders · ${holderLabel(t)}`.slice(0, 100),
            emoji: (t.shieldUntil && t.shieldUntil.getTime() > now) ? "🛡️" : t.faction.emoji,
          })),
        ...world.bases.map(b => ({
          label: b.name.slice(0, 90),
          value: `p:${b.userId}`,
          description: `Member base · ${b.defenders} defender${b.defenders === 1 ? "" : "s"}${b.held ? " · held 🚩" : ""}`.slice(0, 100),
          emoji: "🏠",
        })),
      ].slice(0, 25);
      if (options.length > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:raidpick")
            .setPlaceholder("⚔️ March on a castle…").addOptions(options),
        ));
      }

      // Conquest leaderboard — top raiders by career wins, and bases held now.
      const leaders = await getConquestLeaders(guildId, 5).catch(() => []);
      if (leaders.length > 0) {
        const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];
        const lines = await Promise.all(leaders.map(async (l, i) => {
          const lhq = await getOrCreateHq(guildId, l.userId);
          const name = readHqStats(lhq).title?.trim() || `Warlord ${l.userId.slice(-4)}`;
          const held = l.holding > 0 ? ` · 🚩 holds ${l.holding}` : "";
          const you = l.userId === userId ? " · **you**" : "";
          return `${medals[i] ?? "•"} **${name}** — ${l.wins} win${l.wins === 1 ? "" : "s"}${held}${you}`;
        }));
        embed.addFields({ name: "🏆 Conquest leaderboard", value: lines.join("\n").slice(0, 1024) });
      }
      // Longest-hold leaderboard — who has clung to a base the longest.
      if (reignLeaders.length > 0 && reignLeaders.some(r => r.bestSec > 0)) {
        const crowns = ["👑", "🥈", "🥉", "🏅", "🏅"];
        const rlines = reignLeaders.filter(r => r.bestSec > 0).map((r, i) => {
          const you = r.userId === userId ? " · **you**" : "";
          const live = r.active ? " 🚩" : "";
          return `${crowns[i] ?? "•"} <@${r.userId}> — **${formatReign(r.bestSec)}**${live}${you}`;
        });
        embed.addFields({ name: "👑 Longest hold", value: rlines.join("\n").slice(0, 1024) });
      }
      break;
    }

    case "build": {
      const cur = await loadCursor(guildId, userId, hq);
      const canvasName = cur.canvas === BASE_ROOM_ID ? "Base grounds" : resolveRoom(cur.canvas).name;
      const grid = gridFor(cur.canvas);
      const mat = resolveSurface(cur.materialId);
      const features = await listTerrain(guildId, userId, cur.canvas).catch(() => []);

      embed.setTitle("🛠️ Build Mode").setDescription(
        `Paint the ground of **${canvasName}** in rectangles. The picture shows the **X/Y rulers** and a ` +
        "**live cursor** — move it with the arrows, resize it, pick a material, then **Place**.\n\n" +
        `📍 Cursor: **${cur.w}×${cur.h}** at **(${cur.x}, ${cur.y})** on a **${grid}×${grid}** grid\n` +
        `🎨 Brush: ${mat.emoji} **${mat.name}** _(${mat.kind})_` +
        (mat.kind === "flat" ? "" : ` · height **${cur.elevation || mat.height}**`) +
        `\n🧱 Built here: **${features.length}** / ${MAX_FEATURES_PER_CANVAS}`,
      );
      if (features.length > 0) {
        embed.addFields({
          name: "Placed surfaces",
          value: features.slice(-10).reverse().map(describeFeature).join("\n").slice(0, 1024),
        });
      }
      embed.addFields({
        name: "⌨️ Prefer typing?",
        value:
          "`/hqbuild place` drops the brush at exact coordinates, `/hqbuild remove` clears a tile, " +
          "`/hqbuild list` prints everything you've built, and `/hqbuild wallpaper` re-papers the walls.",
      });
      if (notice) embed.addFields({ name: "🧾 Result", value: notice.slice(0, 1024) });

      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("hq-hub:bmove:left").setEmoji("⬅️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("hq-hub:bmove:up").setEmoji("⬆️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("hq-hub:bmove:down").setEmoji("⬇️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("hq-hub:bmove:right").setEmoji("➡️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("hq-hub:bplace").setLabel("Place").setEmoji("✅").setStyle(ButtonStyle.Success),
      ));
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("hq-hub:bsize:w").setLabel(`W ${cur.w}`).setEmoji("↔️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("hq-hub:bsize:h").setLabel(`H ${cur.h}`).setEmoji("↕️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("hq-hub:belev").setLabel(`Lift ${cur.elevation}`).setEmoji("⛰️")
          .setStyle(ButtonStyle.Primary).setDisabled(mat.kind === "flat"),
        new ButtonBuilder().setCustomId("hq-hub:bremove").setLabel("Remove").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("hq-hub:bclear").setLabel("Clear all").setEmoji("🧹")
          .setStyle(ButtonStyle.Danger).setDisabled(features.length === 0),
      ));
      // Only materials the player has earned or bought — the locked ones are
      // listed in the Shop's Surfaces aisle instead of teasing them here.
      const space = cur.canvas === BASE_ROOM_ID ? "outdoor" : "indoor";
      const brushes = surfacesFor(space).filter(s => isSurfaceUnlocked(s, owned));
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId("hq-hub:bmat").setPlaceholder("🎨 Pick a material…")
          .addOptions(brushes.slice(0, 25).map(s => ({
            label: s.name.slice(0, 90), value: s.id, emoji: s.emoji,
            description: s.kind, default: s.id === cur.materialId,
          }))),
      ));
      const canvases = [
        { id: BASE_ROOM_ID, name: "Base grounds", emoji: "🏰" },
        ...unlockedRooms(owned).map(r => ({ id: r.id, name: r.name, emoji: r.emoji })),
      ];
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId("hq-hub:bcanvas").setPlaceholder("📐 Choose what to build on…")
          .addOptions(canvases.slice(0, 25).map(c => ({
            label: c.name.slice(0, 90), value: c.id, emoji: c.emoji,
            description: c.id === BASE_ROOM_ID ? `${HQ_BASE_GRID}×${HQ_BASE_GRID} outdoor grid` : `${HQ_GRID}×${HQ_GRID} indoor grid`,
            default: c.id === cur.canvas,
          }))),
      ));
      break;
    }

    case "decorations": {
      const owns = ownedDecorations(owned);
      const placements = await getPlacements(guildId, userId, room.id);
      const placedIds = new Set(placements.values());
      embed.setTitle("🎏 Decorations").setDescription(
        `Cosmetics you've **earned** by playing — each one tells a story. Arrange them across the **${room.emoji} ${room.name}**'s ${room.decoSlots} slots: pick a decoration, then choose where it goes (or swap it with one already on display).\n` +
        (owns.length === 0 ? "\nYou haven't earned any decorations yet — win battles, clear raids, complete sets and grow your collection." : ""),
      );
      const lines = decorationsByRarityDesc(owns.map(d => d.id)).slice(0, 12)
        .map(d => `${d.emoji} **${d.name}** — _${d.story}_${placedIds.has(d.id) ? " · 📍 placed" : ""}`);
      if (lines.length) embed.addFields({ name: `Earned (${owns.length})`, value: lines.join("\n").slice(0, 1024) });
      if (placements.size > 0) {
        embed.addFields({
          name: `Placed in ${room.name} (${placements.size}/${room.decoSlots})`,
          value: [...placements.entries()].sort((a, b) => a[0] - b[0])
            .map(([slot, id]) => { const l = placementLabel(id); return `${slotLabel(slot)}: ${l.emoji} ${l.name}`; }).join("\n").slice(0, 1024),
        });
      }
      // Card wall-art: once the Portrait Frame is owned, hang any owned card's art.
      const hasFrame = owned.has(PORTRAIT_FRAME_ID);
      if (hasFrame) {
        embed.addFields({ name: "🖼️ Card wall-art", value: "You own the **Portrait Frame** — pick one of your cards below to frame its real art and hang it on a wall spot." });
      }
      // Place select (any earned-but-unplaced decoration). The Portrait Frame is
      // excluded here — it has its own card-picker flow below. Even a full room can
      // take one — the next step lets the player swap it into an occupied slot.
      const freeSlots = room.decoSlots - placements.size;
      const placeable = owns.filter(d => d.id !== PORTRAIT_FRAME_ID && !placedIds.has(d.id));
      if (placeable.length > 0) {
        const hint = freeSlots > 0 ? `${freeSlots} slot${freeSlots === 1 ? "" : "s"} free` : "room full — place to swap";
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:placedeco").setPlaceholder(`Place a decoration… (${hint})`)
            .addOptions(placeable.slice(0, 25).map(d => ({ label: d.name.slice(0, 90), value: d.id, description: d.rarity, emoji: d.emoji }))),
        ));
      }
      // Frame-a-card select (your top owned cards by worth).
      if (hasFrame) {
        const framable = await topOwnedCards(guildId, userId, 25);
        if (framable.length > 0) {
          rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId("hq-hub:framecard").setPlaceholder("🖼️ Frame a card…")
              .addOptions(framable.map(c => ({ label: c.name.slice(0, 90), value: String(c.id), description: c.rarity.slice(0, 50), emoji: "🖼️" }))),
          ));
        }
      }
      // Remove select.
      if (placements.size > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:removedeco").setPlaceholder("Remove a placed decoration…")
            .addOptions([...placements.entries()].sort((a, b) => a[0] - b[0]).map(([slot, id]) => ({
              label: `${slotLabel(slot)}: ${placementLabel(id).name.slice(0, 72)}`, value: String(slot), emoji: "🗑️",
            }))),
        ));
      }
      break;
    }

    case "shop": {
      const rot = shopRotation();
      const currency = await getOrCreateCurrency(guildId, userId).catch(() => ({ shards: 0 }));
      // Aisle "featured" = today's discounted rotation; "surfaces" = buyable
      // floors & walls; any SHOP_AISLES id browses that decoration category.
      const validAisle = shopAisle === "surfaces" || (shopAisle && SHOP_AISLES.some(a => a.id === shopAisle));
      const aisle = validAisle ? shopAisle! : "featured";
      const priceStr = (basePrice: number, price: number, pct: number) =>
        pct > 0 ? `~~${basePrice}~~ **${price}** (−${pct}%)` : `**${price}**`;

      embed.setTitle("🛒 The Furnisher's Stall").setDescription(
        "_“Welcome, collector! Browse the aisles — pay in the **same 💠 shards as the market**.”_\n" +
        "Anything you buy lands in **🎏 Decorations** (and on your **🏰 Base** grounds) to place. " +
        `The **⭐ Featured** shelf rotates daily with the only **discounts**.\n` +
        `👛 Purse: 💠 **${(currency.shards ?? 0).toLocaleString()}**  ·  🔄 Featured restocks in **${formatRefreshIn(rot.refreshesInMs)}**`,
      );

      // Aisle selector (categories) — always first.
      const aisleOpts = [
        { label: "Featured (on sale)", value: "featured", description: "Today's rotating discounts", emoji: "⭐", default: aisle === "featured" },
        ...SHOP_AISLES.map(a => ({ label: a.label, value: a.id, description: `Browse all ${a.label.toLowerCase()}`, emoji: a.emoji, default: aisle === a.id })),
        { label: "Surfaces", value: "surfaces", description: "Buyable floors & walls for 🎨 Style", emoji: "🧱", default: aisle === "surfaces" },
      ];
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId("hq-hub:shopcat").setPlaceholder("🧭 Choose an aisle…").addOptions(aisleOpts),
      ));

      if (aisle === "surfaces") {
        // Wallpapers, floors, walls and build materials. Buying grants the
        // style/brush, applied later in 🎨 Style or 🛠️ Build.
        const surfaces = buyableSurfaces();
        const lines = surfaces.map(s => `${s.emoji} **${s.name}** · ${s.kind} — 💠 **${s.price}**${owned.has(s.id) ? " · ✅ owned" : ""}`);
        embed.addFields({
          name: "🧱 Surfaces — wallpaper, floors, walls & build materials",
          value: lines.join("\n").slice(0, 1024) || "No surfaces for sale.",
        });
        const buyable = surfaces.filter(s => !owned.has(s.id));
        if (buyable.length > 0) {
          rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId("hq-hub:buysurface").setPlaceholder("Buy a surface…")
              .addOptions(buyable.slice(0, 25).map(s => ({
                label: `${s.name} — ${s.price}`.slice(0, 90), value: s.id,
                description: `${s.kind} · use it in ${s.usedIn}`.slice(0, 100), emoji: s.emoji,
              }))),
          ));
        }
        if (notice) embed.addFields({ name: "🧾 Receipt", value: notice.slice(0, 1024) });
        break;
      }

      // The item list for the active decoration aisle.
      let entries: { deco: typeof HQ_DECORATIONS[number]; basePrice: number; price: number; discountPct: number }[];
      let fieldName: string;
      if (aisle === "featured") {
        entries = rot.entries;
        fieldName = "⭐ Featured today (on sale)";
      } else {
        const a = SHOP_AISLES.find(x => x.id === aisle)!;
        entries = purchasableInAisle(aisle).map(d => { const e = shopPriceFor(d)!; return { deco: d, basePrice: e.basePrice, price: e.price, discountPct: e.discountPct }; });
        fieldName = `${a.emoji} ${a.label}`;
      }
      const stock = entries.map(e => {
        const own = owned.has(e.deco.id);
        return `${e.deco.emoji} **${e.deco.name}** · ${e.deco.rarity} — 💠 ${priceStr(e.basePrice, e.price, e.discountPct)}${own ? " · ✅ owned" : ""}`;
      });
      embed.addFields({ name: fieldName, value: stock.join("\n").slice(0, 1024) || "The shelves here are empty." });

      const buyable = entries.filter(e => !owned.has(e.deco.id));
      if (buyable.length > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(`hq-hub:buy:${aisle}`).setPlaceholder("Buy an item…")
            .addOptions(buyable.slice(0, 25).map(e => ({
              label: `${e.deco.name} — ${e.price}`.slice(0, 90),
              value: e.deco.id,
              description: `${e.discountPct > 0 ? `${e.discountPct}% off · ` : ""}${e.deco.rarity}`,
              emoji: e.deco.emoji,
            }))),
        ));
      }
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`hq-hub:crate:${aisle}`).setLabel(`Open Mystery Crate — ${CRATE_PRICE}`).setEmoji("🎁").setStyle(ButtonStyle.Success),
      ));
      if (notice) embed.addFields({ name: "🧾 Receipt", value: notice.slice(0, 1024) });
      break;
    }

    case "rooms": {
      embed.setTitle("🚪 Rooms").setDescription("Each room shows off a different side of your journey. Locked rooms open as you play.");
      const lines = HQ_ROOMS.map(r => {
        const open = isRoomUnlocked(r, owned);
        const here = r.id === room.id ? " · 📍 here" : "";
        return `${open ? r.emoji : "🔒"} **${r.name}**${here} — ${open ? r.blurb : unlockLabel(r.unlock)}`;
      });
      embed.addFields({ name: "Rooms", value: lines.join("\n").slice(0, 1024) });
      const open = unlockedRooms(owned);
      if (open.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:room").setPlaceholder("Switch room…")
            .addOptions(open.map(r => ({ label: r.name, value: r.id, description: r.blurb.slice(0, 90), emoji: r.emoji, default: r.id === room.id }))),
        ));
      }
      break;
    }

    case "theme": {
      const style = readHqStats(hq);
      const backdrop = resolveBackdrop(style.backdropId);
      const wallpaper = resolveWallpaper(style.wallpaperId);
      embed.setTitle("🎨 Style").setDescription(
        "Restyle your whole HQ — the **theme** sets lighting & mood, the **floor** reskins the ground, and " +
        "**wallpaper** hangs a real repeating covering on the walls, complete with dado rail and skirting. " +
        "Or toggle the **walls** off entirely and show a **backdrop** behind the room, and hide the display " +
        "**glass**. New styles unlock as you play.",
      );
      const themeLines = HQ_THEMES.map(t => {
        const open = isThemeUnlocked(t, owned);
        const here = t.id === theme.id ? " · ✅" : "";
        return `${open ? t.emoji : "🔒"} **${t.name}**${here}${open ? "" : ` — ${unlockLabel(t.unlock)}`}`;
      });
      embed.addFields(
        { name: "🎨 Themes", value: themeLines.join("\n").slice(0, 1024) },
        { name: `🖼️ Wallpaper · ${wallpaper.id === DEFAULT_WALLPAPER_ID ? wall.name : wallpaper.name}`, value: styleList(HQ_WALLPAPERS, wallpaper.id, w => isWallpaperUnlocked(w, owned)), inline: true },
        { name: `🪵 Floor · ${floor.name}`, value: styleList(HQ_FLOORS, floor.id, f => isFloorUnlocked(f, owned)), inline: true },
        { name: `🌅 Backdrop · ${backdrop.name}`, value: styleList(HQ_BACKDROPS, backdrop.id, b => isBackdropUnlocked(b, owned)), inline: true },
        {
          name: "🪟 Room",
          value:
            `Walls: ${style.wallsOff ? "**open** (outside) 🌅" : "**up** (inside) 🧱"}\n` +
            `Glass: ${style.glassOff ? "**off** 🔓" : "**on** 🟦"}`,
          inline: true,
        },
      );
      // Preset + toggle buttons: Inside/Outside set walls in one tap, then
      // individual toggles for finer control. Persisted to player_hq.stats.
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("hq-hub:preset:inside").setLabel("Inside").setEmoji("🏠")
          .setStyle(style.wallsOff ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("hq-hub:preset:outside").setLabel("Outside").setEmoji("🌅")
          .setStyle(style.wallsOff ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("hq-hub:togglewalls").setLabel(style.wallsOff ? "Walls on" : "Walls off").setEmoji("🧱")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("hq-hub:toggleglass").setLabel(style.glassOff ? "Glass on" : "Glass off").setEmoji("🪟")
          .setStyle(ButtonStyle.Secondary),
      ));
      // Discord caps a message at 5 action rows; nav + the button row already
      // take 2. Offer the reskin selects in priority order, stopping before the
      // cap so a fully-maxed player never overflows (a dropped select is still
      // reachable once another category collapses back to its default).
      const styleSelects: { id: string; ph: string; opts: { label: string; value: string; emoji: string; default: boolean }[] }[] = [];
      const openBackdrops = unlockedBackdrops(owned);
      // Wallpaper is the headline restyle, so it gets first claim on a row.
      const openWallpapers = HQ_WALLPAPERS.filter(w => isWallpaperUnlocked(w, owned));
      if (openWallpapers.length > 1) styleSelects.push({
        id: "wallpaper", ph: "Hang wallpaper…",
        opts: openWallpapers.slice(0, 25).map(w => ({
          label: w.id === DEFAULT_WALLPAPER_ID ? "Plain wall" : w.name,
          value: w.id, emoji: w.emoji, default: w.id === wallpaper.id,
        })),
      });
      if (openBackdrops.length > 1) styleSelects.push({ id: "backdrop", ph: "Backdrop (walls-off)…", opts: openBackdrops.map(b => ({ label: b.name, value: b.id, emoji: b.emoji, default: b.id === backdrop.id })) });
      const openThemes = unlockedThemes(owned);
      if (openThemes.length > 1) styleSelects.push({ id: "theme", ph: "Switch theme…", opts: openThemes.map(t => ({ label: t.name, value: t.id, emoji: t.emoji, default: t.id === theme.id })) });
      const openWalls = unlockedWalls(owned);
      if (openWalls.length > 1) styleSelects.push({ id: "wall", ph: "Change walls…", opts: openWalls.map(w => ({ label: w.name, value: w.id, emoji: w.emoji, default: w.id === wall.id })) });
      const openFloors = unlockedFloors(owned);
      if (openFloors.length > 1) styleSelects.push({ id: "floor", ph: "Change floor…", opts: openFloors.map(f => ({ label: f.name, value: f.id, emoji: f.emoji, default: f.id === floor.id })) });
      for (const sel of styleSelects) {
        if (rows.length >= 5) break;
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(`hq-hub:${sel.id}`).setPlaceholder(sel.ph).addOptions(sel.opts),
        ));
      }
      break;
    }
  }

  if (justUnlocked.length > 0) {
    embed.addFields({
      name: "🎉 Just unlocked",
      value: justUnlocked.slice(0, 5).map(d => `${d.emoji} **${d.name}** — _${d.story}_`).join("\n").slice(0, 1024),
    });
  }

  return { embeds: [embed], components: rows, files };
}

// A conqueror holds a base until it is RECLAIMED (persistent takeover). The
// shield only gates how soon it can be re-attacked / reclaimed, not the hold.
function activeCapture(state: Awaited<ReturnType<typeof getBaseState>>): { heldBy: string; heldName: string; shieldUntil: Date | null } | null {
  if (!state?.heldByUserId) return null;
  return { heldBy: state.heldByUserId, heldName: state.heldByName ?? "a rival", shieldUntil: state.shieldUntil ?? null };
}

// Placements under this pseudo-room id decorate the OUTDOOR base (its own grounds
// layout), separate from the interior rooms.
const BASE_ROOM_ID = BASE_CANVAS_ID;

// ── Build mode ────────────────────────────────────────────────────────────────
// The grounds and the interior rooms have different lattice sizes; everything
// that validates or draws a rectangle asks here rather than hardcoding one.
function gridFor(canvas: string): number {
  return canvas === BASE_ROOM_ID ? HQ_BASE_GRID : HQ_GRID;
}

async function loadCursor(guildId: string, userId: string, hq: PlayerHq): Promise<BuildCursor> {
  const stored = (hq.stats as { build?: StoredBuild } | null)?.build;
  // A cursor parked on a room the player can no longer open falls back to the
  // grounds, which are always available.
  let canvas = stored?.canvas ?? BASE_ROOM_ID;
  if (canvas !== BASE_ROOM_ID) {
    const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
    if (!isRoomUnlocked(resolveRoom(canvas), owned)) canvas = BASE_ROOM_ID;
  }
  return readCursor(stored, canvas, gridFor(canvas));
}

// The cursor as the renderer's overlay: red when the current brush wouldn't fit,
// so an invalid placement is visible before the button is pressed.
function cursorOverlay(cur: BuildCursor): HqBuildCursor {
  const mat = resolveSurface(cur.materialId);
  return {
    x: cur.x, y: cur.y, w: cur.w, h: cur.h,
    color: mat.kind === "water" ? 0x4aa3ff : mat.kind === "mound" ? 0x7bd06a : 0x2fd4d4,
    label: cursorLabel(cur),
    valid: true,
  };
}

async function nudgeCursor(guildId: string, userId: string, dir: string): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  const cur = await loadCursor(guildId, userId, hq);
  const moved: BuildCursor = { ...cur };
  if (dir === "left") moved.x -= 1;
  else if (dir === "right") moved.x += 1;
  else if (dir === "up") moved.y -= 1;
  else if (dir === "down") moved.y += 1;
  await saveCursor(guildId, userId, clampCursor(moved, gridFor(cur.canvas)));
}

// Sizes cycle 1→MAX→1 so one button covers grow and reset without a second.
async function cycleCursorSize(guildId: string, userId: string, axis: "w" | "h"): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  const cur = await loadCursor(guildId, userId, hq);
  const grid = gridFor(cur.canvas);
  const cap = Math.min(MAX_RECT_SPAN, grid);
  const next = (cur[axis] % cap) + 1;
  await saveCursor(guildId, userId, clampCursor({ ...cur, [axis]: next }, grid));
}

async function cycleCursorElevation(guildId: string, userId: string): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  const cur = await loadCursor(guildId, userId, hq);
  await saveCursor(guildId, userId, { ...cur, elevation: (cur.elevation + 1) % (MAX_ELEVATION + 1) });
}

async function setCursorMaterial(guildId: string, userId: string, materialId: string): Promise<void> {
  const mat = getSurfaceById(materialId);
  if (!mat) return;
  const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
  if (!isSurfaceUnlocked(mat, owned)) return;
  const hq = await getOrCreateHq(guildId, userId);
  const cur = await loadCursor(guildId, userId, hq);
  await saveCursor(guildId, userId, { ...cur, materialId });
}

async function setCursorCanvas(guildId: string, userId: string, canvas: string): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  const cur = await loadCursor(guildId, userId, hq);
  if (canvas !== BASE_ROOM_ID) {
    const owned = await getUnlockedItemIds(guildId, userId).catch(() => new Set<string>());
    if (!isRoomUnlocked(resolveRoom(canvas), owned)) return;
  }
  await saveCursor(guildId, userId, clampCursor({ ...cur, canvas }, gridFor(canvas)));
}

async function placeAtCursor(guildId: string, userId: string): Promise<string> {
  return withHqLock(`hq:build:${guildId}:${userId}`, async () => {
    const hq = await getOrCreateHq(guildId, userId);
    const cur = await loadCursor(guildId, userId, hq);
    const res = await placeTerrain(guildId, userId, cur.canvas, gridFor(cur.canvas), {
      materialId: cur.materialId, x: cur.x, y: cur.y, w: cur.w, h: cur.h, elevation: cur.elevation,
    });
    if (!res.ok) return `❌ ${res.reason}`;
    return `✅ Placed ${describeFeature(res.feature)}.`;
  });
}

async function removeAtCursor(guildId: string, userId: string): Promise<string> {
  return withHqLock(`hq:build:${guildId}:${userId}`, async () => {
    const hq = await getOrCreateHq(guildId, userId);
    const cur = await loadCursor(guildId, userId, hq);
    const removed = await removeTerrainAt(guildId, userId, cur.canvas, cur.x, cur.y);
    return removed
      ? `🗑️ Removed ${describeFeature(removed)}.`
      : `Nothing built at **(${cur.x}, ${cur.y})**.`;
  });
}

/**
 * Render one build canvas with the cursor overlaid — the shared picture behind
 * both the visual Build section and every `/hqbuild` reply, so the two halves of
 * the editor can never drift apart visually.
 */
export async function renderBuildCanvas(
  interaction: HubInteraction, canvas: string, cursor: BuildCursor,
): Promise<AttachmentBuilder | null> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const hq = await getOrCreateHq(guildId, userId);
  const name = interaction.user.username;
  const avatar = interaction.user.displayAvatarURL();
  return canvas === BASE_ROOM_ID
    ? renderBaseImage(await buildBaseRenderView(guildId, userId, name, avatar, hq, cursor))
    : renderRoomImage(await buildRenderView(guildId, userId, name, avatar, hq, false, cursor));
}

/** Persist an HQ's wallpaper choice (shared with `/hqbuild wallpaper`). */
export async function setHqWallpaper(guildId: string, userId: string, wallpaperId: string): Promise<void> {
  const hq = await getOrCreateHq(guildId, userId);
  await updateHq(guildId, userId, { stats: { ...readHqStats(hq), wallpaperId } }).catch(() => {});
}

async function clearCanvasAtCursor(guildId: string, userId: string): Promise<string> {
  return withHqLock(`hq:build:${guildId}:${userId}`, async () => {
    const hq = await getOrCreateHq(guildId, userId);
    const cur = await loadCursor(guildId, userId, hq);
    const n = await clearTerrain(guildId, userId, cur.canvas);
    return n > 0 ? `🧹 Cleared **${n}** built surface${n === 1 ? "" : "s"}.` : "Nothing to clear here.";
  });
}

// ── Base siege (attack/capture mini-game) ─────────────────────────────────────
// "turn" hands the assault to the player as a full turn-for-turn battle;
// "cinematic" plays the landscape opening film and then auto-resolves; the rest
// are the fast auto-resolve paths.
//
// Which one a guild uses is the SERVER OWNER's setting (bot/hq/settings.ts) —
// never a per-attack prompt, so every siege in a server looks the same.
type SiegeMode = HqSiegeConfig["mode"];
const SIEGE_FILE = "siege.png", SIEGE_GIF = "siege.gif";
// How many of the attacker's strongest cards to offer as a pickable roster at
// muster (the column itself is only as wide as the garrison). Capped so the
// select menu stays within Discord's 25-option limit.
const SIEGE_COLUMN_POOL = 20;
type LoadedCtx = Awaited<ReturnType<typeof loadCtx>>;

// A card → siege combatant, power taken from the guild strength ladder (the same
// source of truth battles/raids use) with a small worth tiebreaker.
function toSiegeCombatant(card: { id: number; name: string; rarity: string; worthValue?: number; imageUrl: string | null }, cx: LoadedCtx): SiegeCombatant {
  const d = getCardDisplayRarity({ id: card.id, rarity: card.rarity }, cx.ctx, cx.settings, cx.displayMap);
  const rank = rarityLadderRank(String(card.rarity), cx.ctx);
  const power = (rank + 1) * 100 + Math.round((card.worthValue ?? 0) / 25);
  return {
    cardId: card.id, name: card.name, rarity: String(card.rarity),
    rarityLabel: d.label, rarityColor: d.color, artUrl: toAbsoluteImageUrl(card.imageUrl), power,
  };
}

async function buildAttackerSquad(guildId: string, userId: string, cx: LoadedCtx, count: number): Promise<SiegeCombatant[]> {
  const ownedIds = new Set((await getUserCollection(guildId, userId)).map(i => i.cardId));
  const pool = cx.cards.filter(c => ownedIds.has(c.id)).map(c => toSiegeCombatant(c, cx));
  pool.sort((a, b) => b.power - a.power);
  return pool.slice(0, Math.max(1, count));
}

async function buildDefenderSquad(guildId: string, defenderId: string, cx: LoadedCtx): Promise<SiegeCombatant[]> {
  const map = await getDefenders(guildId, defenderId);
  const out: SiegeCombatant[] = [];
  for (const [, cardId] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    const card = cx.cards.find(c => c.id === cardId);
    if (card) out.push(toSiegeCombatant(card, cx));
  }
  return out;
}

// Ladder strength for ordering an attacker's squad "strongest first" without
// deriving full battle stats (same source of truth as toSiegeCombatant).
function ladderPowerOf(c: OwnedBattleCard, ctx: LoadedCtx["ctx"]): number {
  const rank = rarityLadderRank(String(c.effectiveRarityKey ?? c.rarity), ctx);
  return (rank + 1) * 1000 + c.level * 5 + Math.round((c.worthValue ?? 0) / 25);
}

// Real-engine squads: OwnedBattleCards (level, star rank, config) so the combat
// engine can derive true stats. Attacker = strongest `count`; defenders = the
// STATIONED cards in slot order (what the owner set to guard).
async function buildAttackerCards(guildId: string, userId: string, ctx: LoadedCtx["ctx"], count: number): Promise<OwnedBattleCard[]> {
  const owned = await getOwnedBattleCards(guildId, userId, ctx);
  owned.sort((a, b) => ladderPowerOf(b, ctx) - ladderPowerOf(a, ctx));
  return owned.slice(0, Math.max(1, count));
}

async function buildDefenderCards(guildId: string, defenderId: string, ctx: LoadedCtx["ctx"]): Promise<OwnedBattleCard[]> {
  const map = await getDefenders(guildId, defenderId);
  const owned = await getOwnedBattleCards(guildId, defenderId, ctx);
  const byId = new Map(owned.map(c => [c.id, c] as const));
  const out: OwnedBattleCard[] = [];
  for (const [, cardId] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    const c = byId.get(cardId);
    if (c) out.push(c);
  }
  return out;
}

// Why a base can't be attacked right now (null = go ahead).
async function siegeBlockReason(guildId: string, attackerId: string, defenderId: string): Promise<string | null> {
  if (attackerId === defenderId) return "You can't besiege your own base.";
  const defenders = await getDefenders(guildId, defenderId);
  if (defenders.size === 0) return "That base has no defenders to fight.";
  if (activeCapture(await getBaseState(guildId, defenderId))) return "That base is shielded after a recent battle. Try again later.";
  const recent = await recentAttackCount(guildId, attackerId, defenderId, new Date(Date.now() - SIEGE_COOLDOWN_MS));
  if (recent >= SIEGE_MAX_PER_WINDOW) return "You've attacked this base too recently — wait for the cooldown.";
  return null;
}

// The pre-siege briefing. How a siege is FOUGHT is no longer the attacker's
// choice — the server owner sets one style for the whole guild in `/hqadmin`,
// the same way battle visuals are configured — so this screen is purely "here's
// what you're walking into", ending in a single Lay Siege button.
async function buildAttackBriefing(guildId: string, attackerId: string, defenderId: string) {
  const blocked = await siegeBlockReason(guildId, attackerId, defenderId);
  const embed = new EmbedBuilder().setColor(0xc0392b).setTitle("⚔️ Lay Siege");
  if (blocked) {
    embed.setDescription(`❌ ${blocked}`);
    return { embeds: [embed], components: [backRow("defenders")], files: [] as AttachmentBuilder[] };
  }
  const cx = await loadCtx(guildId);
  const defenders = await buildDefenderSquad(guildId, defenderId, cx);
  const squad = await buildAttackerSquad(guildId, attackerId, cx, defenders.length);
  const forti = await baseFortification(guildId, defenderId);
  const siegeCfg = await getSiegeConfig(guildId);
  const mode = siegeModeMeta(siegeCfg.mode);
  const yourP = squad.reduce((s, c) => s + c.power, 0), theirP = defenders.reduce((s, c) => s + c.power, 0);
  embed.setDescription(
    `Your strongest **${squad.length}** cards storm **${defenders.length}** stationed defenders in a **real battle** ` +
    "— true stats, moves, specials and passives. Break every rank to capture the base.\n\n" +
    `⚔️ Your strength: **${yourP}**  ·  🛡️ Their defence: **${theirP}**` +
    (forti.totalPct > 0 ? `  ·  🏯 **+${forti.totalPct}%** ${forti.tier.label} fortifications` : ""),
  );
  embed.addFields({ name: `${mode.emoji} Siege style — ${mode.label}`, value: `${mode.blurb}\n_Set for this server by an admin in \`/hqadmin\`._` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:siege:${defenderId}`).setLabel("Lay Siege").setEmoji("⚔️").setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row, backRow("defenders")], files: [] as AttachmentBuilder[] };
}

function backRow(section: Section) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:back:${section}`).setLabel("Back").setEmoji("◀").setStyle(ButtonStyle.Secondary),
  );
}

// Flavour move names for the classic (move-by-move) siege captions.
const SIEGE_MOVES = ["Siege Strike", "Breach", "Overrun", "Vanguard Charge", "Final Blow", "Rally", "Flank", "Storm the Gate"];

// "Shards while you hold": mint tribute for every base the viewer currently
// holds, pull-based, and restart their accrual clock. Returns a short toast
// (or null) to surface at the top of the World map. Best-effort — a failed pay
// never blocks the view.
async function collectHoldTribute(guildId: string, userId: string): Promise<string | null> {
  // Reading owed tribute and advancing its clocks is a read-modify-write
  // sequence. Serialize it per holder so rapid World-map opens cannot both
  // mint the same interval. Do not advance any clocks if the currency write
  // fails; the holder can retry instead of silently losing tribute.
  return withHqLock(`hq:tribute:${guildId}:${userId}`, async () => {
    const now = new Date();
    let total = 0;
    const parts: string[] = [];

    // Member bases the viewer has conquered.
    const held = await getHeldBases(guildId, userId).catch(() => []);
    const collectedOwners: string[] = [];
    for (const b of held) {
      const owed = tributeOwed(b.since, now);
      if (owed > 0) { total += owed; collectedOwners.push(b.ownerId); }
    }
    if (collectedOwners.length > 0) {
      parts.push(`**${collectedOwners.length}** base${collectedOwners.length === 1 ? "" : "s"} (+${TRIBUTE_PER_HOUR}/hr each)`);
    }

    // World territories pay by tier — a capital is worth more than an outpost.
    const territories = await getHeldTerritories(guildId, userId).catch(() => []);
    const collectedNodes: string[] = [];
    for (const t of territories) {
      const tier = getTerritory(t.nodeId)?.tier ?? 1;
      const owed = territoryTributeOwed(tier, t.since, now);
      if (owed > 0) { total += owed; collectedNodes.push(t.nodeId); }
    }
    if (collectedNodes.length > 0) {
      parts.push(`**${collectedNodes.length}** territor${collectedNodes.length === 1 ? "y" : "ies"}`);
    }

    if (total <= 0) return null;
    await addShards(guildId, userId, total);
    await markTributesCollected(guildId, userId, collectedOwners, now);
    await markTerritoryTributesCollected(guildId, userId, collectedNodes, now);
    return `💠 **+${total}** hold-tribute collected from ${parts.join(" and ")}.`;
  });
}

// Human "2d 3h", "4h 12m", "37m" from seconds — for reign durations.
function formatReign(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

// A card the attacker's champion figure is drawn from, in the render's shape.
function championRender(card: OwnedBattleCard | undefined, cx: LoadedCtx) {
  if (!card) return null;
  const d = getCardDisplayRarity({ id: card.id, rarity: card.rarity }, cx.ctx, cx.settings, cx.displayMap);
  return { slot: 0, cardId: card.id, name: card.name, artUrl: toAbsoluteImageUrl(card.imageUrl), rarityColor: d.color, basePath: null };
}

// One resolved siege, normalised so runSiege renders it the same whichever engine
// produced it: the full turn-based battle engine (preferred) or the power
// auto-resolver (fallback when battles are disabled / a squad can't be built).
interface SiegeOutcome {
  attackerWon: boolean;
  attackerPower: number;
  defenderPower: number;
  defenderCount: number;
  summary: string;                                            // headline for the embed
  logLines: string[];                                          // classic-mode recap
  duels: { slot: number; attackerWon: boolean; move: string }[]; // render plan
  champ: ReturnType<typeof championRender>;                    // attacker's lead card
  real: boolean;
}

// Highlight flashes worth surfacing in the classic-mode recap of a real battle.
const SIEGE_HIGHLIGHT = new Set(["ko", "ultimate", "crit", "laststand", "shield_break", "counter", "combo"]);

function outcomeFromBattle(r: SiegeBattleResult, champ: ReturnType<typeof championRender>): SiegeOutcome {
  const cleared = r.defenderFalls.filter(d => d.defeated).length;
  const total = r.defenderFalls.length;
  const highlights = r.events.filter(e => e.flash && SIEGE_HIGHLIGHT.has(e.flash)).map(e => e.text);
  const logLines = (highlights.length >= 3 ? highlights : r.events.map(e => e.text)).slice(-8);
  return {
    attackerWon: r.attackerWon, attackerPower: r.attackerPower, defenderPower: r.defenderPower,
    defenderCount: total,
    summary: r.attackerWon
      ? `cleared **${cleared}/${total}** defenders, losing **${r.attackerCardsLost}** card${r.attackerCardsLost === 1 ? "" : "s"}`
      : `the walls held at **${cleared}/${total}** — your assault was broken`,
    logLines,
    duels: r.defenderFalls.map(d => ({ slot: d.slot, attackerWon: d.defeated, move: d.move })),
    champ, real: true,
  };
}

function outcomeFromPower(r: ReturnType<typeof resolveSiege>, champ: ReturnType<typeof championRender>, defenderCount: number): SiegeOutcome {
  return {
    attackerWon: r.attackerWon, attackerPower: r.attackerPower, defenderPower: r.defenderPower,
    defenderCount,
    summary: `duels **${r.attackerWins}–${r.defenderWins}**`,
    logLines: r.duels.slice(0, 6).map((d, i) => `**${i + 1}.** ${d.attacker.name} ${d.attackerWon ? "🟢 beat" : "🔴 lost to"} ${d.defender.name}`),
    duels: r.duels.map((d, i) => ({ slot: i, attackerWon: d.attackerWon, move: SIEGE_MOVES[Math.floor(Math.random() * SIEGE_MOVES.length)]! })),
    champ, real: false,
  };
}

// Resolve a siege — real battle engine first, power auto-resolve as a safety net.
async function resolveSiegeOutcome(guildId: string, attackerId: string, attackerName: string, defenderId: string, defenderName: string, cx: LoadedCtx, defenderBonusPct = 0): Promise<SiegeOutcome> {
  try {
    const settings = await getBattleSettings(guildId);
    if (settings.enabled) {
      const defenderCards = await buildDefenderCards(guildId, defenderId, cx.ctx);
      if (defenderCards.length > 0) {
        const attackerCards = await buildAttackerCards(guildId, attackerId, cx.ctx, defenderCards.length);
        if (attackerCards.length > 0) {
          const r = simulateSiegeBattle(attackerCards, defenderCards, settings, guildId, cx.ctx, { attackerId, attackerName, defenderId, defenderName }, defenderBonusPct);
          return outcomeFromBattle(r, championRender(attackerCards[0], cx));
        }
      }
    }
  } catch {
    // Fall through to the power auto-resolver below.
  }
  const defenders = await buildDefenderSquad(guildId, defenderId, cx);
  const squad = await buildAttackerSquad(guildId, attackerId, cx, defenders.length);
  const champ = squad[0]
    ? { slot: 0, cardId: squad[0].cardId, name: squad[0].name, artUrl: squad[0].artUrl, rarityColor: squad[0].rarityColor, basePath: null }
    : null;
  return outcomeFromPower(resolveSiege(squad, defenders, Math.random, defenderBonusPct), champ, defenders.length);
}

// ── Turn-for-turn siege launchers ────────────────────────────────────────────
// Build both sides as live combatants, prepare the castle scene, and hand off to
// the siege runtime with an applyOutcome callback that commits capture/reward and
// returns the result screen — one shape for player bases and AI territories.

// The attacker's lead card as the champion figure the castle frame draws
// storming the gate.
function championFor(cards: OwnedBattleCard[], cx: LoadedCtx): HqRenderDefender | null {
  const card = cards[0];
  if (!card) return null;
  const d = getCardDisplayRarity({ id: card.id, rarity: card.rarity as string }, cx.ctx, cx.settings, cx.displayMap);
  return {
    slot: 0, cardId: card.id, name: card.name,
    artUrl: toAbsoluteImageUrl(card.imageUrl), rarityColor: d.color, basePath: null,
  };
}

async function launchPlayerSiege(
  interaction: ButtonInteraction, guildId: string, attackerId: string, attackerName: string,
  defenderId: string, defenderName: string, defHq: PlayerHq, cx: LoadedCtx, siegeCfg: HqSiegeConfig,
): Promise<void> {
  const fail = (msg: string) => interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(`❌ ${msg}`)],
    components: [backRow("defenders")], files: [],
  }).then(() => {}).catch(() => {});
  const settings = await getBattleSettings(guildId);
  if (!settings.enabled) { await fail("Battles are disabled here, so a turn-for-turn siege can't run. An admin can switch the siege style in `/hqadmin`."); return; }
  const defenderCards = await buildDefenderCards(guildId, defenderId, cx.ctx);
  if (defenderCards.length === 0) { await fail("This base has no defenders to fight."); return; }
  // Build a marching ROSTER (more than the column needs) so the player can pick
  // which cards form the column at muster; the default column is the strongest N.
  const poolCards = await buildAttackerCards(guildId, attackerId, cx.ctx, SIEGE_COLUMN_POOL);
  if (poolCards.length === 0) { await fail("You have no cards to march with. Catch some first."); return; }
  const attackerCards = poolCards.slice(0, defenderCards.length);

  const forti = await baseFortification(guildId, defenderId);
  const attackerPool = buildSiegeSquad(poolCards, settings, guildId, cx.ctx, 0, attackerId, attackerName);
  const attackers = attackerPool.slice(0, defenderCards.length);
  const defenders = buildSiegeSquad(defenderCards, settings, guildId, cx.ctx, 1, defenderId, defenderName, forti.totalPct);
  const baseView = await buildBaseRenderView(guildId, defenderId, defenderName, null, defHq).catch(() => null);

  await startSiege(interaction, {
    guildId, targetKey: `hq:base:${guildId}:${defenderId}`,
    starterId: attackerId, attackerName, targetName: defenderName,
    holderName: forti.totalPct > 0 ? `${defenderName} · +${forti.totalPct}% fortified` : defenderName,
    accent: 0xc0392b, attackers, attackerPool, defenders, settings, siege: siegeCfg,
    baseView, champion: championFor(attackerCards, cx),
    applyOutcome: (o) => finalizePlayerSiege(interaction, guildId, attackerId, attackerName, defenderId, o, forti.totalPct),
  });
}

async function finalizePlayerSiege(
  interaction: ButtonInteraction, guildId: string, attackerId: string, attackerName: string,
  defenderId: string, o: TurnSiegeOutcome, fortiPct: number,
): Promise<TurnSiegeResultView> {
  await withHqLock(`hq:siege:${guildId}:${defenderId}`, async () => {
    await applySiegeToBase(guildId, defenderId, o.attackerWon, attackerId, attackerName, SIEGE_SHIELD_MS).catch(() => {});
  }).catch(() => {});
  await logSiege(guildId, attackerId, defenderId, o.attackerWon, o.attackerPower, o.defenderPower, "turn").catch(() => {});
  // A clean three-star assault is worth more than a bloody two-star one.
  // Stars pay: a clean three-star capture beats a bloody two-star one, and a
  // failed assault that still wrecked half the base beats one that bounced.
  const base = o.attackerWon ? Math.min(300, 60 + Math.round(o.defenderPower / 18)) : 20;
  const reward = Math.round(base * (1 + 0.15 * Math.max(0, o.stars - (o.attackerWon ? 1 : 0))));
  await addShards(guildId, attackerId, reward).catch(() => {});
  void notifySiege(interaction, guildId, defenderId, attackerName, o.attackerWon, reward);
  return {
    title: o.attackerWon ? "⚔️ Base Captured!" : "🛡️ Base Defended!",
    description: o.attackerWon
      ? `You broke every rank in **${o.turns}** turns. You hold the base until it's reclaimed — earning **${TRIBUTE_PER_HOUR}💠/hr**.`
      : `The garrison held the walls after **${o.turns}** turns.`,
    color: o.attackerWon ? 0x4fd06a : 0xc0392b,
    fields: [
      { name: "⚔️ Squad power", value: `**${o.attackerPower}**`, inline: true },
      { name: "🛡️ Defence", value: `**${o.defenderPower}**${fortiPct > 0 ? ` · 🏯 +${fortiPct}%` : ""}`, inline: true },
      { name: "💠 Loot", value: `**+${reward}** shards`, inline: true },
    ],
  };
}

async function launchTerritorySiege(
  interaction: ButtonInteraction, guildId: string, attackerId: string, attackerName: string,
  nodeId: string, view: WorldTerritoryView, theme: ReturnType<typeof resolveTheme>,
  garrison: OwnedBattleCard[], attackerCards: OwnedBattleCard[], cx: LoadedCtx, siegeCfg: HqSiegeConfig,
): Promise<void> {
  const settings = await getBattleSettings(guildId);
  if (!settings.enabled) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(
        "❌ Battles are disabled here, so a turn-for-turn siege can't run. An admin can switch the siege style in `/hqadmin`.")],
      components: [backRow("world")], files: [],
    }).catch(() => {});
    return;
  }
  const defenderName = holderLabel(view);
  // A pickable roster (strongest cards, capped) so the player can form the column
  // at muster; the default column is only as wide as the garrison.
  const poolCards = await buildAttackerCards(guildId, attackerId, cx.ctx, SIEGE_COLUMN_POOL).catch(() => attackerCards);
  const attackerPool = buildSiegeSquad(poolCards, settings, guildId, cx.ctx, 0, attackerId, attackerName);
  const attackers = attackerPool.slice(0, garrison.length);
  // "AI" as the garrison owner so the battle embed tags the defenders as 🤖 AI
  // (combatantField special-cases it) instead of showing a raw world node id.
  const defenders = buildSiegeSquad(garrison, settings, guildId, cx.ctx, 1, "AI", defenderName);

  await startSiege(interaction, {
    guildId, targetKey: `hq:world:${guildId}:${nodeId}`,
    starterId: attackerId, attackerName, targetName: view.territory.name,
    holderName: defenderName,
    accent: view.faction.color, attackers, attackerPool, defenders, settings, siege: siegeCfg,
    baseView: territoryBaseView(view, theme, garrison, cx),
    champion: championFor(attackerCards, cx),
    applyOutcome: (o) => finalizeTerritorySiege(interaction, guildId, attackerId, attackerName, nodeId, view, o),
  });
}

async function finalizeTerritorySiege(
  interaction: ButtonInteraction, guildId: string, attackerId: string, attackerName: string,
  nodeId: string, view: WorldTerritoryView, o: TurnSiegeOutcome,
): Promise<TurnSiegeResultView> {
  const prof = tierProfile(view.territory.tier);
  let previousHolder: string | null = null;
  await withHqLock(`hq:world:${guildId}:${nodeId}`, async () => {
    if (o.attackerWon) {
      ({ previousHolder } = await captureTerritory(guildId, nodeId, attackerId, attackerName, WORLD_SHIELD_MS)
        .catch(() => ({ previousHolder: null })));
    } else {
      await markTerritoryAttacked(guildId, nodeId).catch(() => {});
    }
  }).catch(() => {});
  await logSiege(guildId, attackerId, territoryLogKey(nodeId), o.attackerWon, o.attackerPower, o.defenderPower, "turn").catch(() => {});
  const base = o.attackerWon ? prof.bounty : Math.round(prof.bounty * 0.12);
  const reward = Math.round(base * (1 + 0.15 * Math.max(0, o.stars - (o.attackerWon ? 1 : 0))));
  await addShards(guildId, attackerId, reward).catch(() => {});
  if (previousHolder && previousHolder !== attackerId) void notifyTerritoryLost(interaction, previousHolder, attackerName, view.territory.name);
  return {
    title: o.attackerWon ? `🚩 ${view.territory.name} is yours!` : `🛡️ ${view.territory.name} holds`,
    description: o.attackerWon
      ? `You broke the ${holderLabel(view)} garrison in **${o.turns}** turns and now hold this ${prof.label.toLowerCase()} — **${prof.tributePerHour}💠/hr**.`
      : `The ${holderLabel(view)} garrison threw you back after **${o.turns}** turns.`,
    color: o.attackerWon ? 0x4fd06a : view.faction.color,
    fields: [
      { name: "⚔️ Squad power", value: `**${o.attackerPower}**`, inline: true },
      { name: "🛡️ Garrison", value: `**${o.defenderPower}**`, inline: true },
      { name: "💠 Loot", value: `**+${reward}** shards`, inline: true },
    ],
  };
}

// The base assault's opening film. Shared by the cinematic auto-siege and the
// turn-for-turn assault (which rolls it first when the guild has intros on).
async function playBaseCinematic(
  interaction: ButtonInteraction, guildId: string, attackerId: string, attackerName: string,
  defenderId: string, defenderName: string, defHq: PlayerHq, cx: LoadedCtx,
): Promise<void> {
  const theme = resolveTheme((await getOrCreateHq(guildId, attackerId)).themeId);
  const squad = await buildAttackerCards(guildId, attackerId, cx.ctx, 5).catch(() => []);
  const garrisonSize = (await getDefenders(guildId, defenderId).catch(() => new Map())).size;
  await playCinematic(interaction, {
    targetName: defenderName,
    holderName: readHqStats(defHq).title?.trim() ? defenderName : "its garrison",
    defenderColor: resolveTheme(defHq.themeId).palette.accent,
    attackerColor: theme.palette.accent,
    attackerName,
    cards: squad.slice(0, 5).map(c => {
      const d = getCardDisplayRarity({ id: c.id, rarity: c.rarity as string }, cx.ctx, cx.settings, cx.displayMap);
      return { name: c.name, artUrl: toAbsoluteImageUrl(c.imageUrl), rarityColor: d.color };
    }),
    garrison: garrisonSize,
    structure: "castle",
    mood: "dusk",
    tagline: readHqStats(defHq).motto ?? "Take the walls, take the base.",
  }, theme.palette.accent);
}

async function runSiege(interaction: ButtonInteraction, guildId: string, attackerId: string, defenderId: string): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  // One style for the whole server, set by an admin — never asked of the player.
  const siegeCfg = await getSiegeConfig(guildId);
  const mode = siegeCfg.mode;
  // Serialize per DEFENDER (the contested base) so every attack on one base runs
  // one-at-a-time — not just repeat clicks from a single attacker. Keying by the
  // attacker would let two DIFFERENT attackers both pass the shield/cooldown check
  // before either writes the base state, double-resolving a capture. The queued
  // siege re-runs the block check AFTER the prior one commits its log + state.
  await withHqLock(`hq:siege:${guildId}:${defenderId}`, async () => {
  if (isSiegeTargetActive(`hq:base:${guildId}:${defenderId}`)) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xc0392b)
        .setDescription("❌ That base is already under an interactive siege.")],
      components: [backRow("defenders")], files: [],
    }).catch(() => {});
    return;
  }
  const blocked = await siegeBlockReason(guildId, attackerId, defenderId);
  if (blocked) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(`❌ ${blocked}`)], components: [backRow("defenders")], files: [] }).catch(() => {});
    return;
  }
  const attackerName = interaction.user.username;
  const defHq = await getOrCreateHq(guildId, defenderId);
  const defenderName = readHqStats(defHq).title?.trim() || "the defenders";

  const cx = await loadCtx(guildId);

  // Turn-for-turn: optionally roll the opening film, then hand the assault to the
  // player (its own live board) and bail out of the auto-resolve path.
  if (mode === "turn") {
    if (siegeCfg.intro) {
      await playBaseCinematic(interaction, guildId, attackerId, attackerName, defenderId, defenderName, defHq, cx);
    }
    await launchPlayerSiege(interaction, guildId, attackerId, attackerName, defenderId, defenderName, defHq, cx, siegeCfg);
    return;
  }

  // The opening film, before anything is resolved — the ride up to the base, the
  // gates opening, the garrison mustering, and the raider's cards flying in.
  if (mode === "cinematic") {
    await playBaseCinematic(interaction, guildId, attackerId, attackerName, defenderId, defenderName, defHq, cx);
  }

  // The defender's fortification (base tier + built walls/towers/moats) hardens
  // their garrison — this is where Build mode pays off on defence.
  const forti = await baseFortification(guildId, defenderId);
  const result = await resolveSiegeOutcome(guildId, attackerId, attackerName, defenderId, defenderName, cx, forti.totalPct);

  // Persist outcome (capture + shield on a win; log either way).
  await applySiegeToBase(guildId, defenderId, result.attackerWon, attackerId, attackerName, SIEGE_SHIELD_MS).catch(() => {});
  await logSiege(guildId, attackerId, defenderId, result.attackerWon, result.attackerPower, result.defenderPower, mode).catch(() => {});

  // Stakes: the attacker earns a shard BOUNTY on a win (scaled by the defence it
  // beat), or a small consolation on a loss. The bounty is minted, never drained
  // from the defender — no griefing — and the existing shield + per-target
  // cooldown gate how often it can be earned. Reuses the market shard economy.
  const reward = result.attackerWon
    ? Math.min(300, 60 + Math.round(result.defenderPower / 18))
    : 20;
  await addShards(guildId, attackerId, reward).catch(() => {});

  const col = result.attackerWon ? 0x4fd06a : 0xc0392b;
  const embed = new EmbedBuilder().setColor(col)
    .setTitle(result.attackerWon ? "⚔️ Base Captured!" : "🛡️ Base Defended!")
    .setDescription(
      `**${attackerName}** ${result.attackerWon ? "stormed" : "failed to take"} the base — ` +
      `${result.summary}.` +
      (result.attackerWon ? `\n🚩 You hold it until it's reclaimed — earning **${TRIBUTE_PER_HOUR}💠/hr** while you do. Collect from the 🗺️ World map.` : "\nThe defenders held the walls."),
    )
    .addFields(
      { name: "⚔️ Squad power", value: `**${result.attackerPower}**`, inline: true },
      { name: "🛡️ Defence power", value: `**${result.defenderPower}**${forti.totalPct > 0 ? ` · 🏯 +${forti.totalPct}% fortified` : ""}`, inline: true },
      { name: "💠 Loot", value: `**+${reward}** shards`, inline: true },
    );

  // Notify the base owner (best-effort DM) — attacking someone should let them
  // know, win or lose, so conquest is a two-way game.
  void notifySiege(interaction, guildId, defenderId, attackerName, result.attackerWon, reward);

  // All three modes render ON the defender's base scene (castle + cards + health)
  // — never a separate VS screen. Classic adds move captions + hit flashes; live
  // is the clean cinematic; static is one final frame.
  const files: AttachmentBuilder[] = [];
  const baseView = await buildBaseRenderView(guildId, defenderId, defenderName, null, defHq);
  const plan: SiegePlan = {
    duels: result.duels,
    defenderCount: result.defenderCount,
    captured: result.attackerWon,
    attacker: result.champ,
    attackerName, defenderName,
  };
  const live = mode !== "static";
  const buf = await renderSiege(baseView, plan, live, mode === "classic").catch(() => null);
  if (buf) {
    const name = live ? SIEGE_GIF : SIEGE_FILE;
    files.push(new AttachmentBuilder(buf, { name }));
    embed.setImage(`attachment://${name}`);
  }
  if (mode === "classic" && result.logLines.length) {
    embed.addFields({ name: result.real ? "⚔️ Battle log" : "Duels", value: result.logLines.join("\n").slice(0, 1024) });
  }

  await interaction.editReply({ embeds: [embed], components: [backRow("defenders")], files }).catch(() => {});
  });
}

// ── World territory siege (the AI campaign) ───────────────────────────────────
// Attacks on a territory are logged into the SAME hq_base_attacks table as base
// sieges, keyed `world:<nodeId>`, so the per-target cooldown and the conquest
// leaderboard cover the campaign without a second log.
function territoryLogKey(nodeId: string): string { return `world:${nodeId}`; }

async function territoryBlockReason(
  guildId: string, attackerId: string, view: WorldTerritoryView,
): Promise<string | null> {
  if (view.heldByUserId === attackerId) return "You already hold this territory.";
  if (view.shieldUntil && view.shieldUntil.getTime() > Date.now()) {
    return `That castle is still shielded after its last battle — it reopens <t:${Math.floor(view.shieldUntil.getTime() / 1000)}:R>.`;
  }
  const recent = await recentAttackCount(
    guildId, attackerId, territoryLogKey(view.territory.id), new Date(Date.now() - WORLD_COOLDOWN_MS),
  ).catch(() => 0);
  if (recent >= WORLD_MAX_PER_WINDOW) {
    return "Your troops need to regroup — you've assaulted this castle too many times recently.";
  }
  return null;
}

async function findTerritory(guildId: string, nodeId: string): Promise<WorldTerritoryView | null> {
  const all = await listTerritories(guildId).catch(() => [] as WorldTerritoryView[]);
  return all.find(t => t.territory.id === nodeId) ?? null;
}

async function buildTerritoryBriefing(guildId: string, attackerId: string, nodeId: string) {
  const view = await findTerritory(guildId, nodeId);
  if (!view) {
    return {
      embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription("❌ That territory is no longer on the map.")],
      components: [backRow("world")], files: [] as AttachmentBuilder[],
    };
  }
  const prof = tierProfile(view.territory.tier);
  const embed = new EmbedBuilder().setColor(view.faction.color)
    .setTitle(`⚔️ March on ${view.territory.name}`)
    .setDescription(
      `_${view.territory.blurb}_\n\n` +
      `**Holder:** ${view.heldByUserId ? `<@${view.heldByUserId}>` : `${view.faction.emoji} ${view.faction.name}`}\n` +
      `**Difficulty:** ${tierStars(view.territory.tier)} · ${prof.label}\n` +
      `**Garrison:** ${view.territory.garrison} defenders at level ~${prof.cardLevel}${prof.starRank > 0 ? ` (${"⭐".repeat(prof.starRank)})` : ""}`,
    )
    .addFields(
      { name: "💠 Capture bounty", value: `**${prof.bounty}**`, inline: true },
      { name: "💠 Hold tribute", value: `**${prof.tributePerHour}/hr**`, inline: true },
      { name: "🏳️ Times taken", value: `**${view.captures}**`, inline: true },
    );

  const blocked = await territoryBlockReason(guildId, attackerId, view);
  if (blocked) {
    embed.addFields({ name: "⛔ Not right now", value: blocked });
    return { embeds: [embed], components: [backRow("world")], files: [] as AttachmentBuilder[] };
  }
  const mode = siegeModeMeta((await getSiegeConfig(guildId)).mode);
  embed.addFields({
    name: `${mode.emoji} Siege style — ${mode.label}`,
    value: `${mode.blurb}\n_Set for this server by an admin in \`/hqadmin\`._`,
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:wsiege:${nodeId}`).setLabel("March").setEmoji("⚔️").setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row, backRow("world")], files: [] as AttachmentBuilder[] };
}

// Which weather a territory fights under — derived from its biome so the film
// matches the map.
function moodForBiome(biome: string): SiegeCinematicView["mood"] {
  switch (biome) {
    case "snow": return "snow";
    case "volcanic": return "ash";
    case "marsh": return "storm";
    case "forest": return "dawn";
    case "desert": return "dusk";
    case "hills": return "dusk";
    default: return "dusk";
  }
}

// The territory assault's opening film, shared by the cinematic auto-siege and
// the turn-for-turn assault.
function territoryCinematic(
  view: WorldTerritoryView, theme: ReturnType<typeof resolveTheme>, attackerName: string,
  attackerCards: OwnedBattleCard[], garrison: OwnedBattleCard[], cx: LoadedCtx,
): SiegeCinematicView {
  return {
    targetName: view.territory.name,
    holderName: holderLabel(view),
    defenderColor: view.heldByUserId ? 0x4aa3ff : view.faction.color,
    attackerColor: theme.palette.accent,
    attackerName,
    cards: attackerCards.slice(0, 5).map(c => {
      const d = getCardDisplayRarity({ id: c.id, rarity: c.rarity as string }, cx.ctx, cx.settings, cx.displayMap);
      return { name: c.name, artUrl: toAbsoluteImageUrl(c.imageUrl), rarityColor: d.color };
    }),
    garrison: garrison.length,
    structure: view.territory.structure,
    mood: moodForBiome(view.territory.biome),
    tagline: view.territory.blurb,
  };
}

// Play the opening film into the ephemeral hub message, then hold on it long
// enough for the GIF to actually run before the caller posts the result.
async function playCinematic(
  interaction: ButtonInteraction, view: SiegeCinematicView, accent: number,
): Promise<void> {
  const buf = await renderSiegeCinematic(view).catch(() => null);
  if (!buf) return;
  const embed = new EmbedBuilder().setColor(accent)
    .setTitle(`🎥 ${view.attackerName} marches on ${view.targetName}`)
    .setDescription(`_${view.tagline ?? "The horns sound. The gates are closing."}_`)
    .setImage(`attachment://${SIEGE_CINEMATIC_FILE}`);
  await interaction.editReply({
    embeds: [embed], components: [],
    files: [new AttachmentBuilder(buf, { name: SIEGE_CINEMATIC_FILE })],
  }).catch(() => {});
  // Let the film play out before the result replaces it.
  await new Promise(resolve => setTimeout(resolve, CINEMATIC_HOLD_MS));
}

// Roughly the cinematic's own runtime, so the result doesn't cut it off.
const CINEMATIC_HOLD_MS = 5200;

// The territory as a base scene, so the siege animation reuses the exact same
// castle/defender/health painter the player-base siege uses.
function territoryBaseView(
  view: WorldTerritoryView, theme: ReturnType<typeof resolveTheme>,
  garrison: OwnedBattleCard[], cx: LoadedCtx,
): HqBaseView {
  const basePath = spriteForPrefix("base", "round");
  const defenders: HqRenderDefender[] = garrison.map((c, slot) => {
    const d = getCardDisplayRarity({ id: c.id, rarity: c.rarity as string }, cx.ctx, cx.settings, cx.displayMap);
    return { slot, cardId: c.id, name: c.name, artUrl: toAbsoluteImageUrl(c.imageUrl), rarityColor: d.color, basePath };
  });
  return {
    ownerName: view.faction.name,
    displayTitle: view.territory.name,
    ownerAvatarUrl: null,
    theme,
    roomEmoji: "🏰",
    roomName: tierProfile(view.territory.tier).label,
    hqLevel: view.territory.tier,
    subtitle: `${holderLabel(view)} · ${tierStars(view.territory.tier)}`,
    buildings: [{ role: view.territory.structure, spritePath: spriteForPrefix("building", view.territory.structure) }],
    defenders,
    captured: !!view.heldByUserId,
    bannerColor: view.heldByUserId ? 0x4aa3ff : view.faction.color,
  };
}

async function runTerritorySiege(
  interaction: ButtonInteraction, guildId: string, attackerId: string, nodeId: string,
): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  const siegeCfg = await getSiegeConfig(guildId);
  const mode = siegeCfg.mode;
  // Serialize per TERRITORY: two raiders clicking at once must not both pass the
  // shield check and each "capture" the same castle.
  await withHqLock(`hq:world:${guildId}:${nodeId}`, async () => {
    if (isSiegeTargetActive(`hq:world:${guildId}:${nodeId}`)) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xc0392b)
          .setDescription("❌ That territory is already under an interactive siege.")],
        components: [backRow("world")], files: [],
      }).catch(() => {});
      return;
    }
    const view = await findTerritory(guildId, nodeId);
    if (!view) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription("❌ That territory is no longer on the map.")],
        components: [backRow("world")], files: [],
      }).catch(() => {});
      return;
    }
    const blocked = await territoryBlockReason(guildId, attackerId, view);
    if (blocked) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(`❌ ${blocked}`)],
        components: [backRow("world")], files: [],
      }).catch(() => {});
      return;
    }

    const attackerName = interaction.user.username;
    const cx = await loadCtx(guildId);
    const garrison = buildGarrison(view.territory, cx.cards, cx.ctx);
    if (garrison.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(
          "❌ This server has no cards yet, so the garrison couldn't muster. Add cards and try again.")],
        components: [backRow("world")], files: [],
      }).catch(() => {});
      return;
    }
    const attackerCards = await buildAttackerCards(guildId, attackerId, cx.ctx, garrison.length).catch(() => []);
    if (attackerCards.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(
          "❌ You have no cards to march with. Catch some first.")],
        components: [backRow("world")], files: [],
      }).catch(() => {});
      return;
    }

    const theme = resolveTheme((await getOrCreateHq(guildId, attackerId)).themeId);
    const defenderName = holderLabel(view);

    // Turn-by-turn: the player commands the assault on the territory themselves.
    if (mode === "turn") {
      if (siegeCfg.intro) await playCinematic(interaction, territoryCinematic(view, theme, attackerName, attackerCards, garrison, cx), view.faction.color);
      await launchTerritorySiege(interaction, guildId, attackerId, attackerName, nodeId, view, theme, garrison, attackerCards, cx, siegeCfg);
      return;
    }

    // The opening film, before anything is resolved.
    if (mode === "cinematic") {
      await playCinematic(interaction, territoryCinematic(view, theme, attackerName, attackerCards, garrison, cx), view.faction.color);
    }

    // Resolve with the real battle engine; fall back to the power resolver only
    // if battles are disabled or the engine throws.
    let result: SiegeOutcome;
    try {
      const settings = await getBattleSettings(guildId);
      if (!settings.enabled) throw new Error("battles disabled");
      const r = simulateSiegeBattle(attackerCards, garrison, settings, guildId, cx.ctx, {
        attackerId, attackerName, defenderId: `world:${nodeId}`, defenderName,
      });
      result = outcomeFromBattle(r, championRender(attackerCards[0], cx));
    } catch {
      const atk = await buildAttackerSquad(guildId, attackerId, cx, garrison.length);
      const def = garrison.map(c => toSiegeCombatant(c, cx));
      result = outcomeFromPower(resolveSiege(atk, def), championRender(attackerCards[0], cx), def.length);
    }

    const prof = tierProfile(view.territory.tier);
    let previousHolder: string | null = null;
    if (result.attackerWon) {
      ({ previousHolder } = await captureTerritory(guildId, nodeId, attackerId, attackerName, WORLD_SHIELD_MS)
        .catch(() => ({ previousHolder: null })));
    } else {
      await markTerritoryAttacked(guildId, nodeId).catch(() => {});
    }
    await logSiege(
      guildId, attackerId, territoryLogKey(nodeId), result.attackerWon,
      result.attackerPower, result.defenderPower, mode,
    ).catch(() => {});

    const reward = result.attackerWon ? prof.bounty : Math.round(prof.bounty * 0.12);
    await addShards(guildId, attackerId, reward).catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(result.attackerWon ? 0x4fd06a : view.faction.color)
      .setTitle(result.attackerWon ? `🚩 ${view.territory.name} is yours!` : `🛡️ ${view.territory.name} holds`)
      .setDescription(
        result.attackerWon
          ? `**${attackerName}** broke the ${defenderName} garrison — ${result.summary}.\n` +
            `You hold this ${prof.label.toLowerCase()} until someone takes it off you, earning **${prof.tributePerHour}💠/hr**. ` +
            "Collect from the 🗺️ World Map."
          : `The ${defenderName} garrison threw you back — ${result.summary}.`,
      )
      .addFields(
        { name: "⚔️ Squad power", value: `**${result.attackerPower}**`, inline: true },
        { name: "🛡️ Garrison power", value: `**${result.defenderPower}**`, inline: true },
        { name: "💠 Loot", value: `**+${reward}** shards`, inline: true },
      );

    // Whoever just lost the castle deserves to know.
    if (previousHolder && previousHolder !== attackerId) {
      void notifyTerritoryLost(interaction, previousHolder, attackerName, view.territory.name);
    }

    const files: AttachmentBuilder[] = [];
    const baseView = territoryBaseView(view, theme, garrison, cx);
    const plan: SiegePlan = {
      duels: result.duels,
      defenderCount: result.defenderCount,
      captured: result.attackerWon,
      attacker: result.champ,
      attackerName, defenderName,
    };
    const live = mode !== "static";
    const buf = await renderSiege(baseView, plan, live, mode === "classic").catch(() => null);
    if (buf) {
      const name = live ? SIEGE_GIF : SIEGE_FILE;
      files.push(new AttachmentBuilder(buf, { name }));
      embed.setImage(`attachment://${name}`);
    }
    if (mode === "classic" && result.logLines.length) {
      embed.addFields({ name: result.real ? "⚔️ Battle log" : "Duels", value: result.logLines.join("\n").slice(0, 1024) });
    }
    await interaction.editReply({ embeds: [embed], components: [backRow("world")], files }).catch(() => {});
  });
}

// Best-effort DM to the member who just lost a territory.
async function notifyTerritoryLost(
  interaction: ButtonInteraction, holderId: string, attackerName: string, territoryName: string,
): Promise<void> {
  try {
    const guildName = interaction.guild?.name ?? "your server";
    const user = await interaction.client.users.fetch(holderId);
    await user.send({
      embeds: [new EmbedBuilder().setColor(0xc0392b)
        .setTitle("🚩 You lost a territory!")
        .setDescription(
          `**${attackerName}** has taken **${territoryName}** from you in **${guildName}**. ` +
          "Its tribute now flows to them — retake it from **/hq → 🗺️ World Map** once the shield lifts.")],
    });
  } catch {
    // DMs closed / user unreachable — silently skip.
  }
}

// Best-effort DM to a base owner after their base is attacked. Never throws (DMs
// may be closed) and never notifies a self-attack.
async function notifySiege(
  interaction: ButtonInteraction, guildId: string, defenderId: string,
  attackerName: string, captured: boolean, reward: number,
): Promise<void> {
  if (defenderId === interaction.user.id) return;
  try {
    const guildName = interaction.guild?.name ?? "your server";
    const user = await interaction.client.users.fetch(defenderId);
    const embed = new EmbedBuilder()
      .setColor(captured ? 0xc0392b : 0x4fd06a)
      .setTitle(captured ? "🏰 Your base was captured!" : "🛡️ Your base held!")
      .setDescription(
        captured
          ? `**${attackerName}** stormed your base in **${guildName}** and now holds it. ` +
            "Reclaim it from **/hq → 🏰 Base** once the shield lifts, or station stronger defenders."
          : `**${attackerName}** attacked your base in **${guildName}**, but your defenders held the walls. ` +
            `They walked away with only ${reward} shards.`,
      );
    await user.send({ embeds: [embed] });
  } catch {
    // DMs closed / user unreachable — silently skip.
  }
}

// ── Visit (read-only) — scout a base, then attack it ──────────────────────────
async function buildVisitView(guildId: string, targetId: string, targetName: string, targetAvatar: string, attackerId?: string) {
  const hq = await getOrCreateHq(guildId, targetId);
  const owned = await getUnlockedItemIds(guildId, targetId);
  // Show a room the host has actually unlocked (see the note in buildView). This
  // is read-only, so correct for display without persisting to their HQ.
  if (!isRoomUnlocked(resolveRoom(hq.activeRoomId), owned)) hq.activeRoomId = DEFAULT_ROOM_ID;
  // A visitor scouts the EXTERIOR base — its buildings and stationed defenders —
  // because that's what an attacker would face.
  const file = await renderBaseImage(await buildBaseRenderView(guildId, targetId, targetName, targetAvatar, hq));
  const theme = resolveTheme(hq.themeId);
  const stats = readHqStats(hq);
  const defenders = await getDefenders(guildId, targetId);
  const capture = activeCapture(await getBaseState(guildId, targetId));

  const embed = new EmbedBuilder()
    .setColor(capture ? 0xc0392b : theme.palette.accent)
    .setTitle(`🏰 Scouting ${hqDisplayTitle(hq, targetName)}`)
    .setDescription(
      (stats.motto ? `_“${stats.motto}”_\n\n` : "") +
      `**${theme.emoji} ${theme.name}** · **HQ Level ${hq.hqLevel}**` +
      (capture ? `\n🚩 **Currently held by ${capture.heldName}**` : ""),
    )
    .addFields(
      { name: "🛡️ Defenders", value: `**${defenders.size}** / ${HQ_DEFENDER_SLOTS} stationed`, inline: true },
      { name: "🎏 Decorations earned", value: `**${ownedDecorations(owned).length}** / ${HQ_DECORATIONS.length}`, inline: true },
    );
  if (file) embed.setImage(`attachment://${HQ_FILE}`);

  const rows: ActionRowBuilder<any>[] = [];

  // Attack affordance (only when a real rival is scouting a defended base).
  if (attackerId && attackerId !== targetId) {
    const canAttack = defenders.size > 0 && !capture;
    const reason = defenders.size === 0 ? "Undefended — nothing to besiege"
      : capture ? "Shielded after a recent battle" : "";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hq-hub:attack:${targetId}`)
        .setLabel(canAttack ? `Attack ${targetName}'s base` : (reason || "Cannot attack"))
        .setEmoji("⚔️").setStyle(ButtonStyle.Danger).setDisabled(!canAttack),
    ));
  }
  const displays = await getDisplays(guildId, targetId);
  const pinned = [...displays.entries()].sort((a, b) => a[0] - b[0]);
  if (pinned.length > 0) {
    const { cards, settings, ctx, displayMap } = await loadCtx(guildId);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId("hq-hub:open").setPlaceholder("Open a featured card…")
        .addOptions(pinned.map(([slot, cardId]) => {
          const card = cards.find(c => c.id === cardId);
          const d = card ? getCardDisplayRarity(card, ctx, settings, displayMap) : null;
          return { label: `Pedestal ${slot + 1}: ${(card?.name ?? `Card #${cardId}`).slice(0, 90)}`, value: String(cardId), description: d?.label, emoji: "🔎" };
        })),
    ));
  }
  return { embeds: [embed], components: rows, files: file ? [file] : [] };
}

// ── Pin picker sub-view ───────────────────────────────────────────────────────
async function buildPinPicker(guildId: string, userId: string, slot: number) {
  const { settings, ctx, displayMap } = await loadCtx(guildId);
  const collection = (await getUserCollection(guildId, userId))
    .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name));
  const embed = new EmbedBuilder()
    .setColor(0xffd76b)
    .setTitle(`🏆 Feature a card — Pedestal ${slot + 1}`)
    .setDescription(collection.length === 0
      ? "You don't own any cards yet. Catch some, then come back to show them off."
      : "Pick a card to display on this pedestal. Your most valuable cards are listed first.");
  const rows: ActionRowBuilder<any>[] = [];
  if (collection.length > 0) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`hq-hub:pin:${slot}`).setPlaceholder("Choose a card…")
        .addOptions(collection.slice(0, 25).map(i => {
          const d = getCardDisplayRarity({ id: i.cardId, rarity: i.rarity as string }, ctx, settings, displayMap);
          return {
            label: `${i.name.slice(0, 80)}${i.shinyCount > 0 ? ` ${SHINY_EMOJI}` : ""}`,
            value: String(i.cardId), description: `${d.label} · ${i.worthValue} shards`, emoji: d.emoji || undefined,
          };
        })),
    ));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("hq-hub:back:trophy").setLabel("Back to Trophy Hall").setEmoji("◀").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], components: rows, files: [] as AttachmentBuilder[] };
}

// ── Defender picker sub-view ──────────────────────────────────────────────────
async function buildDefenderPicker(guildId: string, userId: string, slot: number) {
  const { settings, ctx, displayMap } = await loadCtx(guildId);
  const collection = (await getUserCollection(guildId, userId))
    .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name));
  const embed = new EmbedBuilder()
    .setColor(0x4aa3ff)
    .setTitle(`🛡️ Choose a defender — Post ${slot + 1}`)
    .setDescription(collection.length === 0
      ? "You don't own any cards yet. Catch some, then station them to guard your base."
      : "Pick a card to guard this post. Your strongest (by value) are listed first.");
  const rows: ActionRowBuilder<any>[] = [];
  if (collection.length > 0) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`hq-hub:def:${slot}`).setPlaceholder("Choose a card…")
        .addOptions(collection.slice(0, 25).map(i => {
          const d = getCardDisplayRarity({ id: i.cardId, rarity: i.rarity as string }, ctx, settings, displayMap);
          return {
            label: `${i.name.slice(0, 80)}${i.shinyCount > 0 ? ` ${SHINY_EMOJI}` : ""}`,
            value: String(i.cardId), description: `${d.label} · ${i.worthValue} shards`, emoji: d.emoji || undefined,
          };
        })),
    ));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("hq-hub:back:defenders").setLabel("Back to Defenders").setEmoji("◀").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], components: rows, files: [] as AttachmentBuilder[] };
}

// ── Featured-card detail (reuses /info-style presentation) ─────────────────────
async function replyCardDetail(
  interaction: StringSelectMenuInteraction, guildId: string, userId: string, cardId: number,
) {
  const { cards, settings, ctx, displayMap } = await loadCtx(guildId);
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    await interaction.editReply({ content: "❌ That card no longer exists." }).catch(() => {});
    return;
  }
  const d = getCardDisplayRarity(card, ctx, settings, displayMap);
  const reveal = await renderCardRevealCanvas(guildId, cardId, { withStats: true, userId }).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(d.color)
    .setTitle(`${d.emoji} ${card.name}`)
    .setDescription(card.description?.slice(0, 500) || null)
    .addFields({ name: "Rarity", value: `${d.emoji} ${d.label}`, inline: true });
  if (reveal) embed.setImage(`attachment://${CARD_REVEAL_FILE}`);

  const embeds = [embed];
  const level = await buildCardLevelEmbed(guildId, userId, {
    id: card.id, name: card.name, rarity: card.rarity as string, imageUrl: card.imageUrl,
  }).catch(() => null);
  if (level && "embed" in level) embeds.push(level.embed);

  await interaction.editReply({ embeds, files: reveal ? [reveal.file] : [] }).catch(() => {});
}

// A friendly label for an encoded placement slot (wall spot or floor grid ref).
function slotLabel(slot: number): string {
  if (slotIsWall(slot)) return `🧱 Wall ${slot - HQ_WALL_SLOT_BASE + 1}`;
  const { gx, gy } = slotToTile(slot);
  return `Floor C${gx + 1}·R${gy + 1}`;
}

// Curated floor tiles offered in the picker: a spread across the usable front of
// the room (the back row hides behind the wall). Kept small so wall + floor +
// auto all fit one 25-option select.
const FLOOR_PICK_TILES: Array<{ gx: number; gy: number }> = (() => {
  const out: Array<{ gx: number; gy: number }> = [];
  // A spread across the big 8×8 floor (front-to-back rows), capped so the picker
  // — auto + wall spots + these — still fits one 25-option select.
  for (const gy of [1, 3, 5]) for (let gx = 1; gx <= 6; gx++) out.push({ gx, gy });
  return out;
})();

// ── Placement picker sub-view (choose WHICH tile / wall spot) ───────────────────
async function buildSlotPicker(guildId: string, userId: string, decoId: string) {
  const deco = resolveDecoration(decoId);
  const hq = await getOrCreateHq(guildId, userId);
  const room = resolveRoom(hq.activeRoomId);
  const theme = resolveTheme(hq.themeId);
  const placements = await getPlacements(guildId, userId, room.id);

  const embed = new EmbedBuilder()
    .setColor(theme.palette.accent)
    .setTitle(`📍 Place ${deco?.emoji ?? "🎏"} ${deco?.name ?? "decoration"}`)
    .setDescription(
      `Pick a **wall spot** or a **floor tile** in the **${room.emoji} ${room.name}**. ` +
      "Choosing an occupied spot swaps what's there back into your earned pile. " +
      `You can display up to **${room.decoSlots}** items here.`,
    );

  const occ = (slot: number) => { const id = placements.get(slot); return id ? resolveDecoration(id) : undefined; };
  const options: { label: string; value: string; description?: string; emoji?: string }[] = [
    { label: "Auto — next free spot", value: "auto", description: "Drop it in the first opening", emoji: "✨" },
  ];
  for (let i = 0; i < HQ_WALL_ANCHOR_COUNT; i++) {
    const slot = wallSlot(i), o = occ(slot);
    options.push({ label: `🧱 Wall spot ${i + 1}${o ? ` — ${o.name}` : ""}`.slice(0, 90), value: String(slot), description: o ? "Occupied — swaps" : "Empty wall", emoji: o?.emoji ?? "▫️" });
  }
  for (const { gx, gy } of FLOOR_PICK_TILES) {
    const slot = floorSlot(gx, gy), o = occ(slot);
    options.push({ label: `Floor C${gx + 1}·R${gy + 1}${o ? ` — ${o.name}` : ""}`.slice(0, 90), value: String(slot), description: o ? "Occupied — swaps" : "Empty tile", emoji: o?.emoji ?? "▫️" });
  }

  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`hq-hub:placeat:${decoId}`).setPlaceholder("Choose a spot…")
        .addOptions(options.slice(0, 25)),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("hq-hub:back:decorations").setLabel("Back to Decorations").setEmoji("◀").setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows, files: [] as AttachmentBuilder[] };
}

// True when an encoded slot is a valid wall anchor or floor tile.
function isValidSlot(slot: number): boolean {
  if (slotIsWall(slot)) return slot - HQ_WALL_SLOT_BASE < HQ_WALL_ANCHOR_COUNT;
  const { gx, gy } = slotToTile(slot);
  return slot >= 0 && floorSlot(gx, gy) === slot; // in-grid, well-formed
}

// ── Actions ───────────────────────────────────────────────────────────────────
// Place (or move) an earned decoration at a chosen wall/floor slot. `slotValue`
// is an encoded slot or "auto" (next free curated tile). Moving clears the
// decoration's previous spot; an occupied target swaps its occupant back out.
// The room's decoSlots caps how many items can be displayed at once.
async function placeDecorationAt(guildId: string, userId: string, decoId: string, slotValue: string): Promise<void> {
  // Serialize per user so concurrent placement clicks can't each read the same
  // "free slot" snapshot and both write — bypassing the cap or duplicating.
  return withHqLock(`hq:place:${guildId}:${userId}`, async () => {
  const deco = resolveDecoration(decoId);
  if (!deco) return;
  const owned = await getUnlockedItemIds(guildId, userId);
  if (!(deco.unlock.kind === "always" || owned.has(deco.id))) return;
  const hq = await getOrCreateHq(guildId, userId);
  const room = resolveRoom(hq.activeRoomId);
  const placements = await getPlacements(guildId, userId, room.id);
  const alreadyPlaced = [...placements.values()].includes(deco.id);

  let target: number | null = null;
  if (slotValue === "auto") {
    for (const { gx, gy } of FLOOR_PICK_TILES) { const s = floorSlot(gx, gy); if (!placements.has(s)) { target = s; break; } }
    if (target === null) for (let i = 0; i < HQ_WALL_ANCHOR_COUNT; i++) { const s = wallSlot(i); if (!placements.has(s)) { target = s; break; } }
    if (target === null) return; // nowhere free
  } else {
    const s = Number(slotValue);
    if (!Number.isInteger(s) || !isValidSlot(s)) return;
    target = s;
  }

  // Enforce the per-room display cap for genuinely new placements (a move or a
  // swap into an occupied tile doesn't grow the count).
  const targetOccupied = placements.has(target);
  if (!alreadyPlaced && !targetOccupied && placements.size >= room.decoSlots) return;

  // Moving: vacate this decoration's previous spot so it's never shown twice.
  for (const [slot, id] of placements) {
    if (id === deco.id && slot !== target) { await clearPlacement(guildId, userId, room.id, slot).catch(() => {}); break; }
  }
  await placeDecoration(guildId, userId, room.id, target, deco.id).catch(() => {});
  });
}

// ── Card wall-art ─────────────────────────────────────────────────────────────
// The player's owned cards, richest first, for the frame-a-card picker.
async function topOwnedCards(
  guildId: string, userId: string, limit: number,
): Promise<{ id: number; name: string; rarity: string }[]> {
  const collection = (await getUserCollection(guildId, userId))
    .sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name));
  return collection.slice(0, limit).map(i => ({ id: i.cardId, name: i.name, rarity: String(i.rarity) }));
}

// A wall-only spot picker for hanging a framed card (portraits live on the wall).
async function buildFrameSlotPicker(guildId: string, userId: string, cardId: number) {
  const hq = await getOrCreateHq(guildId, userId);
  const room = resolveRoom(hq.activeRoomId);
  const theme = resolveTheme(hq.themeId);
  const placements = await getPlacements(guildId, userId, room.id);
  const { cards } = await loadCtx(guildId);
  const card = cards.find(c => c.id === cardId);

  const embed = new EmbedBuilder()
    .setColor(theme.palette.accent)
    .setTitle(`🖼️ Hang ${card?.name ?? "card"}`)
    .setDescription(
      `Pick a **wall spot** in the **${room.emoji} ${room.name}** to hang the framed art. ` +
      "Choosing an occupied spot swaps what's there back into your pile.",
    );

  const occ = (slot: number) => { const id = placements.get(slot); return id ? placementLabel(id) : undefined; };
  const options = [];
  for (let i = 0; i < HQ_WALL_ANCHOR_COUNT; i++) {
    const slot = wallSlot(i), o = occ(slot);
    options.push({ label: `🧱 Wall spot ${i + 1}${o ? ` — ${o.name}` : ""}`.slice(0, 90), value: String(slot), description: o ? "Occupied — swaps" : "Empty wall", emoji: o?.emoji ?? "▫️" });
  }
  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`hq-hub:frameat:${cardId}`).setPlaceholder("Choose a wall spot…").addOptions(options),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("hq-hub:back:decorations").setLabel("Back to Decorations").setEmoji("◀").setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows, files: [] as AttachmentBuilder[] };
}

// Hang a framed card at a wall slot. Requires the Portrait Frame (buyable) and
// that the player still owns the card. Stored as "portrait-frame:<cardId>".
async function placeFramedCardAt(guildId: string, userId: string, cardId: number, slotValue: string): Promise<void> {
  if (!Number.isInteger(cardId)) return;
  return withHqLock(`hq:place:${guildId}:${userId}`, async () => {
  const owned = await getUnlockedItemIds(guildId, userId);
  if (!owned.has(PORTRAIT_FRAME_ID)) return;                        // must own the frame
  const ownsCard = (await getUserCollection(guildId, userId)).some(i => i.cardId === cardId);
  if (!ownsCard) return;                                            // must still own the card
  const s = Number(slotValue);
  if (!Number.isInteger(s) || !slotIsWall(s) || !isValidSlot(s)) return;  // wall spots only

  const hq = await getOrCreateHq(guildId, userId);
  const room = resolveRoom(hq.activeRoomId);
  const placements = await getPlacements(guildId, userId, room.id);
  const itemId = `${PORTRAIT_PREFIX}${cardId}`;
  const targetOccupied = placements.has(s);
  const alreadyHere = placements.get(s) === itemId;
  // Respect the room's display cap for a genuinely new frame.
  if (!targetOccupied && placements.size >= room.decoSlots) return;
  if (alreadyHere) return;
  // Only one frame of a given card at a time: vacate any previous spot.
  for (const [slot, id] of placements) {
    if (id === itemId && slot !== s) { await clearPlacement(guildId, userId, room.id, slot).catch(() => {}); break; }
  }
  await placeDecoration(guildId, userId, room.id, s, itemId).catch(() => {});
  });
}

// Place an owned decoration on the base grounds' next free spot (its own layout,
// stored under the BASE_ROOM_ID pseudo-room).
async function placeBaseDecoration(guildId: string, userId: string, decoId: string): Promise<void> {
  return withHqLock(`hq:place:${guildId}:${userId}`, async () => {
  const deco = resolveDecoration(decoId);
  if (!deco) return;
  const owned = await getUnlockedItemIds(guildId, userId);
  if (!(deco.unlock.kind === "always" || owned.has(deco.id))) return;
  const placements = await getPlacements(guildId, userId, BASE_ROOM_ID);
  if ([...placements.values()].includes(deco.id)) return; // already on the grounds
  let slot = -1;
  for (let i = 0; i < HQ_BASE_DECO_SLOTS; i++) { if (!placements.has(i)) { slot = i; break; } }
  if (slot < 0) return; // grounds full
  await placeDecoration(guildId, userId, BASE_ROOM_ID, slot, deco.id).catch(() => {});
  });
}

// Buy a shop item: validate against the LIVE rotation price (a client can't
// spoof a cheaper/stale item), debit shards atomically, then grant the unlock.
// Refunds if a race means the grant didn't actually create the row.
async function buyShopItem(guildId: string, userId: string, decoId: string): Promise<string> {
  const deco = resolveDecoration(decoId);
  const entry = deco ? shopPriceFor(deco) : undefined;
  if (!entry) return "❌ That item isn't for sale.";
  const owned = await getUnlockedItemIds(guildId, userId);
  if (owned.has(decoId)) return `You already own ${entry.deco.emoji} ${entry.deco.name}.`;
  const paid = await spendShards(guildId, userId, entry.price).catch(() => false);
  if (!paid) return `❌ Not enough shards — ${entry.deco.emoji} ${entry.deco.name} costs 💠 ${entry.price}.`;
  const granted = await grantUnlock(guildId, userId, decoId, "decoration", "shop").catch(() => false);
  if (!granted) {
    await addShards(guildId, userId, entry.price).catch(() => {}); // refund the race
    return `You already own ${entry.deco.emoji} ${entry.deco.name} — no charge.`;
  }
  return `✅ Bought ${entry.deco.emoji} **${entry.deco.name}** for 💠 ${entry.price}! Place it from **🎏 Decorations**.`;
}

// Buy a surface (floor or wall). Grants the style unlock (itemType floor/wall) so
// it can be selected in 🎨 Style. Price validated server-side via surfaceById.
async function buySurface(guildId: string, userId: string, id: string): Promise<string> {
  const s = surfaceById(id);
  if (!s) return "❌ That surface isn't for sale.";
  const owned = await getUnlockedItemIds(guildId, userId);
  if (owned.has(s.id)) return `You already own ${s.emoji} ${s.name}.`;
  const paid = await spendShards(guildId, userId, s.price).catch(() => false);
  if (!paid) return `❌ Not enough shards — ${s.emoji} ${s.name} costs 💠 ${s.price}.`;
  const granted = await grantUnlock(guildId, userId, s.id, s.kind, "shop").catch(() => false);
  if (!granted) {
    await addShards(guildId, userId, s.price).catch(() => {}); // refund the race
    return `You already own ${s.emoji} ${s.name} — no charge.`;
  }
  return `✅ Bought ${s.emoji} **${s.name}** for 💠 ${s.price}! Use it from **${s.usedIn}**.`;
}

// ── Mystery crate (shard sink → a random furniture piece) ──────────────────────
const CRATE_PRICE = 500;
// Anything obtainable as furniture (shop-priced or droppable) can come from a crate.
const CRATE_POOL = HQ_DECORATIONS.filter(d => d.drop || (typeof d.price === "number" && d.price > 0));
const CRATE_RARITY_WEIGHT: Record<Rarity, number> =
  Object.fromEntries(BUILTIN_RARITIES.map((r, i) => [r, Math.max(1, BUILTIN_RARITIES.length - i)])) as Record<Rarity, number>;

async function openMysteryCrate(guildId: string, userId: string): Promise<string> {
  const owned = await getUnlockedItemIds(guildId, userId);
  const pool = CRATE_POOL.filter(d => !owned.has(d.id));
  if (pool.length === 0) return "🎁 You already own every crate item — nothing left to find!";
  const paid = await spendShards(guildId, userId, CRATE_PRICE).catch(() => false);
  if (!paid) return `❌ A Mystery Crate costs 💠 ${CRATE_PRICE}.`;

  const total = pool.reduce((s, d) => s + (CRATE_RARITY_WEIGHT[d.rarity as Rarity] ?? 1), 0);
  let roll = Math.random() * total;
  let pick = pool[0]!;
  for (const d of pool) { roll -= CRATE_RARITY_WEIGHT[d.rarity as Rarity] ?? 1; if (roll <= 0) { pick = d; break; } }

  const granted = await grantUnlock(guildId, userId, pick.id, "decoration", "crate").catch(() => false);
  if (!granted) { await addShards(guildId, userId, CRATE_PRICE).catch(() => {}); return "🎁 The crate was empty (already owned) — refunded."; }
  return `🎁 The crate cracked open — ${pick.emoji} **${pick.name}** (${pick.rarity})! Place it from **🎏 Decorations**.`;
}

// ── UI fragments ──────────────────────────────────────────────────────────────
function sectionRow(current: Section) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("hq-hub:select").setPlaceholder("📋 Jump to a section…")
      .addOptions(SECTIONS.map(s => ({ label: s.label, value: s.id, description: s.description, emoji: s.emoji, default: s.id === current }))),
  );
}

function pedestalButtonRow(
  action: "setslot" | "clearslot" | "setdef" | "cleardef",
  label: string, n: number, style: ButtonStyle, occupied?: Map<number, number>,
) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let slot = 0; slot < Math.min(n, 5); slot++) {
    const btn = new ButtonBuilder().setCustomId(`hq-hub:${action}:${slot}`).setLabel(`${label} ${slot + 1}`).setStyle(style);
    if (action.startsWith("clear")) btn.setDisabled(!occupied?.has(slot));
    row.addComponents(btn);
  }
  return row;
}

// Compact unlockable-style list (walls/floors) for the Style section fields.
function styleList<T extends { id: string; name: string; emoji: string; unlock: UnlockRule }>(
  items: T[], currentId: string, isOpen: (t: T) => boolean,
): string {
  return items.map(t => {
    const open = isOpen(t);
    const here = t.id === currentId ? " ✅" : "";
    return `${open ? t.emoji : "🔒"} ${t.name}${here}${open ? "" : ` — ${unlockLabel(t.unlock)}`}`;
  }).join("\n").slice(0, 1024);
}

// A short "here's what to chase next" line for the overview.
function nextUnlockHint(owned: Set<string>): string | null {
  const nextDeco = HQ_DECORATIONS.find(d => d.unlock.kind !== "always" && !owned.has(d.id));
  const nextRoom = HQ_ROOMS.find(r => r.unlock.kind !== "always" && !isRoomUnlocked(r, owned));
  const bits: string[] = [];
  if (nextRoom) bits.push(`🚪 **${nextRoom.name}** — ${unlockLabel(nextRoom.unlock)}`);
  if (nextDeco) bits.push(`${nextDeco.emoji} **${nextDeco.name}** — ${unlockLabel(nextDeco.unlock)}`);
  return bits.length ? bits.join("\n") : null;
}

// Test seam for scripts/src/hq-smoke.ts: build one section's view from a
// minimal interaction shape, so every section's Discord payload can be checked
// against the API's limits without a gateway connection.
export type HqSection = Section;
export async function __buildViewForTest(interaction: HubInteraction, section: HqSection) {
  return buildView(interaction, section, []);
}
