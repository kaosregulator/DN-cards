import { SlashCommandBuilder, ChannelType } from "discord.js";

const rarityChoices = [
  { name: "⚪ Common", value: "common" },
  { name: "🟢 Uncommon", value: "uncommon" },
  { name: "🔵 Rare", value: "rare" },
  { name: "🟣 Epic", value: "epic" },
  { name: "🌟 Legendary", value: "legendary" },
] as const;

export function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("card")
      .setDescription("DN Cards — DarkNight Military Collectible Card Game")
      .setDMPermission(false)

      // ── User subcommands ──────────────────────────────────────────────────
      .addSubcommand(s => s
        .setName("collection")
        .setDescription("View your DN Cards collection")
        .addUserOption(o => o.setName("user").setDescription("View another member's collection")))

      .addSubcommand(s => s
        .setName("rank")
        .setDescription("View your collector rank and progression")
        .addUserOption(o => o.setName("user").setDescription("View another member's rank")))

      .addSubcommand(s => s
        .setName("info")
        .setDescription("View details about a specific card")
        .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true)))

      .addSubcommand(s => s
        .setName("list")
        .setDescription("View the full DN Cards roster grouped by rarity"))

      .addSubcommand(s => s
        .setName("top")
        .setDescription("Top 10 collectors leaderboard ranked by net worth"))

      .addSubcommand(s => s
        .setName("burn")
        .setDescription("Burn a duplicate card to earn DN Shards")
        .addStringOption(o => o.setName("name").setDescription("Card name to burn").setRequired(true)))

      .addSubcommand(s => s
        .setName("shards")
        .setDescription("Check your DN Shards balance")
        .addUserOption(o => o.setName("user").setDescription("View another member's balance")))

      .addSubcommand(s => s
        .setName("trade")
        .setDescription("Propose a card trade with another member")
        .addUserOption(o => o.setName("user").setDescription("Member to trade with").setRequired(true))
        .addStringOption(o => o.setName("offer").setDescription("Card you are offering").setRequired(true))
        .addStringOption(o => o.setName("want").setDescription("Card you want in return").setRequired(true)))

      .addSubcommand(s => s
        .setName("trades")
        .setDescription("View your pending trade offers"))

      .addSubcommand(s => s
        .setName("accept")
        .setDescription("Accept a trade offer")
        .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /card trades").setRequired(true).setMinValue(1)))

      .addSubcommand(s => s
        .setName("decline")
        .setDescription("Decline or cancel a trade offer")
        .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /card trades").setRequired(true).setMinValue(1)))

      .addSubcommand(s => s
        .setName("help")
        .setDescription("Show all DN Cards commands"))

      // ── Admin subcommand group ────────────────────────────────────────────
      .addSubcommandGroup(g => g
        .setName("admin")
        .setDescription("Admin-only commands")

        .addSubcommand(s => s
          .setName("setchannel")
          .setDescription("Set the channel where cards spawn")
          .addChannelOption(o => o
            .setName("channel")
            .setDescription("Spawn channel (defaults to current channel)")
            .addChannelTypes(ChannelType.GuildText)))

        .addSubcommand(s => s
          .setName("setinterval")
          .setDescription("Set the card spawn interval (fixed or random range)")
          .addStringOption(o => o.setName("time").setDescription("Fixed interval: 30m, 1h, 90s"))
          .addStringOption(o => o.setName("min").setDescription("Random range minimum: 10m"))
          .addStringOption(o => o.setName("max").setDescription("Random range maximum: 60m")))

        .addSubcommand(s => s
          .setName("setwindow")
          .setDescription("Set how long a card stays catchable before expiring")
          .addStringOption(o => o.setName("time").setDescription("Duration: 2m, 90s, 1h").setRequired(true)))

        .addSubcommand(s => s
          .setName("enable")
          .setDescription("Enable automatic card spawning"))

        .addSubcommand(s => s
          .setName("disable")
          .setDescription("Disable automatic card spawning"))

        .addSubcommand(s => s
          .setName("drop")
          .setDescription("Force-drop a card immediately (for events and giveaways)")
          .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for a random drop")))

        .addSubcommand(s => s
          .setName("addcard")
          .setDescription("Add a new standard card to the pool")
          .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true).addChoices(...rarityChoices))
          .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))
          .addStringOption(o => o.setName("description").setDescription("Card description")))

        .addSubcommand(s => s
          .setName("addlimited")
          .setDescription("Add a Limited Edition card with a copy cap (admin-drop only)")
          .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true).addChoices(...rarityChoices))
          .addIntegerOption(o => o.setName("maxcopies").setDescription("Maximum copies that can exist").setRequired(true).setMinValue(1))
          .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))
          .addStringOption(o => o.setName("description").setDescription("Card description")))

        .addSubcommand(s => s
          .setName("addevent")
          .setDescription("Add an Event Exclusive card (admin-drop only, never random-spawns)")
          .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true).addChoices(...rarityChoices))
          .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true))
          .addStringOption(o => o.setName("description").setDescription("Card description")))

        .addSubcommand(s => s
          .setName("removecard")
          .setDescription("Remove a card from the pool")
          .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true)))

        .addSubcommand(s => s
          .setName("give")
          .setDescription("Give a specific card directly to a member")
          .addUserOption(o => o.setName("user").setDescription("Member to give the card to").setRequired(true))
          .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true)))

        .addSubcommand(s => s
          .setName("giveshards")
          .setDescription("Give DN Shards to a member")
          .addUserOption(o => o.setName("user").setDescription("Member to receive shards").setRequired(true))
          .addIntegerOption(o => o.setName("amount").setDescription("Amount of shards").setRequired(true).setMinValue(1)))

        .addSubcommand(s => s
          .setName("addadmin")
          .setDescription("Grant a member bot admin access")
          .addUserOption(o => o.setName("user").setDescription("Member to grant access to").setRequired(true)))

        .addSubcommand(s => s
          .setName("removeadmin")
          .setDescription("Revoke bot admin access from a member")
          .addUserOption(o => o.setName("user").setDescription("Member to revoke access from").setRequired(true)))

        .addSubcommand(s => s
          .setName("listadmins")
          .setDescription("List all bot admins for this server"))

        .addSubcommand(s => s
          .setName("settings")
          .setDescription("View current server settings"))

        .addSubcommand(s => s
          .setName("tradingenable")
          .setDescription("Enable card trading for this server"))

        .addSubcommand(s => s
          .setName("tradingdisable")
          .setDescription("Disable card trading for this server"))

        .addSubcommand(s => s
          .setName("settradechannel")
          .setDescription("Set a dedicated channel for trade proposals")
          .addChannelOption(o => o
            .setName("channel")
            .setDescription("Trade channel (defaults to current channel)")
            .addChannelTypes(ChannelType.GuildText))))

      .toJSON(),
  ];
}
