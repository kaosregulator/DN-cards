import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { MessageFlags } from "discord.js";
import {
  isAdmin,
  listSets, deleteSetByName,
  loadDefaultCards, unloadDefaultCards,
  DEFAULTS_SET_NAME,
} from "../db.js";
import { importCardsFromJson } from "./import.js";
import { logger } from "../../lib/logger.js";

async function checkAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

// ── /loadset ─────────────────────────────────────────────────────────────────
// Either: file:<.json attachment> + optional name:<set-name>
// Or:     defaults:true  → re-add the built-in 27-card default roster
export async function handleLoadSet(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await checkAdmin(interaction))) {
    await interaction.editReply("❌ Admins only.");
    return;
  }

  const wantDefaults = interaction.options.getBoolean("defaults") ?? false;
  const file = interaction.options.getAttachment("file");
  const nameOverride = interaction.options.getString("name") ?? undefined;

  if (wantDefaults) {
    const { added, skipped } = await loadDefaultCards();
    await interaction.editReply(
      `✅ Defaults loaded — added **${added}** cards` +
      (skipped > 0 ? ` (skipped **${skipped}** already in roster).` : "."),
    );
    return;
  }

  if (!file) {
    await interaction.editReply(
      "❌ Attach a `.json` file with `file:<upload>`, or use `defaults:true` to add the built-in roster.",
    );
    return;
  }
  if (!file.name?.toLowerCase().endsWith(".json")) {
    await interaction.editReply("❌ File must be a `.json` file.");
    return;
  }

  let jsonText: string;
  try {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    jsonText = await res.text();
  } catch (err) {
    logger.error({ err }, "loadset: fetch failed");
    await interaction.editReply("❌ Failed to download the JSON file.");
    return;
  }

  try {
    const { created, skipped, failed, errors, setName } =
      await importCardsFromJson(jsonText, file.name, nameOverride);
    await interaction.editReply(
      `✅ **Set loaded** — \`${setName}\`\n` +
      `➕ Created: **${created}**\n` +
      `⏭️ Skipped (already exist): **${skipped}**` +
      (failed > 0 ? `\n❌ Failed: **${failed}**\n${errors.map(e => `• ${e}`).join("\n")}` : "") +
      `\n\nRemove with \`/unloadset set:${setName}\` · See all with \`/listsets\`.`,
    );
  } catch (err: any) {
    await interaction.editReply(`❌ ${err?.message ?? "Import failed"}`);
  }
}

// ── /unloadset ───────────────────────────────────────────────────────────────
export async function handleUnloadSet(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await checkAdmin(interaction))) {
    await interaction.editReply("❌ Admins only.");
    return;
  }

  const setName = interaction.options.getString("set", true).toLowerCase().trim();

  if (setName === DEFAULTS_SET_NAME) {
    const { removed } = await unloadDefaultCards();
    await interaction.editReply(
      `✅ Removed **${removed}** built-in default cards.\nThey will **not** come back on restart. Re-load anytime from the \`!setup\` panel.`,
    );
    return;
  }

  const { removed } = await deleteSetByName(setName);
  if (removed === 0) {
    await interaction.editReply(`❌ No set named \`${setName}\`. Try \`/listsets\` to see what's loaded.`);
    return;
  }
  await interaction.editReply(
    `✅ Unloaded set \`${setName}\` — removed **${removed}** cards and cleared related collections/trades/spawn history.`,
  );
}

// ── /listsets ────────────────────────────────────────────────────────────────
export async function handleListSets(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sets = await listSets();
  if (sets.length === 0) {
    await interaction.editReply("📦 No card sets loaded.");
    return;
  }
  sets.sort((a, b) => b.cardCount - a.cardCount);
  const lines = sets.map(s => `• \`${s.setName}\` — **${s.cardCount}** cards`);
  await interaction.editReply(
    `📦 **Loaded card sets** (${sets.length})\n${lines.join("\n")}\n\n` +
    `Load: \`/loadset file:<.json>\` · Unload: \`/unloadset set:<name>\``,
  );
}
