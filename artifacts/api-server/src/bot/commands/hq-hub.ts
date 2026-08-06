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
  getDefenders, setDefender, clearDefender,
  getBaseState, applySiegeToBase, logSiege, recentAttackCount,
} from "../hq/db.js";
import { shopRotation, shopEntryFor, formatRefreshIn } from "../hq/shop.js";
import {
  resolveSiege, SIEGE_SHIELD_MS, SIEGE_COOLDOWN_MS, SIEGE_MAX_PER_WINDOW,
  type SiegeCombatant,
} from "../hq/siege.js";
import { rarityLadderRank } from "../rarity-runtime.js";
import { renderBattleTurn } from "../animations/battle.js";
import {
  reconcileUnlocks, ownedDecorations, unlockedRooms, unlockedThemes,
  isRoomUnlocked, isThemeUnlocked, unlockedWalls, unlockedFloors,
  isWallUnlocked, isFloorUnlocked,
} from "../hq/engine.js";
import { resolveTheme, HQ_THEMES } from "../hq/defs/themes.js";
import { resolveWall, HQ_WALLS } from "../hq/defs/walls.js";
import { resolveFloor, HQ_FLOORS } from "../hq/defs/floors.js";
import { resolveRoom, HQ_ROOMS, DEFAULT_ROOM_ID } from "../hq/defs/rooms.js";
import { resolveDecoration, decorationsByRarityDesc, HQ_DECORATIONS } from "../hq/defs/decorations.js";
import { unlockLabel, type UnlockRule } from "../hq/defs/unlock-rules.js";
import { spriteFor, spriteForPrefix } from "../hq/assets.js";
import {
  renderHq, renderBase, renderSiege, floorSlot, wallSlot, slotIsWall, slotToTile,
  HQ_WALL_SLOT_BASE, HQ_WALL_ANCHOR_COUNT, HQ_DEFENDER_SLOTS,
  type HqRenderView, type HqRenderCard, type HqRenderDeco, type HqRenderDefender,
  type HqBaseView, type HqBaseBuilding, type HqBuildingRole, type SiegePlan,
} from "../hq/render.js";
import type { PlayerHq } from "@workspace/db";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const HQ_FILE = "hq.png";
const MAX_HQ_NAME = 40;
const MAX_HQ_MOTTO = 80;

// Any interaction that can drive the hub. All four expose guildId + user, which
// is all buildView reads.
type HubInteraction =
  | ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction;

// Player-set personalization lives in the additive `stats` jsonb — no schema
// change. `title` renames the HQ banner; `motto` is a short tagline in the embed.
interface HqStats { title?: string; motto?: string }
function readHqStats(hq: PlayerHq): HqStats {
  const s = hq.stats as HqStats | null | undefined;
  return { title: s?.title, motto: s?.motto };
}
function hqDisplayTitle(hq: PlayerHq, ownerName: string): string {
  const t = readHqStats(hq).title?.trim();
  return t && t.length > 0 ? t : `${ownerName}'s HQ`;
}

type Section = "overview" | "trophy" | "defenders" | "decorations" | "shop" | "rooms" | "theme";
interface SectionMeta { id: Section; label: string; emoji: string; description: string }
const SECTIONS: SectionMeta[] = [
  { id: "overview",    label: "Overview",    emoji: "🏠", description: "Your HQ at a glance" },
  { id: "trophy",      label: "Trophy Hall",  emoji: "🏆", description: "Pin your proudest cards on pedestals" },
  { id: "defenders",   label: "Base",        emoji: "🏰", description: "Your town base — station defenders" },
  { id: "decorations", label: "Decorations", emoji: "🎏", description: "Place the cosmetics you've earned" },
  { id: "shop",        label: "Shop",        emoji: "🛒", description: "Buy furniture — rotates daily" },
  { id: "rooms",       label: "Rooms",       emoji: "🚪", description: "Switch & unlock rooms" },
  { id: "theme",       label: "Style",       emoji: "🎨", description: "Theme, walls & floor" },
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

  // Open a featured card's detail (works in both own & visit views) → ephemeral.
  if (action === "open" && interaction.isStringSelectMenu()) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
    await replyCardDetail(interaction, guildId, userId, Number(interaction.values[0]));
    return;
  }

  // ── Base siege: choose an assault mode, then resolve it ──────────────────────
  if (action === "attack" && interaction.isButton()) {
    await interaction.update(await buildAttackModePicker(guildId, userId, parts[2]!)).catch(() => {});
    return;
  }
  if (action === "siege" && interaction.isButton()) {
    await runSiege(interaction, guildId, userId, parts[2]!, (parts[3] as SiegeMode) ?? "static");
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

  // Shop: buy the selected furniture (validated against the live rotation price).
  if (action === "buy" && interaction.isStringSelectMenu()) {
    const notice = await buyShopItem(guildId, userId, interaction.values[0]!);
    await interaction.update(await buildView(interaction, "shop", [], notice)).catch(() => {});
    return;
  }
  // Shop: open a mystery crate for a random furniture item.
  if (action === "crate" && interaction.isButton()) {
    const notice = await openMysteryCrate(guildId, userId);
    await interaction.update(await buildView(interaction, "shop", [], notice)).catch(() => {});
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
  includeDefenders = false,
): Promise<HqRenderView> {
  const theme = resolveTheme(hq.themeId);
  const wall = resolveWall(hq.wallId);
  const floor = resolveFloor(hq.floorId);
  const room = resolveRoom(hq.activeRoomId);
  const [{ settings, ctx, displayMap, cards }, displays, placements, defenderMap] = await Promise.all([
    loadCtx(guildId),
    getDisplays(guildId, userId),
    getPlacements(guildId, userId, room.id),
    includeDefenders ? getDefenders(guildId, userId) : Promise.resolve(new Map<number, number>()),
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
    const deco = resolveDecoration(itemId);
    if (!deco) continue;
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
    roomName: room.name, roomEmoji: room.emoji, hqLevel: hq.hqLevel,
    subtitle, pedestals, decorations, defenders,
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

// Build the EXTERIOR town-base view: the four structures (art resolved by role,
// procedural fallback in the renderer) plus the stationed defenders as standees.
// This is the attackable/defendable town, distinct from the interior showcase.
const BASE_BUILDING_ROLES: HqBuildingRole[] = [
  "castle", "keep", "tower", "cathedral", "houses", "village", "camp", "hut", "wall",
];
async function buildBaseRenderView(
  guildId: string, userId: string, ownerName: string, ownerAvatarUrl: string | null, hq: PlayerHq,
): Promise<HqBaseView> {
  const theme = resolveTheme(hq.themeId);
  const [{ settings, ctx, displayMap, cards }, defenderMap] = await Promise.all([
    loadCtx(guildId),
    getDefenders(guildId, userId),
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
  return {
    ownerName, displayTitle: hqDisplayTitle(hq, ownerName), ownerAvatarUrl, theme,
    roomEmoji: "🏰", roomName: "Base", hqLevel: hq.hqLevel,
    subtitle: capture ? `Base • held by ${capture.heldName}` : `Base • ${defenders.length}/${HQ_DEFENDER_SLOTS} defenders`,
    buildings, defenders, captured: !!capture,
  };
}

// ── Owner view ────────────────────────────────────────────────────────────────
async function buildView(
  interaction: HubInteraction,
  section: Section, justUnlocked: { name: string; emoji: string; story: string }[],
  notice?: string,
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

  // The Base section shows the SEPARATE exterior town (with defenders); every
  // other section shows the interior room. Defenders live only on the base now.
  const file = section === "defenders"
    ? await renderBaseImage(await buildBaseRenderView(guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq))
    : await renderRoomImage(await buildRenderView(guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq));
  const files = file ? [file] : [];
  const room = resolveRoom(hq.activeRoomId);
  const theme = resolveTheme(hq.themeId);
  const wall = resolveWall(hq.wallId);
  const floor = resolveFloor(hq.floorId);

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
      const nextHint = nextUnlockHint(owned);
      if (nextHint) embed.addFields({ name: "🔓 Next up", value: nextHint, inline: false });
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("hq-hub:renamehq")
          .setLabel(stats.title ? "Rename HQ" : "Name your HQ")
          .setEmoji("✏️").setStyle(ButtonStyle.Secondary),
      ));
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
      embed.setTitle("🏰 Your Base").setDescription(
        "Your **town base** — a keep, walls and camps out in the open. Station cards to **guard it**; they stand as figures out front. " +
        "This exterior base is what other players **scout and attack** in the raid-style base battles (coming next). " +
        `You can post up to **${HQ_DEFENDER_SLOTS}** defenders.\n` +
        (defenders.size === 0 ? "\nNo defenders yet — set one below to start fortifying." : ""),
      );
      if (defenders.size > 0) {
        const { cards, settings, ctx, displayMap } = await loadCtx(guildId);
        embed.addFields({
          name: `On guard (${defenders.size}/${HQ_DEFENDER_SLOTS})`,
          value: [...defenders.entries()].sort((a, b) => a[0] - b[0]).map(([slot, cardId]) => {
            const card = cards.find(c => c.id === cardId);
            const d = card ? getCardDisplayRarity(card, ctx, settings, displayMap) : null;
            return `Post ${slot + 1}: ${d?.emoji ?? "•"} **${card?.name ?? `Card #${cardId}`}**${d ? ` · ${d.label}` : ""}`;
          }).join("\n").slice(0, 1024),
        });
      }
      rows.push(pedestalButtonRow("setdef", "Set", HQ_DEFENDER_SLOTS, ButtonStyle.Primary));
      rows.push(pedestalButtonRow("cleardef", "Clear", HQ_DEFENDER_SLOTS, ButtonStyle.Secondary, defenders));
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
            .map(([slot, id]) => `${slotLabel(slot)}: ${resolveDecoration(id)?.emoji ?? "•"} ${resolveDecoration(id)?.name ?? id}`).join("\n").slice(0, 1024),
        });
      }
      // Place select (any earned-but-unplaced decoration). Even a full room can
      // take one — the next step lets the player swap it into an occupied slot.
      const freeSlots = room.decoSlots - placements.size;
      const placeable = owns.filter(d => !placedIds.has(d.id));
      if (placeable.length > 0) {
        const hint = freeSlots > 0 ? `${freeSlots} slot${freeSlots === 1 ? "" : "s"} free` : "room full — place to swap";
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:placedeco").setPlaceholder(`Place a decoration… (${hint})`)
            .addOptions(placeable.slice(0, 25).map(d => ({ label: d.name.slice(0, 90), value: d.id, description: d.rarity, emoji: d.emoji }))),
        ));
      }
      // Remove select.
      if (placements.size > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:removedeco").setPlaceholder("Remove a placed decoration…")
            .addOptions([...placements.entries()].sort((a, b) => a[0] - b[0]).map(([slot, id]) => ({
              label: `${slotLabel(slot)}: ${(resolveDecoration(id)?.name ?? id).slice(0, 72)}`, value: String(slot), emoji: "🗑️",
            }))),
        ));
      }
      break;
    }

    case "shop": {
      const rot = shopRotation();
      const currency = await getOrCreateCurrency(guildId, userId).catch(() => ({ shards: 0 }));
      embed.setTitle("🛒 HQ Shop").setDescription(
        "Furniture for your HQ — the stock **rotates daily**, and anything you buy lands in **🎏 Decorations** to place. " +
        `Feeling lucky? Crack a **🎁 Mystery Crate** for a random piece (💠 ${CRATE_PRICE}).\n` +
        `💠 **${(currency.shards ?? 0).toLocaleString()}** shards · 🔄 refreshes in **${formatRefreshIn(rot.refreshesInMs)}**`,
      );
      const stock = rot.entries.map(e => {
        const own = owned.has(e.deco.id);
        const priceStr = e.discountPct > 0
          ? `~~${e.basePrice}~~ **${e.price}** (−${e.discountPct}%)`
          : `**${e.price}**`;
        return `${e.deco.emoji} **${e.deco.name}** · ${e.deco.rarity} — 💠 ${priceStr}${own ? " · ✅ owned" : ""}`;
      });
      embed.addFields({ name: "Today's stock", value: stock.join("\n").slice(0, 1024) || "The shelves are empty today." });
      const buyable = rot.entries.filter(e => !owned.has(e.deco.id));
      if (buyable.length > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:buy").setPlaceholder("Buy an item…")
            .addOptions(buyable.map(e => ({
              label: `${e.deco.name} — ${e.price}`.slice(0, 90),
              value: e.deco.id,
              description: `${e.discountPct > 0 ? `${e.discountPct}% off · ` : ""}${e.deco.rarity}`,
              emoji: e.deco.emoji,
            }))),
        ));
      }
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("hq-hub:crate").setLabel(`Open Mystery Crate — ${CRATE_PRICE}`).setEmoji("🎁").setStyle(ButtonStyle.Success),
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
      embed.setTitle("🎨 Style").setDescription(
        "Restyle your whole HQ — the **theme** sets lighting & mood, while **walls** and **floor** " +
        "reskin the room itself. New styles unlock as you play.",
      );
      const themeLines = HQ_THEMES.map(t => {
        const open = isThemeUnlocked(t, owned);
        const here = t.id === theme.id ? " · ✅" : "";
        return `${open ? t.emoji : "🔒"} **${t.name}**${here}${open ? "" : ` — ${unlockLabel(t.unlock)}`}`;
      });
      embed.addFields(
        { name: "🎨 Themes", value: themeLines.join("\n").slice(0, 1024) },
        { name: `🧱 Wall · ${wall.name}`, value: styleList(HQ_WALLS, wall.id, w => isWallUnlocked(w, owned)), inline: true },
        { name: `🪵 Floor · ${floor.name}`, value: styleList(HQ_FLOORS, floor.id, f => isFloorUnlocked(f, owned)), inline: true },
      );
      const openThemes = unlockedThemes(owned);
      if (openThemes.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:theme").setPlaceholder("Switch theme…")
            .addOptions(openThemes.map(t => ({ label: t.name, value: t.id, emoji: t.emoji, default: t.id === theme.id }))),
        ));
      }
      const openWalls = unlockedWalls(owned);
      if (openWalls.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:wall").setPlaceholder("Change walls…")
            .addOptions(openWalls.map(w => ({ label: w.name, value: w.id, emoji: w.emoji, default: w.id === wall.id }))),
        ));
      }
      const openFloors = unlockedFloors(owned);
      if (openFloors.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:floor").setPlaceholder("Change floor…")
            .addOptions(openFloors.map(f => ({ label: f.name, value: f.id, emoji: f.emoji, default: f.id === floor.id }))),
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

// True when a base is currently held by a conqueror (capture still within its
// shield window; after that it lazily reverts to the owner).
function activeCapture(state: Awaited<ReturnType<typeof getBaseState>>): { heldBy: string; heldName: string } | null {
  if (!state?.heldByUserId) return null;
  if (state.shieldUntil && state.shieldUntil.getTime() < Date.now()) return null;
  return { heldBy: state.heldByUserId, heldName: state.heldByName ?? "a rival" };
}

// ── Base siege (attack/capture mini-game) ─────────────────────────────────────
type SiegeMode = "classic" | "static" | "live";
const SIEGE_FILE = "siege.png", SIEGE_GIF = "siege.gif";
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

async function buildAttackModePicker(guildId: string, attackerId: string, defenderId: string) {
  const blocked = await siegeBlockReason(guildId, attackerId, defenderId);
  const embed = new EmbedBuilder().setColor(0xc0392b).setTitle("⚔️ Lay Siege");
  if (blocked) {
    embed.setDescription(`❌ ${blocked}`);
    return { embeds: [embed], components: [backRow("defenders")], files: [] as AttachmentBuilder[] };
  }
  const cx = await loadCtx(guildId);
  const defenders = await buildDefenderSquad(guildId, defenderId, cx);
  const squad = await buildAttackerSquad(guildId, attackerId, cx, defenders.length);
  const yourP = squad.reduce((s, c) => s + c.power, 0), theirP = defenders.reduce((s, c) => s + c.power, 0);
  embed.setDescription(
    `Send your strongest **${squad.length}** cards against **${defenders.length}** defenders. ` +
    "Win the most duels to capture the base.\n\n" +
    `⚔️ Your squad power: **${yourP}**  ·  🛡️ Their defence: **${theirP}**\n\n` +
    "**Pick how to watch it:**\n" +
    "• **Classic** — instant text report\n• **Static** — a battle image\n• **Live** — an animated battle",
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:siege:${defenderId}:classic`).setLabel("Classic").setEmoji("📜").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hq-hub:siege:${defenderId}:static`).setLabel("Static").setEmoji("🖼️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`hq-hub:siege:${defenderId}:live`).setLabel("Live").setEmoji("🎬").setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row, backRow("defenders")], files: [] as AttachmentBuilder[] };
}

function backRow(section: Section) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hq-hub:back:${section}`).setLabel("Back").setEmoji("◀").setStyle(ButtonStyle.Secondary),
  );
}

// Flavour move names for the classic animated turn.
const SIEGE_MOVES = ["Siege Strike", "Breach", "Overrun", "Vanguard Charge", "Final Blow", "Rally"];
// SiegeCombatant → the battle engine's RenderCard (for the classic turn animation).
function renderCardOf(c: SiegeCombatant) {
  return { name: c.name, rarityLabel: c.rarityLabel, rarity: c.rarity as Rarity, rarityColor: c.rarityColor, artUrl: c.artUrl, cardId: c.cardId };
}

async function runSiege(interaction: ButtonInteraction, guildId: string, attackerId: string, defenderId: string, mode: SiegeMode): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  const blocked = await siegeBlockReason(guildId, attackerId, defenderId);
  if (blocked) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xc0392b).setDescription(`❌ ${blocked}`)], components: [backRow("defenders")], files: [] }).catch(() => {});
    return;
  }
  const cx = await loadCtx(guildId);
  const defenders = await buildDefenderSquad(guildId, defenderId, cx);
  const squad = await buildAttackerSquad(guildId, attackerId, cx, defenders.length);
  const result = resolveSiege(squad, defenders);

  const attackerName = interaction.user.username;
  const defHq = await getOrCreateHq(guildId, defenderId);
  const defenderName = readHqStats(defHq).title?.trim() || "the defenders";

  // Persist outcome (capture + shield on a win; log either way).
  await applySiegeToBase(guildId, defenderId, result.attackerWon, attackerId, attackerName, SIEGE_SHIELD_MS).catch(() => {});
  await logSiege(guildId, attackerId, defenderId, result.attackerWon, result.attackerPower, result.defenderPower, mode).catch(() => {});

  const col = result.attackerWon ? 0x4fd06a : 0xc0392b;
  const embed = new EmbedBuilder().setColor(col)
    .setTitle(result.attackerWon ? "⚔️ Base Captured!" : "🛡️ Base Defended!")
    .setDescription(
      `**${attackerName}** ${result.attackerWon ? "stormed" : "failed to take"} the base — ` +
      `duels **${result.attackerWins}–${result.defenderWins}**.` +
      (result.attackerWon ? "\n🚩 You hold it for the next hour." : "\nThe defenders held the walls."),
    )
    .addFields(
      { name: "⚔️ Squad power", value: `**${result.attackerPower}**`, inline: true },
      { name: "🛡️ Defence power", value: `**${result.defenderPower}**`, inline: true },
    );

  const files: AttachmentBuilder[] = [];
  if (mode === "classic") {
    // CLASSIC: the traditional animated battle — the screen shows the decisive
    // move/attack between the two champions (reuses the battle-turn engine).
    const atkC = squad[0];
    const defC = [...defenders].sort((a, b) => b.power - a.power)[0];
    if (atkC && defC) {
      const win = result.attackerWon;
      const move = SIEGE_MOVES[Math.floor(Math.random() * SIEGE_MOVES.length)]!;
      const anim = await renderBattleTurn({
        attacker: renderCardOf(atkC), defender: renderCardOf(defC),
        attackerHp: win ? 92 : 14, attackerMaxHp: 100,
        defenderHp: win ? 0 : 90, defenderMaxHp: 100,
        damage: win ? 86 : 74, isCrit: win, isHit: true, moveName: move,
        attackerWon: win, defenderWon: !win, background: null,
      }, "normal").catch(() => null);
      if (anim?.buffer) { files.push(new AttachmentBuilder(anim.buffer, { name: SIEGE_GIF })); embed.setImage(`attachment://${SIEGE_GIF}`); }
    }
    const log = result.duels.slice(0, 6).map((d, i) =>
      `**${i + 1}.** ${d.attacker.name} ${d.attackerWon ? "🟢 beat" : "🔴 lost to"} ${d.defender.name}`).join("\n");
    if (log) embed.addFields({ name: "Duels", value: log.slice(0, 1024) });
  } else {
    // STATIC + LIVE both render ON the defender's base scene (castle + cards +
    // health) — the siege looks exactly like the base, just resolving.
    const baseView = await buildBaseRenderView(guildId, defenderId, defenderName, null, defHq);
    const champ = squad[0]; // attacker's strongest, assaulting the castle
    const plan: SiegePlan = {
      duels: result.duels.map((d, i) => ({ slot: i, attackerWon: d.attackerWon })),
      defenderCount: defenders.length,
      captured: result.attackerWon,
      attacker: champ ? { slot: 0, cardId: champ.cardId, name: champ.name, artUrl: champ.artUrl, rarityColor: champ.rarityColor, basePath: null } : null,
      attackerName, defenderName,
    };
    const buf = await renderSiege(baseView, plan, mode === "live").catch(() => null);
    if (buf) {
      const name = mode === "live" ? SIEGE_GIF : SIEGE_FILE;
      files.push(new AttachmentBuilder(buf, { name }));
      embed.setImage(`attachment://${name}`);
    }
  }

  await interaction.editReply({ embeds: [embed], components: [backRow("defenders")], files }).catch(() => {});
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
  for (let gy = 1; gy <= 4; gy++) for (let gx = 1; gx <= 4; gx++) out.push({ gx, gy });
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
}

// Buy a shop item: validate against the LIVE rotation price (a client can't
// spoof a cheaper/stale item), debit shards atomically, then grant the unlock.
// Refunds if a race means the grant didn't actually create the row.
async function buyShopItem(guildId: string, userId: string, decoId: string): Promise<string> {
  const entry = shopEntryFor(decoId);
  if (!entry) return "❌ That item just rotated out of the shop.";
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
