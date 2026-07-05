import type { AutocompleteInteraction } from "discord.js";
import { getAllCards, listSetsV2, getUserCollection, getUserWishlist, listCustomRarities, getRarityContext, getOrCreateGuildSettings, getRarityDisplayOverrides, getDisplayRarities, getDistinctCardTypes, listCustomPacks } from "../db.js";
import { tierLabel } from "./pack.js";
import { db, cardDisplayOverridesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { RARITY_EMOJI, rarityEmoji, rarityLabel, type Rarity } from "../cards-data.js";

const MAX_CHOICES = 25;

type SlimCard = { name: string; rarity: string; displayName?: string | null };

// Cache the full card list briefly so we don't hammer the DB on every keystroke.
let cardCache: { at: number; cards: SlimCard[] } | null = null;
const CACHE_MS = 15_000;

async function getCardsCached(): Promise<SlimCard[]> {
  const now = Date.now();
  if (cardCache && now - cardCache.at < CACHE_MS) return cardCache.cards;
  const [cards, overrides] = await Promise.all([
    getAllCards(),
    db.select({ cardId: cardDisplayOverridesTable.cardId, displayName: cardDisplayOverridesTable.displayName })
      .from(cardDisplayOverridesTable)
      .where(isNotNull(cardDisplayOverridesTable.displayName)),
  ]);
  const overrideMap = new Map(overrides.map(o => [o.cardId, o.displayName]));
  const slim = cards.map(c => ({
    name: c.name,
    rarity: c.rarity,
    displayName: overrideMap.get(c.id) ?? null,
  }));
  cardCache = { at: now, cards: slim };
  return slim;
}

let setCache: { at: number; sets: Awaited<ReturnType<typeof listSetsV2>> } | null = null;
const SET_CACHE_MS = 5_000;
async function getSetsCached(): Promise<Awaited<ReturnType<typeof listSetsV2>>> {
  const now = Date.now();
  if (setCache && now - setCache.at < SET_CACHE_MS) return setCache.sets;
  const sets = await listSetsV2();
  setCache = { at: now, sets };
  return sets;
}

const customTierCache = new Map<string, { at: number; tiers: Awaited<ReturnType<typeof listCustomRarities>> }>();
const CUSTOM_TIER_CACHE_MS = 5_000;
async function getCustomRaritiesCached(guildId: string): Promise<Awaited<ReturnType<typeof listCustomRarities>>> {
  const now = Date.now();
  const cached = customTierCache.get(guildId);
  if (cached && now - cached.at < CUSTOM_TIER_CACHE_MS) return cached.tiers;
  const tiers = await listCustomRarities(guildId);
  customTierCache.set(guildId, { at: now, tiers });
  return tiers;
}

const collectionCache = new Map<string, { at: number; rows: Awaited<ReturnType<typeof getUserCollection>> }>();
const COLLECTION_CACHE_MS = 5_000;
async function getUserCollectionCached(guildId: string, userId: string): Promise<Awaited<ReturnType<typeof getUserCollection>>> {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const cached = collectionCache.get(key);
  if (cached && now - cached.at < COLLECTION_CACHE_MS) return cached.rows;
  const rows = await getUserCollection(guildId, userId);
  collectionCache.set(key, { at: now, rows });
  return rows;
}

const wishlistCache = new Map<string, { at: number; rows: Awaited<ReturnType<typeof getUserWishlist>> }>();
const WISHLIST_CACHE_MS = 5_000;
async function getUserWishlistCached(guildId: string, userId: string): Promise<Awaited<ReturnType<typeof getUserWishlist>>> {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const cached = wishlistCache.get(key);
  if (cached && now - cached.at < WISHLIST_CACHE_MS) return cached.rows;
  const rows = await getUserWishlist(guildId, userId);
  wishlistCache.set(key, { at: now, rows });
  return rows;
}

// Score: 0 = startsWith, 1 = word-boundary, 2 = contains, 3 = no match
function scoreMatch(name: string, q: string): number {
  if (!q) return 1;
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/\s+/).some(w => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  return 3;
}

function formatCardChoice(c: SlimCard) {
  const emoji = rarityEmoji(c.rarity as Rarity, null, null) ?? "🃏";
  // When a website display-name override exists, show both so the admin
  // can find the card by either name. Value is always cards.name so
  // getCardByName() resolves it correctly.
  const label = c.displayName && c.displayName !== c.name
    ? `${emoji} ${c.displayName} (${c.name})`.slice(0, 100)
    : `${emoji} ${c.name}`.slice(0, 100);
  return { name: label, value: c.name.slice(0, 100) };
}

async function suggestCardNames(query: string, pool?: SlimCard[]) {
  const q = query.toLowerCase().trim();
  const cards = pool ?? await getCardsCached();
  const scored = cards
    .map(c => {
      // Match against gameplay name OR website display-name override
      const s = Math.min(
        scoreMatch(c.name, q),
        c.displayName ? scoreMatch(c.displayName, q) : 3,
      );
      return { c, s };
    })
    .filter(x => x.s < 3)
    .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
    .slice(0, MAX_CHOICES);
  return scored.map(x => formatCardChoice(x.c));
}

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const cmd = interaction.commandName;
  const query = (focused.value ?? "").toString();

  // The /admin and /cards hub commands consolidate many commands as subcommands.
  // interaction.commandName is "admin" or "cards" for all of them, so we must
  // resolve the actual subcommand name to route autocomplete correctly.
  const effectiveCmd = (cmd === "admin" || cmd === "cards")
    ? (interaction.options.getSubcommand(false) ?? cmd)
    : cmd;

  try {

    // ── Set-name autocomplete for /sets, /drop, /massdrop ───────────────────
    // Any string option named `set`, `from`, `to`, or `name` on these two
    // commands resolves to a set picker (except /setadmin create, which takes
    // a new name — but that's not autocompleted so it won't reach here).
    // /drop and /massdrop have `name` = card name, `set` = set name
    // /setadmin has `name` = set name (rename/delete/view), `set`/`from`/`to` = set name
    // /sets has `name` = set name (view/progress); /addcard has `set` = set name
    const isSetNameOption =
      (effectiveCmd === "sets" && focused.name === "name") ||
      (effectiveCmd === "setadmin" && ["name", "set", "from", "to"].includes(focused.name)) ||
      (effectiveCmd === "drop" && focused.name === "set") ||
      (effectiveCmd === "massdrop" && focused.name === "set") ||
      (effectiveCmd === "addcard" && focused.name === "set") ||
      (effectiveCmd === "giveall" && focused.name === "set");
    if (isSetNameOption) {
      const sets = await getSetsCached();
      const q = query.toLowerCase().trim();
      const matches = sets
        .filter(s => !q || s.set.name.toLowerCase().includes(q))
        .sort((a, b) => b.cardCount - a.cardCount || a.set.name.localeCompare(b.set.name))
        .slice(0, MAX_CHOICES)
        .map(s => ({
          name: `${s.set.name} (${s.cardCount} card${s.cardCount === 1 ? "" : "s"})`.slice(0, 100),
          value: s.set.name.slice(0, 100),
        }));
      await interaction.respond(matches);
      return;
    }

    // ── /burn — only suggest cards the user actually owns ───────────────────
    if (effectiveCmd === "burn" && focused.name === "name" && interaction.guild) {
      const owned = await getUserCollectionCached(interaction.guild.id, interaction.user.id);
      const pool = owned.map(o => ({ name: o.name, rarity: o.rarity }));
      const q = query.toLowerCase().trim();
      const scored = pool
        .map(c => ({ c, s: scoreMatch(c.name, q) }))
        .filter(x => x.s < 3)
        .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
        .slice(0, MAX_CHOICES);
      await interaction.respond(scored.map(x => formatCardChoice(x.c)));
      return;
    }

    // ── /trade offer — only cards the user owns ─────────────────────────────
    if (effectiveCmd === "trade" && focused.name === "offer" && interaction.guild) {
      const owned = await getUserCollectionCached(interaction.guild.id, interaction.user.id);
      const pool = owned.map(o => ({ name: o.name, rarity: o.rarity }));
      await interaction.respond(await suggestCardNames(query, pool));
      return;
    }

    // ── /trade want — only cards the TARGET user owns ───────────────────────
    if (effectiveCmd === "trade" && focused.name === "want" && interaction.guild) {
      const targetOpt = interaction.options.get("user", false);
      const targetId = targetOpt?.user?.id;
      if (targetId && targetId !== interaction.user.id) {
        const targetOwned = await getUserCollectionCached(interaction.guild.id, targetId);
        if (targetOwned.length === 0) {
          await interaction.respond([{ name: `⚠️ ${targetOpt?.user?.username ?? "They"} have no cards yet`, value: "" }]);
          return;
        }
        const pool = targetOwned.map(o => ({ name: o.name, rarity: o.rarity }));
        await interaction.respond(await suggestCardNames(query, pool));
        return;
      }
      // No user picked yet → fall through to full roster so the dropdown isn't empty
    }

    // ── /wishlist remove — only suggest cards already on the user's wishlist ─
    if (effectiveCmd === "wishlist" && focused.name === "name" && interaction.guild) {
      const sub = interaction.options.getSubcommand(false);
      if (sub === "remove") {
        const wished = await getUserWishlistCached(interaction.guild.id, interaction.user.id);
        const pool = wished.map(w => ({ name: w.name, rarity: w.rarity }));
        const q = query.toLowerCase().trim();
        const scored = pool
          .map(c => ({ c, s: scoreMatch(c.name, q) }))
          .filter(x => x.s < 3)
          .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
          .slice(0, MAX_CHOICES);
        await interaction.respond(scored.map(x => formatCardChoice(x.c)));
        return;
      }
    }


    // ── /dnvalueinfo and /dnvaluecalc — autocomplete item names from DN values ─
    if ((effectiveCmd === "dnvalueinfo" && focused.name === "name") ||
        (effectiveCmd === "dnvaluecalc" && focused.name === "item")) {
      const { handleDNValuesAutocomplete } = await import("./dnvalues.js");
      await handleDNValuesAutocomplete(interaction, focused);
      return;
    }

    // ── /tradein rarity — built-ins plus custom tiers in server ladder order ──
    if (effectiveCmd === "tradein" && focused.name === "rarity" && interaction.guild) {
      const q = query.toLowerCase().trim();
      const [ctx, settings, displayMap] = await Promise.all([
        getRarityContext(interaction.guild.id),
        getOrCreateGuildSettings(interaction.guild.id),
        getRarityDisplayOverrides(interaction.guild.id),
      ]);
      const ladder = getDisplayRarities(ctx, settings, { rarestFirst: false, displayMap });
      const options = ladder.slice(0, -1).map((tier, idx) => {
        const next = ladder[idx + 1];
        const value = tier.isCustom ? `custom:${tier.slug}` : tier.rarity!;
        return {
          name: `${tier.emoji} ${tier.label} → ${next?.emoji ?? "⬆️"} ${next?.label ?? "next"}`.slice(0, 100),
          value: value.slice(0, 100),
        };
      });
      const filtered = !q
        ? options
        : options.filter(o => o.name.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
      await interaction.respond(filtered.slice(0, MAX_CHOICES));
      return;
    }

    // ── /addcard rarity — built-in rarities only for the simplified flow ────
    // Legacy custom-tier assignment still exists in advanced tools; new cards
    // should start with a stable built-in rarity identity.
    if (effectiveCmd === "addcard" && focused.name === "rarity" && interaction.guild) {
      const q = query.toLowerCase().trim();
      const [settings, displayMap] = await Promise.all([
        getOrCreateGuildSettings(interaction.guild.id),
        getRarityDisplayOverrides(interaction.guild.id),
      ]);
      const builtIn: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
      const builtInOptions = builtIn.map(r => ({
        name: `${rarityEmoji(r, settings, displayMap)} ${rarityLabel(r, settings, displayMap)}`.slice(0, 100),
        value: r,
      }));
      const filtered = !q
        ? builtInOptions
        : builtInOptions.filter(o => o.name.toLowerCase().includes(q) || o.value.includes(q));
      await interaction.respond(filtered.slice(0, MAX_CHOICES));
      return;
    }

    // ── /rarity custom slug — show existing custom tiers by name ────────────
    if (effectiveCmd === "rarity" && focused.name === "slug" && interaction.guild) {
      const tiers = await getCustomRaritiesCached(interaction.guild.id);
      const q = query.toLowerCase().trim();
      const matches = tiers
        .filter(t => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q))
        .slice(0, MAX_CHOICES)
        .map(t => ({ name: `${t.emoji} ${t.name}`.slice(0, 100), value: t.slug }));
      await interaction.respond(matches);
      return;
    }

    // ── /addcard and /editcard type — free-text with existing types as suggestions ──
    if (
      (effectiveCmd === "addcard" || effectiveCmd === "editcard") &&
      focused.name === "type"
    ) {
      const types = await getDistinctCardTypes();
      const q = query.toLowerCase().trim();
      const matched = types.filter(t => !q || t.toLowerCase().includes(q));
      const options: { name: string; value: string }[] = matched
        .slice(0, MAX_CHOICES - 1)
        .map(t => ({ name: t, value: t }));
      // If the user's query doesn't match any existing type exactly, offer it as a new type.
      if (q && !types.some(t => t.toLowerCase() === q)) {
        options.unshift({ name: `✏️ "${query}" (new type)`, value: query.slice(0, 100) });
      }
      await interaction.respond(options.slice(0, MAX_CHOICES));
      return;
    }

    // ── /pack tier — built-in tiers + active custom guild packs ─────────────
    if (effectiveCmd === "pack" && focused.name === "tier" && interaction.guild) {
      const s = await getOrCreateGuildSettings(interaction.guild.id);
      const builtIns = [
        { name: (s.packBasicDesc?.trim() ? `🥉 ${tierLabel(s, "basic")} — 💠 ${s.packBasicCost.toLocaleString()} · ${s.packBasicDesc.trim()}` : `🥉 ${tierLabel(s, "basic")} — 💠 ${s.packBasicCost.toLocaleString()} (standard rates)`).slice(0, 100), value: "basic" },
        { name: (s.packPremiumDesc?.trim() ? `🥈 ${tierLabel(s, "premium")} — 💠 ${s.packPremiumCost.toLocaleString()} · ${s.packPremiumDesc.trim()}` : `🥈 ${tierLabel(s, "premium")} — 💠 ${s.packPremiumCost.toLocaleString()} (better rates)`).slice(0, 100), value: "premium" },
        { name: (s.packLegendaryDesc?.trim() ? `🥇 ${tierLabel(s, "legendary")} — 💠 ${s.packLegendaryCost.toLocaleString()} · ${s.packLegendaryDesc.trim()}` : `🥇 ${tierLabel(s, "legendary")} — 💠 ${s.packLegendaryCost.toLocaleString()} (no commons)`).slice(0, 100), value: "legendary" },
      ];
      const customPacks = await listCustomPacks(interaction.guild.id);
      const customOptions = customPacks.map(p => ({
        name: (p.description?.trim() ? `🎁 ${p.name} — 💠 ${p.cost.toLocaleString()} · ${p.description.trim()}` : `🎁 ${p.name} — 💠 ${p.cost.toLocaleString()} · ${p.size} card/open`).slice(0, 100),
        value: `custom:${p.id}`,
      }));
      const all = [...builtIns, ...customOptions];
      const q = query.toLowerCase().trim();
      const filtered = !q ? all : all.filter(o =>
        o.name.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
      );
      await interaction.respond(filtered.slice(0, MAX_CHOICES));
      return;
    }

    // ── All other card-name fields → full roster ────────────────────────────
    // /info, /drop, /give, /takeback, /trade.want, /wishlist add
    await interaction.respond(await suggestCardNames(query));
  } catch {
    try { await interaction.respond([]); } catch { /* ignore */ }
  }
}
