import type { Message } from "discord.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { addCard, getCardByName, createSet, addCardToSet, setSetRarityWeights, setSetAwardsCompletion } from "../db.js";
import { RARITY_BURN, RARITY_WEIGHTS, type Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

export interface ImportResult {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
  setName: string;       // last set touched (for backwards-compat with !import / /loadset summary)
  setsImported: number;  // how many distinct sets were touched (1 for flat/single-set, N for bundle)
}

// Reusable importer — feeds the !import prefix command, /loadset, and roundtrip
// imports from /setadmin export*. Accepts three JSON shapes (all back-compat):
//   • Flat array      — { cards: [...] }                      (legacy)
//   • Single-set obj  — { set: { name, description?, rarityWeights? }, cards: [...] }
//   • Multi-set bundle — { exportedAt?, sets: [ {set, cards}, ... ] }
export async function importCardsFromJson(
  jsonText: string,
  sourceLabel: string,
  guildId: string,
  setNameOverride?: string,
): Promise<ImportResult> {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); }
  catch { throw new Error("Invalid JSON"); }

  // Normalize all three shapes to an array of { set?, cards } chunks.
  const chunks = normalizeImportShape(parsed, sourceLabel);
  if (chunks.length === 0) throw new Error("JSON contains no cards");

  // setNameOverride is honored ONLY when the file is a single chunk — bundles
  // carry their own per-set names and overriding to one name would collapse
  // everything into a single set (almost never what the user wants).
  if (setNameOverride && chunks.length > 1) {
    throw new Error("`name:` override cannot be used with a multi-set bundle — let the file's own set names through.");
  }

  const agg: ImportResult = { created: 0, skipped: 0, failed: 0, errors: [], setName: "", setsImported: 0 };
  for (const chunk of chunks) {
    const rawName = setNameOverride ?? chunk.set?.name ?? sourceLabel.replace(/\.json$/i, "");
    const setName = sanitizeSetName(rawName);
    const set = await createSet(setName, chunk.set?.description, guildId ?? undefined);
    // Restore rarity-weight overrides if the file carries any. We only
    // overwrite when the JSON has weights — silent files leave existing
    // weights alone (safer for partial re-imports).
    if (chunk.set?.rarityWeights && Object.keys(chunk.set.rarityWeights).length > 0) {
      await setSetRarityWeights(set.id, chunk.set.rarityWeights, guildId ?? "unknown");
    }
    if (typeof chunk.set?.awardsCompletion === "boolean") {
      await setSetAwardsCompletion(set.id, chunk.set.awardsCompletion, guildId ?? "unknown");
    }
    agg.setName = setName;
    agg.setsImported++;

    for (const raw of chunk.cards) {
      if (!raw.name) { agg.failed++; continue; }
      try {
        const existing = await getCardByName(raw.name, guildId);
        if (existing) {
          await addCardToSet(set.id, existing.id, guildId ?? "unknown");
          agg.skipped++; continue;
        }
        const rarity = mapRarity(raw.rarity);
        // Prefer explicit numeric fields from a roundtripped export; fall
        // back to legacy "burn value:" parsing for hand-edited files.
        const explicitBurn = typeof raw.burnValue === "number" ? raw.burnValue : null;
        const explicitWorth = typeof raw.worthValue === "number" ? raw.worthValue : null;
        const burnMatch = raw.description?.match(/burn value:\s*(\d+)/i);
        const sourceBurn = burnMatch ? parseInt(burnMatch[1], 10) : null;
        const burn = explicitBurn ?? sourceBurn ?? defaultBurn(rarity);
        const worth = explicitWorth ?? burn * 2;
        const newCard = await addCard({
          name: raw.name,
          description: cleanDescription(raw.description),
          rarity,
          cardType: raw.cardType ?? "vehicle",
          dropWeight: typeof raw.dropWeight === "number" ? raw.dropWeight : RARITY_WEIGHTS[rarity],
          worthValue: worth,
          burnValue: burn,
          imageUrl: raw.imageUrl ?? raw.img_url ?? undefined,
          flavor: raw.flavor ?? undefined,
          droppable: typeof raw.droppable === "boolean" ? raw.droppable : true,
          inPacks: typeof raw.inPacks === "boolean" ? raw.inPacks : undefined,
          isLimitedEdition: typeof raw.isLimitedEdition === "boolean" ? raw.isLimitedEdition : undefined,
          isEventExclusive: typeof raw.isEventExclusive === "boolean" ? raw.isEventExclusive : undefined,
          maxCopies: typeof raw.maxCopies === "number" ? raw.maxCopies : undefined,
        }, guildId ?? "unknown");
        if (newCard?.id) await addCardToSet(set.id, newCard.id, guildId ?? "unknown");
        agg.created++;
      } catch (err: any) {
        agg.failed++;
        if (agg.errors.length < 5) agg.errors.push(`${raw.name}: ${err?.message ?? "unknown"}`);
      }
    }
  }

  return agg;
}

// Normalize the three accepted JSON shapes into a uniform iteration target.
// Throws nothing — empty result means "nothing importable", handled by caller.
function normalizeImportShape(parsed: unknown, sourceLabel: string): Array<{ set?: ImportSetMeta; cards: ImportCard[] }> {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  // Bundle: { sets: [{set, cards}, ...] }
  if (Array.isArray(obj.sets)) {
    return (obj.sets as any[])
      .filter(s => s && Array.isArray(s.cards) && s.cards.length > 0)
      .map(s => ({ set: s.set, cards: s.cards as ImportCard[] }));
  }
  // Single-set object: { set?, cards: [...] }
  if (Array.isArray(obj.cards) && obj.cards.length > 0) {
    return [{ set: obj.set as ImportSetMeta | undefined, cards: obj.cards as ImportCard[] }];
  }
  // Bare array (unusual but tolerate it)
  if (Array.isArray(parsed) && parsed.length > 0) {
    return [{ set: { name: sourceLabel.replace(/\.json$/i, "") }, cards: parsed as ImportCard[] }];
  }
  return [];
}

function sanitizeSetName(raw: string): string {
  return raw.toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "imported";
}

interface ImportCard {
  name?: string;
  description?: string | null;
  rarity?: string;
  cardType?: string;
  // Roundtrip-friendly numeric fields (preferred over scraping the description).
  dropWeight?: number;
  worthValue?: number;
  burnValue?: number;
  // Image: prefer canonical `imageUrl`; tolerate legacy `img_url`.
  imageUrl?: string;
  img_url?: string;
  flavor?: string | null;
  droppable?: boolean;
  inPacks?: boolean;
  isLimitedEdition?: boolean;
  isEventExclusive?: boolean;
  maxCopies?: number | null;
}

interface ImportSetMeta {
  name?: string;
  description?: string;
  rarityWeights?: Record<string, number>;
  awardsCompletion?: boolean;
}

// Map source rarity labels to the stable built-in rarity enum.
function mapRarity(raw: string | undefined): Rarity {
  const r = (raw ?? "").toLowerCase().trim();
  if (r === "common") return "common";
  if (r === "uncommon") return "uncommon";
  if (r === "rare") return "rare";
  if (r === "legendary") return "legendary";
  if (r === "mythic") return "mythic";
  if (r === "graded") return "legendary";          // 0.6%, rarest in user's set
  if (r === "le soldiers" || r === "le") return "epic";
  if (r === "mech") return "epic";
  return "common";
}

// Detect auto-generated metadata descriptions ("Legendary Pull\nChance: 12%\nBurn Value: 400")
// and replace with empty so the description doesn't show stale numbers.
function cleanDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  if (/burn value|chance:/i.test(raw)) return "";
  return raw.trim().slice(0, 500);
}

// ── !import command — accepts JSON attachment OR reads default file ──────────
export async function handleImport(msg: Message): Promise<void> {
  if (!msg.guild) return;

  // Resolve source: attached file → fallback to attached_assets/V1_*.json
  const attachment = msg.attachments.first();
  let jsonText: string;
  let sourceLabel: string;

  try {
    if (attachment && attachment.name?.toLowerCase().endsWith(".json")) {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      jsonText = await res.text();
      sourceLabel = attachment.name;
    } else {
      const assetsDir = path.resolve(process.cwd(), "../../attached_assets");
      const files = await fs.readdir(assetsDir).catch(() => [] as string[]);
      const v1File = files.find(f => f.startsWith("V1_") && f.endsWith(".json"));
      if (!v1File) {
        await msg.reply(
          "❌ No JSON found.\n" +
          "Either **attach a `.json` file** to your `!import` message, or place one in `attached_assets/`.\n" +
          "*(Your prefix may be different — run `<prefix>setprefix` to check.)*",
        );
        return;
      }
      jsonText = await fs.readFile(path.join(assetsDir, v1File), "utf8");
      sourceLabel = v1File;
    }
  } catch (err) {
    logger.error({ err }, "Import: failed to read source");
    await msg.reply("❌ Failed to read the JSON file.");
    return;
  }

  // Parse — only used here for an early "is it empty?" check. The real
  // shape normalization happens inside importCardsFromJson (flat / single /
  // bundle), so we just need a permissive view of `cards` on the top level.
  let data: { cards?: unknown[]; sets?: unknown[] };
  try {
    data = JSON.parse(jsonText);
  } catch {
    await msg.reply("❌ Invalid JSON file.");
    return;
  }

  const cards = Array.isArray(data.cards)
    ? data.cards
    : Array.isArray(data.sets)
      ? data.sets.flatMap((s: any) => Array.isArray(s?.cards) ? s.cards : [])
      : [];
  if (cards.length === 0) {
    await msg.reply("❌ JSON contains no cards.");
    return;
  }

  const status = await msg.reply(`📥 Importing **${cards.length}** cards from \`${sourceLabel}\`…`);

  let result;
  try {
    result = await importCardsFromJson(jsonText, sourceLabel, msg.guild.id);
  } catch (err: any) {
    await status.edit(`❌ ${err?.message ?? "Import failed"}`);
    return;
  }

  const { created, skipped, failed, errors, setName, setsImported } = result;
  const setLabel = setsImported === 1
    ? `set: \`${setName}\``
    : `${setsImported} sets imported (last: \`${setName}\`)`;
  const summary =
    `✅ **Import complete** — ${setLabel}\n` +
    `➕ Created: **${created}**\n` +
    `⏭️ Skipped (already exist): **${skipped}**\n` +
    (failed > 0 ? `❌ Failed: **${failed}**\n${errors.map(e => `• ${e}`).join("\n")}\n\n` : "\n") +
    `Use \`/setadmin unload set:${setName}\` to remove this set later.\n` +
    `Use \`/editcard name:<card>\` to tweak any card after import.`

  try { await status.edit(summary); } catch { await msg.reply(summary); }
}

function defaultBurn(r: Rarity): number {
  return RARITY_BURN[r];
}
