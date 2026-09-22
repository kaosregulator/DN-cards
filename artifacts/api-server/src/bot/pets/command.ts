// /pet — interactive Tamagotchi hub (addon). Does not alter existing DN Cards
// commands. Button/select customIds are namespaced under `pet:`.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  ModalSubmitInteraction,
  User,
  Message,
} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  hatchPet,
  getPet,
  tickPet,
  feedPet,
  cleanPet,
  playWithPet,
  buyPetItem,
  usePetItem,
  createChallenge,
  resolveChallenge,
  cancelChallenge,
  petLeaderboard,
  getOrCreatePetSettings,
  DEFAULT_SHOP,
  SPECIES_META,
  moodOf,
  stageLabel,
  PET_SPECIES,
  type PetSpecies,
} from "./engine.js";
import { renderPetGif, renderHatchGif, renderChallengeGif, renderIntroGif } from "./render.js";
import type { Pet } from "@workspace/db";
import { listCatalog } from "../../lib/unbelievaboat/db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Subtle UnbelievaBoat mark — economy spends use their cash. */
const UB_ICON =
  "https://cdn.discordapp.com/avatars/292953664492929025/e81ffdbb910a3757b874a890b2a92740.webp?size=64";
const UB_AUTHOR = { name: "UnbelievaBoat cash", iconURL: UB_ICON } as const;

const PET_IDLE_MS = 60_000;
const petIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function bumpPetIdleCleanup(message: Message | null | undefined) {
  if (!message?.id) return;
  const prev = petIdleTimers.get(message.id);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    petIdleTimers.delete(message.id);
    void message.delete().catch(() => {
      void message.edit({ components: [] }).catch(() => {});
    });
  }, PET_IDLE_MS);
  timer.unref?.();
  petIdleTimers.set(message.id, timer);
}

async function afterPetMessage(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | UserSelectMenuInteraction
    | ModalSubmitInteraction,
) {
  try {
    const msg = await interaction.fetchReply();
    bumpPetIdleCleanup(msg as Message);
  } catch { /* ephemeral follow-ups / missing reply */ }
}

/** customId helpers — panel owner is baked in so strangers can't drive your pet. */
function petId(action: string, ownerId: string, extra?: string | number) {
  return extra != null ? `pet:${action}:${ownerId}:${extra}` : `pet:${action}:${ownerId}`;
}

function parsePetId(customId: string): { action: string; ownerId: string; extra?: string } | null {
  const parts = customId.split(":");
  if (parts[0] !== "pet" || parts.length < 2) return null;
  const action = parts[1]!;
  // Challenge accept/decline: pet:accept:<challengeId>
  if (action === "accept" || action === "decline") {
    return { action, ownerId: "", extra: parts[2] };
  }
  // Modal: pet:hatch_modal:<ownerId>:<species>
  if (action === "hatch_modal") {
    return { action, ownerId: parts[2] ?? "", extra: parts[3] };
  }
  // Standard: pet:<action>:<ownerId> or pet:<action>:<ownerId>:<extra>
  if (parts.length < 3 || !parts[2]) return null;
  return { action, ownerId: parts[2], extra: parts[3] };
}

async function assertPetOwner(
  interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
  ownerId: string,
): Promise<boolean> {
  if (!ownerId || interaction.user.id === ownerId) return true;
  await interaction.reply({
    content: "Only the owner of this pet panel can use these buttons. Run `/pet hub` for yours.",
    ...EPHEMERAL,
  }).catch(async () => {
    await interaction.followUp({
      content: "Only the owner of this pet panel can use these buttons. Run `/pet hub` for yours.",
      ...EPHEMERAL,
    }).catch(() => {});
  });
  return false;
}

export function buildPetCommandJson() {
  return new SlashCommandBuilder()
    .setName("pet")
    .setDescription("Care for your Tamagotchi pet — hatch, feed, challenge friends (UB cash shop)")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("hub")
      .setDescription("Open your pet care hub (animated)"))
    .addSubcommand(sc => sc
      .setName("hatch")
      .setDescription("Hatch a new pet (egg)")
      .addStringOption(o => o.setName("species").setDescription("Creature type").setRequired(true)
        .addChoices(
          { name: "🐉 Dragon", value: "dragon" },
          { name: "🐱 Cat", value: "cat" },
          { name: "🐶 Dog", value: "dog" },
          { name: "🐹 Hamster", value: "hamster" },
        ))
      .addStringOption(o => o.setName("name").setDescription("Pet name").setRequired(true).setMaxLength(24)))
    .addSubcommand(sc => sc
      .setName("challenge")
      .setDescription("Challenge another member's pet")
      .addUserOption(o => o.setName("opponent").setDescription("Who to challenge").setRequired(true))
      .addIntegerOption(o => o.setName("wager").setDescription("UB cash wager (optional)").setMinValue(0).setMaxValue(100_000)))
    .addSubcommand(sc => sc
      .setName("top")
      .setDescription("Pet power leaderboard"))
    .addSubcommand(sc => sc
      .setName("view")
      .setDescription("View someone's pet")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(false)))
    .toJSON();
}

export function buildPetAdminCommandJson() {
  return new SlashCommandBuilder()
    .setName("petadmin")
    .setDescription("Configure the Tamagotchi pet addon")
    .setDMPermission(false)
    .setDefaultMemberPermissions(0x8) // Administrator
    .addSubcommand(sc => sc
      .setName("status")
      .setDescription("Show pet system settings"))
    .addSubcommand(sc => sc
      .setName("toggle")
      .setDescription("Enable or disable pets")
      .addBooleanOption(o => o.setName("enabled").setDescription("On/off").setRequired(true)))
    .addSubcommand(sc => sc
      .setName("set")
      .setDescription("Tune hatch cost / growth / neglect")
      .addIntegerOption(o => o.setName("hatch_cost").setDescription("UB cash to hatch").setMinValue(0))
      .addIntegerOption(o => o.setName("growth_hours").setDescription("Hours per growth stage").setMinValue(1).setMaxValue(168))
      .addIntegerOption(o => o.setName("max_neglects").setDescription("Neglects before death").setMinValue(1).setMaxValue(20))
      .addIntegerOption(o => o.setName("challenge_wager").setDescription("Default challenge wager").setMinValue(0)))
    .addSubcommand(sc => sc
      .setName("reset")
      .setDescription("Delete a member's pet so they can hatch again")
      .addUserOption(o => o.setName("user").setDescription("Member whose pet to wipe").setRequired(true)))
    .addSubcommand(sc => sc
      .setName("crack")
      .setDescription("Force a stuck egg into a hatchling (keeps name)")
      .addUserOption(o => o.setName("user").setDescription("Member with a stuck egg").setRequired(true)))
    .toJSON();
}

function bars(pet: Pet): string {
  const bar = (v: number, filled: string, empty = "░") => {
    const n = Math.round(v / 10);
    return filled.repeat(n) + empty.repeat(10 - n);
  };
  return [
    `❤️ \`${bar(pet.health, "█")}\` ${pet.health}`,
    `🍖 \`${bar(pet.hunger, "▓")}\` ${pet.hunger}`,
    `✨ \`${bar(pet.cleanliness, "▒")}\` ${pet.cleanliness}`,
    `😊 \`${bar(pet.happiness, "░".replace("░", "■"))}\` ${pet.happiness}`,
  ].join("\n");
}

function petEmbed(pet: Pet, title?: string): EmbedBuilder {
  const sp = SPECIES_META[pet.species as PetSpecies];
  const mood = moodOf(pet);
  const color =
    pet.isDead ? 0x4b1c24
    : mood === "critical" ? 0xb45309
    : mood === "ecstatic" ? 0x34d399
    : 0x3b82f6;

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor(UB_AUTHOR)
    .setTitle(title ?? `${sp?.emoji ?? "🐾"} ${pet.name}`)
    .setDescription(
      pet.isDead
        ? `**${pet.name}** has passed on after too much neglect.\nHatch a new companion with \`/pet hatch\`.`
        : `**${stageLabel(pet.stage)}** ${sp?.label ?? pet.species} · Level **${pet.level}** · Power **${pet.power}**\nMood: **${mood}** · Record ${pet.wins}W / ${pet.losses}L`,
    )
    .addFields(
      { name: "Needs", value: bars(pet), inline: false },
      {
        name: "Inventory",
        value: Object.keys(pet.inventory ?? {}).length
          ? Object.entries(pet.inventory).map(([k, v]) => `• ${k} ×${v}`).join("\n")
          : "_Empty — visit the shop_",
        inline: true,
      },
      {
        name: "Care",
        value: [
          pet.lastFedAt ? `Fed <t:${Math.floor(pet.lastFedAt.getTime() / 1000)}:R>` : "Never fed",
          pet.lastCleanedAt ? `Cleaned <t:${Math.floor(pet.lastCleanedAt.getTime() / 1000)}:R>` : "Never cleaned",
          pet.lastPlayedAt ? `Played <t:${Math.floor(pet.lastPlayedAt.getTime() / 1000)}:R>` : "Never played",
        ].join("\n"),
        inline: true,
      },
    )
    .setFooter({
      text: "Shop & hatch use UnbelievaBoat cash · grows in real time · neglect can be fatal · idle panels close in 1m",
    });
}

function careRows(ownerId: string, pet: Pet, opts?: { tutorial?: boolean; readOnly?: boolean }): ActionRowBuilder<ButtonBuilder>[] {
  if (opts?.readOnly) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(petId("top", ownerId)).setLabel("Top pets").setEmoji("🏆").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(petId("myhub", ownerId)).setLabel("My pet hub").setEmoji("🐾").setStyle(ButtonStyle.Primary),
      ),
    ];
  }
  if (pet.isDead) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(petId("hatchmenu", ownerId)).setLabel("Hatch new pet").setEmoji("🥚").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(petId("top", ownerId)).setLabel("Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Secondary),
      ),
    ];
  }
  const tutorial = opts?.tutorial ?? false;
  const care = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(petId("feed", ownerId)).setLabel(tutorial ? "① Feed" : "Feed").setEmoji("🍖").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(petId("clean", ownerId)).setLabel(tutorial ? "② Clean" : "Clean").setEmoji("🧼").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(petId("play", ownerId)).setLabel(tutorial ? "③ Play" : "Play").setEmoji("🎾").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(petId("shop", ownerId)).setLabel("Shop").setEmoji("🛒").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(petId("refresh", ownerId)).setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
  );
  const extra = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(petId("challenge", ownerId)).setLabel("Challenge").setEmoji("⚔️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(petId("top", ownerId)).setLabel("Top pets").setEmoji("🏆").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(petId("inv", ownerId)).setLabel("Use item").setEmoji("🎒").setStyle(ButtonStyle.Secondary),
  );
  return [care, extra];
}

async function replyWithPet(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
  pet: Pet,
  opts?: { hatchAnim?: boolean; content?: string; tutorial?: boolean; readOnly?: boolean; ownerId?: string },
) {
  const live = await tickPet(pet);
  const ownerId = opts?.ownerId ?? interaction.user.id;
  const anim = opts?.hatchAnim ? await renderHatchGif(live) : await renderPetGif(live);
  const files: AttachmentBuilder[] = [];
  const embed = petEmbed(live);
  if (opts?.tutorial) {
    embed.setFooter({
      text: "① Feed  ② Clean  ③ Play — UnbelievaBoat cash powers the shop · idle panels close in 1m",
    });
  }
  if (opts?.readOnly) {
    embed.setFooter({ text: "View-only · open /pet hub for your own companion · UnbelievaBoat cash" });
  }
  if (anim?.buffer) {
    files.push(new AttachmentBuilder(anim.buffer, { name: "pet.gif" }));
    embed.setImage("attachment://pet.gif");
  }
  const payload = {
    content: opts?.content,
    embeds: [embed],
    components: careRows(ownerId, live, { tutorial: opts?.tutorial, readOnly: opts?.readOnly }),
    files,
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  await afterPetMessage(interaction);
}

export async function handlePetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Pets only work in a server.", ...EPHEMERAL });
    return;
  }
  const settings = await getOrCreatePetSettings(guildId);
  const sub = interaction.options.getSubcommand();

  if (sub === "top") {
    await interaction.deferReply();
    const rows = await petLeaderboard(guildId, 15);
    const lines = rows.length
      ? rows.map((r, i) => {
          const em = SPECIES_META[r.species as PetSpecies]?.emoji ?? "🐾";
          return `**${i + 1}.** ${em} **${r.name}** — <@${r.userId}> · PWR ${r.power} · Lv ${r.level} · ${r.wins}W`;
        }).join("\n")
      : "_No living pets yet. `/pet hatch` to begin._";
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("🏆 Pet Power Leaderboard")
          .setDescription(lines),
      ],
    });
    return;
  }

  if (sub === "hatch") {
    await interaction.deferReply();
    if (!settings.enabled) {
      await interaction.editReply("Pets are disabled on this server.");
      return;
    }
    const species = interaction.options.getString("species", true) as PetSpecies;
    const name = interaction.options.getString("name", true);
    try {
      const { pet, charged } = await hatchPet(guildId, interaction.user.id, { name, species });
      await replyWithPet(interaction, pet, {
        hatchAnim: true,
        tutorial: true,
        content: charged > 0
          ? `🎉 **${pet.name}** hatched! (−${charged} UnbelievaBoat cash)\nYou're a caretaker now — start with **Feed → Clean → Play**.`
          : `🎉 **${pet.name}** hatched!\nYou're a caretaker now — start with **Feed → Clean → Play**. Hearts drop over real time.`,
      });
    } catch (err) {
      await interaction.editReply(`❌ ${err instanceof Error ? err.message : "Hatch failed."}`);
    }
    return;
  }

  if (sub === "challenge") {
    await interaction.deferReply();
    const opponent = interaction.options.getUser("opponent", true);
    const wager = interaction.options.getInteger("wager")
      ?? (await getOrCreatePetSettings(guildId)).challengeWager;
    try {
      const { id } = await createChallenge(guildId, interaction.user.id, opponent.id, wager);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`pet:accept:${id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pet:decline:${id}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({
        content: `⚔️ <@${interaction.user.id}> challenges <@${opponent.id}>'s pet${wager > 0 ? ` for **${wager}** UnbelievaBoat cash` : ""}!`,
        components: [row],
      });
      await afterPetMessage(interaction);
    } catch (err) {
      await interaction.editReply(`❌ ${err instanceof Error ? err.message : "Challenge failed."}`);
    }
    return;
  }

  // hub / view
  await interaction.deferReply();
  const target: User = sub === "view"
    ? (interaction.options.getUser("user") ?? interaction.user)
    : interaction.user;
  const viewingOther = target.id !== interaction.user.id;
  let pet = await getPet(guildId, target.id);
  if (!pet) {
    if (viewingOther) {
      await interaction.editReply(`<@${target.id}> doesn't have a pet yet.`);
      return;
    }
    const intro = await renderIntroGif();
    const files: AttachmentBuilder[] = [];
    const ownerId = interaction.user.id;
    const embed = new EmbedBuilder()
      .setColor(0xf5c84c)
      .setAuthor(UB_AUTHOR)
      .setTitle("🥚 Welcome to the Tamagotchi Nursery")
      .setDescription(
        [
          "**How it works (classic style):**",
          "① Pick a **species** below",
          "② Give your pet a **name**",
          "③ Watch the **egg crack** and meet your hatchling",
          "④ Keep hearts full — **Feed · Clean · Play**",
          "",
          "Neglect them too long and they can **truly leave**…",
          "Shop & hatch spend **UnbelievaBoat** cash · Challenge friends for glory.",
        ].join("\n"),
      )
      .setFooter({ text: "Tip: /pet hatch · idle panels close after 1 minute" });
    if (intro?.buffer) {
      files.push(new AttachmentBuilder(intro.buffer, { name: "nursery.gif" }));
      embed.setImage("attachment://nursery.gif");
    }
    const speciesSelect = new StringSelectMenuBuilder()
      .setCustomId(petId("species", ownerId))
      .setPlaceholder("① Pick a species to begin…")
      .addOptions(PET_SPECIES.map(s => ({
        label: SPECIES_META[s].label,
        value: s,
        emoji: SPECIES_META[s].emoji,
        description: `Hatch a ${SPECIES_META[s].label.toLowerCase()} egg`,
      })));
    await interaction.editReply({
      embeds: [embed],
      files,
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(speciesSelect),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(petId("top", ownerId)).setLabel("Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    await afterPetMessage(interaction);
    return;
  }
  pet = await tickPet(pet);
  await replyWithPet(interaction, pet, {
    readOnly: viewingOther,
    ownerId: interaction.user.id,
    content: viewingOther ? `Looking at <@${target.id}>'s pet (view-only).` : undefined,
  });
}

export async function handlePetAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply(EPHEMERAL);
  const sub = interaction.options.getSubcommand();
  if (sub === "status") {
    const s = await getOrCreatePetSettings(guildId);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle("🐾 Pet admin")
          .addFields(
            { name: "Enabled", value: s.enabled ? "Yes" : "No", inline: true },
            { name: "Hatch cost", value: String(s.hatchCost), inline: true },
            { name: "Growth hours", value: String(s.growthHours), inline: true },
            { name: "Max neglects", value: String(s.maxNeglects), inline: true },
            { name: "Default wager", value: String(s.challengeWager), inline: true },
          ),
      ],
    });
    return;
  }
  if (sub === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const { updatePetSettings } = await import("./engine.js");
    await updatePetSettings(guildId, { enabled });
    await interaction.editReply(`Pets are now **${enabled ? "enabled" : "disabled"}**.`);
    return;
  }
  if (sub === "set") {
    const { updatePetSettings } = await import("./engine.js");
    const patch: Record<string, number> = {};
    const hatch = interaction.options.getInteger("hatch_cost");
    const growth = interaction.options.getInteger("growth_hours");
    const neg = interaction.options.getInteger("max_neglects");
    const wager = interaction.options.getInteger("challenge_wager");
    if (hatch != null) patch.hatchCost = hatch;
    if (growth != null) patch.growthHours = growth;
    if (neg != null) patch.maxNeglects = neg;
    if (wager != null) patch.challengeWager = wager;
    if (!Object.keys(patch).length) {
      await interaction.editReply("Provide at least one option to change.");
      return;
    }
    await updatePetSettings(guildId, patch);
    await interaction.editReply("Pet settings updated.");
    return;
  }
  if (sub === "reset") {
    const target = interaction.options.getUser("user", true);
    const { adminDeletePet } = await import("./engine.js");
    try {
      const { deleted } = await adminDeletePet(guildId, target.id);
      await interaction.editReply(
        `Reset <@${target.id}>'s pet **${deleted.name}** (${deleted.stage}). They can \`/pet hatch\` again.`,
      );
    } catch (err) {
      await interaction.editReply(`❌ ${err instanceof Error ? err.message : "Reset failed."}`);
    }
    return;
  }
  if (sub === "crack") {
    const target = interaction.options.getUser("user", true);
    const { adminCrackEgg } = await import("./engine.js");
    try {
      const pet = await adminCrackEgg(guildId, target.id);
      await interaction.editReply(
        `Cracked <@${target.id}>'s egg — **${pet.name}** is now a hatchling. They can care for it with \`/pet hub\`.`,
      );
    } catch (err) {
      await interaction.editReply(`❌ ${err instanceof Error ? err.message : "Crack failed."}`);
    }
  }
}

export async function handlePetComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }

  const parsed = parsePetId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: "This pet panel expired. Run `/pet hub` again.",
      ...EPHEMERAL,
    }).catch(() => {});
    return;
  }
  const { action, ownerId, extra } = parsed;

  // Challenge accept/decline — opponent (or challenger for decline) uses these; no panel owner.
  if (action === "accept" && interaction.isButton()) {
    const challengeId = Number(extra);
    await interaction.deferUpdate();
    try {
      const { winner, loser, challenge } = await resolveChallenge(challengeId, interaction.user.id);
      const challengerPet = winner.userId === challenge.challengerId ? winner : loser;
      const opponentPet = winner.userId === challenge.opponentId ? winner : loser;
      const fight = await renderChallengeGif(challengerPet, opponentPet, winner.userId);
      const files: AttachmentBuilder[] = [];
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setAuthor(UB_AUTHOR)
        .setTitle("⚔️ Pet Challenge Result")
        .setDescription(
          `**${winner.name}** defeated **${loser.name}**!${
            challenge.wager ? `\nWager: **${challenge.wager}** UnbelievaBoat cash` : ""
          }`,
        );
      if (fight?.buffer) {
        files.push(new AttachmentBuilder(fight.buffer, { name: "fight.gif" }));
        embed.setImage("attachment://fight.gif");
      }
      await interaction.editReply({ content: null, embeds: [embed], components: [], files });
      await afterPetMessage(interaction);
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${err instanceof Error ? err.message : "Could not resolve."}`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  if (action === "decline" && interaction.isButton()) {
    const challengeId = Number(extra);
    try {
      await cancelChallenge(challengeId, interaction.user.id);
      await interaction.update({ content: "Challenge declined.", embeds: [], components: [] });
    } catch (err) {
      await interaction.reply({
        content: `❌ ${err instanceof Error ? err.message : "Failed."}`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  if (!(await assertPetOwner(interaction, ownerId))) return;

  // Bump idle timer on the source message whenever the owner clicks.
  if (interaction.message) bumpPetIdleCleanup(interaction.message);

  if (action === "species" && interaction.isStringSelectMenu()) {
    const species = interaction.values[0] as PetSpecies;
    const modal = new ModalBuilder()
      .setCustomId(petId("hatch_modal", ownerId, species))
      .setTitle(`Name your ${SPECIES_META[species].label}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Pet name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(24)
          .setPlaceholder("e.g. Spark, Mochi, Bean…"),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "hatchmenu" && interaction.isButton()) {
    const speciesSelect = new StringSelectMenuBuilder()
      .setCustomId(petId("species", ownerId))
      .setPlaceholder("Pick a species to hatch…")
      .addOptions(PET_SPECIES.map(s => ({
        label: SPECIES_META[s].label,
        value: s,
        emoji: SPECIES_META[s].emoji,
        description: `Hatch a ${SPECIES_META[s].label.toLowerCase()}`,
      })));
    await interaction.reply({
      content: "🥚 Choose a species — then name your egg (UnbelievaBoat cash may apply):",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(speciesSelect)],
      ...EPHEMERAL,
    });
    return;
  }

  if (action === "myhub" && interaction.isButton()) {
    await interaction.deferReply(EPHEMERAL);
    const mine = await getPet(guildId, interaction.user.id);
    if (!mine) {
      await interaction.editReply("You don't have a pet yet — run `/pet hub`.");
      return;
    }
    await replyWithPet(interaction, await tickPet(mine), { ownerId: interaction.user.id });
    return;
  }

  if (action === "top" && interaction.isButton()) {
    await interaction.deferReply(EPHEMERAL);
    const rows = await petLeaderboard(guildId, 10);
    const lines = rows.map((r, i) => {
      const em = SPECIES_META[r.species as PetSpecies]?.emoji ?? "🐾";
      return `**${i + 1}.** ${em} **${r.name}** — <@${r.userId}> · ${r.power} PWR`;
    }).join("\n") || "_Empty_";
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf59e0b)
          .setAuthor(UB_AUTHOR)
          .setTitle("🏆 Top Pets")
          .setDescription(lines),
      ],
    });
    return;
  }

  if (action === "challenge" && interaction.isButton()) {
    const menu = new UserSelectMenuBuilder()
      .setCustomId(petId("challenge_user", ownerId))
      .setPlaceholder("Pick someone to challenge…")
      .setMaxValues(1);
    await interaction.reply({
      content: "Choose an opponent:",
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu)],
      ...EPHEMERAL,
    });
    return;
  }

  if (action === "challenge_user" && interaction.isUserSelectMenu()) {
    const opponentId = interaction.values[0]!;
    await interaction.deferUpdate();
    try {
      const settings = await getOrCreatePetSettings(guildId);
      const { id: cid } = await createChallenge(guildId, interaction.user.id, opponentId, settings.challengeWager);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`pet:accept:${cid}`).setLabel("Accept").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pet:decline:${cid}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      );
      await interaction.followUp({
        content: `⚔️ <@${interaction.user.id}> challenges <@${opponentId}>'s pet${
          settings.challengeWager ? ` for **${settings.challengeWager}** UnbelievaBoat cash` : ""
        }!`,
        components: [row],
      });
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${err instanceof Error ? err.message : "Failed."}`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  if (action === "shop" && interaction.isButton()) {
    const catalog = await listCatalog(guildId, { forPets: true });
    const items = [
      ...DEFAULT_SHOP,
      ...catalog.filter(c => c.listed).map(c => ({
        key: `cat:${c.id}`,
        label: c.name,
        price: c.price,
        emoji: c.emoji ?? "🎁",
        blurb: c.description ?? "Catalog item",
      })),
    ];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(petId("buy", ownerId))
      .setPlaceholder("Buy with UnbelievaBoat cash…")
      .addOptions(items.slice(0, 25).map(i => ({
        label: `${i.label} — ${i.price} cash`,
        value: i.key,
        description: i.blurb.slice(0, 100),
        emoji: i.emoji,
      })));
    await interaction.reply({
      content: "🛒 **Pet Shop** — prices are **UnbelievaBoat cash** (when the API token is authorized).",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ...EPHEMERAL,
    });
    return;
  }

  if (action === "buy" && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const key = interaction.values[0]!;
    const shopItem = DEFAULT_SHOP.find(i => i.key === key);
    try {
      if (!shopItem) {
        const catalog = await listCatalog(guildId, { forPets: true });
        const cid = Number(key.replace("cat:", ""));
        const item = catalog.find(c => c.id === cid);
        if (!item) throw new Error("Unknown item.");
        const effectKey = item.petEffect ?? `item_${item.id}`;
        await buyPetItem(guildId, interaction.user.id, {
          key: effectKey,
          price: item.price,
          label: item.name,
        });
      } else {
        await buyPetItem(guildId, interaction.user.id, shopItem);
      }
      const pet = await getPet(guildId, interaction.user.id);
      if (pet) await replyWithPet(interaction, pet, { content: `🛒 Purchased with UnbelievaBoat cash!`, ownerId });
      else await interaction.followUp({ content: "Purchased.", ...EPHEMERAL });
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${err instanceof Error ? err.message : "Purchase failed."}`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  if (action === "inv" && interaction.isButton()) {
    const pet = await getPet(guildId, interaction.user.id);
    if (!pet) {
      await interaction.reply({ content: "No pet.", ...EPHEMERAL });
      return;
    }
    const entries = Object.entries(pet.inventory ?? {}).filter(([, n]) => Number(n) > 0);
    if (!entries.length) {
      await interaction.reply({ content: "Inventory empty — open the shop.", ...EPHEMERAL });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId(petId("use", ownerId))
      .setPlaceholder("Use an item…")
      .addOptions(entries.slice(0, 25).map(([k, n]) => ({
        label: `${k} ×${n}`,
        value: k,
      })));
    await interaction.reply({
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ...EPHEMERAL,
    });
    return;
  }

  if (action === "use" && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    try {
      let pet = await getPet(guildId, interaction.user.id);
      if (!pet) throw new Error("No pet.");
      pet = await usePetItem(await tickPet(pet), interaction.values[0]!);
      await replyWithPet(interaction, pet, { ownerId });
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${err instanceof Error ? err.message : "Failed."}`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  // Care actions + refresh — always load the PANEL OWNER's pet, never the clicker's
  // if they somehow bypassed (assertPetOwner already enforced clicker === owner).
  if (action === "feed" || action === "clean" || action === "play" || action === "refresh") {
    await interaction.deferUpdate().catch(() => {});
    try {
      let pet = await getPet(guildId, ownerId);
      if (!pet) {
        await interaction.followUp({ content: "Hatch a pet first with `/pet hatch`.", ...EPHEMERAL });
        return;
      }
      pet = await tickPet(pet);
      if (action === "feed") pet = await feedPet(pet);
      else if (action === "clean") pet = await cleanPet(pet);
      else if (action === "play") pet = await playWithPet(pet);
      await replyWithPet(interaction, pet, { ownerId });
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${err instanceof Error ? err.message : "Action failed."}`,
        ...EPHEMERAL,
      });
    }
    return;
  }

  await interaction.reply({
    content: "Unknown pet action — run `/pet hub` again.",
    ...EPHEMERAL,
  }).catch(() => {});
}

/** Modal submit: pet:hatch_modal:<species>:<ownerId> */
export async function handlePetModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  const parsed = parsePetId(interaction.customId);
  if (!parsed || parsed.action !== "hatch_modal") {
    await interaction.reply({ content: "Unknown pet form.", ...EPHEMERAL });
    return;
  }
  if (!(await assertPetOwner(interaction, parsed.ownerId))) return;

  const species = parsed.extra as PetSpecies;
  if (!PET_SPECIES.includes(species)) {
    await interaction.reply({ content: "Unknown species.", ...EPHEMERAL });
    return;
  }
  const name = interaction.fields.getTextInputValue("name").trim();
  if (!name) {
    await interaction.reply({ content: "Give your pet a name.", ...EPHEMERAL });
    return;
  }

  await interaction.deferReply();
  try {
    const { pet, charged } = await hatchPet(guildId, interaction.user.id, { name, species });
    await replyWithPet(interaction, pet, {
      hatchAnim: true,
      tutorial: true,
      content: charged > 0
        ? `🎉 **${pet.name}** hatched! (−${charged} UnbelievaBoat cash)\nStart with **Feed → Clean → Play**.`
        : `🎉 **${pet.name}** hatched!\nStart with **Feed → Clean → Play**. Hearts drop over real time.`,
    });
  } catch (err) {
    await interaction.editReply(`❌ ${err instanceof Error ? err.message : "Hatch failed."}`);
  }
}
