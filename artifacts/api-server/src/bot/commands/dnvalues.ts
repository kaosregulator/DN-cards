import {
  ChatInputCommandInteraction, AutocompleteInteraction, EmbedBuilder, MessageFlags,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction, type TextChannel,
  type InteractionReplyOptions, type BaseMessageOptions,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getBotClient } from "../client-holder.js";

// DN.com data source via public Firebase REST API
const FIRESTORE_API_KEY = "AIzaSyDjB8PzhaPVn4sUwAUbrLbcxHZWMr3QFh0";
const FIRESTORE_API_URL =
  `https://firestore.googleapis.com/v1/projects/military-tycoon-trading-values/databases/(default)/documents/items?key=${FIRESTORE_API_KEY}&pageSize=100`;

const REPLY_DELETE_MS = 40_000; // ephemeral replies vanish after 40 seconds

type DNItem = {
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

let cache: DNItem[] | null = null;
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

function parseDoc(doc: { name: string; fields?: Record<string, unknown> }): DNItem {
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

async function fetchItems(): Promise<DNItem[]> {
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
      logger.warn({ fetched: allDocs.length }, "DN collection may exceed pagination safety cap; some items not loaded");
    }

    const items = allDocs.map(parseDoc);
    cache = items;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return items;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to fetch DN data");
    throw new Error("Could not load DN data. The site might be temporarily unavailable.");
  }
}

// Public reply seen by everyone in the channel, then deleted after 40 seconds.
async function publicReply(
  interaction: ChatInputCommandInteraction,
  payload: InteractionReplyOptions & BaseMessageOptions,
): Promise<void> {
  await interaction.reply(payload);
  setTimeout(() => interaction.deleteReply().catch(() => {}), REPLY_DELETE_MS);
}

function formatValue(item: DNItem): string {
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

function buildItemEmbed(item: DNItem): EmbedBuilder {
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

function itemNameAcronym(item: DNItem): string {
  return item.name
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
}

function matchScore(item: DNItem, query: string): number {
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

export async function handleDNValuesSearch(interaction: ChatInputCommandInteraction): Promise<void> {
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
    // Blank query = list all by value, same as /dnvaluelist but capped at 10.
    results = items
      .slice()
      .sort((a, b) => (b.valueMax ?? 0) - (a.valueMax ?? 0) || (b.valueMin ?? 0) - (a.valueMin ?? 0));
  }

  if (results.length === 0) {
    await publicReply(interaction, {
      content: `🔍 No DN items found for "${query}". Try a different keyword or use \/dnvaluelist to browse all items.`,
    });
    return;
  }

  // If only one result, show full details
  if (results.length === 1) {
    await publicReply(interaction, { embeds: [buildItemEmbed(results[0])] });
    return;
  }

  // Show top 10 matches by relevance score (value already contributes a tiny tie-break).
  const toShow = results.slice(0, 10);

  const lines = toShow.map(
    (item, i) =>
      `**${i + 1}.** ${item.name}\n  💰 ${formatValue(item)} · ${item.rarity.map(rarityEmoji).join("") || "—"} · Demand: ${item.demand ?? "—"}/10`,
  );

  const embed = new EmbedBuilder()
    .setTitle(`🔍 DN — ${query ? `"${query}"` : "All items"}`)
    .setDescription(lines.join("\n\n"))
    .setColor(0x9b59b6)
    .setFooter({
      text: `Showing ${toShow.length} of ${results.length} result${results.length === 1 ? "" : "s"} · Data from dnvalues.com`,
    });

  await publicReply(interaction, { embeds: [embed] });
}

export async function handleDNValuesList(interaction: ChatInputCommandInteraction): Promise<void> {
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
    .setTitle("📋 DN — All Items (Top 15 by Value)")
    .setDescription(lines.join("\n\n"))
    .setColor(0x9b59b6)
    .setFooter({ text: `Showing 15 of ${items.length} items · Data from dnvalues.com` });

  await publicReply(interaction, { embeds: [embed] });
}

export async function handleDNValuesInfo(interaction: ChatInputCommandInteraction): Promise<void> {
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
    await publicReply(interaction, {
      content: `❌ Could not find "${name}" on DN. Use \/dnvaluesearch to find it.`,
    });
    return;
  }

  await publicReply(interaction, { embeds: [buildItemEmbed(item)] });
}

export async function handleDNValuesAutocomplete(
  interaction: AutocompleteInteraction,
  focused: { name: string; value: string },
): Promise<void> {
  if (!["name", "item"].includes(focused.name)) {
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

export async function handleDNValuesHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("🧭 DN Values Commands")
    .setColor(0x9b59b6)
    .setDescription(
      "Quick reference for the DN values lookup tools.\n\n" +
      "**Commands**\n" +
      "• `/dnvaluesearch <keyword>` — search items by name, rarity, or tag.\n" +
      "• `/dnvaluelist` — show all items sorted by value.\n" +
      "• `/dnvalueinfo <item>` — full details for one item (autocomplete).\n" +
      "• `/dnvaluecalc` — open a fresh trade calculator hub.\n" +
      "• `/dnvaluecalc item:<item> side:<your/their>` — add an item straight to your current hub with autocomplete.\n" +
      "• `/dnhelp` — show this message.\n\n" +
      "**Calculator tips**\n" +
      "• The calculator is **yours only** — only you can press its buttons.\n" +
      "• It shows for **40 seconds**, then auto-deletes. Just run `/dnvaluecalc` again for a fresh one.\n" +
      "• Click **Your item / Their item** to add items manually, or use `/dnvaluecalc item:...` for autocomplete.\n" +
      "• Set `tier` to low/mid/high and `stars` to 1-5 to match the exact value you want.\n" +
      "• The verdict turns **fair** when both sides are within 5% of each other.\n\n" +
      "Data pulled live from dnvalues.com."
    )
    .setFooter({ text: "Values from dnvalues.com" });
  await interaction.reply({ embeds: [embed] });
}

// ── Trade Calculator Hub ─────────────────────────────────────────────────────
// Mirrors the calculator on dnvalues.com: two offer sides, star bonuses,
// low/mid/high tier picks, and a 5%-threshold fair/win/loss verdict.

const STAR_VALUE: Record<number, number> = { 1: 0, 2: 1000, 3: 10000, 4: 35000, 5: 75000 };

type CalcTier = "low" | "mid" | "high";

type CalcItem = {
  item: DNItem;
  quantity: number;
  tier: CalcTier;
  stars: number;
};

type CalcState = {
  yourItems: CalcItem[];
  theirItems: CalcItem[];
  ownerUserId: string;
  channelId: string;
  messageId: string;
  createdAt: number;
};

const calcStates = new Map<string, CalcState>();
const calcTimers = new Map<string, ReturnType<typeof setTimeout>>();

function calcItemValue(c: CalcItem): number {
  const min = c.item.valueMin ?? c.item.valueMax ?? 0;
  const max = c.item.valueMax ?? c.item.valueMin ?? 0;
  let base = 0;
  if (c.tier === "low") base = min;
  else if (c.tier === "high") base = max;
  else base = Math.round((min + max) / 2);
  return Math.max(0, base + STAR_VALUE[c.stars]) * c.quantity;
}

function calcWeightedDemand(items: CalcItem[]): number | null {
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
    // Fallback to simple average when values are zero.
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

function calcSideValue(items: CalcItem[]): number {
  return items.reduce((sum, c) => sum + calcItemValue(c), 0);
}

function shortValue(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`.replace(/\.00B$/, "B");
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`.replace(/\.00M$/, "M");
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1_000).toLocaleString()}K`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`.replace(/\.0K$/, "K");
  return n.toLocaleString();
}

function formatCalcItem(c: CalcItem): string {
  const val = calcItemValue(c);
  const starText = c.stars > 1 ? ` · ${"⭐".repeat(c.stars)}` : "";
  const tierText = c.tier !== "mid" ? ` · ${c.tier}` : "";
  const qtyText = c.quantity > 1 ? ` x${c.quantity}` : "";
  return `${c.item.name}${qtyText}${tierText}${starText} — 💎 ${shortValue(val)}`;
}

function buildCalcEmbed(state: CalcState, title = "🧮 DN Trade Calculator", description?: string): EmbedBuilder {
  const yourLines = state.yourItems.length > 0
    ? state.yourItems.map(formatCalcItem).join("\n")
    : "*No items yet*";
  const theirLines = state.theirItems.length > 0
    ? state.theirItems.map(formatCalcItem).join("\n")
    : "*No items yet*";
  const yourTotal = calcSideValue(state.yourItems);
  const theirTotal = calcSideValue(state.theirItems);
  const yourDemand = calcWeightedDemand(state.yourItems);
  const theirDemand = calcWeightedDemand(state.theirItems);
  const diff = yourTotal - theirTotal;
  const rel = Math.abs(diff) / Math.max(yourTotal, theirTotal, 1);
  let verdict = "➖ Add items to both sides and press **Calculate**";
  if (yourTotal > 0 || theirTotal > 0) {
    if (rel <= 0.05) verdict = "⚖️ Fair trade";
    else if (diff > 0) verdict = `🔴 You lose — their offer is short by 💎 ${shortValue(Math.abs(diff))}`;
    else verdict = `🟢 You win — your offer is short by 💎 ${shortValue(Math.abs(diff))}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x74cdd8)
    .setDescription(
      description ??
      `**Your offer** — 💎 ${shortValue(yourTotal)}${yourDemand != null ? ` · Demand ${yourDemand.toFixed(1)}/10` : ""}\n${yourLines}\n\n` +
      `**Their offer** — 💎 ${shortValue(theirTotal)}${theirDemand != null ? ` · Demand ${theirDemand.toFixed(1)}/10` : ""}\n${theirLines}\n\n` +
      `**Verdict:** ${verdict}`,
    )
    .setFooter({ text: "Values from dnvalues.com" });
  return embed;
}

function buildCalcComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("dncalc:your").setLabel("➕ Your item").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dncalc:their").setLabel("➕ Their item").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dncalc:calc").setLabel("🧮 Calculate").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("dncalc:clear").setLabel("🗑️ Clear").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildCalcModal(side: "your" | "their"): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`dncalc_modal:${side}`)
    .setTitle(side === "your" ? "Add to your offer" : "Add to their offer");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Item name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder("e.g. Super Tiger Mech"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("qty")
        .setLabel("Quantity")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(3)
        .setPlaceholder("1"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("tier")
        .setLabel("Tier: low, mid, or high")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(4)
        .setPlaceholder("mid"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("stars")
        .setLabel("Stars (1-5)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(1)
        .setPlaceholder("1"),
    ),
  );
  return modal;
}

function isCalcOwner(interaction: ButtonInteraction | ModalSubmitInteraction, state: CalcState): boolean {
  return interaction.user.id === state.ownerUserId;
}

async function denyUnauthorized(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
  const payload: InteractionReplyOptions = {
    content: "❌ This calculator hub belongs to someone else. Use your own `/dnvaluecalc`.",
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

async function denyExpired(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
  const payload: InteractionReplyOptions = {
    content: "⏱️ This calculator hub has expired or was replaced. Run `/dnvaluecalc` to open a fresh one.",
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
    setTimeout(async () => {
      try {
        const client = getBotClient();
        if (client) {
          const channel = await client.channels.fetch(state.channelId).catch(() => null);
          if (channel && "messages" in channel) {
            await (channel as any).messages.delete(state.messageId).catch(() => {});
          }
        }
      } catch { /* ignore */ }
      calcStates.delete(state.messageId);
      calcTimers.delete(state.messageId);
    }, REPLY_DELETE_MS),
  );
}

function deleteCalcState(state: CalcState): void {
  const timer = calcTimers.get(state.messageId);
  if (timer) clearTimeout(timer);
  calcTimers.delete(state.messageId);
  calcStates.delete(state.messageId);
}

async function cleanupUserCalcStates(userId: string, channelId: string, channel: TextChannel | null): Promise<void> {
  const toDelete: CalcState[] = [];
  for (const state of calcStates.values()) {
    if (state.ownerUserId === userId && state.channelId === channelId) {
      toDelete.push(state);
    }
  }
  for (const state of toDelete) {
    // Best-effort delete the old hub message so dead buttons don't linger.
    if (channel && "messages" in channel) {
      const message = await channel.messages.fetch(state.messageId).catch(() => null);
      if (message && "deletable" in message && message.deletable) {
        await message.delete().catch(() => {});
      }
    }
    deleteCalcState(state);
  }
}

function findUserCalcState(userId: string, channelId: string): CalcState | undefined {
  let latest: CalcState | undefined;
  for (const state of calcStates.values()) {
    if (state.ownerUserId === userId && state.channelId === channelId) {
      if (!latest || state.createdAt > latest.createdAt) {
        latest = state;
      }
    }
  }
  return latest;
}

export async function handleDNValuesCalculator(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.channel) return;

  const itemName = interaction.options.getString("item", false);

  // ── Add-to-existing-hub flow (real Discord autocomplete on the item option) ─
  if (itemName?.trim()) {
    const items = await fetchItems();
    const match = items.find((i) => i.name.toLowerCase() === itemName.trim().toLowerCase())
      ?? items
        .map((i) => ({ i, score: matchScore(i, itemName) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)[0]?.i;

    if (!match) {
      await publicReply(interaction, {
        content: `❌ Could not find "${itemName}" on DN. Try \`/dnvaluesearch\` to find it.`,
      });
      return;
    }

    const side = (interaction.options.getString("side", false) as "your" | "their") || "your";
    const quantity = Math.max(1, interaction.options.getInteger("quantity", false) ?? 1);
    const tierRaw = interaction.options.getString("tier", false) ?? "mid";
    const tier: CalcTier = ["low", "mid", "high"].includes(tierRaw) ? (tierRaw as CalcTier) : "mid";
    const stars = Math.min(5, Math.max(1, interaction.options.getInteger("stars", false) ?? 1));

    const existingState = findUserCalcState(interaction.user.id, interaction.channel.id);
    if (existingState) {
      // Try to edit the existing hub message. If it's gone, the state is stale
      // and we should fall through to creating a fresh hub instead of lying.
      const message = await interaction.channel.messages.fetch(existingState.messageId).catch(() => null);
      if (message && "edit" in message) {
        existingState[side === "your" ? "yourItems" : "theirItems"].push({ item: match, quantity, tier, stars });
        await (message as any).edit({
          embeds: [buildCalcEmbed(existingState, "🧮 DN Trade Calculator")],
          components: buildCalcComponents(),
        });
        await publicReply(interaction, {
          content: `✅ Added **${match.name}** x${quantity} to **${side}** offer.`,
        });
        resetCalcTimer(existingState);
        return;
      }
      // Stale state — clean it up so it doesn't poison future lookups.
      deleteCalcState(existingState);
    }

    // No existing hub in this channel (or it was stale) — create a new one with this item already in it.
    const state: CalcState = {
      yourItems: side === "your" ? [{ item: match, quantity, tier, stars }] : [],
      theirItems: side === "their" ? [{ item: match, quantity, tier, stars }] : [],
      ownerUserId: interaction.user.id,
      channelId: interaction.channel.id,
      messageId: "",
      createdAt: Date.now(),
    };
    await interaction.reply({
      embeds: [buildCalcEmbed(state, "🧮 DN Trade Calculator")],
      components: buildCalcComponents(),
    });
    state.messageId = (await interaction.fetchReply()).id;
    calcStates.set(state.messageId, state);
    resetCalcTimer(state);
    return;
  }

  // ── Default hub-open flow ─
  // Enforce one active hub per user per channel so repeated `/dnvaluecalc` always
  // starts fresh and autocomplete adds land on the current calculator.
  await cleanupUserCalcStates(interaction.user.id, interaction.channel.id, interaction.channel as TextChannel);
  const state: CalcState = {
    yourItems: [],
    theirItems: [],
    ownerUserId: interaction.user.id,
    channelId: interaction.channel.id,
    messageId: "",
    createdAt: Date.now(),
  };
  await interaction.reply({
    embeds: [buildCalcEmbed(state, "🧮 DN Trade Calculator")],
    components: buildCalcComponents(),
  });
  const messageId = (await interaction.fetchReply()).id;
  state.messageId = messageId;
  calcStates.set(messageId, state);
  resetCalcTimer(state);
}

export async function handleDNValuesCalcButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const messageId = interaction.message.id;
  const state = calcStates.get(messageId);
  if (!state) {
    await denyExpired(interaction);
    return;
  }
  if (!isCalcOwner(interaction, state)) {
    await denyUnauthorized(interaction);
    return;
  }

  if (action === "your" || action === "their") {
    await interaction.showModal(buildCalcModal(action));
    return;
  }

  // For calc/clear we need to update the original message.
  await interaction.deferUpdate();

  if (action === "clear") {
    state.yourItems = [];
    state.theirItems = [];
    await interaction.editReply({
      embeds: [buildCalcEmbed(state, "🧮 DN Trade Calculator")],
      components: buildCalcComponents(),
    });
    resetCalcTimer(state);
    return;
  }

  if (action === "calc") {
    const title = state.yourItems.length === 0 && state.theirItems.length === 0
      ? "🧮 DN Trade Calculator"
      : "🧮 DN Trade Calculator — Result";
    await interaction.editReply({
      embeds: [buildCalcEmbed(state, title)],
      components: buildCalcComponents(),
    });
    resetCalcTimer(state);
    return;
  }
}

export async function handleDNValuesCalcModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const side = parts[1] as "your" | "their";
  const messageId = interaction.message?.id;
  if (!messageId) return;

  const state = calcStates.get(messageId);
  if (!state) {
    await denyExpired(interaction);
    return;
  }
  if (!isCalcOwner(interaction, state)) {
    await denyUnauthorized(interaction);
    return;
  }
  const nameRaw = interaction.fields.getTextInputValue("name").trim();
  const qtyRaw = interaction.fields.getTextInputValue("qty").trim() || "1";
  const tierRaw = interaction.fields.getTextInputValue("tier").trim().toLowerCase() || "mid";
  const starsRaw = interaction.fields.getTextInputValue("stars").trim() || "1";

  const items = await fetchItems();
  const match = items.find((i) => i.name.toLowerCase() === nameRaw.toLowerCase())
    ?? items
      .map((i) => ({ i, score: matchScore(i, nameRaw) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.i;

  if (!match) {
    await interaction.editReply({
      embeds: [buildCalcEmbed(state, "🧮 DN Trade Calculator", `❌ Could not find "${nameRaw}" on DN.`)],
      components: buildCalcComponents(),
    });
    resetCalcTimer(state);
    return;
  }

  const quantity = Math.max(1, parseInt(qtyRaw, 10) || 1);
  const tier: CalcTier = ["low", "mid", "high"].includes(tierRaw) ? (tierRaw as CalcTier) : "mid";
  const stars = Math.min(5, Math.max(1, parseInt(starsRaw, 10) || 1));

  state[side === "your" ? "yourItems" : "theirItems"].push({
    item: match, quantity, tier, stars,
  });

  await interaction.editReply({
    embeds: [buildCalcEmbed(state, "🧮 DN Trade Calculator")],
    components: buildCalcComponents(),
  });
  resetCalcTimer(state);
}
