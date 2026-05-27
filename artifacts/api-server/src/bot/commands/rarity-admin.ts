// /rarity — admin command that owns ALL gameplay-rarity writes.
// Replaces the old website rarity editors. Three subcommand groups:
//   /rarity profile set|reset|list       — per-built-in-rarity worth/burn/weight overrides
//   /rarity custom add|edit|remove|list  — define brand-new rarity tiers per guild
//   /rarity card assign|unassign         — put a specific card into a custom tier
//
// Discord = source of truth. The website only ever READS these tables.
import {
  EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import {
  upsertRarityProfile, deleteRarityProfile, listRarityProfiles,
  createCustomRarity, updateCustomRarity, deleteCustomRarity,
  listCustomRarities, getCustomRarityBySlug,
  assignCardToCustomRarity, unassignCardCustomRarity,
  getCardByName,
  getRarityDisplayOverrides, upsertRarityDisplayOverride,
  clearRarityDisplayOverride, clearAllRarityDisplayOverrides,
  getOrCreateGuildSettings,
} from "../db.js";
import {
  RARITY_EMOJI, RARITY_LABELS, RARITY_COLORS, type Rarity, type RarityDisplayMap,
} from "../cards-data.js";

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

  // ── edit — cosmetic display overrides (no group) ──────────────────────────
  if (!group && sub === "edit") {
    const displayMap = await getRarityDisplayOverrides(guildId);
    const settings = await getOrCreateGuildSettings(guildId);
    await interaction.editReply(buildEditPanel(displayMap, settings));
    return;
  }

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

// ── /rarity edit — interactive cosmetic panel ────────────────────────────────
// Shows all 6 built-in tiers with their current display overrides. Select a
// tier from the dropdown, then use modal-backed buttons to change name/emoji/
// color for this server. Resets wipe back to defaults. Economy is untouched.

type EditSettings = { mythicLabel?: string | null; mythicEmoji?: string | null; mythicColor?: number | null };

function getEffectiveDisplay(r: Rarity, displayMap: RarityDisplayMap, settings: EditSettings | null) {
  const ov = displayMap.get(r);
  const label = ov?.displayName?.trim()
    || (r === "mythic" && settings?.mythicLabel?.trim() ? settings.mythicLabel.trim() : RARITY_LABELS[r]);
  const emoji = ov?.emoji?.trim()
    || (r === "mythic" && settings?.mythicEmoji?.trim() ? settings.mythicEmoji.trim() : RARITY_EMOJI[r]);
  const color = ov?.color != null
    ? ov.color
    : (r === "mythic" && settings?.mythicColor != null ? settings.mythicColor : RARITY_COLORS[r]);
  return { label, emoji, color: color ?? 0x5865f2, hasOverride: !!ov };
}

function buildEditPanel(
  displayMap: RarityDisplayMap,
  settings: EditSettings | null,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("🎨 Rarity Display Overrides")
    .setColor(0x5865f2)
    .setDescription(
      "Rename any built-in rarity tier for this server — changes display name, emoji, and embed color " +
      "in spawns, collections, packs, and trade-ins. Economy values (worth/burn/weight) are unaffected.\n\u200b",
    );
  for (const r of BUILTIN_RARITIES) {
    const { label, emoji, color, hasOverride } = getEffectiveDisplay(r, displayMap, settings);
    embed.addFields({
      name: `${emoji} ${label}`,
      value: hasOverride ? `\`${hex(color)}\` *(overrides active)*` : `\`${hex(color)}\` *(defaults)*`,
      inline: true,
    });
  }
  embed.setFooter({ text: "Select a tier below to edit it · Reset All clears every override" });

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rarity_edit:select")
      .setPlaceholder("Pick a rarity tier to edit…")
      .addOptions(
        BUILTIN_RARITIES.map(r => {
          const { label, emoji, hasOverride } = getEffectiveDisplay(r, displayMap, settings);
          return { label, emoji, value: r, description: hasOverride ? "Has overrides" : "Using defaults" };
        }),
      ),
  );
  const resetAllRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("rarity_edit:resetall")
      .setLabel("🗑️ Reset All Overrides")
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [selectRow, resetAllRow] };
}

function buildTierPanel(
  r: Rarity,
  displayMap: RarityDisplayMap,
  settings: EditSettings | null,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const { label, emoji, color, hasOverride } = getEffectiveDisplay(r, displayMap, settings);
  const ov = displayMap.get(r);
  const defLabel = r === "mythic" && settings?.mythicLabel?.trim() ? settings.mythicLabel.trim() : RARITY_LABELS[r];
  const defEmoji = r === "mythic" && settings?.mythicEmoji?.trim() ? settings.mythicEmoji.trim() : RARITY_EMOJI[r];
  const defColor = r === "mythic" && settings?.mythicColor != null ? settings.mythicColor : (RARITY_COLORS[r] ?? 0x5865f2);

  const embed = new EmbedBuilder()
    .setTitle(`🎨 Edit: ${emoji} ${label}`)
    .setColor(color)
    .addFields(
      {
        name: "Display Name",
        value: ov?.displayName ? `**${ov.displayName}** *(overridden)*` : `${defLabel} *(default)*`,
        inline: true,
      },
      {
        name: "Emoji",
        value: ov?.emoji ? `${ov.emoji} *(overridden)*` : `${defEmoji} *(default)*`,
        inline: true,
      },
      {
        name: "Color",
        value: ov?.color != null ? `\`${hex(ov.color)}\` *(overridden)*` : `\`${hex(defColor)}\` *(default)*`,
        inline: true,
      },
    )
    .setFooter({ text: "Changes apply immediately across all bot embeds for this server" });

  if (!hasOverride) embed.setDescription("*All fields are currently at defaults.*\n\u200b");

  const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rarity_edit:name:${r}`).setLabel("📝 Set Name").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rarity_edit:emoji:${r}`).setLabel("😀 Set Emoji").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rarity_edit:color:${r}`).setLabel("🎨 Set Color").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rarity_edit:reset:${r}`).setLabel("🔄 Reset Tier").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("rarity_edit:back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  const previewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rarity_edit:preview:${r}`).setLabel("👁️ Preview Tier").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [editRow, previewRow] };
}

export async function handleRarityEditButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.deferUpdate(); return; }
  const guildId = interaction.guild.id;
  const parts = interaction.customId.split(":");
  const action = parts[1]!;
  const rarityPart = parts[2] as Rarity | undefined;

  if (action === "back" || action === "resetall") {
    await interaction.deferUpdate();
    if (action === "resetall") await clearAllRarityDisplayOverrides(guildId);
    const [displayMap, settings] = await Promise.all([
      getRarityDisplayOverrides(guildId),
      getOrCreateGuildSettings(guildId),
    ]);
    await interaction.editReply(buildEditPanel(displayMap, settings));
    return;
  }

  if (action === "reset" && rarityPart && BUILTIN_RARITIES.includes(rarityPart)) {
    await interaction.deferUpdate();
    await clearRarityDisplayOverride(guildId, rarityPart);
    const [displayMap, settings] = await Promise.all([
      getRarityDisplayOverrides(guildId),
      getOrCreateGuildSettings(guildId),
    ]);
    await interaction.editReply(buildTierPanel(rarityPart, displayMap, settings));
    return;
  }

  if (action === "preview" && rarityPart && BUILTIN_RARITIES.includes(rarityPart)) {
    await interaction.deferReply({ ephemeral: true });
    const [displayMap, settings] = await Promise.all([
      getRarityDisplayOverrides(guildId),
      getOrCreateGuildSettings(guildId),
    ]);
    const { label, emoji, color } = getEffectiveDisplay(rarityPart, displayMap, settings);
    const sampleCard = { name: "Dark Titan", dropWeight: 1.0, worthValue: 2500, burnValue: 1250 };
    const preview = new EmbedBuilder()
      .setTitle(`${emoji} ${label} — Preview`)
      .setColor(color)
      .setDescription(
        `This is how **${label}** tier cards will appear in bot embeds for this server.\n\n` +
        `**Sample card:** ${emoji} **${sampleCard.name}**\n` +
        `Worth: 💠 ${sampleCard.worthValue.toLocaleString()} · Burn: 🔥 ${sampleCard.burnValue.toLocaleString()}`,
      )
      .setFooter({ text: "Dismiss this preview — your changes are already live" });
    await interaction.followUp({ embeds: [preview], ephemeral: true });
    return;
  }

  // name, emoji, color — show modal (MUST be first response; no deferUpdate).
  if ((action === "name" || action === "emoji" || action === "color") && rarityPart && BUILTIN_RARITIES.includes(rarityPart)) {
    const cfgs = {
      name:  { label: "Display Name",  placeholder: "e.g. Cosmic, Prismatic, Ultra (1–32 chars)", max: 32 },
      emoji: { label: "Emoji",          placeholder: "e.g. 🌈 or 💫 (leave blank to clear)", max: 8 },
      color: { label: "Color (hex)",    placeholder: "e.g. #ff2d92 or #00d4ff (leave blank to clear)", max: 9 },
    } as const;
    const cfg = cfgs[action];
    const modal = new ModalBuilder()
      .setCustomId(`rarity_edit:modal:${action}:${rarityPart}`)
      .setTitle(`Edit ${RARITY_LABELS[rarityPart]} — ${cfg.label}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("value")
            .setLabel(cfg.label)
            .setPlaceholder(cfg.placeholder)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(cfg.max)
            .setRequired(false),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();
}

export async function handleRarityEditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.deferUpdate(); return; }
  await interaction.deferUpdate();
  const guildId = interaction.guild.id;
  const r = interaction.values[0] as Rarity;
  if (!BUILTIN_RARITIES.includes(r)) return;
  const [displayMap, settings] = await Promise.all([
    getRarityDisplayOverrides(guildId),
    getOrCreateGuildSettings(guildId),
  ]);
  await interaction.editReply(buildTierPanel(r, displayMap, settings));
}

export async function handleRarityEditModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.deferUpdate(); return; }
  await interaction.deferUpdate();
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  // customId: rarity_edit:modal:<action>:<rarity>
  const parts = interaction.customId.split(":");
  const action = parts[2] as "name" | "emoji" | "color";
  const r = parts[3] as Rarity;
  if (!BUILTIN_RARITIES.includes(r)) return;

  const raw = interaction.fields.getTextInputValue("value").trim();

  if (action === "name") {
    if (raw.length === 0) {
      await upsertRarityDisplayOverride(guildId, r, { displayName: null }, userId);
    } else {
      await upsertRarityDisplayOverride(guildId, r, { displayName: raw }, userId);
    }
  } else if (action === "emoji") {
    if (raw.length === 0) {
      await upsertRarityDisplayOverride(guildId, r, { emoji: null }, userId);
    } else {
      await upsertRarityDisplayOverride(guildId, r, { emoji: raw }, userId);
    }
  } else if (action === "color") {
    if (raw.length === 0) {
      await upsertRarityDisplayOverride(guildId, r, { color: null }, userId);
    } else {
      const parsed = parseHexColor(raw);
      if (parsed === null) {
        await interaction.followUp({ content: "❌ Color must be a valid hex code like `#ff2d92`.", flags: MessageFlags.Ephemeral });
      } else {
        await upsertRarityDisplayOverride(guildId, r, { color: parsed }, userId);
      }
    }
  }

  const [displayMap, settings] = await Promise.all([
    getRarityDisplayOverrides(guildId),
    getOrCreateGuildSettings(guildId),
  ]);
  await interaction.editReply(buildTierPanel(r, displayMap, settings));
}
