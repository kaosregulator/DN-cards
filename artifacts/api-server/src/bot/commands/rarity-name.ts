import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings } from "../db.js";
import { getMythicDisplay, RARITY_COLORS, RARITY_EMOJI, RARITY_LABELS } from "../cards-data.js";

// Parses #rrggbb / #rgb / 0xRRGGBB / plain 6-hex. Returns null on invalid.
function parseHexColor(input: string): number | null {
  const s = input.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s) && !/^[0-9a-fA-F]{3}$/.test(s)) return null;
  const full = s.length === 3
    ? s.split("").map(c => c + c).join("")
    : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : null;
}

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

export async function handleRarityName(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const opts = interaction.options;
  const reset = opts.getBoolean("reset") ?? false;

  if (reset) {
    await updateGuildSettings(guildId, {
      mythicLabel: null,
      mythicEmoji: null,
      mythicColor: null,
    });
    const embed = new EmbedBuilder()
      .setTitle("🔄 Mythic tier reset to defaults")
      .setColor(RARITY_COLORS.mythic)
      .setDescription(
        `The Mythic tier is back to **${RARITY_EMOJI.mythic} ${RARITY_LABELS.mythic}** (${hex(RARITY_COLORS.mythic)}).`,
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const name = opts.getString("name", true).trim();
  const emoji = opts.getString("emoji", true).trim();
  const colorRaw = opts.getString("color");

  if (name.length === 0 || name.length > 32) {
    await interaction.editReply("❌ Name must be 1-32 characters.");
    return;
  }
  if (emoji.length === 0 || emoji.length > 8) {
    await interaction.editReply("❌ Emoji must be a single character or emoji (1-8 chars).");
    return;
  }

  let color: number | null = null;
  if (colorRaw && colorRaw.trim().length > 0) {
    color = parseHexColor(colorRaw);
    if (color === null) {
      await interaction.editReply(
        "❌ Couldn't read that color. Use a hex code like `#ff2d92` (or `ff2d92`).",
      );
      return;
    }
  }

  const patch: { mythicLabel: string; mythicEmoji: string; mythicColor?: number } = {
    mythicLabel: name,
    mythicEmoji: emoji,
  };
  if (color !== null) patch.mythicColor = color;
  await updateGuildSettings(guildId, patch);

  const settings = await getOrCreateGuildSettings(guildId);
  const view = getMythicDisplay(settings);

  const embed = new EmbedBuilder()
    .setTitle(`✨ Top tier is now ${view.emoji} ${view.label}`)
    .setColor(view.color)
    .setDescription(
      `Your server's top rarity tier will now appear as **${view.emoji} ${view.label}** ` +
      `(${hex(view.color)}) in spawn embeds, /info, /list, /catalog, /collection, ` +
      `packs and trade-ins.\n\n` +
      `Use \`/rarityname reset:true\` any time to revert to the default ${RARITY_EMOJI.mythic} **${RARITY_LABELS.mythic}**.`,
    );
  await interaction.editReply({ embeds: [embed] });
}
