// /cardadmin — admin card create/edit/give/drop hub.
// Sources: Discord upload · Kitsu (kitsu.io) · Vault Values (valuevaultx.com).
// Thin router into existing admin handlers — options, autocomplete, panels, and
// Vault Values / Kitsu fetch paths are unchanged.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";

export function buildCardAdminCommandJson() {
  return new SlashCommandBuilder()
    .setName("cardadmin")
    .setDescription("Admin card hub — create from upload / Kitsu / Vault Values, edit, give, drop")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // ── Create ──────────────────────────────────────────────────────────────
    .addSubcommand(sc => sc
      .setName("create")
      .setDescription("Create a card — upload an image/GIF from Discord")
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("rarity").setDescription("Built-in rarity tier — type to search").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("type").setDescription("Card type/tag — type to search or enter new").setRequired(true).setAutocomplete(true))
      .addAttachmentOption(o => o.setName("image").setDescription("Upload card image/GIF with Discord's file picker"))
      .addStringOption(o => o.setName("set").setDescription("Optional set to add this card to immediately").setAutocomplete(true))
      .addStringOption(o => o.setName("description").setDescription("Card description (up to 500 chars)").setMaxLength(500))
      .addBooleanOption(o => o.setName("limited").setDescription("Limited edition — capped copy count?"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies if limited (default 50)").setMinValue(1))
      .addBooleanOption(o => o.setName("event_exclusive").setDescription("Event exclusive — never spawns randomly?")))
    .addSubcommand(sc => sc
      .setName("create_kitsu")
      .setDescription("Create from Kitsu — anime, manga, or character (kitsu.io)")
      .addStringOption(o => o.setName("category").setDescription("Kitsu library to search").setRequired(true)
        .addChoices(
          { name: "Anime", value: "anime" },
          { name: "Manga", value: "manga" },
          { name: "Character", value: "character" },
        ))
      .addStringOption(o => o.setName("item").setDescription("Title or character name — type to search").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("rarity").setDescription("DN rarity tier — type to search").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("type").setDescription("Card type/tag").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("set").setDescription("Optional set").setAutocomplete(true))
      .addStringOption(o => o.setName("description").setDescription("Override description").setMaxLength(500))
      .addBooleanOption(o => o.setName("limited").setDescription("Limited edition?"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies if limited").setMinValue(1))
      .addBooleanOption(o => o.setName("event_exclusive").setDescription("Event exclusive?")))
    .addSubcommand(sc => sc
      .setName("create_vault")
      .setDescription("Create from Vault Values — image + value (valuevaultx.com)")
      .addStringOption(o => o.setName("item").setDescription("Vault Values item — type to search").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("rarity").setDescription("DN rarity tier — type to search").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("type").setDescription("Card type/tag").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("set").setDescription("Optional set").setAutocomplete(true))
      .addStringOption(o => o.setName("description").setDescription("Override description").setMaxLength(500))
      .addBooleanOption(o => o.setName("limited").setDescription("Limited edition?"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies if limited").setMinValue(1))
      .addBooleanOption(o => o.setName("event_exclusive").setDescription("Event exclusive?")))
    .addSubcommand(sc => sc
      .setName("library")
      .setDescription("Preview a Kitsu title/character (bio + image)")
      .addStringOption(o => o.setName("category").setDescription("Kitsu library").setRequired(true)
        .addChoices(
          { name: "Anime", value: "anime" },
          { name: "Manga", value: "manga" },
          { name: "Character", value: "character" },
        ))
      .addStringOption(o => o.setName("name").setDescription("Title or character — type to search").setRequired(true).setAutocomplete(true)))
    // ── Edit ────────────────────────────────────────────────────────────────
    .addSubcommand(sc => sc
      .setName("edit")
      .setDescription("Edit a card — optional replacement image/GIF")
      .addStringOption(o => o.setName("name").setDescription("Card to edit").setRequired(true).setAutocomplete(true))
      .addAttachmentOption(o => o.setName("image").setDescription("Optional replacement image/GIF upload"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies (0 clears limit)").setMinValue(0))
      .addIntegerOption(o => o.setName("total_minted").setDescription("Manual total minted override").setMinValue(0))
      .addBooleanOption(o => o.setName("limited").setDescription("Mark limited edition")))
    .addSubcommand(sc => sc
      .setName("edit_image")
      .setDescription("Update image/description from Vault Values or upload")
      .addStringOption(o => o.setName("name").setDescription("Card to edit").setRequired(true).setAutocomplete(true))
      .addAttachmentOption(o => o.setName("image").setDescription("Upload image/GIF (overrides Vault Values search)")))
    .addSubcommand(sc => sc
      .setName("delete")
      .setDescription("Permanently delete a card from the roster")
      .addStringOption(o => o.setName("name").setDescription("Card to delete").setRequired(true).setAutocomplete(true)))
    // ── Give / drop ─────────────────────────────────────────────────────────
    .addSubcommand(sc => sc
      .setName("give")
      .setDescription("Give a card directly to a member")
      .addUserOption(o => o.setName("user").setDescription("Member to receive the card").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("amount").setDescription("How many copies (default 1, max 100)").setMinValue(1).setMaxValue(100))
      .addIntegerOption(o => o.setName("star").setDescription("Star Rank (0-5)").setMinValue(0).setMaxValue(5))
      .addIntegerOption(o => o.setName("level").setDescription("Level (1-100)").setMinValue(1).setMaxValue(100)))
    .addSubcommand(sc => sc
      .setName("take")
      .setDescription("Remove a card from a member's collection")
      .addUserOption(o => o.setName("user").setDescription("Member to take the card from").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Copies to remove (default 1, max 100)").setMinValue(1).setMaxValue(100)))
    .addSubcommand(sc => sc
      .setName("giveall")
      .setDescription("Give one copy of every card (optional set/rarity filter)")
      .addUserOption(o => o.setName("user").setDescription("Member to receive the cards").setRequired(true))
      .addStringOption(o => o.setName("set").setDescription("Only cards from this set").setAutocomplete(true))
      .addStringOption(o => o.setName("rarity").setDescription("Only this rarity")
        .addChoices(
          { name: "Common", value: "common" }, { name: "Uncommon", value: "uncommon" },
          { name: "Rare", value: "rare" }, { name: "Epic", value: "epic" },
          { name: "Legendary", value: "legendary" }, { name: "Mythic", value: "mythic" },
        ))
      .addIntegerOption(o => o.setName("shinyrate").setDescription("Shiny chance 0-100% (default 0.5)").setMinValue(0).setMaxValue(100)))
    .addSubcommand(sc => sc
      .setName("drop")
      .setDescription("Force-drop a card — for events and giveaways")
      .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for random from active set").setAutocomplete(true))
      .addStringOption(o => o.setName("set").setDescription("Pick a specific set to drop from").setAutocomplete(true))
      .addIntegerOption(o => o.setName("star").setDescription("Star Rank (0-5)").setMinValue(0).setMaxValue(5))
      .addIntegerOption(o => o.setName("level").setDescription("Level (1-100)").setMinValue(1).setMaxValue(100)))
    .addSubcommand(sc => sc
      .setName("mass_drop")
      .setDescription("Drop a big batch of cards")
      .addIntegerOption(o => o.setName("amount").setDescription("How many cards (10-25, default 15)").setMinValue(10).setMaxValue(25))
      .addStringOption(o => o.setName("set").setDescription("Pick a specific set to drop from").setAutocomplete(true)))
    .addSubcommand(sc => sc
      .setName("give_shards")
      .setDescription("Give DN Shards to a member")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc
      .setName("take_shards")
      .setDescription("Deduct DN Shards from a member")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)))
    .addSubcommand(sc => sc
      .setName("edituser")
      .setDescription("Edit a member's cards, shards, and battle profile")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)))
    .toJSON();
}

const SUB_TO_INTERNAL: Record<string, string> = {
  create: "addcard",
  create_kitsu: "createcardfrom",
  create_vault: "createcardfrommttv",
  library: "library",
  edit: "editcard",
  edit_image: "editimage",
  delete: "deletecard",
  give: "give",
  take: "takeback",
  giveall: "giveall",
  drop: "drop",
  mass_drop: "massdrop",
  give_shards: "giveshards",
  take_shards: "takeshards",
  edituser: "edituser",
};

export async function handleCardAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const internal = SUB_TO_INTERNAL[sub];
  if (!internal) {
    await interaction.reply({ content: "Unknown cardadmin action.", ephemeral: true });
    return;
  }
  // Existing admin handlers own defer / home-guild gates / panels.
  const { handleAdminCommand } = await import("./admin.js");
  await handleAdminCommand(interaction, internal);
}
