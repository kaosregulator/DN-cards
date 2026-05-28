// /rarity — single hub command. Four sections accessed via buttons:
//   🎨 Display Names  — cosmetic overrides per built-in tier
//   📊 Economy        — worth/burn/weight profile overrides per tier
//   ✨ Custom Tiers    — brand-new tiers beyond the 6 built-ins
//   🃏 Card Tiers      — assign/unassign cards to custom tiers
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

export const BUILTIN_RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
export { RARITY_COLORS };

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  if (v === null || v === undefined) return "*(default)*";
  return `${v.toLocaleString()}${suffix}`;
}

type ProfileRow = { rarity: string; worthValue: number | null; burnValue: number | null; dropWeight: number | null };
type CustomRow = Awaited<ReturnType<typeof listCustomRarities>>[number];

// ── Hub ───────────────────────────────────────────────────────────────────────

function buildHubPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎨 Rarity Hub")
    .setColor(0x5865f2)
    .setDescription(
      "Manage all rarity settings for this server.\n\n" +
      "**🎨 Display Names** — rename, recolor, or change the emoji of any built-in tier\n" +
      "**📊 Economy Overrides** — adjust worth, burn value, or spawn % per tier\n" +
      "**✨ Custom Tiers** — create tiers beyond Common → Mythic\n" +
      "**🃏 Card Tiers** — move a card into a custom tier\n\u200b",
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rarity_hub:display").setLabel("🎨 Display Names").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("rarity_hub:economy").setLabel("📊 Economy Overrides").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("rarity_hub:custom").setLabel("✨ Custom Tiers").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rarity_hub:cardtier").setLabel("🃏 Card Tiers").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export async function handleRarityHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }
  await interaction.editReply(buildHubPanel());
}

// ── Economy Overrides ─────────────────────────────────────────────────────────

function buildEconomyPanel(profiles: ProfileRow[]) {
  const byRarity = new Map(profiles.map(r => [r.rarity as Rarity, r]));
  const embed = new EmbedBuilder()
    .setTitle("📊 Economy Overrides")
    .setColor(0x5865f2)
    .setDescription(
      "Set worth, burn, and the visible spawn % source for any built-in tier. " +
      "Overrides apply to **every card in that tier** for this server.\n" +
      "Pick a tier from the menu to configure it.\n\u200b",
    );
  for (const r of BUILTIN_RARITIES) {
    const row = byRarity.get(r);
    const hasAny = row && (row.worthValue !== null || row.burnValue !== null || row.dropWeight !== null);
    embed.addFields({
      name: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}`,
      value: hasAny
        ? `Worth: ${fmtVal(row?.worthValue, " 💠")} · Burn: ${fmtVal(row?.burnValue, " 💠")} · Spawn %: ${fmtVal(row?.dropWeight)}`
        : "*(using card defaults)*",
      inline: false,
    });
  }
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rarity_hub:economy:select")
      .setPlaceholder("Pick a tier to configure…")
      .addOptions(BUILTIN_RARITIES.map(r => {
        const row = byRarity.get(r);
        const parts: string[] = [];
        if (row?.worthValue != null) parts.push(`Worth: ${row.worthValue}`);
        if (row?.burnValue != null) parts.push(`Burn: ${row.burnValue}`);
        if (row?.dropWeight != null) parts.push(`Spawn %: ${row.dropWeight}`);
        return {
          label: `${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}`,
          value: r,
          description: (parts.length ? parts.join(" · ") : "No overrides").slice(0, 100),
        };
      })),
  );
  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rarity_hub:economy:resetall").setLabel("🔄 Reset All").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("rarity_hub:main").setLabel("← Hub").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [selectRow, btnRow] };
}

function buildEconomyTierPanel(rarity: Rarity, profile: ProfileRow | undefined) {
  const label = RARITY_LABELS[rarity];
  const emoji = RARITY_EMOJI[rarity];
  const hasOverride = profile && (profile.worthValue !== null || profile.burnValue !== null || profile.dropWeight !== null);
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${emoji} ${label} — Economy`)
    .setColor(RARITY_COLORS[rarity] ?? 0x5865f2)
    .addFields(
      { name: "Worth", value: fmtVal(profile?.worthValue, " 💠"), inline: true },
      { name: "Burn", value: fmtVal(profile?.burnValue, " 💠"), inline: true },
      { name: "Spawn % Source", value: fmtVal(profile?.dropWeight), inline: true },
    );
  if (!hasOverride) embed.setDescription("*No overrides — cards in this tier use their own values.*\n\u200b");
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rarity_hub:economy:set:${rarity}`).setLabel("✏️ Set Overrides").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rarity_hub:economy:reset:${rarity}`).setLabel("🔄 Reset").setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rarity_hub:economy").setLabel("← Economy").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rarity_hub:main").setLabel("← Hub").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row1, row2] };
}

// ── Custom Tiers ──────────────────────────────────────────────────────────────

function buildCustomPanel(tiers: CustomRow[]) {
  const embed = new EmbedBuilder()
    .setTitle("✨ Custom Tiers")
    .setColor(0x5865f2)
    .setDescription(
      tiers.length === 0
        ? "_No custom tiers yet. Click **Add Tier** to create one._\n\u200b"
        : `${tiers.length} custom tier${tiers.length === 1 ? "" : "s"} in this server. Built-ins occupy positions 1–6.\n\u200b`,
    );
  for (const t of tiers) {
    embed.addFields({
      name: `${t.emoji} ${t.name}`,
      value:
        `Position **${t.position}** · Color ${hex(t.color)}\n` +
        `Worth 💠 ${t.worthValue.toLocaleString()} · Burn 💠 ${t.burnValue.toLocaleString()} · Spawn % ${t.dropWeight}\n` +
        `Spawns: ${t.droppable ? "✅" : "❌"} · In packs: ${t.inPacks ? "✅" : "❌"}`,
      inline: false,
    });
  }
  const btns: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId("rarity_hub:custom:add").setLabel("➕ Add Tier").setStyle(ButtonStyle.Success),
  ];
  if (tiers.length > 0) {
    btns.push(
      new ButtonBuilder().setCustomId("rarity_hub:custom:edit").setLabel("✏️ Edit Tier").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("rarity_hub:custom:remove").setLabel("🗑️ Remove Tier").setStyle(ButtonStyle.Danger),
    );
  }
  btns.push(new ButtonBuilder().setCustomId("rarity_hub:main").setLabel("← Hub").setStyle(ButtonStyle.Secondary));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btns);
  return { embeds: [embed], components: [row] };
}

function buildCustomSelectPanel(tiers: CustomRow[], action: "edit" | "remove") {
  const embed = new EmbedBuilder()
    .setTitle(action === "edit" ? "✏️ Pick a Tier to Edit" : "🗑️ Pick a Tier to Remove")
    .setColor(action === "edit" ? 0x5865f2 : 0xe74c3c)
    .setDescription(
      action === "remove"
        ? "⚠️ Cards in the removed tier will revert to their built-in rarity.\n\u200b"
        : "Select a custom tier to edit.\n\u200b",
    );
  const select = new StringSelectMenuBuilder()
    .setCustomId(`rarity_hub:custom:select:${action}`)
    .setPlaceholder("Pick a custom tier…")
    .addOptions(tiers.slice(0, 25).map(t => ({
      label: `${t.emoji} ${t.name}`,
      value: t.slug,
      description: `Worth ${t.worthValue} · Burn ${t.burnValue} · Weight ${t.dropWeight}`.slice(0, 100),
    })));
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rarity_hub:custom").setLabel("← Custom Tiers").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [selectRow, backRow] };
}

// ── Card Tiers ────────────────────────────────────────────────────────────────

function buildCardTierPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🃏 Card Tier Assignments")
    .setColor(0x5865f2)
    .setDescription(
      "Assign a card into a custom tier — the tier's worth, burn, and spawn % source replace the card's own values.\n" +
      "Unassigning reverts the card back to its built-in rarity.\n\u200b",
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rarity_hub:cardtier:assign").setLabel("📌 Assign Card to Tier").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("rarity_hub:cardtier:unassign").setLabel("🔓 Unassign Card").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rarity_hub:main").setLabel("← Hub").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ── Button Handler ────────────────────────────────────────────────────────────
// Buttons that open modals MUST NOT call deferUpdate first.

export async function handleRarityHubButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.deferUpdate(); return; }
  const parts = interaction.customId.split(":");
  // parts: ["rarity_hub", section, sub?, extra?]
  const section = parts[1]!;
  const sub = parts[2];
  const extra = parts[3];

  // ── Economy: set override → modal (no defer) ──────────────────────────────
  if (section === "economy" && sub === "set" && extra && BUILTIN_RARITIES.includes(extra as Rarity)) {
    const r = extra as Rarity;
    const modal = new ModalBuilder()
      .setCustomId(`rarity_hub:modal:economy:${r}`)
      .setTitle(`${RARITY_EMOJI[r]} ${RARITY_LABELS[r]} — Set Overrides`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("worth").setLabel("Worth (💠 shards)").setStyle(TextInputStyle.Short)
            .setRequired(false).setPlaceholder("Leave blank to keep current value").setMaxLength(10),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("burn").setLabel("Burn value (💠 shards)").setStyle(TextInputStyle.Short)
            .setRequired(false).setPlaceholder("Leave blank to keep current value").setMaxLength(10),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("weight").setLabel("Drop % (0 = disabled, e.g. 1.5)").setStyle(TextInputStyle.Short)
            .setRequired(false).setPlaceholder("Leave blank to keep current value").setMaxLength(10),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // ── Custom: add → modal (no defer) ───────────────────────────────────────
  if (section === "custom" && sub === "add") {
    const modal = new ModalBuilder()
      .setCustomId("rarity_hub:modal:custom:add")
      .setTitle("Create Custom Tier")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("name").setLabel("Display name (e.g. Ultra, Prismatic)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(32),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("emoji").setLabel("Emoji (e.g. 🌈 or 💫)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(8),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("position").setLabel("Position (1=Common … 6=Mythic, 5.5=between)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(10).setPlaceholder("e.g. 5.5 to sit between Legendary and Mythic"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("worth").setLabel("Worth (💠 shards per card — burn = 50%)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(10).setPlaceholder("e.g. 3000"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("drop").setLabel("Drop % (0 = disabled, e.g. 15)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(10).setPlaceholder("e.g. 15 for ~15% of spawns"),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // ── Card tier: assign / unassign → modal (no defer) ──────────────────────
  if (section === "cardtier" && sub === "assign") {
    const modal = new ModalBuilder()
      .setCustomId("rarity_hub:modal:cardtier:assign")
      .setTitle("Assign Card to Custom Tier")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("card").setLabel("Card name (exact)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(100),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("tier").setLabel("Custom tier name (e.g. Ultra)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(100),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (section === "cardtier" && sub === "unassign") {
    const modal = new ModalBuilder()
      .setCustomId("rarity_hub:modal:cardtier:unassign")
      .setTitle("Unassign Card from Custom Tier")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("card").setLabel("Card name (exact)").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(100),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // ── All other buttons (no modal) — safe to defer ──────────────────────────
  await interaction.deferUpdate();
  const guildId = interaction.guild.id;

  if (section === "main") {
    await interaction.editReply(buildHubPanel());
    return;
  }

  if (section === "display") {
    const [displayMap, settings] = await Promise.all([
      getRarityDisplayOverrides(guildId),
      getOrCreateGuildSettings(guildId),
    ]);
    await interaction.editReply(buildEditPanel(displayMap, settings));
    return;
  }

  if (section === "economy") {
    if (!sub) {
      const profiles = await listRarityProfiles(guildId);
      await interaction.editReply(buildEconomyPanel(profiles));
      return;
    }
    if (sub === "resetall") {
      for (const r of BUILTIN_RARITIES) await deleteRarityProfile(guildId, r);
      const profiles = await listRarityProfiles(guildId);
      await interaction.editReply(buildEconomyPanel(profiles));
      return;
    }
    if (sub === "reset" && extra) {
      await deleteRarityProfile(guildId, extra as Rarity);
      const profiles = await listRarityProfiles(guildId);
      const profile = profiles.find(p => p.rarity === extra);
      await interaction.editReply(buildEconomyTierPanel(extra as Rarity, profile));
      return;
    }
    if (sub === "economy" && !extra) {
      const profiles = await listRarityProfiles(guildId);
      await interaction.editReply(buildEconomyPanel(profiles));
      return;
    }
  }

  if (section === "custom") {
    if (!sub) {
      const tiers = await listCustomRarities(guildId);
      await interaction.editReply(buildCustomPanel(tiers));
      return;
    }
    if (sub === "edit") {
      const tiers = await listCustomRarities(guildId);
      if (tiers.length === 0) {
        await interaction.followUp({ content: "❌ No custom tiers to edit. Add one first.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.editReply(buildCustomSelectPanel(tiers, "edit"));
      return;
    }
    if (sub === "remove") {
      const tiers = await listCustomRarities(guildId);
      if (tiers.length === 0) {
        await interaction.followUp({ content: "❌ No custom tiers to remove.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.editReply(buildCustomSelectPanel(tiers, "remove"));
      return;
    }
  }

  if (section === "cardtier" && !sub) {
    await interaction.editReply(buildCardTierPanel());
    return;
  }
}

// ── Select Menu Handler ───────────────────────────────────────────────────────

export async function handleRarityHubSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.deferUpdate(); return; }
  const guildId = interaction.guild.id;
  const parts = interaction.customId.split(":");
  // "rarity_hub:economy:select" or "rarity_hub:custom:select:edit|remove"
  const section = parts[1]!;
  const sub = parts[2];
  const action = parts[3] as "edit" | "remove" | undefined;

  if (section === "economy" && sub === "select") {
    await interaction.deferUpdate();
    const r = interaction.values[0] as Rarity;
    const profiles = await listRarityProfiles(guildId);
    const profile = profiles.find(p => p.rarity === r);
    await interaction.editReply(buildEconomyTierPanel(r, profile));
    return;
  }

  if (section === "custom" && sub === "select" && action === "remove") {
    await interaction.deferUpdate();
    const slug = interaction.values[0]!;
    const { removed, clearedAssignments } = await deleteCustomRarity(guildId, slug);
    const tiers = await listCustomRarities(guildId);
    const panel = buildCustomPanel(tiers);
    if (removed) {
      panel.embeds[0]!.setFooter({ text: `✅ Removed "${slug}" — ${clearedAssignments} card assignment(s) cleared` });
    } else {
      panel.embeds[0]!.setFooter({ text: `❌ Tier "${slug}" not found` });
    }
    await interaction.editReply(panel);
    return;
  }

  if (section === "custom" && sub === "select" && action === "edit") {
    const slug = interaction.values[0]!;
    const tier = await getCustomRarityBySlug(guildId, slug);
    if (!tier) {
      await interaction.deferUpdate();
      const tiers = await listCustomRarities(guildId);
      await interaction.editReply(buildCustomPanel(tiers));
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`rarity_hub:modal:custom:edit:${slug}`)
      .setTitle(`Edit: ${tier.emoji} ${tier.name}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("name").setLabel("Display name").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(32).setValue(tier.name),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("emoji").setLabel("Emoji").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(8).setValue(tier.emoji),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("drop").setLabel("Drop % (0 = disabled, e.g. 15)").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(10).setValue(String(tier.dropWeight)),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("worth").setLabel("Worth (💠 shards)").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(10).setValue(String(tier.worthValue)),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("burn").setLabel("Burn (💠 shards)").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(10).setValue(String(tier.burnValue)),
        ),
      );
    await interaction.showModal(modal);
    return;
  }
}

// ── Modal Handler ─────────────────────────────────────────────────────────────

export async function handleRarityHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.deferUpdate(); return; }
  await interaction.deferUpdate();
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":");
  // "rarity_hub:modal:<section>:<extra>[:<slug>]"
  const section = parts[2]!;
  const extra = parts[3];
  const slugExtra = parts[4];

  // ── Economy modal ─────────────────────────────────────────────────────────
  if (section === "economy" && extra) {
    const r = extra as Rarity;
    const worthRaw = interaction.fields.getTextInputValue("worth").trim();
    const burnRaw = interaction.fields.getTextInputValue("burn").trim();
    const weightRaw = interaction.fields.getTextInputValue("weight").trim();

    const patch: { worthValue?: number; burnValue?: number; dropWeight?: number; updatedBy?: string } = { updatedBy: userId };
    if (worthRaw) {
      const v = parseInt(worthRaw, 10);
      if (isNaN(v) || v < 0) { await interaction.followUp({ content: "❌ Worth must be a non-negative whole number.", flags: MessageFlags.Ephemeral }); return; }
      patch.worthValue = v;
    }
    if (burnRaw) {
      const v = parseInt(burnRaw, 10);
      if (isNaN(v) || v < 0) { await interaction.followUp({ content: "❌ Burn must be a non-negative whole number.", flags: MessageFlags.Ephemeral }); return; }
      patch.burnValue = v;
    }
    if (weightRaw) {
      const v = parseFloat(weightRaw);
      if (isNaN(v) || v < 0) { await interaction.followUp({ content: "❌ Drop % source must be a non-negative number.", flags: MessageFlags.Ephemeral }); return; }
      patch.dropWeight = v;
    }
    if (Object.keys(patch).length <= 1) {
      await interaction.followUp({ content: "❌ Fill in at least one field.", flags: MessageFlags.Ephemeral });
      return;
    }
    await upsertRarityProfile(guildId, r, patch);
    const profiles = await listRarityProfiles(guildId);
    const profile = profiles.find(p => p.rarity === r);
    await interaction.editReply(buildEconomyTierPanel(r, profile));
    return;
  }

  // ── Custom tier: add ──────────────────────────────────────────────────────
  if (section === "custom" && extra === "add") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const emoji = interaction.fields.getTextInputValue("emoji").trim();
    const positionRaw = interaction.fields.getTextInputValue("position").trim();
    const worthRaw = interaction.fields.getTextInputValue("worth").trim();
    const dropRaw = interaction.fields.getTextInputValue("drop").trim();

    if (!name || name.length > 32) { await interaction.followUp({ content: "❌ Name must be 1–32 chars.", flags: MessageFlags.Ephemeral }); return; }
    if (!emoji || emoji.length > 8) { await interaction.followUp({ content: "❌ Emoji must be 1–8 chars.", flags: MessageFlags.Ephemeral }); return; }
    const position = parseFloat(positionRaw);
    if (isNaN(position) || position <= 0 || position > 100) { await interaction.followUp({ content: "❌ Position must be 0.01–100 (e.g. 5.5 = between Legendary and Mythic).", flags: MessageFlags.Ephemeral }); return; }
    const worth = parseInt(worthRaw, 10);
    if (isNaN(worth) || worth < 0) { await interaction.followUp({ content: "❌ Worth must be a non-negative whole number.", flags: MessageFlags.Ephemeral }); return; }
    const drop = parseFloat(dropRaw);
    if (isNaN(drop) || drop < 0 || drop > 100) { await interaction.followUp({ content: "❌ Drop % must be 0–100.", flags: MessageFlags.Ephemeral }); return; }
    const burn = Math.floor(worth * 0.5);

    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "tier";
    let attempts = 0;
    while (attempts < 5) {
      try {
        await createCustomRarity(guildId, {
          slug, name, emoji, position, worthValue: worth, burnValue: burn,
          color: 0x5865f2, dropWeight: drop, droppable: drop > 0, inPacks: false,
          updatedBy: userId,
        });
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate key|23505/i.test(msg)) {
          attempts++;
          slug = (slug.replace(/_\d+$/, "") + `_${attempts + 1}`).slice(0, 32);
        } else throw err;
      }
    }
    const tiers = await listCustomRarities(guildId);
    const panel = buildCustomPanel(tiers);
    panel.embeds[0]!.setFooter({ text: `✅ Created tier "${name}"` });
    await interaction.editReply(panel);
    return;
  }

  // ── Custom tier: edit ─────────────────────────────────────────────────────
  if (section === "custom" && extra === "edit" && slugExtra) {
    const name = interaction.fields.getTextInputValue("name").trim();
    const emoji = interaction.fields.getTextInputValue("emoji").trim();
    const dropRaw = interaction.fields.getTextInputValue("drop").trim();
    const worthRaw = interaction.fields.getTextInputValue("worth").trim();
    const burnRaw = interaction.fields.getTextInputValue("burn").trim();

    const patch: Parameters<typeof updateCustomRarity>[2] = { updatedBy: userId };
    if (name) { if (name.length > 32) { await interaction.followUp({ content: "❌ Name too long (max 32 chars).", flags: MessageFlags.Ephemeral }); return; } patch.name = name; }
    if (emoji) { if (emoji.length > 8) { await interaction.followUp({ content: "❌ Emoji too long (max 8 chars).", flags: MessageFlags.Ephemeral }); return; } patch.emoji = emoji; }
    if (dropRaw) { const v = parseFloat(dropRaw); if (isNaN(v) || v < 0 || v > 100) { await interaction.followUp({ content: "❌ Drop % must be 0–100.", flags: MessageFlags.Ephemeral }); return; } patch.dropWeight = v; patch.droppable = v > 0; }
    if (worthRaw) { const v = parseInt(worthRaw, 10); if (isNaN(v) || v < 0) { await interaction.followUp({ content: "❌ Worth must be ≥ 0.", flags: MessageFlags.Ephemeral }); return; } patch.worthValue = v; }
    if (burnRaw) { const v = parseInt(burnRaw, 10); if (isNaN(v) || v < 0) { await interaction.followUp({ content: "❌ Burn must be ≥ 0.", flags: MessageFlags.Ephemeral }); return; } patch.burnValue = v; }

    if (Object.keys(patch).length <= 1) {
      await interaction.followUp({ content: "❌ Change at least one field.", flags: MessageFlags.Ephemeral });
      return;
    }
    const updated = await updateCustomRarity(guildId, slugExtra, patch);
    const tiers = await listCustomRarities(guildId);
    const panel = buildCustomPanel(tiers);
    if (updated) panel.embeds[0]!.setFooter({ text: `✅ Updated "${updated.name}"` });
    await interaction.editReply(panel);
    return;
  }

  // ── Card tier: assign ─────────────────────────────────────────────────────
  if (section === "cardtier" && extra === "assign") {
    const cardName = interaction.fields.getTextInputValue("card").trim();
    const tierInput = interaction.fields.getTextInputValue("tier").trim().toLowerCase();
    const card = await getCardByName(cardName);
    if (!card) { await interaction.followUp({ content: `❌ No card named **${cardName}**.`, flags: MessageFlags.Ephemeral }); return; }
    const tiers = await listCustomRarities(guildId);
    const tier = tiers.find(t => t.slug === tierInput || t.name.toLowerCase() === tierInput);
    if (!tier) {
      const names = tiers.map(t => `${t.emoji} ${t.name}`).join(", ") || "none created yet";
      await interaction.followUp({ content: `❌ No custom tier named **"${tierInput}"**.\nAvailable: ${names}`, flags: MessageFlags.Ephemeral });
      return;
    }
    await assignCardToCustomRarity(guildId, card.id, tier.slug);
    await interaction.followUp({
      content: `✅ **${card.name}** → ${tier.emoji} **${tier.name}** (worth 💠 ${tier.worthValue.toLocaleString()}, burn 💠 ${tier.burnValue.toLocaleString()}).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Card tier: unassign ───────────────────────────────────────────────────
  if (section === "cardtier" && extra === "unassign") {
    const cardName = interaction.fields.getTextInputValue("card").trim();
    const card = await getCardByName(cardName);
    if (!card) { await interaction.followUp({ content: `❌ No card named **${cardName}**.`, flags: MessageFlags.Ephemeral }); return; }
    const removed = await unassignCardCustomRarity(guildId, card.id);
    const r = card.rarity as Rarity;
    await interaction.followUp({
      content: removed
        ? `🔄 **${card.name}** reverted to ${RARITY_EMOJI[r] ?? "🃏"} **${RARITY_LABELS[r] ?? r}**.`
        : `ℹ️ **${card.name}** wasn't in any custom tier.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

// ── Display Names Panel (cosmetic overrides for built-in tiers) ───────────────
// Accessed from the hub via the "🎨 Display Names" button.

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
    .setTitle("🎨 Rarity Display Names")
    .setColor(0x5865f2)
    .setDescription(
      "Rename any built-in rarity tier for this server — changes the display name, emoji, and embed color " +
      "in spawns, collections, packs, and trade-ins. Economy values are unaffected.\n\u200b",
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
  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rarity_edit:resetall").setLabel("🗑️ Reset All").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("rarity_hub:main").setLabel("← Hub").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [selectRow, btnRow] };
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
  const parts = interaction.customId.split(":");
  const action = parts[2] as "name" | "emoji" | "color";
  const r = parts[3] as Rarity;
  if (!BUILTIN_RARITIES.includes(r)) return;

  const raw = interaction.fields.getTextInputValue("value").trim();

  if (action === "name") {
    await upsertRarityDisplayOverride(guildId, r, { displayName: raw.length === 0 ? null : raw }, userId);
  } else if (action === "emoji") {
    await upsertRarityDisplayOverride(guildId, r, { emoji: raw.length === 0 ? null : raw }, userId);
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
