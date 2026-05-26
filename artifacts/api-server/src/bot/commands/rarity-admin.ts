// /rarity — admin command that owns ALL gameplay-rarity writes.
// Replaces the old website rarity editors. Three subcommand groups:
//   /rarity profile set|reset|list       — per-built-in-rarity worth/burn/weight overrides
//   /rarity custom add|edit|remove|list  — define brand-new rarity tiers per guild
//   /rarity card assign|unassign         — put a specific card into a custom tier
//
// Discord = source of truth. The website only ever READS these tables.
import {
  EmbedBuilder, MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  upsertRarityProfile, deleteRarityProfile, listRarityProfiles,
  createCustomRarity, updateCustomRarity, deleteCustomRarity,
  listCustomRarities, getCustomRarityBySlug,
  assignCardToCustomRarity, unassignCardCustomRarity,
  getCardByName,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, RARITY_COLORS, type Rarity } from "../cards-data.js";

const BUILTIN_RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

function parseHexColor(input: string): number | null {
  const s = input.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s) && !/^[0-9a-fA-F]{3}$/.test(s)) return null;
  const full = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : null;
}

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

function fmtVal(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined) return "*(unset → use card value)*";
  return `${v.toLocaleString()}${suffix}`;
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(slug);
}

export async function handleRarityAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(true);

  // ── profile (built-in rarity overrides) ──────────────────────────────────
  if (group === "profile") {
    if (sub === "set") {
      const rarity = interaction.options.getString("rarity", true) as Rarity;
      if (!BUILTIN_RARITIES.includes(rarity)) {
        await interaction.editReply("❌ Unknown rarity.");
        return;
      }
      const worth = interaction.options.getInteger("worth");
      const burn = interaction.options.getInteger("burn");
      const weight = interaction.options.getNumber("weight");
      if (worth === null && burn === null && weight === null) {
        await interaction.editReply("❌ Provide at least one of `worth`, `burn`, or `weight`. To clear all, use `/rarity profile reset`.");
        return;
      }
      const patch: { worthValue?: number; burnValue?: number; dropWeight?: number; updatedBy?: string } = { updatedBy: userId };
      if (worth !== null) patch.worthValue = worth;
      if (burn !== null) patch.burnValue = burn;
      if (weight !== null) patch.dropWeight = weight;
      await upsertRarityProfile(guildId, rarity, patch);
      await interaction.editReply(
        `✅ Updated **${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}** profile:\n` +
        (worth !== null ? `• Worth → 💠 ${worth.toLocaleString()}\n` : "") +
        (burn !== null ? `• Burn → 💠 ${burn.toLocaleString()}\n` : "") +
        (weight !== null ? `• Drop weight → ${weight}\n` : "") +
        `\nUnchanged fields keep their current value. Use \`/rarity profile reset\` to clear all overrides for this tier.`,
      );
      return;
    }
    if (sub === "reset") {
      const rarity = interaction.options.getString("rarity", true) as Rarity;
      const removed = await deleteRarityProfile(guildId, rarity);
      await interaction.editReply(
        removed
          ? `🔄 Cleared profile overrides for **${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}**. Cards in this tier fall back to their own worth/burn/weight.`
          : `ℹ️ No profile override was set for **${RARITY_EMOJI[rarity]} ${RARITY_LABELS[rarity]}**.`,
      );
      return;
    }
    if (sub === "list") {
      const rows = await listRarityProfiles(guildId);
      const byRarity = new Map(rows.map(r => [r.rarity as Rarity, r]));
      const embed = new EmbedBuilder()
        .setTitle("📊 Rarity Profile Overrides")
        .setColor(0x5865f2)
        .setDescription("Per-tier overrides for **this server only**. Null = falls back to each card's own value.");
      for (const r of BUILTIN_RARITIES) {
        const row = byRarity.get(r);
        embed.addFields({
          name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}`,
          value:
            `Worth: ${fmtVal(row?.worthValue, " 💠")}\n` +
            `Burn: ${fmtVal(row?.burnValue, " 💠")}\n` +
            `Drop weight: ${fmtVal(row?.dropWeight)}`,
          inline: true,
        });
      }
      embed.setFooter({ text: "Edit with /rarity profile set · Clear with /rarity profile reset" });
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

  // ── custom (new rarity tiers beyond the 6 built-ins) ─────────────────────
  if (group === "custom") {
    if (sub === "add") {
      const slug = interaction.options.getString("slug", true).trim().toLowerCase();
      const name = interaction.options.getString("name", true).trim();
      const emoji = interaction.options.getString("emoji", true).trim();
      const position = interaction.options.getNumber("position", true);
      const worth = interaction.options.getInteger("worth", true);
      const burn = interaction.options.getInteger("burn", true);
      const colorRaw = interaction.options.getString("color");
      const weight = interaction.options.getNumber("weight");
      const droppable = interaction.options.getBoolean("droppable");
      const inPacks = interaction.options.getBoolean("inpacks");

      if (!isValidSlug(slug)) {
        await interaction.editReply("❌ Slug must be 1-32 chars, lowercase letters/numbers/`-`/`_`, starting with a letter or number (e.g. `ultra`, `prismatic-v2`).");
        return;
      }
      if (name.length === 0 || name.length > 32) { await interaction.editReply("❌ Name must be 1-32 chars."); return; }
      if (emoji.length === 0 || emoji.length > 8) { await interaction.editReply("❌ Emoji must be 1-8 chars."); return; }
      if (!Number.isFinite(position) || position <= 0 || position > 100) { await interaction.editReply("❌ Position must be > 0 and ≤ 100. Built-ins are 1-6 (common=1 … mythic=6)."); return; }
      if (worth < 0 || burn < 0) { await interaction.editReply("❌ Worth and burn must be ≥ 0."); return; }

      let color = 0x5865f2;
      if (colorRaw && colorRaw.trim()) {
        const parsed = parseHexColor(colorRaw);
        if (parsed === null) { await interaction.editReply("❌ Color must be a hex code like `#ff2d92`."); return; }
        color = parsed;
      }

      const existing = await getCustomRarityBySlug(guildId, slug);
      if (existing) { await interaction.editReply(`❌ A custom tier with slug \`${slug}\` already exists. Use \`/rarity custom edit\` to change it.`); return; }

      // The pre-check above is a UX shortcut. The DB has a unique
      // (guildId, slug) constraint that closes the TOCTOU window if two
      // admins try to create the same slug simultaneously.
      let row;
      try {
        row = await createCustomRarity(guildId, {
          slug, name, emoji, position, worthValue: worth, burnValue: burn,
          color, dropWeight: weight ?? 1.0, droppable: droppable ?? true, inPacks: inPacks ?? false,
          updatedBy: userId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate key|23505/i.test(msg)) {
          await interaction.editReply(`❌ A custom tier with slug \`${slug}\` was just created by someone else. Use \`/rarity custom edit slug:${slug}\` to change it instead.`);
          return;
        }
        throw err;
      }
      const embed = new EmbedBuilder()
        .setTitle(`✨ Created custom tier: ${row.emoji} ${row.name}`)
        .setColor(row.color)
        .addFields(
          { name: "Slug", value: `\`${row.slug}\``, inline: true },
          { name: "Position", value: String(row.position), inline: true },
          { name: "Color", value: hex(row.color), inline: true },
          { name: "Worth", value: `💠 ${row.worthValue.toLocaleString()}`, inline: true },
          { name: "Burn", value: `💠 ${row.burnValue.toLocaleString()}`, inline: true },
          { name: "Drop weight", value: String(row.dropWeight), inline: true },
          { name: "Droppable", value: row.droppable ? "✅" : "❌", inline: true },
          { name: "In packs", value: row.inPacks ? "✅" : "❌", inline: true },
        )
        .setFooter({ text: "Assign cards to this tier with /rarity card assign" });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "edit") {
      const slug = interaction.options.getString("slug", true).trim().toLowerCase();
      const existing = await getCustomRarityBySlug(guildId, slug);
      if (!existing) { await interaction.editReply(`❌ No custom tier with slug \`${slug}\`.`); return; }

      const patch: Parameters<typeof updateCustomRarity>[2] = { updatedBy: userId };
      const name = interaction.options.getString("name");
      const emoji = interaction.options.getString("emoji");
      const position = interaction.options.getNumber("position");
      const worth = interaction.options.getInteger("worth");
      const burn = interaction.options.getInteger("burn");
      const colorRaw = interaction.options.getString("color");
      const weight = interaction.options.getNumber("weight");
      const droppable = interaction.options.getBoolean("droppable");
      const inPacks = interaction.options.getBoolean("inpacks");

      if (name !== null) { if (name.length === 0 || name.length > 32) { await interaction.editReply("❌ Name must be 1-32 chars."); return; } patch.name = name.trim(); }
      if (emoji !== null) { if (emoji.length === 0 || emoji.length > 8) { await interaction.editReply("❌ Emoji must be 1-8 chars."); return; } patch.emoji = emoji.trim(); }
      if (position !== null) { if (!Number.isFinite(position) || position <= 0 || position > 100) { await interaction.editReply("❌ Position must be > 0 and ≤ 100."); return; } patch.position = position; }
      if (worth !== null) { if (worth < 0) { await interaction.editReply("❌ Worth must be ≥ 0."); return; } patch.worthValue = worth; }
      if (burn !== null) { if (burn < 0) { await interaction.editReply("❌ Burn must be ≥ 0."); return; } patch.burnValue = burn; }
      if (colorRaw !== null) { const parsed = parseHexColor(colorRaw); if (parsed === null) { await interaction.editReply("❌ Color must be a hex code like `#ff2d92`."); return; } patch.color = parsed; }
      if (weight !== null) patch.dropWeight = weight;
      if (droppable !== null) patch.droppable = droppable;
      if (inPacks !== null) patch.inPacks = inPacks;

      if (Object.keys(patch).length <= 1) { await interaction.editReply("❌ Provide at least one field to change."); return; }
      const updated = await updateCustomRarity(guildId, slug, patch);
      if (!updated) { await interaction.editReply("❌ Update failed — tier may have been deleted."); return; }
      await interaction.editReply(`✅ Updated custom tier **${updated.emoji} ${updated.name}** (\`${updated.slug}\`).`);
      return;
    }

    if (sub === "remove") {
      const slug = interaction.options.getString("slug", true).trim().toLowerCase();
      const { removed, clearedAssignments } = await deleteCustomRarity(guildId, slug);
      if (!removed) { await interaction.editReply(`❌ No custom tier with slug \`${slug}\`.`); return; }
      await interaction.editReply(`🗑️ Removed custom tier \`${slug}\`. Cleared **${clearedAssignments}** card assignment(s) — those cards revert to their built-in rarity.`);
      return;
    }

    if (sub === "list") {
      const rows = await listCustomRarities(guildId);
      const embed = new EmbedBuilder()
        .setTitle("🎨 Custom Rarity Tiers")
        .setColor(0x5865f2)
        .setDescription(rows.length === 0
          ? "_No custom tiers yet. Create one with `/rarity custom add`._"
          : `${rows.length} custom tier${rows.length === 1 ? "" : "s"} in this server. Built-ins occupy positions 1-6.`);
      for (const r of rows) {
        embed.addFields({
          name: `${r.emoji} ${r.name} (\`${r.slug}\`)`,
          value:
            `Position **${r.position}** · Color ${hex(r.color)}\n` +
            `Worth 💠 ${r.worthValue.toLocaleString()} · Burn 💠 ${r.burnValue.toLocaleString()} · Drop weight ${r.dropWeight}\n` +
            `Droppable ${r.droppable ? "✅" : "❌"} · In packs ${r.inPacks ? "✅" : "❌"}`,
          inline: false,
        });
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

  // ── card (assign/unassign a card to a custom tier) ───────────────────────
  if (group === "card") {
    if (sub === "assign") {
      const cardName = interaction.options.getString("card", true).trim();
      const slug = interaction.options.getString("slug", true).trim().toLowerCase();
      const card = await getCardByName(cardName);
      if (!card) { await interaction.editReply(`❌ No card named **${cardName}**.`); return; }
      const tier = await getCustomRarityBySlug(guildId, slug);
      if (!tier) { await interaction.editReply(`❌ No custom tier \`${slug}\`. Create one with \`/rarity custom add\` or list with \`/rarity custom list\`.`); return; }
      await assignCardToCustomRarity(guildId, card.id, slug);
      await interaction.editReply(`✅ **${card.name}** is now in custom tier ${tier.emoji} **${tier.name}** (worth 💠 ${tier.worthValue.toLocaleString()}, burn 💠 ${tier.burnValue.toLocaleString()}, drop weight ${tier.dropWeight}).`);
      return;
    }
    if (sub === "unassign") {
      const cardName = interaction.options.getString("card", true).trim();
      const card = await getCardByName(cardName);
      if (!card) { await interaction.editReply(`❌ No card named **${cardName}**.`); return; }
      const removed = await unassignCardCustomRarity(guildId, card.id);
      const r = card.rarity as Rarity;
      await interaction.editReply(
        removed
          ? `🔄 **${card.name}** is back to its built-in rarity ${RARITY_EMOJI[r] ?? "🃏"} **${RARITY_LABELS[r] ?? r}**.`
          : `ℹ️ **${card.name}** was not assigned to any custom tier.`,
      );
      return;
    }
  }

  await interaction.editReply("❌ Unknown rarity subcommand.");
}

// Card-name autocomplete for /rarity card assign|unassign is handled by the
// shared autocomplete handler (it already routes any unrecognized card-name
// option to the full roster).
export { BUILTIN_RARITIES, RARITY_COLORS };
