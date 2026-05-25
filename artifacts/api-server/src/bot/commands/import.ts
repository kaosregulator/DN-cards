import type { Message } from "discord.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { addCard, getCardByName } from "../db.js";
import { RARITY_WEIGHTS, type Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";

// Reusable importer — feeds both the !import prefix command and the /loadset slash command.
export async function importCardsFromJson(
  jsonText: string,
  sourceLabel: string,
  setNameOverride?: string,
): Promise<{ created: number; skipped: number; failed: number; errors: string[]; setName: string }> {
  let data: ImportSet;
  try { data = JSON.parse(jsonText); }
  catch { throw new Error("Invalid JSON"); }

  const cards = data.cards ?? [];
  if (cards.length === 0) throw new Error("JSON contains no cards");

  // Resolve set name: explicit override > set.name in JSON > filename stem
  const rawName = setNameOverride
    ?? data.set?.name
    ?? sourceLabel.replace(/\.json$/i, "");
  const setName = sanitizeSetName(rawName);

  let created = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const raw of cards) {
    if (!raw.name) { failed++; continue; }
    try {
      const existing = await getCardByName(raw.name);
      if (existing) { skipped++; continue; }

      const rarity = mapRarity(raw.rarity);
      const burnMatch = raw.description?.match(/burn value:\s*(\d+)/i);
      const sourceBurn = burnMatch ? parseInt(burnMatch[1], 10) : null;
      const burn = sourceBurn ?? defaultBurn(rarity);
      const worth = burn * 2;

      await addCard({
        name: raw.name,
        description: cleanDescription(raw.description),
        rarity,
        cardType: "vehicle",
        dropWeight: RARITY_WEIGHTS[rarity],
        worthValue: worth,
        burnValue: burn,
        imageUrl: raw.img_url ?? undefined,
        droppable: true,
        setName,
      });
      created++;
    } catch (err: any) {
      failed++;
      if (errors.length < 5) errors.push(`${raw.name}: ${err?.message ?? "unknown"}`);
    }
  }

  return { created, skipped, failed, errors, setName };
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
  img_url?: string;
}

interface ImportSet {
  set?: { name?: string; description?: string };
  cards?: ImportCard[];
}

// Map any source rarity to our 5-tier system
function mapRarity(raw: string | undefined): Rarity {
  const r = (raw ?? "").toLowerCase().trim();
  if (r === "common") return "common";
  if (r === "uncommon") return "uncommon";
  if (r === "rare") return "rare";
  if (r === "legendary") return "legendary";
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
          "Either **attach a `.json` file** to your `!import` message, or place one in `attached_assets/`.",
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

  // Parse
  let data: ImportSet;
  try {
    data = JSON.parse(jsonText);
  } catch {
    await msg.reply("❌ Invalid JSON file.");
    return;
  }

  const cards = data.cards ?? [];
  if (cards.length === 0) {
    await msg.reply("❌ JSON contains no cards.");
    return;
  }

  const status = await msg.reply(`📥 Importing **${cards.length}** cards from \`${sourceLabel}\`…`);

  let result;
  try {
    result = await importCardsFromJson(jsonText, sourceLabel);
  } catch (err: any) {
    await status.edit(`❌ ${err?.message ?? "Import failed"}`);
    return;
  }

  const { created, skipped, failed, errors, setName } = result;
  const summary =
    `✅ **Import complete** — set: \`${setName}\`\n` +
    `➕ Created: **${created}**\n` +
    `⏭️ Skipped (already exist): **${skipped}**\n` +
    (failed > 0 ? `❌ Failed: **${failed}**\n${errors.map(e => `• ${e}`).join("\n")}\n\n` : "\n") +
    `Use \`/unloadset set:${setName}\` to remove this set later.\n` +
    `Use \`!editcard <Name>\` to tweak any card.`;

  try { await status.edit(summary); } catch { await msg.reply(summary); }
}

function defaultBurn(r: Rarity): number {
  return { common: 5, uncommon: 25, rare: 250, epic: 500, legendary: 1250 }[r];
}
