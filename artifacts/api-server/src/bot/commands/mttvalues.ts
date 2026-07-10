import type {
  ChatInputCommandInteraction, AutocompleteInteraction,
  ButtonInteraction, ModalSubmitInteraction,
  InteractionReplyOptions, BaseMessageOptions,
} from "discord.js";
import {
  EmbedBuilder, MessageFlags,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getBotClient } from "../client-holder.js";
import { addCard, addCardToSet, getCardByName, getSetByName } from "../db.js";
import { renderPanel, persistBotImage } from "./edit-card.js";
import { RARITY_BURN, RARITY_WEIGHTS, RARITY_WORTH, type Rarity } from "../cards-data.js";

// MTTV data source via public Firebase REST API — prices from MTTV.
// The Firebase Web API key is intentionally public (used by browser clients),
// but is kept in an env var to avoid hardcoding it in source.
const MTTV_FIRESTORE_KEY = process.env["MTTV_FIRESTORE_KEY"] ?? "";
const MTTV_FIRESTORE_URL =
  `https://firestore.googleapis.com/v1/projects/military-tycoon-trading-values/databases/(default)/documents/items?key=${MTTV_FIRESTORE_KEY}&pageSize=100`;

const CALC_STATE_TTL_MS = 15 * 60 * 1000; // ephemeral /calc state lives up to 15 minutes

export type MTTVItem = {
  id: string;
  name: string;
  valueMin: number | null;
  valueMax: number | null;
  rarity: string[];
  demand: number | null;
  functionality: number | null;
  tags: string[];
  description: string;
  image: string | null;
};

let cache: MTTVItem[] | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getFieldValue(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key] as Record<string, unknown> | undefined;
  if (!v) return null;
  return (v.stringValue as string | undefined) ?? null;
}

function getFieldInt(fields: Record<string, unknown>, key: string): number | null {
  const v = fields[key] as Record<string, unknown> | undefined;
  if (!v) return null;
  const iv = v.integerValue as string | undefined;
  if (!iv) return null;
  const n = parseInt(iv, 10);
  return Number.isNaN(n) ? null : n;
}

function getFieldArray(fields: Record<string, unknown>, key: string): string[] {
  const v = fields[key] as Record<string, unknown> | undefined;
  if (!v) return [];
  const arr = (v.arrayValue as Record<string, unknown> | undefined)?.values as Array<Record<string, unknown>> | undefined;
  if (!arr) return [];
  return arr.map((item) => (item.stringValue as string | undefined) ?? "").filter(Boolean);
}

export async function fetchMTTVItems(): Promise<MTTVItem[]> {
  const now = Date.now();
  if (cache && cacheExpiresAt > now) return cache;

  try {
    const allDocs: Array<{ name: string; fields?: Record<string, unknown> }> = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = 50; // Firestore pageSize=100 → up to 5,000 docs before warning

    do {
      const url = pageToken
        ? `${MTTV_FIRESTORE_URL}&pageToken=${encodeURIComponent(pageToken)}`
        : MTTV_FIRESTORE_URL;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json() as {
        documents?: Array<{ name: string; fields?: Record<string, unknown> }>;
        nextPageToken?: string;
      };
      allDocs.push(...(data.documents ?? []));
      pageToken = data.nextPageToken;
      pageCount++;
    } while (pageToken && pageCount < maxPages);

    if (pageToken) {
      logger.warn({ fetched: allDocs.length }, "MTTV collection may exceed pagination safety cap; some items not loaded");
    }

    const items: MTTVItem[] = allDocs.map((doc) => {
      const fields = doc.fields ?? {};
      return {
        id: doc.name.split("/").pop() ?? "",
        name: getFieldValue(fields, "name") ?? "Unknown",
        valueMin: getFieldInt(fields, "valueMin"),
        valueMax: getFieldInt(fields, "valueMax"),
        rarity: getFieldArray(fields, "rarity"),
        demand: getFieldInt(fields, "demand"),
        functionality: getFieldInt(fields, "functionality"),
        tags: getFieldArray(fields, "tags"),
        description: getFieldValue(fields, "description") ?? "",
        image: getFieldValue(fields, "image"),
      };
    });

    cache = items;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return items;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to fetch MTTV prices");
    throw new Error("Could not load MTTV prices. The site might be temporarily unavailable.");
  }
}

export function formatMTTVValue(item: MTTVItem): string {
  if (item.valueMin == null && item.valueMax == null) return "?";
  if (item.valueMin === item.valueMax) return item.valueMin?.toLocaleString() ?? "?";
  if (item.valueMin == null) return item.valueMax?.toLocaleString() ?? "?";
  if (item.valueMax == null) return item.valueMin.toLocaleString();
  return `${item.valueMin.toLocaleString()} – ${item.valueMax.toLocaleString()}`;
}

export function getMTTVAverageValue(item: MTTVItem): number {
  if (item.valueMin == null && item.valueMax == null) return 0;
  if (item.valueMin == null) return item.valueMax ?? 0;
  if (item.valueMax == null) return item.valueMin;
  return Math.round((item.valueMin + item.valueMax) / 2);
}

function rarityEmoji(rarity: string): string {
  const map: Record<string, string> = {
    Common: "⚪",
    Rare: "🔵",
    Legendary: "🟡",
    Epic: "🟣",
    Exotic: "🔥",
    Limited: "💎",
  };
  return map[rarity] ?? "";
}

function tagEmoji(tag: string): string {
  const map: Record<string, string> = {
    unstable: "📉",
    underpaid: "⬇️",
    overpaid: "⬆️",
    dropping: "🔻",
    rising: "🚀",
    stable: "➡️",
    meta: "🔥",
  };
  return map[tag] ?? "";
}

export function buildMTTVItemEmbed(item: MTTVItem): EmbedBuilder {
  const valueStr = formatMTTVValue(item);
  const rarityStr = item.rarity.map((r) => `${rarityEmoji(r)} ${r}`).join(" · ") || "—";
  const tagStr = item.tags.map((t) => `${tagEmoji(t)} ${t}`).join(" · ") || "—";
  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setColor(0x9b59b6)
    .setDescription(item.description || "No description available.")
    .addFields([
      { name: "💰 Value", value: valueStr, inline: true },
      { name: "⭐ Rarity", value: rarityStr, inline: true },
      { name: "📊 Demand", value: item.demand != null ? `${item.demand}/10` : "—", inline: true },
      { name: "🛠️ Functionality", value: item.functionality != null ? `${item.functionality}/10` : "—", inline: true },
      { name: "🏷️ Tags", value: tagStr, inline: true },
      { name: "📈 Avg Value", value: getMTTVAverageValue(item).toLocaleString(), inline: true },
    ]);
  if (item.image) {
    embed.setImage(item.image);
  }
  return embed;
}

function itemNameAcronym(item: MTTVItem): string {
  return item.name
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
}

export function matchScore(item: MTTVItem, query: string): number {
  const q = query.toLowerCase().trim().replace(/\s+/g, " ");
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const name = item.name.toLowerCase();
  const desc = item.description.toLowerCase();
  const rarity = item.rarity.map((r) => r.toLowerCase());
  const tags = item.tags.map((t) => t.toLowerCase());
  const compactName = name.replace(/[^a-zA-Z0-9]/g, "");
  const acronym = itemNameAcronym(item);

  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    let tokenScore = 0;

    if (name === token) tokenScore = 100;
    else if (name.startsWith(token + " ")) tokenScore = 80;
    else if (name.includes(token)) tokenScore = 60;
    else if (compactName.includes(token)) tokenScore = 50;
    else if (acronym.includes(token)) tokenScore = 45;
    else if (desc.includes(token)) tokenScore = 30;
    else if (rarity.some((r) => r.includes(token))) tokenScore = 20;
    else if (tags.some((t) => t.includes(token))) tokenScore = 20;

    score += tokenScore;
  }

  score += (item.valueMax ?? item.valueMin ?? 0) / 1_000_000;
  return score;
}

export async function handleInfoMTTV(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = interaction.options.getString("item", true);
  const items = await fetchMTTVItems();
  let item = items.find(
    (i) => i.name.toLowerCase() === name.trim().toLowerCase(),
  );

  if (!item) {
    const scored = items
      .map((i) => ({ i, score: matchScore(i, name) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    item = scored[0]?.i;
  }

  if (!item) {
    await interaction.editReply(`❌ Could not find "${name}" on MTTV. Use /valuelist to browse items or /calc to compare values.`);
    return;
  }

  await interaction.editReply({ embeds: [buildMTTVItemEmbed(item)] });
}

const CREATE_CARD_RARITIES = new Set<string>(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);

function createCardRarityDefaults(rarity: Rarity): { worth: number; burn: number; weight: number } {
  return {
    worth: RARITY_WORTH[rarity],
    burn: RARITY_BURN[rarity],
    weight: RARITY_WEIGHTS[rarity],
  };
}

export async function handleCreateCardFromMTTV(interaction: ChatInputCommandInteraction): Promise<void> {
  // Caller (admin.ts) has already deferred the reply.
  const guildId = interaction.guildId!;
  const itemName = interaction.options.getString("item", true).trim();
  const rarityInput = interaction.options.getString("rarity", true);
  const type = interaction.options.getString("type", true).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
  const setName = interaction.options.getString("set")?.trim();
  const descriptionOverride = interaction.options.getString("description") ?? "";
  const limited = interaction.options.getBoolean("limited") ?? false;
  const maxCopies = interaction.options.getInteger("max_copies") ?? undefined;
  const eventExclusive = interaction.options.getBoolean("event_exclusive") ?? false;

  if (!type) {
    await interaction.editReply("❌ Card type cannot be empty. Enter a type/tag such as `tank`, `aircraft`, or `nuke`.");
    return;
  }

  if (!CREATE_CARD_RARITIES.has(rarityInput)) {
    await interaction.editReply("❌ Pick one of the built-in rarities from autocomplete.");
    return;
  }
  const baseRarity = rarityInput as Rarity;
  const defs = createCardRarityDefaults(baseRarity);

  let item: MTTVItem | undefined;
  try {
    const items = await fetchMTTVItems();
    item = items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
    if (!item) {
      const scored = items
        .map((i) => ({ i, score: matchScore(i, itemName) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      item = scored[0]?.i;
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch MTTV items for create_card_from_mttv");
    await interaction.editReply("❌ Could not reach MTTV. Try again later.");
    return;
  }

  if (!item) {
    await interaction.editReply(`❌ Could not find MTTV item "${itemName}". Use /info_mttv to search first.`);
    return;
  }

  const existing = await getCardByName(item.name, guildId);
  if (existing) {
    await interaction.editReply(
      `❌ A card named **${item.name}** already exists (ID #${existing.id}). ` +
      `Use \`/edit_card\` to modify it.`,
    );
    return;
  }

  const imageUrl = item.image ? await persistBotImage(item.image) : undefined;

  const card = await addCard({
    name: item.name,
    rarity: baseRarity,
    cardType: type,
    description: descriptionOverride || item.description || "",
    imageUrl,
    worthValue: defs.worth,
    burnValue: defs.burn,
    dropWeight: defs.weight,
    isLimitedEdition: limited,
    maxCopies: limited ? (maxCopies ?? 50) : undefined,
    isEventExclusive: eventExclusive,
    droppable: !eventExclusive,
    inPacks: !eventExclusive && baseRarity !== "mythic",
  }, guildId);

  let setNote = "";
  if (setName) {
    const set = await getSetByName(setName, guildId);
    if (set) {
      await addCardToSet(set.id, card.id, guildId);
      setNote = ` and added to set \`${set.name}\``;
    } else {
      setNote = ` (set \`${setName}\` was not found, so no set was assigned)`;
    }
  }

  await renderPanel(interaction, card.id, false, `✅ Created **${card.name}** from MTTV (${baseRarity})${setNote} — tweak any field below`);
}

export async function handleValueList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const items = await fetchMTTVItems();
  const sorted = items
    .slice()
    .sort((a, b) => (b.valueMax ?? 0) - (a.valueMax ?? 0) || (b.valueMin ?? 0) - (a.valueMin ?? 0));
  const toShow = sorted.slice(0, 15);

  const lines = toShow.map(
    (item, i) =>
      `**${i + 1}.** ${item.name}\n` +
      `  💰 ${formatMTTVValue(item)} · ${item.rarity.map(rarityEmoji).join("") || "—"} · Demand: ${item.demand ?? "—"}/10`,
  );

  const embed = new EmbedBuilder()
    .setTitle("📋 MTTV Values — Top Items by Value")
    .setDescription(lines.join("\n\n"))
    .setColor(0x9b59b6)
    .setFooter({ text: `Showing 15 of ${items.length} items · Prices from MTTV` });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleValueHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const embed = new EmbedBuilder()
    .setTitle("❓ MTTV Value Help")
    .setColor(0x9b59b6)
    .setDescription(
      "MTTV (Military Tycoon Trading Values) tracks community prices for Military Tycoon items.\n\n" +
      "**What the numbers mean:**\n" +
      "• 💰 **Value** — the typical trade value range for the item.\n" +
      "• ⭐ **Rarity** — how hard the item is to obtain.\n" +
      "• 📊 **Demand** — how wanted the item is right now (1–10).\n" +
      "• 🛠️ **Functionality** — how useful the item is in-game (1–10).\n" +
      "• 🏷️ **Tags** — market trends like `rising`, `dropping`, `stable`, `meta`.\n\n" +
      "**Commands:**\n" +
      "• `/info_mttv name:<item>` — full details for one item.\n" +
      "• `/calc` — MTTV trade calculator with two offer sides.\n" +
      "• `/valuelist` — top items by value.\n\n" +
      "All prices are pulled live from MTTV.",
    )
    .setFooter({ text: "Prices from MTTV" });
  await interaction.editReply({ embeds: [embed] });
}

// ── MTTV Trade Calculator ───────────────────────────────────────────────────
// Mirrors the posted calculator (/postcalculator) but stays fully private.
// Two offer sides, star bonuses, low/mid/high tier picks, and a 5%-threshold
// fair/win/loss verdict. Item lookup uses the same fuzzy search as /info_mttv.

const STAR_VALUE: Record<number, number> = { 1: 0, 2: 1000, 3: 10000, 4: 35000, 5: 75000 };

export type CalcTier = "low" | "mid" | "high";

export type CalcItem = {
  item: MTTVItem;
  quantity: number;
  tier: CalcTier;
  stars: number;
};

type CalcState = {
  yourItems: CalcItem[];
  theirItems: CalcItem[];
  lastSearch: { your: MTTVItem[] | null; their: MTTVItem[] | null };
  ownerUserId: string;
  channelId: string;
  messageId: string;
};

const calcStates = new Map<string, CalcState>();
const calcTimers = new Map<string, ReturnType<typeof setTimeout>>();

const CALC_CUSTOM_ID_PREFIX = "mtcalc";
const MAX_CALC_ITEMS = 3;
const CALC_TIER_CHOICES: CalcTier[] = ["low", "mid", "high"];
const CALC_STAR_LABELS = ["", "⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"];
const CALC_EMPTY_SIDE = "*No items yet — press Add Item*";

export function calcItemValue(c: CalcItem): number {
  const min = c.item.valueMin ?? c.item.valueMax ?? 0;
  const max = c.item.valueMax ?? c.item.valueMin ?? 0;
  let base = 0;
  if (c.tier === "low") base = min;
  else if (c.tier === "high") base = max;
  else base = Math.round((min + max) / 2);
  return Math.max(0, base + STAR_VALUE[c.stars]) * c.quantity;
}

export function calcWeightedDemand(items: CalcItem[]): number | null {
  let valueSum = 0;
  let demandSum = 0;
  let demandCount = 0;
  for (const c of items) {
    const v = calcItemValue(c);
    valueSum += v;
    if (c.item.demand != null) {
      demandSum += c.item.demand * v;
      demandCount += v;
    }
  }
  if (valueSum === 0) {
    let count = 0;
    let total = 0;
    for (const c of items) {
      if (c.item.demand != null) {
        total += c.item.demand;
        count++;
      }
    }
    return count > 0 ? total / count : null;
  }
  return demandCount > 0 ? demandSum / demandCount : null;
}

export function calcSideValue(items: CalcItem[]): number {
  return items.reduce((sum, c) => sum + calcItemValue(c), 0);
}

export function shortValue(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`.replace(/\.00B$/, "B");
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`.replace(/\.00M$/, "M");
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1_000).toLocaleString()}K`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`.replace(/\.0K$/, "K");
  return n.toLocaleString();
}

function calcItemLine(c: CalcItem): string {
  const val = calcItemValue(c);
  const rarity = c.item.rarity.map(rarityEmoji).join("") || "—";
  const starText = c.stars > 1 ? ` ${CALC_STAR_LABELS[c.stars]}` : "";
  const tierText = c.tier !== "mid" ? ` · ${c.tier}` : "";
  const qtyText = c.quantity > 1 ? ` x${c.quantity}` : "";
  return `${rarity} ${c.item.name}${qtyText}${tierText}${starText} — 💎 ${shortValue(val)}`;
}

function buildCalcPreview(state: CalcState, description?: string): EmbedBuilder {
  const yourLines = state.yourItems.length > 0 ? state.yourItems.map(calcItemLine).join("\n") : CALC_EMPTY_SIDE;
  const theirLines = state.theirItems.length > 0 ? state.theirItems.map(calcItemLine).join("\n") : CALC_EMPTY_SIDE;
  const yourTotal = calcSideValue(state.yourItems);
  const theirTotal = calcSideValue(state.theirItems);
  const yourDemand = calcWeightedDemand(state.yourItems);
  const theirDemand = calcWeightedDemand(state.theirItems);

  return new EmbedBuilder()
    .setTitle("🧮 MTTV Trade Calculator")
    .setColor(0x74cdd8)
    .setDescription(
      (description ? `${description}\n\n` : "") +
      `**Your offer** — 💎 ${shortValue(yourTotal)}${yourDemand != null ? ` · Demand ${yourDemand.toFixed(1)}/10` : ""}\n${yourLines}\n\n` +
      `**Their offer** — 💎 ${shortValue(theirTotal)}${theirDemand != null ? ` · Demand ${theirDemand.toFixed(1)}/10` : ""}\n${theirLines}`,
    )
    .setFooter({ text: "Prices from MTTV · each user has their own private session" });
}

function buildCalcMainComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:your`).setLabel("🙂 Your Items").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:their`).setLabel("🤝 Their Items").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:calc`).setLabel("🧮 Calculate").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:clear`).setLabel("🗑️ Clear").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildCalcManageComponents(
  side: "your" | "their",
  canAdd: boolean,
  hasItems: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const main = new ActionRowBuilder<ButtonBuilder>();
  if (canAdd) {
    main.addComponents(new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:add:${side}`).setLabel("➕ Add Item").setStyle(ButtonStyle.Primary));
  }
  if (hasItems) {
    main.addComponents(
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:remove:${side}`).setLabel("🗑️ Remove").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:edit:${side}`).setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
    );
  }
  main.addComponents(new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:clear:${side}`).setLabel("🚫 Clear All").setStyle(ButtonStyle.Danger));
  rows.push(main);
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:back`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildCalcItemListComponents(
  side: "your" | "their",
  items: CalcItem[],
  action: "remove" | "edit",
): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  items.forEach((c, idx) => {
    const label = `${action === "remove" ? "🗑️" : "✏️"} ${idx + 1}. ${c.item.name.slice(0, 30)}`.slice(0, 80);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CALC_CUSTOM_ID_PREFIX}:${action}:${side}:${idx}`)
        .setLabel(label)
        .setStyle(action === "remove" ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
  });
  return [
    row,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:back:${side}`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildCalcEditComponents(
  side: "your" | "their",
  idx: number,
  item: CalcItem,
): ActionRowBuilder<ButtonBuilder>[] {
  const base = `${side}:${idx}`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:qty:${base}:label`).setLabel(`Qty: ${item.quantity}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:qty:${base}:inc`).setLabel("➕").setStyle(ButtonStyle.Primary).setDisabled(item.quantity >= 99),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:qty:${base}:dec`).setLabel("➖").setStyle(ButtonStyle.Primary).setDisabled(item.quantity <= 1),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...CALC_TIER_CHOICES.map(tier =>
        new ButtonBuilder()
          .setCustomId(`${CALC_CUSTOM_ID_PREFIX}:tier:${base}:${tier}`)
          .setLabel(tier === item.tier ? `✓ ${tier}` : tier)
          .setStyle(tier === item.tier ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...([1, 2, 3, 4, 5] as const).map(stars =>
        new ButtonBuilder()
          .setCustomId(`${CALC_CUSTOM_ID_PREFIX}:stars:${base}:${stars}`)
          .setLabel(stars === item.stars ? `✓ ${CALC_STAR_LABELS[stars]}` : CALC_STAR_LABELS[stars])
          .setStyle(stars === item.stars ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:back:${side}`).setLabel("↩️ Done").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:remove:${side}:${idx}`).setLabel("🗑️ Delete this item").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildCalcSearchResultComponents(
  side: "your" | "their",
  results: MTTVItem[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let current = new ActionRowBuilder<ButtonBuilder>();
  results.forEach((item, idx) => {
    const rarity = item.rarity.map(rarityEmoji).join("") || "—";
    const label = `${rarity} ${item.name.slice(0, 80)}`.slice(0, 80);
    if (current.components.length >= 5) {
      rows.push(current);
      current = new ActionRowBuilder<ButtonBuilder>();
    }
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CALC_CUSTOM_ID_PREFIX}:pick:${side}:${idx}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary),
    );
  });
  if (current.components.length > 0) rows.push(current);
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CALC_CUSTOM_ID_PREFIX}:back:${side}`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildCalcAddModal(side: "your" | "their"): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CALC_CUSTOM_ID_PREFIX}_modal:${side}`)
    .setTitle(side === "your" ? "Add to your offer" : "Add to their offer");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Item name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder("e.g. Super Tiger Mech or Exotic..."),
    ),
  );
  return modal;
}

function calcSideField(state: CalcState, side: "your" | "their") {
  return side === "your" ? state.yourItems : state.theirItems;
}

function isCalcOwner(interaction: ButtonInteraction | ModalSubmitInteraction, state: CalcState): boolean {
  return interaction.user.id === state.ownerUserId;
}

async function denyUnauthorized(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
  const payload: InteractionReplyOptions = {
    content: "❌ This calculator belongs to someone else. Use your own `/calc`.",
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

function resetCalcTimer(state: CalcState): void {
  const existing = calcTimers.get(state.messageId);
  if (existing) clearTimeout(existing);
  calcTimers.set(
    state.messageId,
    setTimeout(() => {
      calcStates.delete(state.messageId);
      calcTimers.delete(state.messageId);
    }, CALC_STATE_TTL_MS),
  );
}

export async function handleCalc(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.channel) {
    await interaction.reply({ content: "❌ This command must be used in a server channel.", flags: MessageFlags.Ephemeral });
    return;
  }
  const state: CalcState = {
    yourItems: [],
    theirItems: [],
    lastSearch: { your: null, their: null },
    ownerUserId: interaction.user.id,
    channelId: interaction.channel.id,
    messageId: "",
  };
  const embed = new EmbedBuilder()
    .setTitle("🧮 MTTV Trade Calculator")
    .setColor(0x74cdd8)
    .setDescription(
      "Use the buttons below to build your trade offer.\n\n" +
      "• **Your Items** — add items you are giving\n" +
      "• **Their Items** — add items you are receiving\n" +
      "• **Calculate** — see your result privately\n" +
      "• **Clear** — reset your session",
    )
    .setFooter({ text: "Prices from MTTV · each user has their own private session" });
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [embed],
    components: buildCalcMainComponents(),
  });
  const messageId = (await interaction.fetchReply()).id;
  state.messageId = messageId;
  calcStates.set(messageId, state);
  resetCalcTimer(state);
}

export async function handleMTTVCalcButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const messageId = interaction.message.id;
  const state = calcStates.get(messageId);
  if (!state || !isCalcOwner(interaction, state)) {
    await denyUnauthorized(interaction);
    return;
  }

  if (action === "your" || action === "their") {
    const side = action as "your" | "their";
    const items = calcSideField(state, side);
    await interaction.update({
      embeds: [buildCalcPreview(state, `Managing **${side === "your" ? "Your" : "Their"}** items.`)],
      components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
    }).catch(() => {});
    resetCalcTimer(state);
    return;
  }

  if (action === "add") {
    const side = parts[2] as "your" | "their";
    if (!side) return;
    await interaction.showModal(buildCalcAddModal(side));
    return;
  }

  await interaction.deferUpdate();

  if (action === "clear") {
    const side = parts[2] as "your" | "their" | undefined;
    if (side) {
      if (side === "your") state.yourItems = [];
      else state.theirItems = [];
      const items = calcSideField(state, side);
      await interaction.editReply({
        embeds: [buildCalcPreview(state, `🧹 Cleared **${side === "your" ? "Your" : "Their"}** items.`)],
        components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
      });
    } else {
      state.yourItems = [];
      state.theirItems = [];
      await interaction.editReply({
        embeds: [buildCalcPreview(state, "🧹 Session reset.")],
        components: buildCalcMainComponents(),
      });
    }
    resetCalcTimer(state);
    return;
  }

  if (action === "back") {
    const side = parts[2] as "your" | "their" | undefined;
    if (side) {
      const items = calcSideField(state, side);
      await interaction.editReply({
        embeds: [buildCalcPreview(state, `Managing **${side === "your" ? "Your" : "Their"}** items.`)],
        components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
      });
    } else {
      await interaction.editReply({
        embeds: [buildCalcPreview(state)],
        components: buildCalcMainComponents(),
      });
    }
    resetCalcTimer(state);
    return;
  }

  if (action === "calc") {
    const yourTotal = calcSideValue(state.yourItems);
    const theirTotal = calcSideValue(state.theirItems);
    const diff = yourTotal - theirTotal;
    const rel = Math.abs(diff) / Math.max(yourTotal, theirTotal, 1);
    let verdict: string;
    let color: number;
    if (yourTotal === 0 && theirTotal === 0) {
      verdict = "➖ Add items to both sides and press **Calculate**";
      color = 0x74cdd8;
    } else if (rel <= 0.05) {
      verdict = "⚖️ Fair trade";
      color = 0x95a5a6;
    } else if (diff > 0) {
      verdict = `🔴 You lose — their offer is short by 💎 ${shortValue(Math.abs(diff))}`;
      color = 0xe74c3c;
    } else {
      verdict = `🟢 You win — your offer is short by 💎 ${shortValue(Math.abs(diff))}`;
      color = 0x2ecc71;
    }

    const yourDemand = calcWeightedDemand(state.yourItems);
    const theirDemand = calcWeightedDemand(state.theirItems);
    const yourLines = state.yourItems.length > 0 ? state.yourItems.map(calcItemLine).join("\n") : CALC_EMPTY_SIDE;
    const theirLines = state.theirItems.length > 0 ? state.theirItems.map(calcItemLine).join("\n") : CALC_EMPTY_SIDE;
    const resultEmbed = new EmbedBuilder()
      .setTitle("🧮 MTTV Trade Calculator — Result")
      .setColor(color)
      .setDescription(
        `**Your offer** — 💎 ${shortValue(yourTotal)}${yourDemand != null ? ` · Demand ${yourDemand.toFixed(1)}/10` : ""}\n${yourLines}\n\n` +
        `**Their offer** — 💎 ${shortValue(theirTotal)}${theirDemand != null ? ` · Demand ${theirDemand.toFixed(1)}/10` : ""}\n${theirLines}\n\n` +
        `**Verdict:** ${verdict}`,
      )
      .setFooter({ text: "Prices from MTTV · each user has their own private session" });

    await interaction.editReply({
      embeds: [resultEmbed],
      components: buildCalcMainComponents(),
    });
    resetCalcTimer(state);
    return;
  }

  const side = parts[2] as "your" | "their";
  if (!side) return;
  const items = calcSideField(state, side);

  if (action === "remove" || action === "edit") {
    const idx = parts[3] ? parseInt(parts[3], 10) : NaN;
    if (Number.isNaN(idx)) {
      if (items.length === 0) {
        await interaction.editReply({
          embeds: [buildCalcPreview(state, "No items to modify on this side.")],
          components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
        });
        return;
      }
      await interaction.editReply({
        embeds: [buildCalcPreview(state, `Select an item to **${action === "remove" ? "remove" : "edit"}**.`)],
        components: buildCalcItemListComponents(side, items, action),
      });
      resetCalcTimer(state);
      return;
    }
    if (idx < 0 || idx >= items.length) {
      await interaction.editReply({
        embeds: [buildCalcPreview(state, "⚠️ That item no longer exists. Pick another.")],
        components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
      });
      resetCalcTimer(state);
      return;
    }
    if (action === "remove") {
      items.splice(idx, 1);
      await interaction.editReply({
        embeds: [buildCalcPreview(state, "🗑️ Item removed.")],
        components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
      });
      resetCalcTimer(state);
      return;
    }
    // edit
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `Editing **${items[idx].item.name}**.`)],
      components: buildCalcEditComponents(side, idx, items[idx]),
    });
    resetCalcTimer(state);
    return;
  }

  if (action === "pick") {
    const idx = parseInt(parts[3], 10);
    const result = state.lastSearch[side]?.[idx];
    if (!result) {
      await interaction.editReply({
        embeds: [buildCalcPreview(state, "⚠️ Search result expired. Try again.")],
        components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
      });
      resetCalcTimer(state);
      return;
    }
    if (items.length >= MAX_CALC_ITEMS) {
      await interaction.editReply({
        embeds: [buildCalcPreview(state, `❌ You can only add up to ${MAX_CALC_ITEMS} items per side.`)],
        components: buildCalcManageComponents(side, false, items.length > 0),
      });
      resetCalcTimer(state);
      return;
    }
    items.push({ item: result, quantity: 1, tier: "mid", stars: 1 });
    state.lastSearch[side] = null;
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `✅ Added **${result.name}**. Adjust quantity/tier/stars below or add another.`)],
      components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
    });
    resetCalcTimer(state);
    return;
  }

  if (action === "qty" || action === "tier" || action === "stars") {
    const idx = parseInt(parts[3], 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= items.length) return;
    const item = items[idx];
    if (action === "qty") {
      const delta = parts[4] === "inc" ? 1 : -1;
      item.quantity = Math.max(1, Math.min(99, item.quantity + delta));
    } else if (action === "tier") {
      const tier = parts[4] as CalcTier;
      if (CALC_TIER_CHOICES.includes(tier)) item.tier = tier;
    } else if (action === "stars") {
      const stars = parseInt(parts[4], 10);
      if (!Number.isNaN(stars) && stars >= 1 && stars <= 5) item.stars = stars;
    }
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `Editing **${item.item.name}**.`)],
      components: buildCalcEditComponents(side, idx, item),
    });
    resetCalcTimer(state);
    return;
  }
}

export async function handleMTTVCalcModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const side = parts[1] as "your" | "their";
  const messageId = interaction.message?.id;
  if (!messageId) return;

  const state = calcStates.get(messageId);
  if (!state || !isCalcOwner(interaction, state)) {
    await denyUnauthorized(interaction);
    return;
  }
  const nameRaw = interaction.fields.getTextInputValue("name").trim();
  const items = calcSideField(state, side);

  if (items.length >= MAX_CALC_ITEMS) {
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `❌ You can only add up to ${MAX_CALC_ITEMS} items per side.`)],
      components: buildCalcManageComponents(side, false, items.length > 0),
    });
    resetCalcTimer(state);
    return;
  }

  let allItems: MTTVItem[];
  try {
    allItems = await fetchMTTVItems();
  } catch {
    await interaction.editReply({
      embeds: [buildCalcPreview(state, "❌ Could not fetch MTTV items. Please try again.")],
      components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
    });
    resetCalcTimer(state);
    return;
  }

  const exact = allItems.find(i => i.name.toLowerCase() === nameRaw.toLowerCase());
  if (exact) {
    items.push({ item: exact, quantity: 1, tier: "mid", stars: 1 });
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `✅ Added **${exact.name}**.`)],
      components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
    });
    resetCalcTimer(state);
    return;
  }

  const scored = allItems
    .map(i => ({ i, score: matchScore(i, nameRaw) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (scored.length === 0) {
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `❌ No items matched "${nameRaw}". Try a different name or acronym.`)],
      components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
    });
    resetCalcTimer(state);
    return;
  }

  if (scored.length === 1) {
    const match = scored[0].i;
    items.push({ item: match, quantity: 1, tier: "mid", stars: 1 });
    await interaction.editReply({
      embeds: [buildCalcPreview(state, `✅ Added **${match.name}**.`)],
      components: buildCalcManageComponents(side, items.length < MAX_CALC_ITEMS, items.length > 0),
    });
    resetCalcTimer(state);
    return;
  }

  state.lastSearch[side] = scored.map(s => s.i);
  const lines = scored.map((s, i) => {
    const rarity = s.i.rarity.map(rarityEmoji).join("") || "—";
    return `${i + 1}. ${rarity} **${s.i.name}** · 💰 ${formatMTTVValue(s.i)}`;
  }).join("\n");

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔍 Select an item")
        .setColor(0x9b59b6)
        .setDescription(`Search results for "${nameRaw}":\n${lines}`)
        .setFooter({ text: "Prices from MTTV" }),
    ],
    components: buildCalcSearchResultComponents(side, scored.map(s => s.i)),
  });
  resetCalcTimer(state);
}

export async function handleMTTVAutocomplete(
  interaction: AutocompleteInteraction,
  focused: { name: string; value: string },
): Promise<void> {
  if (focused.name !== "item") {
    await interaction.respond([]);
    return;
  }
  const q = focused.value.trim();
  try {
    const items = await fetchMTTVItems();
    const matches = items
      .map((i) => ({ i, score: matchScore(i, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((i) => ({ name: i.i.name, value: i.i.name }));
    await interaction.respond(matches);
  } catch {
    await interaction.respond([]);
  }
}
