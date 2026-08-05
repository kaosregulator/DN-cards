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
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags, AttachmentBuilder,
} from "discord.js";
import {
  getAllCardsCached, getUserCollection, getOrCreateGuildSettings,
  getRarityContext, getRarityDisplayOverrides, getCardDisplayRarity,
} from "../db.js";
import { rarityColor, SHINY_EMOJI, type Rarity } from "../cards-data.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { renderCardRevealCanvas, CARD_REVEAL_FILE } from "../cards/card-reveal-canvas.js";
import { buildCardLevelEmbed } from "../cards/level-command.js";
import {
  getOrCreateHq, updateHq, getDisplays, pinDisplay, clearDisplay,
  getPlacements, placeDecoration, clearPlacement, pruneUnownedPlacements,
  getUnlockedItemIds,
} from "../hq/db.js";
import {
  reconcileUnlocks, ownedDecorations, unlockedRooms, unlockedThemes,
  isRoomUnlocked, isThemeUnlocked,
} from "../hq/engine.js";
import { resolveTheme, HQ_THEMES } from "../hq/defs/themes.js";
import { resolveRoom, HQ_ROOMS } from "../hq/defs/rooms.js";
import { resolveDecoration, decorationsByRarityDesc, HQ_DECORATIONS } from "../hq/defs/decorations.js";
import { unlockLabel } from "../hq/defs/unlock-rules.js";
import { spriteFor } from "../hq/assets.js";
import { renderHq, type HqRenderView, type HqRenderCard, type HqRenderDeco } from "../hq/render.js";
import type { PlayerHq } from "@workspace/db";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const HQ_FILE = "hq.png";

type Section = "overview" | "trophy" | "decorations" | "rooms" | "theme";
interface SectionMeta { id: Section; label: string; emoji: string; description: string }
const SECTIONS: SectionMeta[] = [
  { id: "overview",    label: "Overview",    emoji: "🏠", description: "Your HQ at a glance" },
  { id: "trophy",      label: "Trophy Hall",  emoji: "🏆", description: "Pin your proudest cards on pedestals" },
  { id: "decorations", label: "Decorations", emoji: "🎏", description: "Place the cosmetics you've earned" },
  { id: "rooms",       label: "Rooms",       emoji: "🚪", description: "Switch & unlock rooms" },
  { id: "theme",       label: "Theme",       emoji: "🎨", description: "Restyle your whole HQ" },
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
    const view = await buildVisitView(interaction.guildId, target.id, target.username, target.displayAvatarURL());
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

  // Decorations: place into the next free slot / remove a placed one.
  if (action === "placedeco" && interaction.isStringSelectMenu()) {
    await placeDecorationAction(guildId, userId, interaction.values[0]!);
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

  if (action === "back") {
    await interaction.update(await buildView(interaction, (parts[2] as Section) ?? "trophy", [])).catch(() => {});
    return;
  }

  // Default: section dropdown changed.
  const section: Section = interaction.isStringSelectMenu()
    ? ((interaction.values[0] as Section) ?? "overview") : "overview";
  await interaction.update(await buildView(interaction, section, [])).catch(() => {});
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

// Build the renderer's view from persisted state.
async function buildRenderView(
  guildId: string, userId: string, ownerName: string, ownerAvatarUrl: string | null, hq: PlayerHq,
): Promise<HqRenderView> {
  const theme = resolveTheme(hq.themeId);
  const room = resolveRoom(hq.activeRoomId);
  const [{ settings, ctx, displayMap, cards }, displays, placements] = await Promise.all([
    loadCtx(guildId),
    getDisplays(guildId, userId),
    getPlacements(guildId, userId, room.id),
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

  return {
    ownerName, ownerAvatarUrl, theme,
    roomName: room.name, roomEmoji: room.emoji, hqLevel: hq.hqLevel,
    subtitle, pedestals, decorations,
  };
}

async function renderRoomImage(view: HqRenderView): Promise<AttachmentBuilder | null> {
  const buf = await renderHq(view).catch(() => null);
  return buf ? new AttachmentBuilder(buf, { name: HQ_FILE }) : null;
}

// ── Owner view ────────────────────────────────────────────────────────────────
async function buildView(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  section: Section, justUnlocked: { name: string; emoji: string; story: string }[],
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

  const renderView = await buildRenderView(guildId, userId, interaction.user.username, interaction.user.displayAvatarURL(), hq);
  const file = await renderRoomImage(renderView);
  const files = file ? [file] : [];
  const room = resolveRoom(hq.activeRoomId);
  const theme = resolveTheme(hq.themeId);

  const rows: ActionRowBuilder<any>[] = [sectionRow(section)];
  const embed = new EmbedBuilder().setColor(theme.palette.accent);
  if (file) embed.setImage(`attachment://${HQ_FILE}`);

  switch (section) {
    case "overview": {
      const decoOwned = ownedDecorations(owned).length;
      const roomsOpen = unlockedRooms(owned).length;
      embed.setTitle(`🏠 ${interaction.user.username}'s Headquarters`)
        .setDescription(
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

    case "decorations": {
      const owns = ownedDecorations(owned);
      const placements = await getPlacements(guildId, userId, room.id);
      const placedIds = new Set(placements.values());
      embed.setTitle("🎏 Decorations").setDescription(
        `Cosmetics you've **earned** by playing — each one tells a story. Placing fills the **${room.emoji} ${room.name}**'s ${room.decoSlots} slots.\n` +
        (owns.length === 0 ? "\nYou haven't earned any decorations yet — win battles, clear raids, complete sets and grow your collection." : ""),
      );
      const lines = decorationsByRarityDesc(owns.map(d => d.id)).slice(0, 12)
        .map(d => `${d.emoji} **${d.name}** — _${d.story}_${placedIds.has(d.id) ? " · 📍 placed" : ""}`);
      if (lines.length) embed.addFields({ name: `Earned (${owns.length})`, value: lines.join("\n").slice(0, 1024) });
      if (placements.size > 0) {
        embed.addFields({
          name: `Placed in ${room.name} (${placements.size}/${room.decoSlots})`,
          value: [...placements.entries()].sort((a, b) => a[0] - b[0])
            .map(([slot, id]) => `Slot ${slot + 1}: ${resolveDecoration(id)?.emoji ?? "•"} ${resolveDecoration(id)?.name ?? id}`).join("\n").slice(0, 1024),
        });
      }
      // Place select (earned but with a free slot available).
      const freeSlots = room.decoSlots - placements.size;
      const placeable = owns.filter(d => !placedIds.has(d.id));
      if (freeSlots > 0 && placeable.length > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:placedeco").setPlaceholder(`Place a decoration… (${freeSlots} slot${freeSlots === 1 ? "" : "s"} free)`)
            .addOptions(placeable.slice(0, 25).map(d => ({ label: d.name.slice(0, 90), value: d.id, description: d.rarity, emoji: d.emoji }))),
        ));
      }
      // Remove select.
      if (placements.size > 0) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:removedeco").setPlaceholder("Remove a placed decoration…")
            .addOptions([...placements.entries()].sort((a, b) => a[0] - b[0]).map(([slot, id]) => ({
              label: `Slot ${slot + 1}: ${(resolveDecoration(id)?.name ?? id).slice(0, 80)}`, value: String(slot), emoji: "🗑️",
            }))),
        ));
      }
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
      embed.setTitle("🎨 Theme").setDescription("Restyle your entire HQ. New themes unlock as your account grows.");
      const lines = HQ_THEMES.map(t => {
        const open = isThemeUnlocked(t, owned);
        const here = t.id === theme.id ? " · ✅ active" : "";
        return `${open ? t.emoji : "🔒"} **${t.name}**${here}${open ? "" : ` — ${unlockLabel(t.unlock)}`}`;
      });
      embed.addFields({ name: "Themes", value: lines.join("\n").slice(0, 1024) });
      const open = unlockedThemes(owned);
      if (open.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("hq-hub:theme").setPlaceholder("Switch theme…")
            .addOptions(open.map(t => ({ label: t.name, value: t.id, emoji: t.emoji, default: t.id === theme.id }))),
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

// ── Visit (read-only) ─────────────────────────────────────────────────────────
async function buildVisitView(guildId: string, targetId: string, targetName: string, targetAvatar: string) {
  const hq = await getOrCreateHq(guildId, targetId);
  const renderView = await buildRenderView(guildId, targetId, targetName, targetAvatar, hq);
  const file = await renderRoomImage(renderView);
  const room = resolveRoom(hq.activeRoomId);
  const theme = resolveTheme(hq.themeId);
  const owned = await getUnlockedItemIds(guildId, targetId);

  const embed = new EmbedBuilder()
    .setColor(theme.palette.accent)
    .setTitle(`🏠 Visiting ${targetName}'s Headquarters`)
    .setDescription(`**${theme.emoji} ${theme.name}** · **HQ Level ${hq.hqLevel}** · **${room.emoji} ${room.name}**`)
    .addFields({ name: "🎏 Decorations earned", value: `**${ownedDecorations(owned).length}** / ${HQ_DECORATIONS.length}`, inline: true });
  if (file) embed.setImage(`attachment://${HQ_FILE}`);

  const rows: ActionRowBuilder<any>[] = [];
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

// ── Actions ───────────────────────────────────────────────────────────────────
async function placeDecorationAction(guildId: string, userId: string, decoId: string): Promise<void> {
  const deco = resolveDecoration(decoId);
  if (!deco) return;
  const owned = await getUnlockedItemIds(guildId, userId);
  const isOwned = deco.unlock.kind === "always" || owned.has(deco.id);
  if (!isOwned) return;
  const hq = await getOrCreateHq(guildId, userId);
  const room = resolveRoom(hq.activeRoomId);
  const placements = await getPlacements(guildId, userId, room.id);
  if ([...placements.values()].includes(deco.id)) return; // already placed
  // Next free slot.
  let slot = -1;
  for (let i = 0; i < room.decoSlots; i++) { if (!placements.has(i)) { slot = i; break; } }
  if (slot < 0) return; // room full
  await placeDecoration(guildId, userId, room.id, slot, deco.id).catch(() => {});
}

// ── UI fragments ──────────────────────────────────────────────────────────────
function sectionRow(current: Section) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("hq-hub:select").setPlaceholder("📋 Jump to a section…")
      .addOptions(SECTIONS.map(s => ({ label: s.label, value: s.id, description: s.description, emoji: s.emoji, default: s.id === current }))),
  );
}

function pedestalButtonRow(
  action: "setslot" | "clearslot", label: string, n: number, style: ButtonStyle, displays?: Map<number, number>,
) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let slot = 0; slot < Math.min(n, 5); slot++) {
    const btn = new ButtonBuilder().setCustomId(`hq-hub:${action}:${slot}`).setLabel(`${label} ${slot + 1}`).setStyle(style);
    if (action === "clearslot") btn.setDisabled(!displays?.has(slot));
    row.addComponents(btn);
  }
  return row;
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
