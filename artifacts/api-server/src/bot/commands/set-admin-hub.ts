import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction,
  type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import {
  isAdmin, listSetsV2, getCardsInSet, getSetById, createSet, renameSet,
  deleteSetById, setActiveSet, clearActiveSet, getActiveSet,
  setSetAwardsCompletion, invalidateActiveSetCardsCache,
  patchSetRarityWeight, setSetRarityWeights,
} from "../db.js";
import { buildSingleSetPayload } from "./sets-admin.js";
import { isHomeGuild, GLOBAL_ONLY_MSG } from "../home-guild.js";
import { RARITY_EMOJI, type Rarity } from "../cards-data.js";

// ── Rarity weight options for the weights sub-panel ──────────────────────────
// Mirrors config-panel: omit legendary/mythic from the selects
// (those can be set via `/setadmin setweight`).
const WEIGHT_RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic"];

const SET_WEIGHT_OPTIONS: Record<Rarity, (number | null)[]> = {
  common:    [null, 80, 70, 60, 50, 40, 30, 20, 10, 5],
  uncommon:  [null, 40, 30, 25, 20, 15, 10, 5, 1],
  rare:      [null, 10, 5, 3, 2, 1, 0],
  epic:      [null, 20, 15, 10, 8, 5, 3, 2, 1],
  legendary: [null, 15, 10, 8, 6, 4, 3, 2, 1, 0],
  mythic:    [null, 5, 3, 2, 1, 0],
};

const VIEW_CARDS_PAGE_SIZE = 15;

// ── Permission helpers ────────────────────────────────────────────────────────
async function ensureAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has("Administrator")) return true;
  if (await isAdmin(interaction.guild.id, interaction.user.id)) return true;
  await interaction.editReply({ content: "❌ Admins only." }).catch(() => {});
  return false;
}

// ── Embed / component builders ────────────────────────────────────────────────
async function buildHubEmbed(guildId: string, selectedSetId?: number): Promise<EmbedBuilder> {
  const [sets, activeSet] = await Promise.all([listSetsV2(), getActiveSet(guildId)]);
  const activeId = activeSet?.id;

  const activeDesc = activeSet
    ? `**Active spawn pool:** \`${activeSet.name}\` (${sets.find(s => s.set.id === activeId)?.cardCount ?? "?"} cards)`
    : "**Active spawn pool:** None — random spawns disabled";

  const embed = new EmbedBuilder()
    .setTitle("🗂️ Set Admin Hub")
    .setColor(0x5865f2);

  if (sets.length === 0) {
    embed.setDescription(`${activeDesc}\n\nNo sets yet. Click **➕ Create** to get started.`);
    return embed;
  }

  const lines = sets.map(({ set, cardCount }) => {
    const active = set.id === activeId ? " 🟢" : "";
    const showcase = set.awardsCompletion ? " ✨" : "";
    const selected = set.id === selectedSetId ? " ◀" : "";
    return `\`${set.name}\` — ${cardCount} card${cardCount === 1 ? "" : "s"}${active}${showcase}${selected}`;
  });

  embed.setDescription(`${activeDesc}\n\n${lines.join("\n")}`);
  embed.setFooter({ text: "🟢 active pool · ✨ showcase · ◀ selected — pick a set from the dropdown" });
  return embed;
}

function buildSelectRow(
  sets: Awaited<ReturnType<typeof listSetsV2>>,
  activeId: number | undefined,
  selectedSetId?: number,
) {
  if (sets.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId("setadminhub:select")
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

function buildContextualRow1(setId: number, showcaseOn: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setadminhub:rename:${setId}`)
      .setLabel("Rename")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setadminhub:delete:${setId}`)
      .setLabel("Delete")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`setadminhub:active:${setId}`)
      .setLabel("Set Active")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`setadminhub:deactivate:${setId}`)
      .setLabel("Deactivate")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setadminhub:showcase:${setId}`)
      .setLabel(showcaseOn ? "Showcase: ON" : "Showcase: OFF")
      .setEmoji("✨")
      .setStyle(showcaseOn ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function buildContextualRow2(setId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setadminhub:export:${setId}`)
      .setLabel("Export")
      .setEmoji("📤")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setadminhub:weights:${setId}`)
      .setLabel("Rarity Weights")
      .setEmoji("⚖️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setadminhub:view:${setId}`)
      .setLabel("View Cards")
      .setEmoji("👁️")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildGlobalRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("setadminhub:create")
      .setLabel("Create Set")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("setadminhub:exportall")
      .setLabel("Export All")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("setadminhub:import")
      .setLabel("Import")
      .setEmoji("📥")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function buildPanelPayload(guildId: string, selectedSetId?: number) {
  const [sets, activeSet] = await Promise.all([listSetsV2(), getActiveSet(guildId)]);
  const activeId = activeSet?.id;
  const embed = await buildHubEmbed(guildId, selectedSetId);
  const components: ActionRowBuilder<any>[] = [];

  const selectRow = buildSelectRow(sets, activeId, selectedSetId);
  if (selectRow) components.push(selectRow);

  if (selectedSetId !== undefined) {
    const selectedEntry = sets.find(s => s.set.id === selectedSetId);
    const showcaseOn = selectedEntry?.set.awardsCompletion ?? false;
    components.push(buildContextualRow1(selectedSetId, showcaseOn));
    components.push(buildContextualRow2(selectedSetId));
  }

  components.push(buildGlobalRow());
  return { embeds: [embed], components };
}

// ── View Cards paginated embed ────────────────────────────────────────────────
function buildViewCardsEmbed(
  setName: string,
  cards: Awaited<ReturnType<typeof getCardsInSet>>,
  page: number,
): EmbedBuilder {
  const total = cards.length;
  const totalPages = Math.max(1, Math.ceil(total / VIEW_CARDS_PAGE_SIZE));
  const start = page * VIEW_CARDS_PAGE_SIZE;
  const slice = cards.slice(start, start + VIEW_CARDS_PAGE_SIZE);

  const lines = slice.map(c => `• **${c.name}** — ${RARITY_EMOJI[c.rarity as Rarity] ?? ""} ${c.rarity}`);

  return new EmbedBuilder()
    .setTitle(`👁️ ${setName} — Cards (${total})`)
    .setColor(0x5865f2)
    .setDescription(lines.join("\n") || "No cards.")
    .setFooter({ text: `Page ${page + 1} / ${totalPages} · ${total} card${total === 1 ? "" : "s"} total` });
}

function buildViewNavRow(setId: number, page: number, totalPages: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setadminhub:viewpage:${setId}:${page - 1}`)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`setadminhub:viewclose:${setId}`)
      .setLabel("✕ Close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`setadminhub:viewpage:${setId}:${page + 1}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

// ── Rarity weights sub-panel ──────────────────────────────────────────────────
function buildWeightsEmbed(
  setName: string,
  rarityWeights: Record<string, number> | null,
  isActive: boolean,
): EmbedBuilder {
  const w = rarityWeights ?? {};
  const allRarities: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
  const lines = allRarities.map(r => {
    const v = w[r];
    const tag = v == null ? "*(guild profile)*" : `**${v}**`;
    return `${RARITY_EMOJI[r]} \`${r}\` — ${tag}`;
  });
  return new EmbedBuilder()
    .setTitle(`⚖️ ${setName} — Rarity Weights`)
    .setColor(isActive ? 0x57f287 : 0x5865f2)
    .setDescription(
      lines.join("\n") +
      "\n\n*Legendary & Mythic can be set via `/setadmin setweight`. Changes here are instant.*" +
      (isActive
        ? "\n🟢 **This set is active — overrides are live.**"
        : "\n⚠️ Activate this set for these overrides to take effect."),
    )
    .setFooter({ text: "null = falls through to guild rarity profile · 0 = disabled for this set" });
}

function buildWeightsComponents(setId: number, rarityWeights: Record<string, number> | null) {
  const w = rarityWeights ?? {};
  const rows: ActionRowBuilder<any>[] = [];

  for (const rarity of WEIGHT_RARITIES) {
    const opts = SET_WEIGHT_OPTIONS[rarity] ?? [];
    const current = w[rarity] ?? null;
    const select = new StringSelectMenuBuilder()
      .setCustomId(`setadminhub:weight:${setId}:${rarity}`)
      .setPlaceholder(`${RARITY_EMOJI[rarity]} ${rarity} weight`)
      .addOptions(
        opts.map(v => ({
          label: v == null ? `${rarity} — Default (guild profile)` : `${rarity} — ${v}`,
          value: v == null ? "default" : String(v),
          default: v === current,
        })),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  // Row 5: Back + Clear All
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`setadminhub:back:${setId}`)
        .setLabel("Back to Hub")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`setadminhub:clearweights:${setId}`)
        .setLabel("Clear All Weights")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}

async function buildWeightsPayload(setId: number, guildId: string) {
  const [sets, activeSet] = await Promise.all([listSetsV2(), getActiveSet(guildId)]);
  const entry = sets.find(s => s.set.id === setId);
  if (!entry) return null;
  const isActive = activeSet?.id === setId;
  const embed = buildWeightsEmbed(
    entry.set.name,
    entry.set.rarityWeights as Record<string, number> | null,
    isActive,
  );
  const components = buildWeightsComponents(
    setId,
    entry.set.rarityWeights as Record<string, number> | null,
  );
  return { embeds: [embed], components };
}

// ── Entry: /set_admin slash command ──────────────────────────────────────────
export async function handleSetAdminHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!await ensureAdmin(interaction)) return;
  const guildId = interaction.guild.id;
  const payload = await buildPanelPayload(guildId);
  await interaction.editReply(payload);
}

// ── Select: user picks a set from the dropdown ────────────────────────────────
export async function handleSetAdminHubSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  if (!await ensureAdmin(interaction)) return;
  const guildId = interaction.guild.id;
  const setId = parseInt(interaction.values[0]!, 10);
  const payload = await buildPanelPayload(guildId, setId);
  await interaction.editReply(payload);
}

// ── Weight select: user changes a rarity weight in the sub-panel ──────────────
export async function handleSetAdminHubWeightSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate();
  if (!await ensureAdmin(interaction)) return;
  if (!isHomeGuild(interaction.guild.id)) {
    await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
    return;
  }

  // customId: setadminhub:weight:${setId}:${rarity}
  const parts = interaction.customId.split(":");
  const setId = parseInt(parts[2]!, 10);
  const rarity = parts[3] as Rarity;
  const raw = interaction.values[0];
  const weight: number | null = raw === "default" ? null : parseInt(raw!, 10);

  await patchSetRarityWeight(setId, rarity, weight);

  const guildId = interaction.guild.id;
  const payload = await buildWeightsPayload(setId, guildId);
  if (!payload) {
    await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.editReply(payload);
}

// ── Buttons ───────────────────────────────────────────────────────────────────
export async function handleSetAdminHubButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  // customId: setadminhub:action[:arg1[:arg2]]
  const parts = interaction.customId.split(":");
  const action = parts[1]!;
  const arg1 = parts[2];
  const arg2 = parts[3];
  const setId = arg1 ? parseInt(arg1, 10) : undefined;

  // ── Modal paths: showModal() MUST be the first response (no defer first) ──
  // Authorization is fully enforced on modal submit — showing the modal
  // itself is harmless. The slash entry uses the full ensureAdmin check
  // which includes DB-backed bot admins, so anyone who reached this panel
  // was already authorized at open time.
  if (action === "create") {
    if (!isHomeGuild(guildId)) {
      await interaction.reply({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId("setadminhub:modal:create")
      .setTitle("Create a New Set")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("setadminhub:name")
            .setLabel("Set Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Season 2, Event Pack, Starter Set")
            .setRequired(true)
            .setMaxLength(64),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("setadminhub:desc")
            .setLabel("Description (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(256),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "rename" && setId !== undefined) {
    if (!isHomeGuild(guildId)) {
      await interaction.reply({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`setadminhub:modal:rename:${setId}`)
      .setTitle("Rename Set")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("setadminhub:newname")
            .setLabel("New Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("New set name")
            .setRequired(true)
            .setMaxLength(64),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "import") {
    if (!isHomeGuild(guildId)) {
      await interaction.reply({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId("setadminhub:modal:import")
      .setTitle("Import Set from URL")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("setadminhub:url")
            .setLabel("JSON File URL")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("https://cdn.discordapp.com/…/set.json")
            .setRequired(true)
            .setMaxLength(1000),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("setadminhub:nameoverride")
            .setLabel("Set name override (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(64),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // ── All other buttons: defer first, then do DB work ───────────────────────
  await interaction.deferUpdate();
  if (!await ensureAdmin(interaction)) return;

  // ── Back to hub from weights sub-panel ────────────────────────────────────
  if (action === "back" && setId !== undefined) {
    const payload = await buildPanelPayload(guildId, setId);
    await interaction.editReply(payload);
    return;
  }

  // ── View cards pagination (prev/next) ─────────────────────────────────────
  if (action === "viewpage" && setId !== undefined && arg2 !== undefined) {
    const page = parseInt(arg2, 10);
    const [cards, sets] = await Promise.all([getCardsInSet(setId), listSetsV2()]);
    const entry = sets.find(s => s.set.id === setId);
    if (!entry) return;
    const totalPages = Math.max(1, Math.ceil(cards.length / VIEW_CARDS_PAGE_SIZE));
    const clampedPage = Math.max(0, Math.min(page, totalPages - 1));
    await interaction.editReply({
      embeds: [buildViewCardsEmbed(entry.set.name, cards, clampedPage)],
      components: [buildViewNavRow(setId, clampedPage, totalPages)],
    });
    return;
  }

  // ── Close view cards pager ────────────────────────────────────────────────
  if (action === "viewclose") {
    await interaction.deleteReply().catch(() => {});
    return;
  }

  // ── Export ALL ────────────────────────────────────────────────────────────
  if (action === "exportall") {
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
    const file = new AttachmentBuilder(
      Buffer.from(JSON.stringify(bundle, null, 2), "utf8"),
      { name: "all-sets.json" },
    );
    await interaction.followUp({
      content: `📦 Exported **${all.length}** set${all.length === 1 ? "" : "s"} (${totalCards} card${totalCards === 1 ? "" : "s"} total). Re-import with \`/setadmin load file:<this.json>\`.`,
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Buttons that require a setId ──────────────────────────────────────────
  if (setId === undefined) return;

  // ── Deactivate ────────────────────────────────────────────────────────────
  if (action === "deactivate") {
    await clearActiveSet(guildId);
    const payload = await buildPanelPayload(guildId, setId);
    await interaction.editReply(payload);
    await interaction.followUp({ content: "⏹️ Spawn pool deactivated — random spawns are paused.", flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Set Active ────────────────────────────────────────────────────────────
  if (action === "active") {
    await setActiveSet(guildId, setId);
    const [payload, sets] = await Promise.all([
      buildPanelPayload(guildId, setId),
      listSetsV2(),
    ]);
    await interaction.editReply(payload);
    const entry = sets.find(s => s.set.id === setId);
    if (entry) {
      const warn = entry.cardCount === 0 ? " ⚠️ No droppable cards in this set yet — add some with `/setadmin add`." : "";
      await interaction.followUp({ content: `🟢 **${entry.set.name}** is now the active spawn pool.${warn}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // ── Delete set ────────────────────────────────────────────────────────────
  if (action === "delete") {
    if (!isHomeGuild(guildId)) {
      await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const entry = (await listSetsV2()).find(s => s.set.id === setId);
    if (!entry) {
      await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const { removedMemberships } = await deleteSetById(setId);
    const payload = await buildPanelPayload(guildId);
    await interaction.editReply(payload);
    await interaction.followUp({
      content: `🗑️ Deleted set \`${entry.set.name}\` — removed **${removedMemberships}** membership${removedMemberships === 1 ? "" : "s"}. Cards themselves are untouched.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Toggle Showcase ───────────────────────────────────────────────────────
  if (action === "showcase") {
    if (!isHomeGuild(guildId)) {
      await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const sets = await listSetsV2();
    const entry = sets.find(s => s.set.id === setId);
    if (!entry) {
      await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const next = !entry.set.awardsCompletion;
    await setSetAwardsCompletion(setId, next);
    const payload = await buildPanelPayload(guildId, setId);
    await interaction.editReply(payload);
    const msg = next
      ? `✨ **${entry.set.name}** is now a showcase set — collectors who own every card unlock a dedicated achievement.`
      : `✅ **${entry.set.name}** showcase achievement disabled.`;
    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Export single set ─────────────────────────────────────────────────────
  if (action === "export") {
    const sets = await listSetsV2();
    const entry = sets.find(s => s.set.id === setId);
    if (!entry) {
      await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    const cards = await getCardsInSet(setId);
    const payload = JSON.stringify(
      { exportedAt: new Date().toISOString(), ...buildSingleSetPayload(entry.set, cards) },
      null,
      2,
    );
    const safeName = entry.set.name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    const file = new AttachmentBuilder(Buffer.from(payload, "utf8"), { name: `${safeName}.json` });
    await interaction.followUp({
      content: `📤 Exported **${entry.set.name}** (${cards.length} card${cards.length === 1 ? "" : "s"}). Re-import with \`/setadmin load file:<this.json>\`.`,
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── View Cards — paginated embed as followUp ──────────────────────────────
  if (action === "view") {
    const [cards, sets] = await Promise.all([getCardsInSet(setId), listSetsV2()]);
    const entry = sets.find(s => s.set.id === setId);
    if (!entry) return;
    if (cards.length === 0) {
      await interaction.followUp({ content: "📭 No cards in this set yet. Add some with `/setadmin add`.", flags: MessageFlags.Ephemeral });
      return;
    }
    const totalPages = Math.max(1, Math.ceil(cards.length / VIEW_CARDS_PAGE_SIZE));
    await interaction.followUp({
      embeds: [buildViewCardsEmbed(entry.set.name, cards, 0)],
      components: [buildViewNavRow(setId, 0, totalPages)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Rarity weights sub-panel ──────────────────────────────────────────────
  if (action === "weights") {
    const payload = await buildWeightsPayload(setId, guildId);
    if (!payload) {
      await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.editReply(payload);
    return;
  }

  // ── Clear all weight overrides ────────────────────────────────────────────
  if (action === "clearweights") {
    if (!isHomeGuild(guildId)) {
      await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    await setSetRarityWeights(setId, null);
    const payload = await buildWeightsPayload(setId, guildId);
    if (!payload) return;
    await interaction.editReply(payload);
    await interaction.followUp({ content: "🔄 All rarity weight overrides cleared for this set.", flags: MessageFlags.Ephemeral });
    return;
  }
}

// ── Modals ────────────────────────────────────────────────────────────────────
// Modal submits triggered by message components can use deferUpdate() + editReply()
// to refresh the hub message in-place. Full ensureAdmin (including DB check) is
// enforced here — the button trigger only does a sync home-guild check.
export async function handleSetAdminHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  // customId: setadminhub:modal:<action>[:<setId>]
  const parts = interaction.customId.split(":");
  const action = parts[2]!;

  // deferUpdate() acks the modal and defers in-place update of the hub message.
  await interaction.deferUpdate();
  if (!await ensureAdmin(interaction)) return;

  // ── Create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    if (!isHomeGuild(guildId)) {
      await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const name = interaction.fields.getTextInputValue("setadminhub:name").trim();
    const desc = interaction.fields.getTextInputValue("setadminhub:desc").trim() || undefined;
    if (!name) {
      await interaction.followUp({ content: "❌ Set name cannot be empty.", flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      const set = await createSet(name, desc);
      await invalidateActiveSetCardsCache(guildId);
      const payload = await buildPanelPayload(guildId, set.id);
      await interaction.editReply(payload);
      await interaction.followUp({
        content: `✅ Created set **${set.name}**. Add cards with \`/setadmin add set:${set.name} card:<Name>\` or \`/setadmin bulkadd\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      await interaction.followUp({ content: `❌ ${err?.message ?? "Failed to create set."}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // ── Rename ────────────────────────────────────────────────────────────────
  if (action === "rename") {
    const setId = parseInt(parts[3]!, 10);
    if (!isHomeGuild(guildId)) {
      await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }
    const newName = interaction.fields.getTextInputValue("setadminhub:newname").trim();
    if (!newName) {
      await interaction.followUp({ content: "❌ Name cannot be empty.", flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      const entry = await getSetById(setId);
      if (!entry) {
        await interaction.followUp({ content: "❌ Set not found.", flags: MessageFlags.Ephemeral });
        return;
      }
      const updated = await renameSet(setId, newName);
      const payload = await buildPanelPayload(guildId, setId);
      await interaction.editReply(payload);
      await interaction.followUp({
        content: `✅ Renamed \`${entry.name}\` → \`${updated?.name}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      await interaction.followUp({ content: `❌ ${err?.message ?? "Rename failed."}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // ── Import ────────────────────────────────────────────────────────────────
  if (action === "import") {
    if (!isHomeGuild(guildId)) {
      await interaction.followUp({ content: GLOBAL_ONLY_MSG, flags: MessageFlags.Ephemeral });
      return;
    }

    const url = interaction.fields.getTextInputValue("setadminhub:url").trim();
    const nameOverride = interaction.fields.getTextInputValue("setadminhub:nameoverride").trim() || undefined;

    if (!url.startsWith("http")) {
      await interaction.followUp({ content: "❌ Please provide a valid https:// URL to the JSON file.", flags: MessageFlags.Ephemeral });
      return;
    }

    let jsonText: string;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      jsonText = await res.text();
    } catch (err: any) {
      await interaction.followUp({ content: `❌ Failed to fetch the file: ${err?.message ?? "unknown error"}`, flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const { importCardsFromJson } = await import("./import.js");
      const filename = url.split("/").pop() ?? "import.json";
      const { created, skipped, failed, errors, setName } = await importCardsFromJson(jsonText, filename, nameOverride);
      const payload = await buildPanelPayload(guildId);
      await interaction.editReply(payload);
      await interaction.followUp({
        content:
          `✅ **Imported set \`${setName}\`**\n` +
          `➕ Created: **${created}**\n` +
          `⏭️ Skipped (already exist): **${skipped}**` +
          (failed > 0 ? `\n❌ Failed: **${failed}**\n${errors.map((e: string) => `• ${e}`).join("\n")}` : ""),
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      await interaction.followUp({ content: `❌ ${err?.message ?? "Import failed."}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }
}
