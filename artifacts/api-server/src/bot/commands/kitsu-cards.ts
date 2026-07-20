import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import { addCard, addCardToSet, getCardByName, getSetByName } from "../db.js";
import { renderPanel, persistBotImage } from "./edit-card.js";
import { RARITY_BURN, RARITY_WEIGHTS, RARITY_WORTH, type Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

// ── Kitsu.io card source ───────────────────────────────────────────────────
// Kitsu is a JSON:API anime/manga/characters database. We pull only the title,
// synopsis (bio), and poster/cover image. Value, rarity, and type are supplied
// by the admin running the command, just like /create_card_from_mttv.
//
// Supported categories:
//   anime      — canonicalTitle + posterImage + synopsis
//   manga      — canonicalTitle + posterImage + synopsis
//   character  — name + image + description
//
// No API key is required, but we cache searches to keep autocomplete keystrokes
// from hammering the public endpoint.

const KITSU_API_BASE = "https://kitsu.io/api/edge";
const KITSU_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type KitsuCategory = "anime" | "manga" | "character";

export interface KitsuItem {
  id: string;
  type: KitsuCategory;
  name: string;
  description: string;
  imageUrl: string | null;
}

interface KitsuAttributes {
  canonicalTitle?: string;
  titles?: Record<string, string | null | undefined>;
  synopsis?: string | null;
  description?: string | null;
  name?: string;
  posterImage?: KitsuImage | null;
  coverImage?: KitsuImage | null;
  image?: KitsuImage | null;
}

interface KitsuImage {
  tiny?: string;
  small?: string;
  medium?: string;
  large?: string;
  original?: string;
}

interface KitsuResponse {
  data: Array<{
    id: string;
    type: string;
    attributes: KitsuAttributes;
  }>;
}

const searchCache = new Map<string, { at: number; items: KitsuItem[] }>();

function cacheKey(category: string, query: string): string {
  return `${category}:${query.toLowerCase().trim()}`;
}

function bestImageUrl(attrs: KitsuAttributes): string | null {
  const candidates = [
    attrs.posterImage?.large,
    attrs.posterImage?.medium,
    attrs.posterImage?.small,
    attrs.coverImage?.large,
    attrs.coverImage?.medium,
    attrs.coverImage?.small,
    attrs.image?.large,
    attrs.image?.medium,
    attrs.image?.small,
  ];
  for (const url of candidates) {
    if (url) return url;
  }
  return null;
}

function buildName(attrs: KitsuAttributes, type: string): string {
  if (attrs.canonicalTitle) return attrs.canonicalTitle;
  if (attrs.canonicalName) return attrs.canonicalName;
  if (attrs.name) return attrs.name;
  const title = attrs.titles?.en || attrs.titles?.en_jp || attrs.titles?.en_us || attrs.titles?.ja_jp;
  if (typeof title === "string") return title;
  return `${type} #${Math.floor(Math.random() * 100000)}`;
}

function buildDescription(attrs: KitsuAttributes): string {
  const raw = attrs.synopsis ?? attrs.description ?? "";
  return raw.trim();
}

export function isKitsuCategory(v: string | null | undefined): v is KitsuCategory {
  return v === "anime" || v === "manga" || v === "character";
}

export async function searchKitsu(category: KitsuCategory, query: string): Promise<KitsuItem[]> {
  const q = query.trim();
  if (!q) return [];

  const key = cacheKey(category, q);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < KITSU_CACHE_TTL_MS) return cached.items;

  try {
    const filterParam = category === "character" ? "filter[name]" : "filter[text]";
    const url = `${KITSU_API_BASE}/${category}?${filterParam}=${encodeURIComponent(q)}&page[limit]=25`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = (await resp.json()) as KitsuResponse;
    if (!Array.isArray(data?.data)) {
      throw new Error("Unexpected Kitsu response shape");
    }

    const items: KitsuItem[] = data.data.map((entry) => {
      const attrs = entry.attributes ?? {};
      return {
        id: entry.id,
        type: category,
        name: buildName(attrs, category),
        description: buildDescription(attrs),
        imageUrl: bestImageUrl(attrs),
      };
    });

    searchCache.set(key, { at: Date.now(), items });
    return items;
  } catch (err) {
    logger.error({ err: (err as Error).message, category, query }, "Failed to search Kitsu");
    throw new Error("Could not reach Kitsu. Try again in a moment.");
  }
}

const CREATE_CARD_RARITIES = new Set<string>(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);

function createCardRarityDefaults(rarity: Rarity): { worth: number; burn: number; weight: number } {
  return {
    worth: RARITY_WORTH[rarity],
    burn: RARITY_BURN[rarity],
    weight: RARITY_WEIGHTS[rarity],
  };
}

function matchScore(item: KitsuItem, query: string): number {
  const q = query.toLowerCase().trim();
  const name = item.name.toLowerCase();
  if (name === q) return 1000;
  if (name.startsWith(q)) return 500;
  if (name.includes(q)) return 100;
  // acronym match
  const acronym = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, "").slice(0, 1))
    .join("");
  if (acronym.includes(q)) return 50;
  return 0;
}

export async function handleKitsuAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "item") {
    await interaction.respond([]);
    return;
  }

  const category = interaction.options.getString("category");
  if (!isKitsuCategory(category)) {
    await interaction.respond([
      { name: "Select a category first (Anime / Manga / Character)", value: "__need_category__" },
    ]);
    return;
  }

  const query = focused.value.trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  try {
    const items = await searchKitsu(category, query);
    const scored = items
      .map((item) => ({ item, score: matchScore(item, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
    await interaction.respond(
      scored.map(({ item }) => ({
        name: `${item.name}`.slice(0, 100),
        value: item.name.slice(0, 100),
      })),
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Kitsu autocomplete failed");
    await interaction.respond([]);
  }
}

export async function handleCreateCardFromKitsu(interaction: ChatInputCommandInteraction): Promise<void> {
  // Caller (admin.ts) has already deferred the reply.
  const guildId = interaction.guildId!;
  const category = interaction.options.getString("category", true);
  const itemName = interaction.options.getString("item", true).trim();
  const rarityInput = interaction.options.getString("rarity", true);
  const type = interaction.options.getString("type", true).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
  const setName = interaction.options.getString("set")?.trim();
  const descriptionOverride = interaction.options.getString("description") ?? "";
  const limited = interaction.options.getBoolean("limited") ?? false;
  const maxCopies = interaction.options.getInteger("max_copies") ?? undefined;
  const eventExclusive = interaction.options.getBoolean("event_exclusive") ?? false;

  if (!isKitsuCategory(category)) {
    await interaction.editReply("❌ Pick a valid category: Anime, Manga, or Character.");
    return;
  }

  if (!type) {
    await interaction.editReply("❌ Card type cannot be empty. Enter a type/tag such as `anime`, `manga`, or `character`.");
    return;
  }

  if (!CREATE_CARD_RARITIES.has(rarityInput)) {
    await interaction.editReply("❌ Pick one of the built-in rarities from autocomplete.");
    return;
  }
  const baseRarity = rarityInput as Rarity;
  const defs = createCardRarityDefaults(baseRarity);

  let item: KitsuItem | undefined;
  try {
    const items = await searchKitsu(category, itemName);
    item = items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
    if (!item) {
      const scored = items
        .map((i) => ({ i, score: matchScore(i, itemName) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      item = scored[0]?.i;
    }
  } catch (err) {
    logger.error({ err, category, itemName }, "Failed to search Kitsu for create_card_from");
    await interaction.editReply("❌ Could not reach Kitsu. Try again later.");
    return;
  }

  if (!item) {
    await interaction.editReply(`❌ Could not find "${itemName}" in Kitsu ${category} library. Check the spelling or try another title.`);
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

  let imageUrl: string | undefined;
  if (item.imageUrl) {
    try {
      imageUrl = await persistBotImage(item.imageUrl);
    } catch (err) {
      logger.error({ err, imageUrl: item.imageUrl }, "Failed to persist Kitsu image");
    }
  }

  let card;
  try {
    card = await addCard({
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
  } catch (err) {
    logger.error({ err, itemName: item.name, guildId, category }, "Failed to create card from Kitsu");
    await interaction.editReply(
      `❌ Could not create card **${item.name}** — the server hit an error while saving it. ` +
      `Try again; if it keeps failing, tell me the exact title and the error message you see.`,
    );
    return;
  }

  let setNote = "";
  if (setName) {
    try {
      const set = await getSetByName(setName, guildId);
      if (set) {
        await addCardToSet(set.id, card.id, guildId);
        setNote = ` and added to set \`${set.name}\``;
      } else {
        setNote = ` (set \`${setName}\` was not found, so no set was assigned)`;
      }
    } catch (err) {
      logger.error({ err, cardId: card.id, setName, guildId }, "Failed to add Kitsu-created card to set");
      setNote = ` (could not add to set \`${setName}\`)`;
    }
  }

  await renderPanel(interaction, card.id, false, `✅ Created **${card.name}** from Kitsu ${category} (${baseRarity})${setNote} — tweak any field below`);
}

