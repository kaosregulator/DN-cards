import { SlashCommandBuilder, ChannelType, type SlashCommandOptionsOnlyBuilder } from "discord.js";

type AnySlashBuilder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;

const rarityChoices = [
  { name: "⚪ Common", value: "common" },
  { name: "🟢 Uncommon", value: "uncommon" },
  { name: "🔵 Rare", value: "rare" },
  { name: "🟣 Epic", value: "epic" },
  { name: "🌟 Legendary", value: "legendary" },
] as const;

function user(name: string, desc: string, build: (s: SlashCommandBuilder) => AnySlashBuilder) {
  return build(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(`(User) ${desc}`)
      .setDMPermission(false),
  ).toJSON();
}

function admin(name: string, desc: string, build: (s: SlashCommandBuilder) => AnySlashBuilder) {
  return build(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(`(Admin) ${desc}`)
      .setDMPermission(false),
  ).toJSON();
}

export function buildCommands() {
  return [
    // ── User Commands ─────────────────────────────────────────────────────────
    user("collection", "View your DN Cards collection", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's collection"))),

    user("rank", "View your collector rank and progression", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's rank"))),

    user("info", "View details, worth, and drop chance for a card", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))),

    user("list", "View the full DN Cards roster grouped by rarity", s => s),

    user("top", "Top 10 collectors leaderboard ranked by net worth", s => s),

    user("burn", "Burn a duplicate card to earn DN Shards", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name to burn").setRequired(true))),

    user("shards", "Check your DN Shards balance", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's balance"))),

    user("trade", "Propose a 1-for-1 card trade with another member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to trade with").setRequired(true))
      .addStringOption(o => o.setName("offer").setDescription("Card you are offering").setRequired(true))
      .addStringOption(o => o.setName("want").setDescription("Card you want in return").setRequired(true))),

    user("trades", "View your pending trade offers", s => s),

    user("accept", "Accept a pending trade offer", s => s
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID (from /trades)").setRequired(true).setMinValue(1))),

    user("decline", "Decline or cancel a trade offer", s => s
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID (from /trades)").setRequired(true).setMinValue(1))),

    user("help", "Show all DN Cards commands", s => s),

    // ── Admin Commands ────────────────────────────────────────────────────────
    admin("setchannel", "Set the channel where cards spawn", s => s
      .addChannelOption(o => o
        .setName("channel")
        .setDescription("Spawn channel (defaults to current channel)")
        .addChannelTypes(ChannelType.GuildText))),

    admin("setinterval", "Set the card spawn interval — fixed or random range", s => s
      .addStringOption(o => o.setName("time").setDescription("Fixed interval: 30m, 1h, 90s"))
      .addStringOption(o => o.setName("min").setDescription("Random range minimum: 10m"))
      .addStringOption(o => o.setName("max").setDescription("Random range maximum: 60m"))),

    admin("setwindow", "Set how long a card stays catchable before expiring", s => s
      .addStringOption(o => o.setName("time").setDescription("Duration: 2m, 90s, 1h").setRequired(true))),

    admin("spawnenable", "Enable automatic card spawning", s => s),

    admin("spawndisable", "Disable automatic card spawning", s => s),

    admin("drop", "Force-drop a card immediately for events or giveaways", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for a random drop"))),

    admin("addcard", "Add a new standard card to the pool", s => s
      .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true).addChoices(...rarityChoices))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))
      .addStringOption(o => o.setName("description").setDescription("Card description"))
      .addAttachmentOption(o => o.setName("image").setDescription("Card image (upload a file)"))),

    admin("addlimited", "Add a Limited Edition card with a copy cap (admin-drop only)", s => s
      .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true).addChoices(...rarityChoices))
      .addIntegerOption(o => o.setName("maxcopies").setDescription("Maximum copies that can exist").setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))
      .addStringOption(o => o.setName("description").setDescription("Card description"))
      .addAttachmentOption(o => o.setName("image").setDescription("Card image (upload a file)"))),

    admin("addevent", "Add an Event Exclusive card (admin-drop only, never random-spawns)", s => s
      .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true).addChoices(...rarityChoices))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))
      .addStringOption(o => o.setName("description").setDescription("Card description"))
      .addAttachmentOption(o => o.setName("image").setDescription("Card image (upload a file)"))),

    admin("removecard", "Remove a card from the pool", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))),

    admin("give", "Give a specific card directly to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to give the card to").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))),

    admin("giveshards", "Give DN Shards to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to receive shards").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount of shards").setRequired(true).setMinValue(1))),

    admin("addadmin", "Grant a member bot admin access", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to grant access to").setRequired(true))),

    admin("removeadmin", "Revoke bot admin access from a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to revoke access from").setRequired(true))),

    admin("listadmins", "List all DN Cards bot admins for this server", s => s),

    admin("settings", "View current DN Cards server settings", s => s),

    admin("tradingenable", "Enable card trading for this server", s => s),

    admin("tradingdisable", "Disable card trading for this server", s => s),

    admin("settradechannel", "Set a dedicated channel for trade proposals", s => s
      .addChannelOption(o => o
        .setName("channel")
        .setDescription("Trade channel (defaults to current channel)")
        .addChannelTypes(ChannelType.GuildText))),
  ];
}

// Full list of all command names for routing
export const USER_COMMAND_NAMES = new Set([
  "collection", "rank", "info", "list", "top",
  "burn", "shards", "trade", "trades", "accept", "decline", "help",
]);

export const ADMIN_COMMAND_NAMES = new Set([
  "setchannel", "setinterval", "setwindow", "spawnenable", "spawndisable",
  "drop", "addcard", "addlimited", "addevent", "removecard",
  "give", "giveshards", "addadmin", "removeadmin", "listadmins",
  "settings", "tradingenable", "tradingdisable", "settradechannel",
]);
