import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

type AnySlashBuilder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

function cmd(name: string, desc: string, build: (s: SlashCommandBuilder) => AnySlashBuilder) {
  return build(
    new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false),
  ).toJSON();
}

export function buildCommands() {
  return [
    // ── User Commands ─────────────────────────────────────────────────────────
    cmd("collection", "(User) View your DN Cards collection", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's collection"))),

    cmd("rank", "(User) Your collector rank and progression", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's rank"))),

    cmd("info", "(User) View card details, worth, and drop chance", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))),

    cmd("list", "(User) Full DN Cards roster grouped by rarity", s => s),

    cmd("top", "(User) Top 10 collectors leaderboard", s => s),

    cmd("burn", "(User) Burn a duplicate card for DN Shards", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name to burn").setRequired(true).setAutocomplete(true))),

    cmd("shards", "(User) Check your DN Shards balance", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's balance"))),

    cmd("trade", "(User) Propose a 1-for-1 card trade", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to trade with").setRequired(true))
      .addStringOption(o => o.setName("offer").setDescription("Card you are offering").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("want").setDescription("Card you want in return").setRequired(true).setAutocomplete(true))),

    cmd("trades", "(User) View your pending trade offers", s => s),

    cmd("accept", "(User) Accept a pending trade offer", s => s
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /trades").setRequired(true).setMinValue(1))),

    cmd("decline", "(User) Decline or cancel a trade offer", s => s
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /trades").setRequired(true).setMinValue(1))),

    cmd("help", "(User) Show DN Cards commands", s => s),

    cmd("daily", "(User) Claim your daily DN Shards reward", s => s),

    cmd("pack", "(User) Open a 5-card pack for DN Shards", s => s),

    cmd("achievements", "(User) View unlocked achievements", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's achievements"))),

    cmd("wishlist", "(User) Manage your card wishlist — get pinged when wished cards spawn", s => s
      .addSubcommand(sc => sc.setName("add").setDescription("Add a card to your wishlist")
        .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("remove").setDescription("Remove a card from your wishlist")
        .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("list").setDescription("View a wishlist")
        .addUserOption(o => o.setName("user").setDescription("View another member's wishlist")))),

    // ── Quick Admin Slash Commands ────────────────────────────────────────────
    cmd("drop", "(Admin) Force-drop a card — for events and giveaways", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for a random drop").setAutocomplete(true))),

    cmd("give", "(Admin) Give a card directly to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to receive the card").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))),

    cmd("giveshards", "(Admin) Give DN Shards to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to receive shards").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount of shards").setRequired(true).setMinValue(1))),

    cmd("takeback", "(Admin) Remove a card from a member's collection", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to take the card from").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))),

    cmd("takeshards", "(Admin) Deduct DN Shards from a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to deduct shards from").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to deduct").setRequired(true).setMinValue(1))),

    // ── Card Set Management ───────────────────────────────────────────────────
    cmd("loadset", "(Admin) Upload a JSON card set or re-add the built-in defaults", s => s
      .addAttachmentOption(o => o.setName("file").setDescription("JSON file with cards to import"))
      .addStringOption(o => o.setName("name").setDescription("Custom set name (defaults to JSON's set.name or filename)"))
      .addBooleanOption(o => o.setName("defaults").setDescription("Re-add the built-in 27 default cards"))),

    cmd("unloadset", "(Admin) Remove a card set (cards + related collections/trades)", s => s
      .addStringOption(o => o.setName("set").setDescription("Set name from /listsets (e.g. 'defaults', 'v1')").setRequired(true).setAutocomplete(true))),

    cmd("listsets", "(Admin) List all loaded card sets and their sizes", s => s),
  ];
}

export const USER_COMMAND_NAMES = new Set([
  "collection", "rank", "info", "list", "top",
  "burn", "shards", "trade", "trades", "accept", "decline", "help",
  "daily", "pack", "achievements", "wishlist",
]);

export const ADMIN_COMMAND_NAMES = new Set([
  "drop", "give", "giveshards", "takeback", "takeshards",
]);

export const CARDSET_COMMAND_NAMES = new Set([
  "loadset", "unloadset", "listsets",
]);
