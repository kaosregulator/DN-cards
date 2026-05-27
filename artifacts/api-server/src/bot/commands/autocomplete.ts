import type { AutocompleteInteraction } from "discord.js";
import { getAllCards, listSetsV2, getUserCollection, getUserWishlist, listCustomRarities } from "../db.js";
import { RARITY_EMOJI, type Rarity } from "../cards-data.js";

const MAX_CHOICES = 25;

// Cache the full card list briefly so we don't hammer the DB on every keystroke.
let cardCache: { at: number; cards: Array<{ name: string; rarity: string }> } | null = null;
const CACHE_MS = 15_000;

async function getCardsCached(): Promise<Array<{ name: string; rarity: string }>> {
  const now = Date.now();
  if (cardCache && now - cardCache.at < CACHE_MS) return cardCache.cards;
  const cards = await getAllCards();
  const slim = cards.map(c => ({ name: c.name, rarity: c.rarity }));
  cardCache = { at: now, cards: slim };
  return slim;
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

function formatCardChoice(c: { name: string; rarity: string }) {
  const emoji = RARITY_EMOJI[c.rarity as Rarity] ?? "🃏";
  const display = `${emoji} ${c.name}`.slice(0, 100);
  return { name: display, value: c.name.slice(0, 100) };
}

async function suggestCardNames(query: string, pool?: Array<{ name: string; rarity: string }>) {
  const q = query.toLowerCase().trim();
  const cards = pool ?? await getCardsCached();
  const scored = cards
    .map(c => ({ c, s: scoreMatch(c.name, q) }))
    .filter(x => x.s < 3)
    .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
    .slice(0, MAX_CHOICES);
  return scored.map(x => formatCardChoice(x.c));
}

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const cmd = interaction.commandName;
  const query = (focused.value ?? "").toString();

  try {

    // ── Set-name autocomplete for /sets, /drop, /massdrop ───────────────────
    // Any string option named `set`, `from`, `to`, or `name` on these two
    // commands resolves to a set picker (except /setadmin create, which takes
    // a new name — but that's not autocompleted so it won't reach here).
    const setNameCommands = new Set(["sets", "drop", "massdrop"]);
    if (setNameCommands.has(cmd)
        && ["set", "from", "to", "name"].includes(focused.name)) {
      const sets = await listSetsV2();
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
    if (cmd === "burn" && focused.name === "name" && interaction.guild) {
      const owned = await getUserCollection(interaction.guild.id, interaction.user.id);
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
    if (cmd === "trade" && focused.name === "offer" && interaction.guild) {
      const owned = await getUserCollection(interaction.guild.id, interaction.user.id);
      const pool = owned.map(o => ({ name: o.name, rarity: o.rarity }));
      await interaction.respond(await suggestCardNames(query, pool));
      return;
    }

    // ── /trade want — only cards the TARGET user owns ───────────────────────
    if (cmd === "trade" && focused.name === "want" && interaction.guild) {
      const targetOpt = interaction.options.get("user", false);
      const targetId = targetOpt?.user?.id;
      if (targetId && targetId !== interaction.user.id) {
        const targetOwned = await getUserCollection(interaction.guild.id, targetId);
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
    if (cmd === "wishlist" && focused.name === "name" && interaction.guild) {
      const sub = interaction.options.getSubcommand(false);
      if (sub === "remove") {
        const wished = await getUserWishlist(interaction.guild.id, interaction.user.id);
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

    // ── /rarity custom slug — show existing custom tiers by name ────────────
    if (cmd === "rarity" && focused.name === "slug" && interaction.guild) {
      const tiers = await listCustomRarities(interaction.guild.id);
      const q = query.toLowerCase().trim();
      const matches = tiers
        .filter(t => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q))
        .slice(0, MAX_CHOICES)
        .map(t => ({ name: `${t.emoji} ${t.name}`.slice(0, 100), value: t.slug }));
      await interaction.respond(matches);
      return;
    }

    // ── All other card-name fields → full roster ────────────────────────────
    // /info, /drop, /give, /takeback, /trade.want, /wishlist add
    await interaction.respond(await suggestCardNames(query));
  } catch {
    try { await interaction.respond([]); } catch { /* ignore */ }
  }
}
