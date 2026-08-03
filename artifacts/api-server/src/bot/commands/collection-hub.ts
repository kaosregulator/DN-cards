// ─────────────────────────────────────────────────────────────────────────────
// /collection-hub — browse YOUR collection.
//
// The /user-hub Collection section answers "how much do I have?"; this answers
// "what exactly do I have, and show me that one". It is a filterable, paginated
// browser over the cards you own:
//
//   • Rarity filter  — every tier from the rarity source of truth, so renamed
//                      built-ins and CUSTOM tiers both appear with their real
//                      name, emoji and colour.
//   • Special filter — shinies, limited, event, duplicates, leveled.
//   • Name search    — fuzzy, via the shared search service.
//   • Card detail    — the same presentation /info uses: the reveal canvas with
//                      the Level-1 battle stat block, plus your level/XP.
//
// Everything is ephemeral and scoped to the invoker. Filter state rides in the
// component customId, so there is no server-side session to expire.
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
  getUserCollection, getOrCreateGuildSettings, getAllCardsCached,
  getRarityContext, getRarityDisplayOverrides, getCardDisplayRarity,
  getDisplayRarities, effectiveRarityKey,
} from "../db.js";
import { getShinyName, SHINY_EMOJI } from "../cards-data.js";
import { getCardProgress } from "../cards/leveling.js";
import { getStarRanks } from "../cards/stars.js";
import { fuzzyRank } from "../search/fuse-service.js";
import { buildCardLevelEmbed } from "../cards/level-command.js";
import { renderCardRevealCanvas, CARD_REVEAL_FILE } from "../cards/card-reveal-canvas.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const PAGE_SIZE = 10;      // list lines per page
const MAX_SELECT = 25;     // Discord's select-option cap

// ── Filter state ──────────────────────────────────────────────────────────────
// Encoded into the customId so the browser is fully stateless. Format:
//   collhub:<action>|<page>|<rarityKey>|<special>|<query>
// `:` is the routing separator (index.ts splits on it) and rarity keys may
// themselves contain a colon ("custom:slug"), so the payload uses `|`.
type Special = "all" | "shiny" | "limited" | "event" | "dupes" | "leveled";

interface State {
  page: number;
  // INDEX into the guild's rarity ladder (getDisplayRarities), or -1 for "all".
  // An index rather than the key itself because a custom tier's key is
  // "custom:<slug>" and an unbounded slug could push the customId past
  // Discord's 100-character limit, which would break every button on the hub.
  // The ladder is derived deterministically from the guild's rarity config, so
  // the same index resolves to the same tier across renders.
  rarityIdx: number;
  special: Special;
  query: string;
}

const DEFAULT_STATE: State = { page: 0, rarityIdx: -1, special: "all", query: "" };

// The query is the only unbounded part of the payload, so it is what gets
// trimmed. Worst case the encoded id is ~64 chars — comfortably under the cap.
const MAX_QUERY = 32;

function encodeState(action: string, s: State): string {
  const q = s.query.slice(0, MAX_QUERY).replace(/[|:]/g, " ").trim();
  return `collhub:${action}|${s.page}|${s.rarityIdx}|${s.special}|${q}`;
}

function decodeState(customId: string): { action: string; state: State } {
  // "collhub:<action>|<page>|<rarityIdx>|<special>|<query>"
  const payload = customId.slice("collhub:".length);
  const [action = "view", page = "0", rarityIdx = "-1", special = "all", ...rest] = payload.split("|");
  const idx = Number(rarityIdx);
  return {
    action,
    state: {
      page: Math.max(0, Number(page) || 0),
      rarityIdx: Number.isFinite(idx) ? idx : -1,
      special: (special as Special) || "all",
      query: rest.join("|"),
    },
  };
}

// ── Entry points ──────────────────────────────────────────────────────────────
export async function handleCollectionHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ This command can only be used in a server.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  await interaction.deferReply(EPHEMERAL).catch(() => {});

  // Resolve the optional `rarity:` argument against the guild's own ladder, so
  // it accepts a built-in key ("legendary"), a renamed built-in, or a custom
  // tier — by key, slug or display label, case-insensitively.
  let rarityIdx = -1;
  const wanted = interaction.options.getString("rarity")?.trim().toLowerCase();
  if (wanted) {
    const [settings, ctx, displayMap] = await Promise.all([
      getOrCreateGuildSettings(interaction.guildId),
      getRarityContext(interaction.guildId),
      getRarityDisplayOverrides(interaction.guildId),
    ]);
    const tiers = getDisplayRarities(ctx, settings, { displayMap });
    rarityIdx = tiers.findIndex(t =>
      t.key.toLowerCase() === wanted ||
      t.label.toLowerCase() === wanted ||
      (t.slug ?? "").toLowerCase() === wanted ||
      (t.rarity ?? "").toLowerCase() === wanted);
  }

  const state: State = {
    ...DEFAULT_STATE,
    rarityIdx,
    special: (interaction.options.getString("filter") as Special) ?? "all",
    query: interaction.options.getString("name") ?? "",
  };
  const view = await buildListView(interaction.guildId, interaction.user.id, interaction.user.username, state);
  await interaction.editReply(view).catch(() => {});
}

// Opened from the /user-hub Collection section.
export async function openCollectionHubFromButton(interaction: ButtonInteraction): Promise<void> {
  const view = await buildListView(interaction.guildId!, interaction.user.id, interaction.user.username, DEFAULT_STATE);
  await interaction.update(view).catch(() => {});
}

// ── Component routing (collhub:*) ─────────────────────────────────────────────
export async function handleCollectionHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const { action, state } = decodeState(interaction.customId);
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Name search opens a modal; everything else re-renders in place.
  if (action === "search" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(encodeState("modal", state))
      .setTitle("Search your collection")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("query")
            .setLabel("Card name (leave empty to clear)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(MAX_QUERY),
        ),
      );
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  let next: State = state;
  if (action === "rarity" && interaction.isStringSelectMenu()) {
    next = { ...state, rarityIdx: Number(interaction.values[0] ?? -1), page: 0 };
  } else if (action === "special" && interaction.isStringSelectMenu()) {
    next = { ...state, special: (interaction.values[0] as Special) ?? "all", page: 0 };
  } else if (action === "prev") {
    next = { ...state, page: Math.max(0, state.page - 1) };
  } else if (action === "next") {
    next = { ...state, page: state.page + 1 };
  } else if (action === "reset") {
    next = { ...DEFAULT_STATE };
  } else if (action === "card" && interaction.isStringSelectMenu()) {
    const cardId = Number(interaction.values[0]);
    await interaction.deferUpdate().catch(() => {});
    const detail = await buildDetailView(guildId, userId, cardId, state);
    await interaction.editReply(detail).catch(() => {});
    return;
  } else if (action === "back") {
    // fall through to the list with the preserved state
  }

  await interaction.deferUpdate().catch(() => {});
  const view = await buildListView(guildId, userId, username, next);
  await interaction.editReply(view).catch(() => {});
}

export async function handleCollectionHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { state } = decodeState(interaction.customId);
  const query = interaction.fields.getTextInputValue("query").trim();
  await interaction.deferUpdate().catch(() => {});
  const view = await buildListView(
    interaction.guildId!, interaction.user.id, interaction.user.username,
    { ...state, query, page: 0 },
  );
  await interaction.editReply(view).catch(() => {});
}

// ── Data ──────────────────────────────────────────────────────────────────────
type Item = Awaited<ReturnType<typeof getUserCollection>>[number];

async function loadFiltered(guildId: string, userId: string, state: State) {
  const [items, settings, ctx, displayMap, starRanks] = await Promise.all([
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getRarityContext(guildId),
    getRarityDisplayOverrides(guildId),
    getStarRanks(guildId, userId).catch(() => new Map<number, number>()),
  ]);

  const tiers = getDisplayRarities(ctx, settings, { displayMap });
  const tier = state.rarityIdx >= 0 ? tiers[state.rarityIdx] : undefined;

  let rows = items;
  if (tier) {
    // Match on the EFFECTIVE key so a card moved into a custom tier filters
    // under that tier, not its underlying built-in rarity.
    rows = rows.filter(i => effectiveRarityKey({ id: i.cardId, rarity: i.rarity as string }, ctx) === tier.key);
  }
  switch (state.special) {
    case "shiny":   rows = rows.filter(i => (i.shinyCount ?? 0) > 0); break;
    case "limited": rows = rows.filter(i => i.isLimitedEdition); break;
    case "event":   rows = rows.filter(i => i.isEventExclusive); break;
    case "dupes":   rows = rows.filter(i => i.count + i.shinyCount > 1); break;
    case "leveled": rows = rows.filter(i => (starRanks.get(i.cardId) ?? 0) > 0); break;
    default: break;
  }
  if (state.query) {
    rows = fuzzyRank(rows, state.query, r => r.name);
  } else {
    // Rarest first, then most valuable, then name — a stable, useful default.
    rows = [...rows].sort((a, b) => b.worthValue - a.worthValue || a.name.localeCompare(b.name));
  }
  return { rows, settings, ctx, displayMap, starRanks, totalOwned: items.length, tiers, tier };
}

// ── List view ─────────────────────────────────────────────────────────────────
async function buildListView(guildId: string, userId: string, username: string, state: State) {
  const { rows, settings, ctx, displayMap, starRanks, totalOwned, tiers, tier } =
    await loadFiltered(guildId, userId, state);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const shinyName = getShinyName(settings);

  const lines = slice.map(item => {
    const d = getCardDisplayRarity({ id: item.cardId, rarity: item.rarity as string }, ctx, settings, displayMap);
    const star = starRanks.get(item.cardId) ?? 0;
    const bits: string[] = [`×${item.count + item.shinyCount}`];
    if ((item.shinyCount ?? 0) > 0) bits.push(`${SHINY_EMOJI}${item.shinyCount}`);
    if (star > 0) bits.push("★".repeat(star));
    if (item.isLimitedEdition) bits.push("💎");
    if (item.isEventExclusive) bits.push("🎆");
    return `${d.emoji} **${item.name}** — ${bits.join(" · ")}`;
  });

  const activeFilters: string[] = [];
  if (tier) activeFilters.push(`${tier.emoji} ${tier.label}`);
  if (state.special !== "all") activeFilters.push(SPECIAL_LABEL[state.special]);
  if (state.query) activeFilters.push(`name~"${state.query}"`);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🃏 ${username}'s Collection`)
    .setDescription(
      rows.length === 0
        ? "No cards match these filters. Try **♻️ Reset**, or widen the rarity/filter."
        : lines.join("\n").slice(0, 4000),
    )
    .setFooter({
      text: `${rows.length} of ${totalOwned} owned${activeFilters.length ? ` · ${activeFilters.join(" · ")}` : ""} · page ${page + 1}/${pages}`,
    });
  if ((state.special === "shiny" || state.query) && rows.length > 0) {
    embed.setAuthor({ name: state.special === "shiny" ? `${shinyName} only` : `Search: ${state.query}` });
  }

  const cur: State = { ...state, page };
  const rowsOut: ActionRowBuilder<any>[] = [
    rarityRow(cur, tiers),
    specialRow(cur),
  ];
  if (slice.length > 0) rowsOut.push(cardRow(cur, slice, ctx, settings, displayMap));
  rowsOut.push(navRow(cur, page, pages));

  return { embeds: [embed], components: rowsOut, files: [] as AttachmentBuilder[] };
}

const SPECIAL_LABEL: Record<Special, string> = {
  all: "All cards",
  shiny: "✨ Shinies",
  limited: "💎 Limited",
  event: "🎆 Event",
  dupes: "🔁 Duplicates",
  leveled: "⭐ Leveled",
};

function rarityRow(state: State, tiers: ReturnType<typeof getDisplayRarities>) {
  // Rarity source of truth: built-ins (with any rename/recolour applied) plus
  // every custom tier, rarest first. The option VALUE is the ladder index —
  // see State.rarityIdx for why.
  const options = [
    { label: "All rarities", value: "-1", emoji: "🃏", default: state.rarityIdx < 0 },
    ...tiers.slice(0, MAX_SELECT - 1).map((t, i) => ({
      label: t.label.slice(0, 100),
      value: String(i),
      emoji: t.emoji || undefined,
      default: state.rarityIdx === i,
    })),
  ];
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(encodeState("rarity", state))
      .setPlaceholder("Filter by rarity…")
      .addOptions(options),
  );
}

function specialRow(state: State) {
  const opts: Special[] = ["all", "shiny", "limited", "event", "dupes", "leveled"];
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(encodeState("special", state))
      .setPlaceholder("Filter by kind…")
      .addOptions(opts.map(o => ({
        label: SPECIAL_LABEL[o], value: o, default: state.special === o,
      }))),
  );
}

function cardRow(
  state: State,
  slice: Item[],
  ctx: Awaited<ReturnType<typeof getRarityContext>>,
  settings: Awaited<ReturnType<typeof getOrCreateGuildSettings>>,
  displayMap: Awaited<ReturnType<typeof getRarityDisplayOverrides>>,
) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(encodeState("card", state))
      .setPlaceholder("Open a card…")
      .addOptions(slice.slice(0, MAX_SELECT).map(item => {
        const d = getCardDisplayRarity({ id: item.cardId, rarity: item.rarity as string }, ctx, settings, displayMap);
        return {
          label: item.name.slice(0, 100),
          value: String(item.cardId),
          description: `${d.label} · ×${item.count + item.shinyCount}${item.shinyCount > 0 ? ` · ${SHINY_EMOJI}${item.shinyCount}` : ""}`.slice(0, 100),
          emoji: d.emoji || undefined,
        };
      })),
  );
}

function navRow(state: State, page: number, pages: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(encodeState("prev", state)).setEmoji("◀").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(encodeState("next", state)).setEmoji("▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
    new ButtonBuilder().setCustomId(encodeState("search", state)).setLabel("Search").setEmoji("🔎").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(encodeState("reset", state)).setLabel("Reset").setEmoji("♻️").setStyle(ButtonStyle.Secondary),
  );
}

// ── Card detail ───────────────────────────────────────────────────────────────
// Mirrors what /info shows for a card — the reveal canvas with the Level-1
// battle stat block — and adds the viewer's own level/XP and copy counts.
async function buildDetailView(guildId: string, userId: string, cardId: number, state: State) {
  const [cards, items, settings, ctx, displayMap] = await Promise.all([
    getAllCardsCached(guildId),
    getUserCollection(guildId, userId),
    getOrCreateGuildSettings(guildId),
    getRarityContext(guildId),
    getRarityDisplayOverrides(guildId),
  ]);
  const card = cards.find(c => c.id === cardId);
  const item = items.find(i => i.cardId === cardId);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(encodeState("back", state)).setLabel("Back to collection").setEmoji("◀").setStyle(ButtonStyle.Secondary),
  );

  if (!card || !item) {
    return {
      embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("❌ You don't own that card any more.")],
      components: [backRow],
      files: [] as AttachmentBuilder[],
    };
  }

  const display = getCardDisplayRarity(card, ctx, settings, displayMap);
  const progress = await getCardProgress(guildId, userId, cardId).catch(() => null);
  const shinyName = getShinyName(settings);

  // The /info-style canvas: card art + the Level-1 battle stat block, with the
  // viewer's star rank layered in.
  const reveal = await renderCardRevealCanvas(guildId, cardId, { withStats: true, userId }).catch(() => null);

  const owned: string[] = [`**${item.count + item.shinyCount}** owned`];
  if ((item.shinyCount ?? 0) > 0) owned.push(`${SHINY_EMOJI} **${item.shinyCount}** ${shinyName}`);
  if (item.isLimitedEdition) owned.push("💎 Limited");
  if (item.isEventExclusive) owned.push("🎆 Event");

  const embed = new EmbedBuilder()
    .setColor(display.color)
    .setTitle(`${display.emoji} ${card.name}`)
    .setDescription(card.description?.slice(0, 500) || null)
    .addFields(
      { name: "Rarity", value: `${display.emoji} ${display.label}`, inline: true },
      { name: "Worth", value: `💠 ${item.worthValue.toLocaleString()}`, inline: true },
      { name: "Level", value: `Lv **${progress?.level ?? 1}**`, inline: true },
      { name: "Yours", value: owned.join(" · "), inline: false },
    );
  if (item.firstCaughtAt) {
    embed.setFooter({ text: `First caught ${new Date(item.firstCaughtAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` });
  }
  if (reveal) embed.setImage(`attachment://${CARD_REVEAL_FILE}`);

  // The full level/XP breakdown (same embed /level shows), when there is one.
  const embeds = [embed];
  const level = await buildCardLevelEmbed(guildId, userId, {
    id: card.id, name: card.name, rarity: card.rarity as string, imageUrl: card.imageUrl,
  }).catch(() => null);
  if (level && "embed" in level) embeds.push(level.embed);

  return { embeds, components: [backRow], files: reveal ? [reveal.file] : [] };
}
