// ─────────────────────────────────────────────────────────────────────────────
// Recycle Card Generator — interactive /recycle hub.
//
// Reuses the existing recycle logic (cards/stars.ts), card reveal rendering,
// fuzzy search, and the animation engine. Presents the user's top duplicate cards
// on a single canvas, lets them search their collection, and plays a short
// morph animation when they recycle.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import {
  EmbedBuilder, MessageFlags, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder,
  ButtonStyle,
} from "discord.js";
import {
  getCanvas, hexToRgba, roundRectPath, drawGradientBackground, type Ctx, type CanvasMod, type FrameCtx,
  lerp, easeInOutCubic, easeOutBack, clamp01,
  encodeAnimation,
} from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawRarityBadge, drawTextWithShadow,
  drawTitle, fitText, getRarityEffectColor, TITLE_FONT,
} from "../animations/effects.js";
import { drawSparks, drawEmbers, drawExplosion } from "../animations/particles.js";
import { queueRender } from "../animations/render-queue.js";
import { renderCardReveal } from "../animations/reveal.js";
import type { RenderCard } from "../battle/image/render.js";
import {
  getAllCardsCached, getOrCreateGuildSettings, getRarityContext, getRarityDisplayOverrides,
  getCardDisplayRarity, getUserCollection, getCardById,
} from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import { fuzzyRank } from "../search/fuse-service.js";
import { recycleQuote, recycleCard, starRankString, MAX_STAR, getStarRank, getStarRanks, mergeAllRecycle } from "./stars.js";
import type { Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const HUB_CANVAS = { width: 1000, height: 540 } as const;
const CARD_CANVAS = { width: 520, height: 660 } as const;
const RECYCLE_MORPH_FILE = "recycle-morph.gif";
const RECYCLE_HUB_FILE = "recycle-hub.png";
const RECYCLE_CARD_FILE = "recycle-card.png";

// Minimum duplicates required to recycle (matches recycleCost / stars.ts).
const MIN_DUPLICATES = 5;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface RecycleCardEntry {
  cardId: number;
  name: string;
  rarity: Rarity;
  rarityLabel: string;
  rarityColor: number | null;
  cardType: string | null;
  imageUrl: string | null;
  count: number;
  star: number;
}

// ── Data helpers ─────────────────────────────────────────────────────────────

async function loadRecycleCandidates(guildId: string, userId: string, limit = 5): Promise<RecycleCardEntry[]> {
  const [collection, ctx, settings, displayMap] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  const withDisplay = collection.map(c => ({ ...c, display: getCardDisplayRarity(c, ctx, settings, displayMap) }));
  const eligible = withDisplay
    .filter(c => c.count > 1)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
  const stars = await getStarRanks(guildId, userId);
  return eligible.map(c => ({
    cardId: c.id,
    name: c.name,
    rarity: c.rarity as Rarity,
    rarityLabel: c.display.label,
    rarityColor: c.display.color,
    cardType: c.cardType,
    imageUrl: c.imageUrl,
    count: c.count,
    star: stars.get(c.id) ?? 0,
  }));
}

async function loadUserRecycleCards(guildId: string, userId: string, limit = 25): Promise<RecycleCardEntry[]> {
  const [collection, ctx, settings, displayMap] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  const owned = collection
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const stars = await getStarRanks(guildId, userId);
  return owned.slice(0, limit).map(c => {
    const display = getCardDisplayRarity(c, ctx, settings, displayMap);
    return {
      cardId: c.id,
      name: c.name,
      rarity: c.rarity as Rarity,
      rarityLabel: display.label,
      rarityColor: display.color,
      cardType: c.cardType,
      imageUrl: c.imageUrl,
      count: c.count,
      star: stars.get(c.id) ?? 0,
    };
  });
}

function cardSelectMenu(cards: RecycleCardEntry[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = cards.map(c => ({
    label: `${starRankString(c.star)} ${c.name}`.slice(0, 100),
    description: `×${c.count} copies`.slice(0, 100),
    value: String(c.cardId),
  }));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("recycle:search")
      .setPlaceholder("🔍 Pick a card to recycle…")
      .setOptions(options.length ? options : [{ label: "No cards", value: "__none__", description: "Collection empty" }])
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(options.length === 0),
  );
}

async function loadSingleRecycleCard(guildId: string, userId: string, cardId: number): Promise<RecycleCardEntry | null> {
  const [collection, ctx, settings, displayMap] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  const row = collection.find(c => c.id === cardId);
  if (!row) return null;
  const display = getCardDisplayRarity(row, ctx, settings, displayMap);
  const star = await getStarRank(guildId, userId, cardId).catch(() => 0);
  return {
    cardId: row.id,
    name: row.name,
    rarity: row.rarity as Rarity,
    rarityLabel: display.label,
    rarityColor: display.color,
    cardType: row.cardType,
    imageUrl: row.imageUrl,
    count: row.count,
    star,
  };
}

// ── Canvas helpers ───────────────────────────────────────────────────────────

async function cardToRenderCard(entry: RecycleCardEntry): Promise<RenderCard> {
  return {
    name: entry.name,
    rarity: entry.rarity,
    rarityLabel: entry.rarityLabel,
    rarityColor: entry.rarityColor,
    cardId: entry.cardId,
    cardType: entry.cardType,
    artUrl: toAbsoluteImageUrl(entry.imageUrl),
  };
}

/** Draw a simple 5-pointed star polygon centered at (cx,cy). */
function starPath(ctx: Ctx, cx: number, cy: number, outerR: number, innerR: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ── Hub canvas: top duplicate cards ─────────────────────────────────────────

export async function renderRecycleHubCanvas(
  guildId: string, userId: string, cards: RecycleCardEntry[],
): Promise<{ buffer: Buffer; color: number } | null> {
  return queueRender("recycle-hub", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const { width, height } = HUB_CANVAS;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const accent = 0x2ecc71;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(accent, 0.35)],
        [0.55, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      drawTitle(ctx, "♻️ RECYCLE GENERATOR", width / 2, 44, "#ffffff", 34);
      drawTextWithShadow(ctx, "Top duplicate cards ready to star up", width / 2, 78, "#aab0c0", 18);

      const shown = cards.slice(0, 5);
      const cw = 150, ch = 210;
      const gap = 24;
      const totalW = shown.length * cw + (shown.length - 1) * gap;
      const startX = (width - totalW) / 2;
      const y = 120;

      for (let i = 0; i < shown.length; i++) {
        const c = shown[i]!;
        const x = startX + i * (cw + gap);
        const color = c.rarityColor ?? getRarityEffectColor(c.rarity);
        drawRarityGlow(ctx, x, y, cw, ch, color, 0.55);
        await drawCardArt(ctx, mod, x, y, cw, ch, toAbsoluteImageUrl(c.imageUrl));
        drawCardFrame(ctx, x, y, cw, ch, color, 5);
        drawRarityBadge(ctx, x + cw - 10, y + 10, c.rarityLabel, color);
        drawTextWithShadow(ctx, `#${i + 1}`, x + 14, y + 18, "#ffffff", 16);

        const labelY = y + ch + 26;
        drawTextWithShadow(ctx, c.name, x + cw / 2, labelY, "#ffffff", fitText(ctx, c.name, cw + 20, 16, 12, TITLE_FONT));
        drawTextWithShadow(ctx, starRankString(c.star), x + cw / 2, labelY + 22, "#ffd54a", 18);
        drawTextWithShadow(ctx, `×${c.count}`, x + cw / 2, labelY + 44, "#aab0c0", 16);
      }

      return { buffer: await canvas.encode("png"), color: accent };
    } catch (err) {
      logger.debug({ err, guildId, userId }, "renderRecycleHubCanvas failed");
      return null;
    }
  });
}

// ── Selected card canvas ─────────────────────────────────────────────────────

export async function renderRecycleSelectedCanvas(
  _guildId: string, _userId: string, entry: RecycleCardEntry,
): Promise<{ buffer: Buffer; color: number } | null> {
  // Reuse the existing reveal renderer so the card looks identical to /info,
  // then layer the owned-copies count on top so the recycle canvas is self-contained.
  const card = await cardToRenderCard(entry);
  const revealBuffer = await renderCardReveal({ card, stats: null, info: null, shiny: false, index: 1, total: 1 });
  if (!revealBuffer) return null;

  return queueRender("recycle-card", async () => {
    const mod = await getCanvas();
    if (!mod) return null;
    try {
      const { width, height } = CARD_CANVAS;
      const canvas = mod.createCanvas(width, height);
      const ctx = canvas.getContext("2d") as unknown as Ctx;
      const art = await mod.loadImage(revealBuffer);
      ctx.drawImage(art, 0, 0, width, height);

      const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
      const badgeH = 42;
      const badgeY = height - 26 - badgeH;
      ctx.save();
      ctx.fillStyle = "rgba(10,12,18,0.78)";
      roundRectPath(ctx, 40, badgeY, width - 80, badgeH, 14);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRgba(color, 0.9);
      roundRectPath(ctx, 40, badgeY, width - 80, badgeH, 14);
      ctx.stroke();
      ctx.restore();

      drawTextWithShadow(ctx, `⭐ ${starRankString(entry.star)} · ×${entry.count} owned`, width / 2, badgeY + badgeH / 2 + 6, "#ffffff", 20);
      return { buffer: await canvas.encode("png"), color };
    } catch (err) {
      logger.debug({ err, cardId: entry.cardId }, "renderRecycleSelectedCanvas overlay failed; falling back to plain reveal");
      return { buffer: revealBuffer, color: entry.rarityColor ?? getRarityEffectColor(entry.rarity) };
    }
  });
}

// ── Recycle morph animation ──────────────────────────────────────────────────

export async function renderRecycleMorphAnimation(
  _guildId: string, _userId: string, entry: RecycleCardEntry, fromStar: number, toStar: number,
): Promise<AnimationResult | null> {
  const card = await cardToRenderCard(entry);
  const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
  const starColor = 0xffd54a;
  const { width, height } = CARD_CANVAS;

  // Try to load Flubber for a true path morph; if unavailable, fall back to a
  // manual star-polygon interpolation. Either way the result is drawn on a single
  // canvas per frame.
  let flubberInterpolate: ((a: string, b: string, o?: { maxSegmentLength?: number }) => (t: number) => string) | null = null;
  try {
    const flubber = await import("flubber");
    flubberInterpolate = flubber.interpolate;
  } catch {
    flubberInterpolate = null;
  }
  void flubberInterpolate; // referenced for future path-morph upgrade; manual fallback is used below

  return encodeAnimation({
    width,
    height,
    speed: "normal",
    durationMs: 1600,
    maxFrames: 24,
    quality: 18,
    renderScale: 0.75,
    render: async (frame: FrameCtx) => {
      const { ctx, t, mod } = frame;
      const cx = width / 2, cy = height / 2;

      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(color, 0.35)],
        [0.5, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      const morphT = easeInOutCubic(clamp01(t / 0.55));
      const starT = easeOutBack(clamp01((t - 0.45) / 0.55));
      const cardAlpha = 1 - morphT;
      const starAlpha = starT;

      // Phase 1: card shrinks / glows.
      if (cardAlpha > 0.02) {
        const scale = lerp(1, 0.6, morphT);
        const cw = 300 * scale, ch = 300 * scale;
        const cx2 = cx - cw / 2, cy2 = 66 + (150 - ch / 2) * morphT;
        ctx.save();
        ctx.globalAlpha = cardAlpha;
        drawRarityGlow(ctx, cx2, cy2, cw, ch, color, 0.8 + morphT * 0.4);
        await drawCardArt(ctx, mod, cx2, cy2, cw, ch, card.artUrl);
        drawCardFrame(ctx, cx2, cy2, cw, ch, color, 6);
        drawRarityBadge(ctx, cx2 + cw - 12, cy2 + 12, card.rarityLabel, color);
        ctx.restore();
      }

      // Energy / particles throughout.
      drawEmbers(ctx, 0, height * 0.4, width, height * 0.6, {
        color: starColor, count: 18, seed: `recycle-embers-${entry.cardId}`,
      });
      if (t > 0.35) {
        drawSparks(ctx, cx, height * 0.45, {
          color: starColor, count: 16, maxLen: 80, seed: `recycle-sparks-${entry.cardId}`,
        });
      }
      if (t > 0.6) {
        drawExplosion(ctx, cx, height * 0.45, {
          color: starColor, radius: 70, ringCount: 2, seed: `recycle-boom-${entry.cardId}`,
        });
      }

      // Phase 2: star reward morphs in.
      if (starAlpha > 0.02) {
        const outerR = lerp(30, 120, starT);
        const innerR = outerR * 0.42;
        ctx.save();
        ctx.globalAlpha = starAlpha;
        ctx.shadowColor = hexToRgba(starColor, 1);
        ctx.shadowBlur = 30 + starT * 30;
        ctx.fillStyle = hexToRgba(starColor, 0.95);
        starPath(ctx, cx, cy, outerR, innerR);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        starPath(ctx, cx, cy, outerR, innerR);
        ctx.stroke();
        ctx.restore();

        drawTitle(ctx, `${starRankString(toStar)}`, cx, cy + outerR + 46, "#ffd54a", 34);
        drawTextWithShadow(ctx, entry.name, cx, cy + outerR + 80, "#ffffff", fitText(ctx, entry.name, width - 80, 22, 14, TITLE_FONT));
      }

      // Header: from -> to.
      drawTextWithShadow(ctx, `${starRankString(fromStar)}  →  ${starRankString(toStar)}`, cx, 36, "#ffffff", 24);
    },
  });
}

// ── Message builders ─────────────────────────────────────────────────────────

export async function buildRecycleHubMessage(guildId: string, userId: string) {
  const cards = await loadRecycleCandidates(guildId, userId, 5);
  const collection = await loadUserRecycleCards(guildId, userId, 25);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("♻️ Recycle Card Generator")
    .setDescription(cards.length === 0
      ? `You need at least **${MIN_DUPLICATES} copies** of a card to recycle. Pull or catch more duplicates and come back!`
      : "Pick a card from the dropdown to view it, or tap one of the quick actions below.");

  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  rows.push(cardSelectMenu(collection));
  const actionRow = new ActionRowBuilder<ButtonBuilder>();
  if (cards[0]?.count >= MIN_DUPLICATES) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId(`recycle:do:${cards[0]!.cardId}`).setLabel("♻️ Recycle Top Card").setEmoji("⭐").setStyle(ButtonStyle.Success),
    );
  }
  if (cards.length > 0) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId("recycle:merge-all").setLabel("🌟 Merge All into Top Card").setEmoji("♻️").setStyle(ButtonStyle.Primary),
    );
  }
  if (actionRow.components.length) rows.push(actionRow);

  const render = await renderRecycleHubCanvas(guildId, userId, cards);
  if (render) {
    embed.setImage(`attachment://${RECYCLE_HUB_FILE}`);
    return {
      embeds: [embed],
      components: rows,
      files: [new AttachmentBuilder(render.buffer, { name: RECYCLE_HUB_FILE })],
    };
  }
  return { embeds: [embed], components: rows };
}

export async function buildRecycleSelectedMessage(
  guildId: string, userId: string, cardId: number,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] } | string> {
  const entry = await loadSingleRecycleCard(guildId, userId, cardId);
  if (!entry) return "You do not own this card.";

  const quote = await recycleQuote(guildId, userId, cardId);
  const embed = new EmbedBuilder()
    .setColor(entry.rarityColor ?? 0x2ecc71)
    .setTitle(`${entry.rarityLabel} ${entry.name}`)
    .setDescription(
      `**Star Rank:** ${starRankString(entry.star)}  (${entry.star}★)\n` +
      `**Owned:** ×${entry.count}\n\n` +
      (quote.atMax
        ? `This card is already at max Star Rank (**${MAX_STAR}★**).`
        : quote.canRecycle
          ? `Next: ${entry.star}★ → ${entry.star + 1}★ · costs **${quote.cost}** duplicates.`
          : `Need **${quote.cost}** duplicates to recycle. You have **${quote.spendable}** spendable.`)
    );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const actionRow = new ActionRowBuilder<ButtonBuilder>();
  actionRow.addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
  );
  if (!quote.atMax && quote.canRecycle) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId(`recycle:do:${cardId}`).setLabel("♻️ Recycle").setEmoji("⭐").setStyle(ButtonStyle.Success),
    );
  }
  rows.push(actionRow);

  const render = await renderRecycleSelectedCanvas(guildId, userId, entry);
  if (render) {
    embed.setImage(`attachment://${RECYCLE_CARD_FILE}`);
    return { embeds: [embed], components: rows, files: [new AttachmentBuilder(render.buffer, { name: RECYCLE_CARD_FILE })] };
  }
  return { embeds: [embed], components: rows };
}

// ── Interaction handlers ───────────────────────────────────────────────────────

export async function handleRecycleHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply(EPHEMERAL).catch(() => {});
  const msg = await buildRecycleHubMessage(interaction.guild.id, interaction.user.id);
  await interaction.editReply(msg).catch(() => {});
}

export async function handleRecycleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const [action, sub, id] = interaction.customId.split(":");
  if (action !== "recycle") return;

  if (interaction.isButton()) {
    if (sub === "select") {
      const cardId = Number(id);
      await interaction.deferUpdate().catch(() => {});
      const msg = await buildRecycleSelectedMessage(guildId, userId, cardId);
      if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [], files: [] }).catch(() => {}); return; }
      await interaction.editReply(msg).catch(() => {});
      return;
    }
    if (sub === "back") {
      await interaction.deferUpdate().catch(() => {});
      const msg = await buildRecycleHubMessage(guildId, userId);
      await interaction.editReply(msg).catch(() => {});
      return;
    }
  }

  if (interaction.isStringSelectMenu() && sub === "search") {
    const cardId = Number(interaction.values[0]);
    await interaction.deferUpdate().catch(() => {});
    const msg = await buildRecycleSelectedMessage(guildId, userId, cardId);
    if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [], files: [] }).catch(() => {}); return; }
    await interaction.editReply(msg).catch(() => {});
  }
}

export async function handleRecycleMergeAll(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  await interaction.deferUpdate().catch(() => {});
  const res = await mergeAllRecycle(guildId, userId);
  if (!res.ok) {
    const msg = res.reason === "no_duplicates" ? "You don't have any duplicate cards to merge."
      : res.reason === "max_star" ? "Your top card is already at max Star Rank."
      : res.reason === "no_progress" ? "Not enough duplicates to raise the top card's star rank."
      : "Something went wrong merging cards.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("♻️ Merge All Complete")
    .setDescription(
      `Fused **${res.consumed}** duplicates into **${res.targetName}** for a star rank jump.\n\n` +
      `**${starRankString(res.fromStar)}**  →  **${starRankString(res.toStar)}**  (${res.toStar}★)\n\n` +
      `Sources:\n${res.sources.map(s => `• ${s.name}: ×${s.consumed}`).join("\n")}`
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
}

export async function handleRecycleConfirmButton(interaction: ButtonInteraction): Promise<void> {
  // This is the NEW animated recycle confirm. It reuses the existing recycleCard
  // logic, plays the morph GIF, and then updates the message with the result.
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle" || parts[1] !== "do") return;
  const cardId = Number(parts[2]);
  await interaction.deferUpdate().catch(() => {});

  const card = await getCardById(cardId, guildId);
  const entry = card ? await loadSingleRecycleCard(guildId, userId, cardId) : null;
  const quote = entry ? await recycleQuote(guildId, userId, cardId) : null;

  if (!entry || !quote || !quote.canRecycle) {
    await interaction.editReply({ content: "❌ You no longer have enough duplicates to recycle that card.", embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  // Play morph animation before consuming copies.
  const anim = await renderRecycleMorphAnimation(guildId, userId, entry, quote.star, quote.star + 1);
  if (anim) {
    const embed = new EmbedBuilder()
      .setColor(entry.rarityColor ?? 0x2ecc71)
      .setTitle("♻️ Recycling…")
      .setDescription(`Morphing **${entry.name}** into **${starRankString(quote.star + 1)}**…`)
      .setImage(`attachment://${RECYCLE_MORPH_FILE}`);
    await interaction.editReply({ embeds: [embed], components: [], files: [new AttachmentBuilder(anim.buffer, { name: RECYCLE_MORPH_FILE })] }).catch(() => {});
    // Let the GIF play before replacing it with the result screen.
    await sleep(1600);
  }

  // Now perform the actual recycle.
  const res = await recycleCard(guildId, userId, cardId);
  if (!res.ok) {
    const msg = res.reason === "max_star" ? "This card is already at max Star Rank."
      : res.reason === "not_enough" ? "You no longer have enough duplicate copies to recycle."
      : "Something went wrong recycling that card.";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [], files: [] }).catch(() => {});
    return;
  }

  const next = await recycleQuote(guildId, userId, cardId);
  const embed = new EmbedBuilder()
    .setColor(entry.rarityColor ?? 0xf1c40f)
    .setAuthor({ name: `⭐ Star Up! — ${entry.name}` })
    .setDescription(
      `${entry.rarityLabel} **${entry.name}** recycled **${res.consumed}** duplicates.\n\n` +
      `**${starRankString(res.fromStar)}**  →  **${starRankString(res.toStar)}**  (${res.toStar}★)`
    );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back to Hub").setStyle(ButtonStyle.Secondary),
  );
  if (!next.atMax && next.canRecycle) {
    row.addComponents(new ButtonBuilder().setCustomId(`recycle:do:${cardId}`).setLabel("♻️ Recycle Again").setEmoji("⭐").setStyle(ButtonStyle.Success));
  }
  rows.push(row);
  await interaction.editReply({ embeds: [embed], components: rows, files: [] }).catch(() => {});
}
