// ─────────────────────────────────────────────────────────────────────────────
// Card Fusion — the /card_recycle command (internal key "tradein").
//
// Star Rank is the single progression axis. Two actions per card:
//   ♻️  Recycle — turn spendable duplicate copies into Scrap (⚙️).
//   🌟  Fuse    — spend duplicates + Scrap to raise the card's Star Rank by one,
//                 boosting its battle stats. On success a premium 2–3s canvas
//                 GIF plays: the duplicates shatter into Scrap energy and flow
//                 into the card as its new star ignites.
//
// The hub and selected views are lightweight embeds (instant, no canvas). The
// only canvas render is the celebratory fuse animation, built on the same
// encodeAnimation pipeline as battles/reveals, with timeout-guarded image loads
// so it can never hang the interaction.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction, ModalSubmitInteraction,
} from "discord.js";
import {
  EmbedBuilder, MessageFlags, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import {
  hexToRgba, type Ctx, type FrameCtx,
  lerp, easeOutBack, clamp01,
  drawGradientBackground,
  encodeAnimation,
} from "../animations/engine.js";
import type { AnimationResult } from "../animations/types.js";
import {
  drawCardArt, drawCardFrame, drawRarityGlow, drawTextWithShadow,
  drawTitle, getRarityEffectColor,
} from "../animations/effects.js";
import { drawSparks, drawEmbers, drawExplosion } from "../animations/particles.js";
import {
  getOrCreateGuildSettings, getRarityContext, getRarityDisplayOverrides,
  getCardDisplayRarity, getUserCollection, getCardByName, getScrap,
} from "../db.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import {
  recycleForScrap, fuseStar, fuseStarQuote, scrapValueForCard,
  starRankString, starStatMultiplier, MAX_STAR, getStarRankMap, getRecycleSettings,
} from "./stars.js";
import type { Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const CARD_CANVAS = { width: 520, height: 660 } as const;
const FUSION_FILE = "fusion.gif";

interface FusionEntry {
  cardId: number;
  name: string;
  rarity: Rarity;
  rarityLabel: string;
  rarityColor: number | null;
  imageUrl: string | null;
  count: number;
  worthValue: number;
  star: number;
}

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadFusionEntries(guildId: string, userId: string): Promise<FusionEntry[]> {
  const [collection, ctx, settings, displayMap, stars] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getStarRankMap(guildId, userId),
  ]);
  return collection
    .filter(c => c.count > 1)                          // must have a spendable duplicate
    .map(c => {
      const display = getCardDisplayRarity(c, ctx, settings, displayMap);
      return {
        cardId: c.id,
        name: c.name,
        rarity: c.rarity as Rarity,
        rarityLabel: display.label,
        rarityColor: display.color,
        imageUrl: c.imageUrl,
        count: c.count,
        worthValue: c.worthValue,
        star: stars.get(c.id) ?? 0,
      };
    })
    .sort((a, b) => b.star - a.star || b.count - a.count || a.name.localeCompare(b.name));
}

async function loadSingleEntry(guildId: string, userId: string, cardId: number): Promise<FusionEntry | null> {
  const [collection, ctx, settings, displayMap, stars] = await Promise.all([
    getUserCollection(guildId, userId),
    getRarityContext(guildId),
    getOrCreateGuildSettings(guildId),
    getRarityDisplayOverrides(guildId),
    getStarRankMap(guildId, userId),
  ]);
  const row = collection.find(c => c.id === cardId);
  if (!row) return null;
  const display = getCardDisplayRarity(row, ctx, settings, displayMap);
  return {
    cardId: row.id,
    name: row.name,
    rarity: row.rarity as Rarity,
    rarityLabel: display.label,
    rarityColor: display.color,
    imageUrl: row.imageUrl,
    count: row.count,
    worthValue: row.worthValue,
    star: stars.get(row.id) ?? 0,
  };
}

// ── Messages ───────────────────────────────────────────────────────────────

function fusionDropdown(entries: FusionEntry[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = entries.slice(0, 25).map(e => ({
    label: `${starRankString(e.star)} ${e.name}`.slice(0, 100),
    description: `×${e.count} owned · ${e.rarityLabel}`.slice(0, 100),
    value: String(e.cardId),
  }));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("recycle:select")
      .setPlaceholder(options.length ? "🔧 Pick a card to fuse…" : "No duplicate cards yet")
      .setOptions(options.length ? options : [{ label: "No cards", value: "__none__", description: "Collect duplicates first" }])
      .setDisabled(options.length === 0),
  );
}

async function buildFusionHubMessage(guildId: string, userId: string) {
  const [entries, scrap] = await Promise.all([
    loadFusionEntries(guildId, userId),
    getScrap(guildId, userId),
  ]);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🔧 Card Fusion")
    .setDescription(
      entries.length === 0
        ? "You have no duplicate cards yet. Open packs and catch spawns — once you own **2+ copies** of a card you can fuse it here."
        : "**Fuse** duplicate copies + **Scrap** to raise a card's **Star Rank** (★) and boost its battle stats.\n\n" +
          "Pick a card below, or **search by name**. Recycle spare dupes into Scrap to fund your next fusion.",
    )
    .setFooter({ text: `⚙️ Scrap: ${scrap.toLocaleString()}  ·  ★ +8% battle stats per star` });

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    fusionDropdown(entries),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("recycle:search").setLabel("🔍 Search by Name").setStyle(ButtonStyle.Primary).setDisabled(entries.length === 0),
    ),
  ];
  return { embeds: [embed], components: rows };
}

async function buildFusionSelectedMessage(
  guildId: string, userId: string, cardId: number,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } | string> {
  const entry = await loadSingleEntry(guildId, userId, cardId);
  if (!entry) return "You don't own this card.";

  const [quote, settings, scrap] = await Promise.all([
    fuseStarQuote(guildId, userId, cardId, entry.rarity),
    getRecycleSettings(guildId),
    getScrap(guildId, userId),
  ]);
  const spendable = Math.max(0, entry.count - 1);
  const scrapPer = scrapValueForCard(entry.rarity, entry.worthValue, settings);
  const recycleGain = spendable * scrapPer;
  const curMult = starStatMultiplier(entry.star);
  const nextMult = starStatMultiplier(entry.star + 1);

  const lines: string[] = [
    `**${entry.rarityLabel}** · ${starRankString(entry.star)}  (${entry.star}/${MAX_STAR}★)`,
    `Owned: **×${entry.count}**  (${spendable} spendable duplicate${spendable !== 1 ? "s" : ""})`,
    `⚙️ Scrap balance: **${scrap.toLocaleString()}**`,
    "",
  ];
  if (entry.star >= MAX_STAR) {
    lines.push(`⭐ **Max Star Rank reached** (${MAX_STAR}★) — battle stats **+${Math.round((curMult - 1) * 100)}%**.`);
  } else {
    lines.push(
      `🌟 **Fuse → ${entry.star + 1}★**`,
      `• Cost: **${quote.dupeCost}** duplicate${quote.dupeCost !== 1 ? "s" : ""}  +  **${quote.scrapCost.toLocaleString()} ⚙️**`,
      `• Battle stats: +${Math.round((curMult - 1) * 100)}% → **+${Math.round((nextMult - 1) * 100)}%**`,
    );
    if (quote.reason === "insufficient_dupes") lines.push(`\n❌ Need **${quote.dupeCost - spendable}** more duplicate${quote.dupeCost - spendable !== 1 ? "s" : ""} of this card.`);
    else if (quote.reason === "insufficient_scrap") lines.push(`\n❌ Need **${(quote.scrapCost - scrap).toLocaleString()}** more ⚙️ Scrap — recycle spare dupes to earn it.`);
  }
  lines.push("", `♻️ **Recycle** all ${spendable} spare dupe${spendable !== 1 ? "s" : ""} → **+${recycleGain.toLocaleString()} ⚙️** (${scrapPer}/copy)`);

  const embed = new EmbedBuilder()
    .setColor(entry.rarityColor ?? 0x2ecc71)
    .setTitle(entry.name)
    .setDescription(lines.join("\n"));
  const thumb = toAbsoluteImageUrl(entry.imageUrl);
  if (thumb) embed.setThumbnail(thumb);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`recycle:fuse:${cardId}`).setLabel("🌟 Fuse").setStyle(ButtonStyle.Success).setDisabled(!quote.canFuse),
    new ButtonBuilder().setCustomId(`recycle:recycle:${cardId}`).setLabel("♻️ Recycle Dupes").setStyle(ButtonStyle.Secondary).setDisabled(spendable === 0),
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ── Fuse animation (premium GIF) ─────────────────────────────────────────────

// Draw a filled 5-pointed star at (cx,cy).
function fillStar(ctx: Ctx, cx: number, cy: number, outerR: number, innerR: number, fill: string, glow: string): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = outerR * 0.9;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

export async function renderFusionAnimation(
  entry: FusionEntry, fromStar: number, toStar: number,
): Promise<AnimationResult | null> {
  const artUrl = toAbsoluteImageUrl(entry.imageUrl);
  const color = entry.rarityColor ?? getRarityEffectColor(entry.rarity);
  const scrapColor = 0x64d4a4;
  const starColor = 0xffd54a;
  const { width, height } = CARD_CANVAS;

  return encodeAnimation({
    width, height,
    speed: "normal",
    durationMs: 2400,
    maxFrames: 34,
    quality: 18,
    renderScale: 0.75,
    render: async (frame: FrameCtx) => {
      const { ctx, t, mod } = frame;
      const cx = width / 2, cy = height / 2 - 30;

      // Background
      drawGradientBackground(ctx, width, height, [
        [0, hexToRgba(color, 0.30)],
        [0.5, "#0c0e14"],
        [1, "#070810"],
      ], 0.3);

      // Phase envelopes
      const inflow = clamp01(t / 0.55);                  // dupes spiral in + shatter
      const charge = clamp01((t - 0.35) / 0.4);          // card glows / energy streams
      const burst  = clamp01((t - 0.72) / 0.28);         // star ignites

      // Central card, growing slightly and glowing brighter as it charges.
      const baseW = 250, baseH = 250;
      const scale = lerp(0.92, 1.06, charge);
      const cw = baseW * scale, ch = baseH * scale;
      drawRarityGlow(ctx, cx - cw / 2, cy - ch / 2, cw, ch, color, 0.5 + charge * 0.6);
      await drawCardArt(ctx, mod, cx - cw / 2, cy - ch / 2, cw, ch, artUrl);
      drawCardFrame(ctx, cx - cw / 2, cy - ch / 2, cw, ch, color, 6);

      // Duplicate "ghost" cards spiral inward and shatter into scrap energy.
      const dupes = Math.min(4, Math.max(2, entry.count - 1));
      if (inflow < 1) {
        for (let i = 0; i < dupes; i++) {
          const a0 = (i / dupes) * Math.PI * 2;
          const ang = a0 + inflow * Math.PI * 1.5;
          const dist = lerp(230, 8, inflow);
          const gx = cx + Math.cos(ang) * dist;
          const gy = cy + Math.sin(ang) * dist * 0.8;
          const gs = lerp(0.5, 0.08, inflow);
          const gw = baseW * gs, gh = baseH * gs;
          ctx.save();
          ctx.globalAlpha = 0.85 * (1 - inflow);
          drawRarityGlow(ctx, gx - gw / 2, gy - gh / 2, gw, gh, scrapColor, 0.6);
          await drawCardArt(ctx, mod, gx - gw / 2, gy - gh / 2, gw, gh, artUrl);
          ctx.restore();
        }
      }

      // Scrap energy streaming into the card.
      if (charge > 0.02 && burst < 1) {
        drawSparks(ctx, cx, cy, {
          color: scrapColor, count: 20, maxLen: 120, seed: `fuse-in-${entry.cardId}`,
        });
      }
      drawEmbers(ctx, 0, height * 0.35, width, height * 0.65, {
        color: scrapColor, count: 18, seed: `fuse-embers-${entry.cardId}`,
      });

      // Burst: flash + explosion + the new star igniting.
      if (burst > 0.02) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.6 * (1 - burst));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
        drawExplosion(ctx, cx, cy, { color: starColor, radius: 130, ringCount: 2, seed: `fuse-boom-${entry.cardId}` });
      }

      // Star track along the bottom: existing stars solid, the new one pops in.
      const starY = cy + ch / 2 + 46;
      const gap = 46, sr = 16;
      const startX = cx - ((MAX_STAR - 1) * gap) / 2;
      for (let i = 0; i < MAX_STAR; i++) {
        const sx = startX + i * gap;
        const filledBefore = i < fromStar;
        const isNew = i === toStar - 1;
        if (filledBefore) {
          fillStar(ctx, sx, starY, sr, sr * 0.45, hexToRgba(starColor, 1), hexToRgba(starColor, 0.6));
        } else if (isNew) {
          const pop = easeOutBack(burst);
          if (pop > 0.02) fillStar(ctx, sx, starY, sr * pop, sr * 0.45 * pop, hexToRgba(starColor, 1), hexToRgba(starColor, 1));
        } else {
          fillStar(ctx, sx, starY, sr, sr * 0.45, "rgba(255,255,255,0.10)", "rgba(0,0,0,0)");
        }
      }

      // Header + payoff text. (Canvas font has no emoji glyphs — keep it text.)
      drawTextWithShadow(ctx, "CARD FUSION", cx, 30, hexToRgba(color, 1), 16);
      drawTextWithShadow(ctx, entry.name, cx, 54, "#ffffff", 24);
      if (burst > 0.25) {
        ctx.save();
        ctx.globalAlpha = clamp01((burst - 0.25) / 0.5);
        drawTitle(ctx, `${fromStar}★ → ${toStar}★`, cx, height - 96, hexToRgba(starColor, 1), 40);
        const bonus = Math.round((starStatMultiplier(toStar) - 1) * 100);
        drawTextWithShadow(ctx, `Battle stats +${bonus}%`, cx, height - 56, "#a8e6cf", 20);
        ctx.restore();
      }
    },
  });
}

// ── Command + component handlers ─────────────────────────────────────────────

export async function handleFusionCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply(EPHEMERAL).catch(() => {});

  try {
    const settings = await getRecycleSettings(guildId);
    if (!settings.enabled) {
      await interaction.editReply({ content: "🔧 Card Fusion is currently disabled by the server admins.", embeds: [], components: [] });
      return;
    }
    const name = interaction.options.getString("name")?.trim();
    if (!name) {
      await interaction.editReply(await buildFusionHubMessage(guildId, interaction.user.id));
      return;
    }
    const card = await getCardByName(name, guildId);
    if (!card) {
      await interaction.editReply(`❌ Couldn't find a card called **${name}**. Run \`/card_recycle\` without a name to browse.`);
      return;
    }
    const msg = await buildFusionSelectedMessage(guildId, interaction.user.id, card.id);
    if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [] }); return; }
    await interaction.editReply(msg);
  } catch (err) {
    logger.error({ err, userId: interaction.user.id, guildId }, "handleFusionCommand failed");
    await interaction.editReply({ content: "❌ Something went wrong opening Card Fusion. Try again in a moment.", embeds: [], components: [] }).catch(() => {});
  }
}

// Routes recycle:* buttons and the card-select menu.
export async function handleFusionComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "recycle") return;
  const sub = parts[1];

  // Card picked from the hub dropdown.
  if (interaction.isStringSelectMenu() && sub === "select") {
    await interaction.deferUpdate().catch(() => {});
    const cardId = Number(interaction.values[0]);
    if (!cardId || Number.isNaN(cardId)) { await interaction.editReply({ content: "❌ Invalid selection.", embeds: [], components: [] }).catch(() => {}); return; }
    const msg = await buildFusionSelectedMessage(guildId, userId, cardId);
    if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [] }).catch(() => {}); return; }
    await interaction.editReply(msg).catch(() => {});
    return;
  }

  if (!interaction.isButton()) return;

  if (sub === "back") {
    await interaction.deferUpdate().catch(() => {});
    await interaction.editReply(await buildFusionHubMessage(guildId, userId)).catch(() => {});
    return;
  }
  if (sub === "search") {
    const modal = new ModalBuilder().setCustomId("recycle:search").setTitle("Search a card to fuse");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("q").setLabel("Card name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
    ));
    await interaction.showModal(modal).catch(() => {});
    return;
  }
  if (sub === "fuse")    { await handleFuseButton(interaction); return; }
  if (sub === "recycle") { await handleRecycleButton(interaction); return; }
}

async function handleFuseButton(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const cardId = Number(interaction.customId.split(":")[2]);
  await interaction.deferUpdate().catch(() => {});

  const entry = await loadSingleEntry(guildId, userId, cardId);
  if (!entry) { await interaction.editReply({ content: "❌ Card no longer available.", embeds: [], components: [] }).catch(() => {}); return; }

  const res = await fuseStar(guildId, userId, cardId, entry.rarity);
  if (!res.ok) {
    const msg =
      res.reason === "max_star" ? "This card is already at max Star Rank."
      : res.reason === "insufficient_dupes" ? "You no longer have enough duplicate copies to fuse."
      : res.reason === "insufficient_scrap" ? "You don't have enough Scrap to fuse."
      : "Something went wrong fusing that card.";
    // Re-render the selected view so the buttons/costs reflect current state.
    const back = await buildFusionSelectedMessage(guildId, userId, cardId);
    if (typeof back === "string") { await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [] }).catch(() => {}); return; }
    await interaction.editReply({ content: `❌ ${msg}`, embeds: back.embeds, components: back.components }).catch(() => {});
    return;
  }

  // Success — play the premium fuse animation, falling back to a static embed.
  const fused = { ...entry, star: res.toStar };
  const anim = await renderFusionAnimation(fused, res.fromStar, res.toStar).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(entry.rarityColor ?? 0x2ecc71)
    .setTitle(`🔧 Fusion complete — ${entry.name}`)
    .setDescription(
      `${starRankString(res.fromStar)}  →  **${starRankString(res.toStar)}**  (${res.toStar}/${MAX_STAR}★)\n` +
      `Spent **${res.consumedDupes}** duplicate${res.consumedDupes !== 1 ? "s" : ""}` +
      (res.scrapSpent > 0 ? `  +  **${res.scrapSpent.toLocaleString()} ⚙️ Scrap**` : "") + "\n" +
      `Battle stats now **+${Math.round((starStatMultiplier(res.toStar) - 1) * 100)}%**.`,
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`recycle:select:${cardId}`).setLabel("🔧 Fuse Again").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("recycle:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
  );

  if (anim) {
    embed.setImage(`attachment://${FUSION_FILE}`);
    await interaction.editReply({
      embeds: [embed], components: [row],
      files: [new AttachmentBuilder(Buffer.from(anim.buffer), { name: FUSION_FILE })],
    }).catch(() => {});
  } else {
    const thumb = toAbsoluteImageUrl(entry.imageUrl);
    if (thumb) embed.setThumbnail(thumb);
    await interaction.editReply({ embeds: [embed], components: [row], files: [] }).catch(() => {});
  }
}

async function handleRecycleButton(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const cardId = Number(interaction.customId.split(":")[2]);
  await interaction.deferUpdate().catch(() => {});

  const entry = await loadSingleEntry(guildId, userId, cardId);
  if (!entry) { await interaction.editReply({ content: "❌ Card no longer available.", embeds: [], components: [] }).catch(() => {}); return; }

  const res = await recycleForScrap(guildId, userId, cardId, entry.rarity, entry.worthValue);
  if (!res.ok) {
    const msg = res.reason === "no_duplicates" ? "No spendable duplicates to recycle." : "Something went wrong recycling.";
    const back = await buildFusionSelectedMessage(guildId, userId, cardId);
    if (typeof back === "string") { await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [] }).catch(() => {}); return; }
    await interaction.editReply({ content: `❌ ${msg}`, embeds: back.embeds, components: back.components }).catch(() => {});
    return;
  }

  // Re-render the selected view (now with fresh Scrap balance) plus a banner.
  const back = await buildFusionSelectedMessage(guildId, userId, cardId);
  const banner = `♻️ Recycled **${res.consumed}** dupe${res.consumed !== 1 ? "s" : ""} → **+${res.scrapEarned.toLocaleString()} ⚙️ Scrap**.`;
  if (typeof back === "string") { await interaction.editReply({ content: banner, embeds: [], components: [] }).catch(() => {}); return; }
  await interaction.editReply({ content: banner, embeds: back.embeds, components: back.components }).catch(() => {});
}

export async function handleFusionSearchModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  await interaction.deferUpdate().catch(() => {});
  const q = interaction.fields.getTextInputValue("q").trim();
  const card = await getCardByName(q, guildId);
  if (!card) { await interaction.editReply({ content: `❌ No card called **${q}**.`, embeds: [], components: [] }).catch(() => {}); return; }
  const msg = await buildFusionSelectedMessage(guildId, interaction.user.id, card.id);
  if (typeof msg === "string") { await interaction.editReply({ content: msg, embeds: [], components: [] }).catch(() => {}); return; }
  await interaction.editReply(msg).catch(() => {});
}
