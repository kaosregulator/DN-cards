import { ChatInputCommandInteraction, AutocompleteInteraction, EmbedBuilder, MessageFlags } from "discord.js";
import { logger } from "../../lib/logger.js";

// MTTValues.com data source via public Firebase REST API
const FIRESTORE_API_URL =
  "https://firestore.googleapis.com/v1/projects/military-tycoon-trading-values/databases/(default)/documents/items?key=AIzaSyDjB8PzhaPVn4sUwAUbrLbcxHZWMr3QFh0&pageSize=100";

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

async function fetchItems(): Promise<MTTItem[]> {
  const now = Date.now();
  if (cache && cacheExpiresAt > now) {
    return cache;
  }

  try {
    const resp = await fetch(FIRESTORE_API_URL, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json() as { documents?: Array<{ name: string; fields?: Record<string, unknown> }> };
    const docs = data.documents ?? [];

    const items: MTTItem[] = docs.map((doc) => {
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
    });

    cache = items;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return items;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to fetch MTTValues data");
    throw new Error("Could not load MTTValues data. The site might be temporarily unavailable.");
  }
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

export async function handleMTTValuesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === "search") {
    const query = interaction.options.getString("query", false) ?? "";
    const items = await fetchItems();

    let results = items;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      results = items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.rarity.some((r) => r.toLowerCase().includes(q)) ||
          item.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    if (results.length === 0) {
      await interaction.reply({
        content: `🔍 No MTTValues items found for "${query}". Try a different keyword or use \/mttvalues list to browse all items.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // If only one result, show full details
    if (results.length === 1) {
      await interaction.reply({
        embeds: [buildItemEmbed(results[0])],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Sort by value (max first, then min) and show top 10
    const sorted = results
      .slice()
      .sort((a, b) => (b.valueMax ?? 0) - (a.valueMax ?? 0) || (b.valueMin ?? 0) - (a.valueMin ?? 0));
    const toShow = sorted.slice(0, 10);

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

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "info") {
    const name = interaction.options.getString("name", true);
    const items = await fetchItems();
    const item = items.find(
      (i) => i.name.toLowerCase() === name.trim().toLowerCase(),
    );

    if (!item) {
      await interaction.reply({
        content: `❌ Could not find "${name}" on MTTValues. Use \/mttvalues search to find it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [buildItemEmbed(item)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "❌ Unknown subcommand. Use `search`, `list`, or `info`.",
    flags: MessageFlags.Ephemeral,
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
  const q = focused.value.trim().toLowerCase();
  try {
    const items = await fetchItems();
    const matches = items
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((i) => ({ name: i.name, value: i.name }));
    await interaction.respond(matches);
  } catch {
    await interaction.respond([]);
  }
}
