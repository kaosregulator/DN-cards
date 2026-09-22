// /ubadmin — Discord mini dashboard for UnbelievaBoat + pets economy.
// Ephemeral, Administrator-only. Website hub at /admin/unbelievaboat stays.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  UserSelectMenuBuilder,
} from "discord.js";
import { isUbConfigured, ubApi } from "../../lib/unbelievaboat/client.js";
import {
  getOrCreateUbSettings,
  updateUbSettings,
  listCatalog,
  listRoleLinks,
  listUbAudit,
  writeUbAudit,
} from "../../lib/unbelievaboat/db.js";
import {
  getOrCreatePetSettings,
  updatePetSettings,
  petLeaderboard,
  adminDeletePet,
  adminCrackEgg,
} from "../pets/engine.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const UB_ICON =
  "https://cdn.discordapp.com/avatars/292953664492929025/e81ffdbb910a3757b874a890b2a92740.webp?size=64";

export function buildUbAdminCommandJson() {
  return new SlashCommandBuilder()
    .setName("ubadmin")
    .setDescription("UnbelievaBoat mini dashboard — cash, pets, leaderboard")
    .setDMPermission(false)
    .setDefaultMemberPermissions(0x8)
    .toJSON();
}

function hubRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ubadmin:overview").setLabel("Overview").setEmoji("📋").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ubadmin:leaderboard").setLabel("Cash board").setEmoji("💰").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ubadmin:pets").setLabel("Pets").setEmoji("🐾").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ubadmin:store").setLabel("Catalog").setEmoji("🛒").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ubadmin:toggle_ub").setLabel("Toggle UB link").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ubadmin:toggle_pets_spend").setLabel("Toggle pet spend").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ubadmin:adjust").setLabel("Adjust cash").setEmoji("✏️").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ubadmin:pet_tools").setLabel("Pet tools").setEmoji("🛠️").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function fmt(n: number) {
  return new Intl.NumberFormat().format(n);
}

async function buildOverviewEmbed(guildId: string): Promise<EmbedBuilder> {
  const settings = await getOrCreateUbSettings(guildId);
  const petSettings = await getOrCreatePetSettings(guildId);
  let guildLine = "_API not queried_";
  let apiErr: string | null = null;
  if (isUbConfigured() && settings.enabled) {
    try {
      const g = await ubApi.getGuild(settings.ubGuildId || guildId);
      guildLine = `**${g.name}** · ${fmt(g.member_count)} members · symbol ${g.symbol || "—"}`;
    } catch (err) {
      apiErr = err instanceof Error ? err.message : "UB API error";
    }
  }

  return new EmbedBuilder()
    .setColor(0xe91e8c)
    .setAuthor({ name: "UnbelievaBoat mini dashboard", iconURL: UB_ICON })
    .setTitle("Economy + Pets control")
    .setDescription(
      [
        `Token configured: **${isUbConfigured() ? "yes" : "no"}**`,
        `UB link enabled: **${settings.enabled ? "on" : "off"}**`,
        `Pets spend UB cash: **${settings.petsSpendUb ? "on" : "off"}**`,
        `Leaderboard sort: **${settings.leaderboardSort}**`,
        `UB guild id: \`${settings.ubGuildId || guildId}\``,
        "",
        guildLine,
        apiErr ? `⚠️ ${apiErr}` : null,
        "",
        `Pets enabled: **${petSettings.enabled ? "yes" : "no"}** · hatch **${petSettings.hatchCost}** · growth **${petSettings.growthHours}h** · neglect **${petSettings.maxNeglects}**`,
        "",
        "_Website hub still at `/admin/unbelievaboat` for deep edits._",
      ].filter(Boolean).join("\n"),
    )
    .setFooter({ text: "Admin only · UnbelievaBoat cash powers pet shop & hatch" });
}

export async function handleUbAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  const embed = await buildOverviewEmbed(interaction.guildId);
  await interaction.editReply({ embeds: [embed], components: hubRows() });
}

export async function handleUbAdminComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  if (!interaction.memberPermissions?.has("Administrator")) {
    await interaction.reply({ content: "Administrator only.", ...EPHEMERAL });
    return;
  }

  const id = interaction.customId;

  if (id === "ubadmin:overview" && interaction.isButton()) {
    await interaction.deferUpdate();
    const embed = await buildOverviewEmbed(guildId);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "ubadmin:leaderboard" && interaction.isButton()) {
    await interaction.deferUpdate();
    const settings = await getOrCreateUbSettings(guildId);
    let lines = "_Configure `UNBELIEVABOAT_TOKEN` and enable the UB link._";
    if (isUbConfigured() && settings.enabled) {
      try {
        const raw = await ubApi.getLeaderboard(settings.ubGuildId, {
          sort: settings.leaderboardSort as "cash" | "bank" | "total",
          limit: 10,
          page: 1,
        });
        const users = Array.isArray(raw) ? raw : raw.users ?? [];
        lines = users.length
          ? users.map((u, i) =>
            `**${i + 1}.** <@${u.user_id}> — cash ${fmt(u.cash)} · bank ${fmt(u.bank)} · total **${fmt(u.total)}**`,
          ).join("\n")
          : "_No balances yet._";
      } catch (err) {
        lines = `⚠️ ${err instanceof Error ? err.message : "Leaderboard failed"}`;
      }
    }
    const embed = new EmbedBuilder()
      .setColor(0xe91e8c)
      .setAuthor({ name: "UnbelievaBoat cash board", iconURL: UB_ICON })
      .setTitle(`Top balances (${settings.leaderboardSort})`)
      .setDescription(lines);
    const sortMenu = new StringSelectMenuBuilder()
      .setCustomId("ubadmin:sort")
      .setPlaceholder("Sort leaderboard by…")
      .addOptions(
        { label: "Total", value: "total" },
        { label: "Cash", value: "cash" },
        { label: "Bank", value: "bank" },
      );
    await interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sortMenu),
        ...hubRows(),
      ],
    });
    return;
  }

  if (id === "ubadmin:sort" && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const sort = interaction.values[0] as "cash" | "bank" | "total";
    await updateUbSettings(guildId, { leaderboardSort: sort });
    await writeUbAudit(guildId, interaction.user.id, "discord_sort", { sort });
    const settings = await getOrCreateUbSettings(guildId);
    let lines = "_Configure `UNBELIEVABOAT_TOKEN` and enable the UB link._";
    if (isUbConfigured() && settings.enabled) {
      try {
        const raw = await ubApi.getLeaderboard(settings.ubGuildId, { sort, limit: 10, page: 1 });
        const users = Array.isArray(raw) ? raw : raw.users ?? [];
        lines = users.length
          ? users.map((u, i) =>
            `**${i + 1}.** <@${u.user_id}> — cash ${fmt(u.cash)} · bank ${fmt(u.bank)} · total **${fmt(u.total)}**`,
          ).join("\n")
          : "_No balances yet._";
      } catch (err) {
        lines = `⚠️ ${err instanceof Error ? err.message : "Leaderboard failed"}`;
      }
    }
    const embed = new EmbedBuilder()
      .setColor(0xe91e8c)
      .setAuthor({ name: "UnbelievaBoat cash board", iconURL: UB_ICON })
      .setTitle(`Top balances (${sort})`)
      .setDescription(lines);
    const sortMenu = new StringSelectMenuBuilder()
      .setCustomId("ubadmin:sort")
      .setPlaceholder("Sort leaderboard by…")
      .addOptions(
        { label: "Total", value: "total" },
        { label: "Cash", value: "cash" },
        { label: "Bank", value: "bank" },
      );
    await interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sortMenu),
        ...hubRows(),
      ],
    });
    return;
  }

  if (id === "ubadmin:pets" && interaction.isButton()) {
    await interaction.deferUpdate();
    const petSettings = await getOrCreatePetSettings(guildId);
    const top = await petLeaderboard(guildId, 8);
    const lines = top.length
      ? top.map((p, i) => `**${i + 1}.** **${p.name}** <@${p.userId}> · ${p.stage} · PWR ${p.power}`).join("\n")
      : "_No living pets._";
    const embed = new EmbedBuilder()
      .setColor(0xf5c84c)
      .setAuthor({ name: "UnbelievaBoat · Pets", iconURL: UB_ICON })
      .setTitle("Pet addon")
      .setDescription(
        [
          `Enabled **${petSettings.enabled ? "yes" : "no"}** · hatch **${petSettings.hatchCost}** cash · growth **${petSettings.growthHours}h** · max neglects **${petSettings.maxNeglects}** · wager **${petSettings.challengeWager}**`,
          "",
          lines,
          "",
          "Deep resets: `/petadmin reset` · `/petadmin crack`",
        ].join("\n"),
      );
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "ubadmin:store" && interaction.isButton()) {
    await interaction.deferUpdate();
    const [catalog, roles, audit] = await Promise.all([
      listCatalog(guildId),
      listRoleLinks(guildId),
      listUbAudit(guildId, 5),
    ]);
    const catLines = catalog.slice(0, 8).map(c =>
      `${c.listed ? "✅" : "⏸"} **${c.name}** — ${c.price} cash${c.forPets ? " · pets" : ""}`,
    ).join("\n") || "_No catalog items._";
    const roleLines = roles.slice(0, 5).map(r =>
      `${r.enabled ? "✅" : "⏸"} **${r.name}** — ${r.price} cash`,
    ).join("\n") || "_No role links._";
    const auditLines = audit.map(a =>
      `• \`${a.action}\` · <@${a.actorId.replace(/^dash:/, "")}> · <t:${Math.floor(new Date(a.createdAt).getTime() / 1000)}:R>`,
    ).join("\n") || "_No audit yet._";
    const embed = new EmbedBuilder()
      .setColor(0xe91e8c)
      .setAuthor({ name: "UnbelievaBoat catalog", iconURL: UB_ICON })
      .setTitle("Store / roles / recent audit")
      .addFields(
        { name: "Catalog", value: catLines.slice(0, 1000) },
        { name: "Role links", value: roleLines.slice(0, 1000) },
        { name: "Recent audit", value: auditLines.slice(0, 1000) },
      )
      .setFooter({ text: "Edit items on the website hub if you need full forms" });
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "ubadmin:toggle_ub" && interaction.isButton()) {
    await interaction.deferUpdate();
    const s = await getOrCreateUbSettings(guildId);
    const next = !s.enabled;
    await updateUbSettings(guildId, { enabled: next });
    await writeUbAudit(guildId, interaction.user.id, "discord_toggle_ub", { enabled: next });
    const embed = await buildOverviewEmbed(guildId);
    embed.setDescription(`${embed.data.description ?? ""}\n\n✅ UB link is now **${next ? "on" : "off"}**.`);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "ubadmin:toggle_pets_spend" && interaction.isButton()) {
    await interaction.deferUpdate();
    const s = await getOrCreateUbSettings(guildId);
    const next = !s.petsSpendUb;
    await updateUbSettings(guildId, { petsSpendUb: next });
    await writeUbAudit(guildId, interaction.user.id, "discord_toggle_pets_spend", { petsSpendUb: next });
    const embed = await buildOverviewEmbed(guildId);
    embed.setDescription(`${embed.data.description ?? ""}\n\n✅ Pet shop/hatch UB spend is now **${next ? "on" : "off"}**.`);
    await interaction.editReply({ embeds: [embed], components: hubRows() });
    return;
  }

  if (id === "ubadmin:adjust" && interaction.isButton()) {
    const menu = new UserSelectMenuBuilder()
      .setCustomId("ubadmin:adjust_user")
      .setPlaceholder("Whose UnbelievaBoat balance?")
      .setMaxValues(1);
    await interaction.reply({
      content: "Pick a member, then enter a cash delta.",
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu)],
      ...EPHEMERAL,
    });
    return;
  }

  if (id === "ubadmin:adjust_user" && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`ubadmin:adjust_modal:${userId}`)
      .setTitle("Adjust UnbelievaBoat cash");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("cash")
          .setLabel("Cash delta (e.g. 100 or -50)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(12),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder("Discord /ubadmin adjust"),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (id === "ubadmin:pet_tools" && interaction.isButton()) {
    const menu = new UserSelectMenuBuilder()
      .setCustomId("ubadmin:pet_tool_user")
      .setPlaceholder("Pick a member for pet tools…")
      .setMaxValues(1);
    const actionMenu = new StringSelectMenuBuilder()
      .setCustomId("ubadmin:pet_tool_action")
      .setPlaceholder("What to do? (pick user first via button flow)")
      .setDisabled(true)
      .addOptions(
        { label: "Reset pet (delete)", value: "reset", description: "They can /pet hatch again" },
        { label: "Crack stuck egg", value: "crack", description: "Egg → hatchling" },
      );
    await interaction.reply({
      content: "Pet tools — select a member:",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu),
      ],
      ...EPHEMERAL,
    });
    void actionMenu;
    return;
  }

  if (id === "ubadmin:pet_tool_user" && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const actionMenu = new StringSelectMenuBuilder()
      .setCustomId(`ubadmin:pet_do:${userId}`)
      .setPlaceholder("Choose action…")
      .addOptions(
        { label: "Reset pet (delete)", value: "reset", description: "Wipe so they can hatch again" },
        { label: "Crack stuck egg", value: "crack", description: "Force egg → hatchling" },
        { label: "Disable pets server-wide", value: "pets_off" },
        { label: "Enable pets server-wide", value: "pets_on" },
      );
    await interaction.update({
      content: `Pet tools for <@${userId}>:`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(actionMenu)],
    });
    return;
  }

  if (id.startsWith("ubadmin:pet_do:") && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const userId = id.slice("ubadmin:pet_do:".length);
    const choice = interaction.values[0]!;
    try {
      if (choice === "reset") {
        const { deleted } = await adminDeletePet(guildId, userId);
        await writeUbAudit(guildId, interaction.user.id, "discord_pet_reset", { userId, name: deleted.name });
        await interaction.editReply({
          content: `Reset <@${userId}>'s pet **${deleted.name}**. They can \`/pet hatch\` again.`,
          components: [],
        });
      } else if (choice === "crack") {
        const pet = await adminCrackEgg(guildId, userId);
        await writeUbAudit(guildId, interaction.user.id, "discord_pet_crack", { userId, name: pet.name });
        await interaction.editReply({
          content: `Cracked <@${userId}>'s egg — **${pet.name}** is a hatchling.`,
          components: [],
        });
      } else if (choice === "pets_off" || choice === "pets_on") {
        await updatePetSettings(guildId, { enabled: choice === "pets_on" });
        await writeUbAudit(guildId, interaction.user.id, "discord_pets_toggle", { enabled: choice === "pets_on" });
        await interaction.editReply({
          content: `Pets are now **${choice === "pets_on" ? "enabled" : "disabled"}** server-wide.`,
          components: [],
        });
      }
    } catch (err) {
      await interaction.editReply({
        content: `❌ ${err instanceof Error ? err.message : "Failed."}`,
        components: [],
      });
    }
  }
}

export async function handleUbAdminModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  if (!interaction.memberPermissions?.has("Administrator")) {
    await interaction.reply({ content: "Administrator only.", ...EPHEMERAL });
    return;
  }
  const parts = interaction.customId.split(":");
  if (parts[1] !== "adjust_modal" || !parts[2]) {
    await interaction.reply({ content: "Unknown form.", ...EPHEMERAL });
    return;
  }
  const userId = parts[2];
  const cashRaw = interaction.fields.getTextInputValue("cash").trim();
  const reason = interaction.fields.getTextInputValue("reason")?.trim() || "Discord /ubadmin adjust";
  const cash = Number(cashRaw);
  if (!Number.isFinite(cash) || cash === 0) {
    await interaction.reply({ content: "Enter a non-zero cash delta.", ...EPHEMERAL });
    return;
  }

  await interaction.deferReply(EPHEMERAL);
  const settings = await getOrCreateUbSettings(guildId);
  if (!isUbConfigured() || !settings.enabled) {
    await interaction.editReply("UnbelievaBoat token missing or UB link disabled — flip it on in `/ubadmin`.");
    return;
  }
  try {
    const bal = await ubApi.patchUserBalance(settings.ubGuildId, userId, { cash, reason });
    await writeUbAudit(guildId, interaction.user.id, "discord_cash_adjust", { userId, cash, reason, bal });
    await interaction.editReply(
      `Adjusted <@${userId}> by **${cash > 0 ? "+" : ""}${fmt(cash)}** cash.\nNow: cash **${fmt(bal.cash)}** · bank **${fmt(bal.bank)}** · total **${fmt(bal.total)}**.`,
    );
  } catch (err) {
    await interaction.editReply(`❌ ${err instanceof Error ? err.message : "Adjust failed."}`);
  }
}
