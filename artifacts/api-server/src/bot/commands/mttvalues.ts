import { ChatInputCommandInteraction, AutocompleteInteraction, EmbedBuilder, MessageFlags, type InteractionReplyOptions, type BaseMessageOptions } from "discord.js";
import { logger } from "../../lib/logger.js";

// MTTValues.com data source via public Firebase REST API
const FIRESTORE_API_KEY = "AIzaSyDjB8PzhaPVn4sUwAUbrLbcxHZWMr3QFh0";
const FIRESTORE_API_URL =
  `https://firestore.googleapis.com/v1/projects/military-tycoon-trading-values/databases/(default)/documents/items?key=${FIRESTORE_API_KEY}&pageSize=100`;

const REPLY_DELETE_MS = 40_000; // ephemeral replies vanish after 40 seconds

type MTTItem = {
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

let cache: MTTItem[] | null = null;
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

function parseDoc(doc: { name: string; fields?: Record<string, unknown> }): MTTItem {
  const fields = doc.fields ?? {};
  const valueMin = getFieldInt(fields, "valueMin");
  const valueMax = getFieldInt(fields, "valueMax");
  return {
    id: doc.name.split("/").pop() ?? "",
    name: getFieldValue(fields, "name") ?? "Unknown",
    valueMin,
    valueMax,
    rarity: getFieldArray(fields, "rarity"),
    demand: getFieldInt(fields, "demand"),
    functionality: getFieldInt(fields, "functionality"),
    tags: getFieldArray(fields, "tags"),
    description: getFieldValue(fields, "description") ?? "",
    image: getFieldValue(fields, "image"),
  };
}

async function fetchItems(): Promise<MTTItem[]> {
  const now = Date.now();
  if (cache && cacheExpiresAt > now) {
    return cache;
  }

  try {
    const allDocs: Array<{ name: string; fields?: Record<string, unknown> }> = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = 50; // Firestore pageSize=100 → up to 5,000 docs before warning

    do {
      const url = pageToken
        ? `${FIRESTORE_API_URL}&pageToken=${encodeURIComponent(pageToken)}`
        : FIRESTORE_API_URL;
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
      logger.warn({ fetched: allDocs.length }, "MTTValues collection may exceed pagination safety cap; some items not loaded");
    }

    const items = allDocs.map(parseDoc);
    cache = items;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return items;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to fetch MTTValues data");
    throw new Error("Could not load MTTValues data. The site might be temporarily unavailable.");
  }
}

// Ephemeral reply visible only to the command user, then deleted after 40 seconds.
async function ephemeralReply(
  interaction: ChatInputCommandInteraction,
  payload: InteractionReplyOptions & BaseMessageOptions,
): Promise<void> {
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  setTimeout(() => interaction.deleteReply().catch(() => {}), REPLY_DELETE_MS);
}

function formatValue(item: MTTItem): string {
  if (item.valueMin == null && item.valueMax == null) return "?";
  if (item.valueMin === item.valueMax) return item.valueMin?.toLocaleString() ?? "?";
  if (item.valueMin == null) return item.valueMax?.toLocaleString() ?? "?";
  if (item.valueMax == null) return item.valueMin.toLocaleString();
  return `${item.valueMin.toLocaleString()} – ${item.valueMax.toLocaleString()}`;
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

function buildItemEmbed(item: MTTItem): EmbedBuilder {
  const valueStr = formatValue(item);
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
    ]);
  if (item.image) {
    embed.setImage(item.image);
  }
  return embed;
}

function itemNameAcronym(item: MTTItem): string {
  return item.name
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
}

function matchScore(item: MTTItem, query: string): number {
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

    // Exact or prefix match in the name is the strongest signal.
    if (name === token) tokenScore = 100;
    else if (name.startsWith(token + " ")) tokenScore = 80;
    else if (name.includes(token)) tokenScore = 60;
    else if (compactName.includes(token)) tokenScore = 50;
    else if (acronym.includes(token)) tokenScore = 45; // e.g. "stm" -> "Super Tiger Mech"
    else if (desc.includes(token)) tokenScore = 30;
    else if (rarity.some((r) => r.includes(token))) tokenScore = 20;
    else if (tags.some((t) => t.includes(token))) tokenScore = 20;

    score += tokenScore;
  }

  // Slight bonus for higher-value items among equal textual matches.
  score += (item.valueMax ?? item.valueMin ?? 0) / 1_000_000;
  return score;
}

export async function handleMTTValuesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === "search") {
    const query = interaction.options.getString("query", false) ?? "";
    const items = await fetchItems();

    let results = items;
    if (query.trim()) {
      const scored = items
        .map((item) => ({ item, score: matchScore(item, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      results = scored.map((s) => s.item);
    } else {
      // Blank query = list all by value, same as /mttvalues list but capped at 10.
      results = items
        .slice()
        .sort((a, b) => (b.valueMax ?? 0) - (a.valueMax ?? 0) || (b.valueMin ?? 0) - (a.valueMin ?? 0));
    }

    if (results.length === 0) {
      await ephemeralReply(interaction, {
        content: `🔍 No MTTValues items found for "${query}". Try a different keyword or use \/mttvalues list to browse all items.`,
      });
      return;
    }

    // If only one result, show full details
    if (results.length === 1) {
      await ephemeralReply(interaction, { embeds: [buildItemEmbed(results[0])] });
      return;
    }

    // Show top 10 matches by relevance score (value already contributes a tiny tie-break).
    const toShow = results.slice(0, 10);

    const lines = toShow.map(
      (item, i) =>
        `**${i + 1}.** ${item.name}\n  💰 ${formatValue(item)} · ${item.rarity.map(rarityEmoji).join("") || "—"} · Demand: ${item.demand ?? "—"}/10`,
    );

    const embed = new EmbedBuilder()
      .setTitle(`🔍 MTTValues — ${query ? `"${query}"` : "All items"}`)
      .setDescription(lines.join("\n\n"))
      .setColor(0x9b59b6)
      .setFooter({
        text: `Showing ${toShow.length} of ${results.length} result${results.length === 1 ? "" : "s"} · Data from mttvalues.com`,
      });

    await ephemeralReply(interaction, { embeds: [embed] });
    return;
  }

  if (subcommand === "list") {
    const items = await fetchItems();
    const sorted = items
      .slice()
      .sort((a, b) => (b.valueMax ?? 0) - (a.valueMax ?? 0) || (b.valueMin ?? 0) - (a.valueMin ?? 0));
    const toShow = sorted.slice(0, 15);

    const lines = toShow.map(
      (item, i) =>
        `**${i + 1}.** ${item.name}\n  💰 ${formatValue(item)} · ${item.rarity.map(rarityEmoji).join("") || "—"} · Demand: ${item.demand ?? "—"}/10`,
    );

    const embed = new EmbedBuilder()
      .setTitle("📋 MTTValues — All Items (Top 15 by Value)")
      .setDescription(lines.join("\n\n"))
      .setColor(0x9b59b6)
      .setFooter({ text: `Showing 15 of ${items.length} items · Data from mttvalues.com` });

    await ephemeralReply(interaction, { embeds: [embed] });
    return;
  }

  if (subcommand === "info") {
    const name = interaction.options.getString("name", true);
    const items = await fetchItems();
    const exact = items.find((i) => i.name.toLowerCase() === name.trim().toLowerCase());

    let item = exact;
    if (!item) {
      // Fallback: fuzzy match; highest textual score wins.
      const scored = items
        .map((i) => ({ i, score: matchScore(i, name) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      item = scored[0]?.i;
    }

    if (!item) {
      await ephemeralReply(interaction, {
        content: `❌ Could not find "${name}" on MTTValues. Use \/mttvalues search to find it.`,
      });
      return;
    }

    await ephemeralReply(interaction, { embeds: [buildItemEmbed(item)] });
    return;
  }

  await ephemeralReply(interaction, {
    content: "❌ Unknown subcommand. Use `search`, `list`, or `info`.",
  });
}

export async function handleMTTValuesAutocomplete(
  interaction: AutocompleteInteraction,
  focused: { name: string; value: string },
): Promise<void> {
  if (focused.name !== "name") {
    await interaction.respond([]);
    return;
  }
  const q = focused.value.trim();
  try {
    const items = await fetchItems();
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
