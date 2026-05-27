import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { isAdmin, listSetsV2, getCardsInSet, createSet, setActiveSet, clearActiveSet, getActiveSet, setSetAwardsCompletion, invalidateActiveSetCardsCache } from "../db.js";
import { buildSingleSetPayload } from "./sets-admin.js";

// ── Permission guard ──────────────────────────────────────────────────────────
async function ensureAdmin(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean> {
  // Use interaction.memberPermissions (inline in payload) — the old
  // GuildMember-instanceof + members.fetch path adds RTT and can blow
  // Discord's 3s interaction window.
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has("Administrator")) return true;
  if (await isAdmin(interaction.guild.id, interaction.user.id)) return true;
  await interaction.reply({ content: "❌ Admins only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  return false;
}

// ── Embed builder ─────────────────────────────────────────────────────────────
async function buildHubEmbed(guildId: string, selectedSetId?: number): Promise<EmbedBuilder> {
  const [sets, activeSet] = await Promise.all([listSetsV2(), getActiveSet(guildId)]);
  const embed = new EmbedBuilder()
    .setTitle("🗂️ Set Manager")
    .setColor(0x5865f2);

  const activeId = activeSet?.id;
  const desc = activeSet
    ? `**Active spawn pool:** \`${activeSet.name}\` (${sets.find(s => s.set.id === activeSet.id)?.cardCount ?? "?"} cards)\n`
    : "**Active spawn pool:** None — random spawns are disabled\n";

  if (sets.length === 0) {
    embed.setDescription(desc + "\nNo sets yet. Click **➕ Create** to make your first one.");
    return embed;
  }

  const lines = sets.map(({ set, cardCount }) => {
    const active = set.id === activeId ? " 🟢" : "";
    const showcase = set.awardsCompletion ? " ✨" : "";
    const selected = set.id === selectedSetId ? " ◀" : "";
    return `\`${set.name}\` — ${cardCount} card${cardCount === 1 ? "" : "s"}${active}${showcase}${selected}`;
  });

  embed.setDescription(desc + "\n" + lines.join("\n"));
  embed.setFooter({ text: "🟢 = active spawn pool · ✨ = showcase (completion achievement) · ◀ = selected" });
  return embed;
}

// ── Component builders ────────────────────────────────────────────────────────
function buildSelectRow(sets: Awaited<ReturnType<typeof listSetsV2>>, activeId: number | undefined, selectedSetId?: number) {
  if (sets.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId("sets:pick")
    .setPlaceholder("Pick a set to manage…")
    .addOptions(
      sets.slice(0, 25).map(({ set, cardCount }) => ({
        label: (set.id === activeId ? "🟢 " : "") + set.name,
        description: `${cardCount} card${cardCount === 1 ? "" : "s"}${set.awardsCompletion ? " · ✨ showcase" : ""}`,
        value: String(set.id),
        default: set.id === selectedSetId,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildSetActionRow(setId: number | undefined, showcaseOn: boolean) {
  const has = setId !== undefined;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(has ? `sets:active:${setId}` : "sets:active:0")
      .setLabel("Set Active")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!has),
    new ButtonBuilder()
      .setCustomId(has ? `sets:view:${setId}` : "sets:view:0")
      .setLabel("View Cards")
      .setEmoji("👁")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!has),
    new ButtonBuilder()
      .setCustomId(has ? `sets:export:${setId}` : "sets:export:0")
      .setLabel("Export Set")
      .setEmoji("📤")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!has),
    new ButtonBuilder()
      .setCustomId(has ? `sets:showcase:${setId}` : "sets:showcase:0")
      .setLabel(showcaseOn ? "Showcase: ON" : "Showcase: OFF")
      .setEmoji("✨")
      .setStyle(showcaseOn ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!has),
  );
}

function buildGlobalRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sets:exportall")
      .setLabel("Export ALL")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("sets:create")
      .setLabel("Create Set")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("sets:deactivate")
      .setLabel("Deactivate")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger),
  );
}

async function buildPanelPayload(guildId: string, selectedSetId?: number) {
  const [sets, activeSet] = await Promise.all([listSetsV2(), getActiveSet(guildId)]);
  const activeId = activeSet?.id;
  const embed = await buildHubEmbed(guildId, selectedSetId);
  const components: ActionRowBuilder<any>[] = [];

  const selectRow = buildSelectRow(sets, activeId, selectedSetId);
  if (selectRow) components.push(selectRow);

  const selectedSet = selectedSetId !== undefined ? sets.find(s => s.set.id === selectedSetId) : undefined;
  components.push(buildSetActionRow(selectedSetId, selectedSet?.set.awardsCompletion ?? false));
  components.push(buildGlobalRow());

  return { embeds: [embed], components };
}

// ── Entry: /sethub slash command ──────────────────────────────────────────────
export async function handleSetsHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // admin.ts dispatcher has already called deferReply(ephemeral) — use editReply, not reply.
  if (!await ensureAdmin(interaction)) return;
  const guildId = interaction.guild!.id;
  const payload = await buildPanelPayload(guildId);
  await interaction.editReply(payload);
}

// ── Select: user picks a set from the dropdown ────────────────────────────────
export async function handleSetsHubSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!await ensureAdmin(interaction)) return;
  const guildId = interaction.guild!.id;
  const setId = parseInt(interaction.values[0]!, 10);
  await interaction.deferUpdate();
  const payload = await buildPanelPayload(guildId, setId);
  await interaction.editReply(payload);
}

// ── Button: all sets: button actions ─────────────────────────────────────────
export async function handleSetsHubButton(interaction: ButtonInteraction): Promise<void> {
  if (!await ensureAdmin(interaction)) return;
  const guildId = interaction.guild!.id;
  const [, action, argStr] = interaction.customId.split(":");
  const argId = argStr ? parseInt(argStr, 10) : undefined;

  // ── Export ALL — sends a file, then refreshes the panel ───────────────────
  if (action === "exportall") {
    await interaction.deferUpdate();
    const all = await listSetsV2();
    if (all.length === 0) {
      await interaction.followUp({ content: "❌ No sets to export yet.", flags: MessageFlags.Ephemeral });
      return;
    }
    const bundle: { exportedAt: string; sets: ReturnType<typeof buildSingleSetPayload>[] } = {
      exportedAt: new Date().toISOString(),
      sets: [],
    };
    let totalCards = 0;
    for (const { set } of all) {
      const cards = await getCardsInSet(set.id);
      bundle.sets.push(buildSingleSetPayload(set, cards));
      totalCards += cards.length;
    }
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(bundle, null, 2), "utf8"), { name: "all-sets.json" });
    await interaction.followUp({
      content: `📦 Exported **${all.length}** set${all.length === 1 ? "" : "s"} (${totalCards} card${totalCards === 1 ? "" : "s"} total). Re-import with \`!loadset\` and attaching the file.`,
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Create — open a modal for the set name ────────────────────────────────
  if (action === "create") {
    const modal = new ModalBuilder()
      .setCustomId("sets:modal:create")
      .setTitle("Create a New Set")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("sets:name")
            .setLabel("Set Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Season 2, Event Pack, Starter Set")
            .setRequired(true)
            .setMaxLength(64),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("sets:desc")
            .setLabel("Description (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(256),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // ── Deactivate ────────────────────────────────────────────────────────────
  if (action === "deactivate") {
    await interaction.deferUpdate();
    await clearActiveSet(guildId);
    const payload = await buildPanelPayload(guildId);
    await interaction.editReply(payload);
    await interaction.followUp({ content: "⛔ Spawn pool deactivated — random spawns are now paused.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!argId) { await interaction.deferUpdate(); return; }

  // ── Set Active ────────────────────────────────────────────────────────────
  if (action === "active") {
    await interaction.deferUpdate();
    await setActiveSet(guildId, argId);
    const payload = await buildPanelPayload(guildId, argId);
    await interaction.editReply(payload);
    const sets = await listSetsV2();
    const set = sets.find(s => s.set.id === argId);
    if (set) {
      const warn = set.cardCount === 0 ? " ⚠️ This set has no cards yet — add some with `/setadmin add`." : "";
      await interaction.followUp({ content: `✅ **${set.set.name}** is now the active spawn pool.${warn}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // ── View Cards ────────────────────────────────────────────────────────────
  if (action === "view") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cards = await getCardsInSet(argId);
    if (cards.length === 0) {
      await interaction.editReply({ content: "📭 No cards in this set yet. Add some with `/setadmin add`." });
      return;
    }
    const lines = cards.map(c => `• **${c.name}** — ${c.rarity}`);
    const chunks: string[] = [];
    let cur = "";
    for (const l of lines) {
      if ((cur + "\n" + l).length > 1900) { chunks.push(cur); cur = l; }
      else cur = cur ? cur + "\n" + l : l;
    }
    if (cur) chunks.push(cur);
    const sets = await listSetsV2();
    const set = sets.find(s => s.set.id === argId);
    const title = `**${set?.set.name ?? "Set"} — ${cards.length} card${cards.length === 1 ? "" : "s"}**\n`;
    await interaction.editReply({ content: title + (chunks[0] ?? "") });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // ── Export single set ─────────────────────────────────────────────────────
  if (action === "export") {
    await interaction.deferUpdate();
    const sets = await listSetsV2();
    const entry = sets.find(s => s.set.id === argId);
    if (!entry) { await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral }); return; }
    const cards = await getCardsInSet(argId);
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), ...buildSingleSetPayload(entry.set, cards) }, null, 2);
    const safeName = entry.set.name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    const file = new AttachmentBuilder(Buffer.from(payload, "utf8"), { name: `${safeName}.json` });
    await interaction.followUp({
      content: `📤 Exported **${entry.set.name}** (${cards.length} card${cards.length === 1 ? "" : "s"}). Re-import with \`!loadset\` and attaching the file.`,
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Toggle Showcase ───────────────────────────────────────────────────────
  if (action === "showcase") {
    await interaction.deferUpdate();
    const sets = await listSetsV2();
    const entry = sets.find(s => s.set.id === argId);
    if (!entry) { await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral }); return; }
    const next = !entry.set.awardsCompletion;
    await setSetAwardsCompletion(argId, next);
    const payload = await buildPanelPayload(guildId, argId);
    await interaction.editReply(payload);
    const msg = next
      ? `✨ **${entry.set.name}** is now a showcase set — collectors who own every card unlock a dedicated achievement.`
      : `✅ **${entry.set.name}** showcase achievement disabled.`;
    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }
}

// ── Modal: create set ─────────────────────────────────────────────────────────
export async function handleSetsHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!await ensureAdmin(interaction)) return;
  const guildId = interaction.guild!.id;
  const name = interaction.fields.getTextInputValue("sets:name").trim();
  const desc = interaction.fields.getTextInputValue("sets:desc").trim() || undefined;
  if (!name) { await interaction.reply({ content: "❌ Set name cannot be empty.", flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferUpdate();
  const set = await createSet(name, desc);
  const payload = await buildPanelPayload(guildId, set.id);
  await interaction.editReply(payload);
  await interaction.followUp({
    content: `✅ Created set **${set.name}**. Add cards with \`/setadmin add set:${set.name} card:<Name>\`.`,
    flags: MessageFlags.Ephemeral,
  });
}
