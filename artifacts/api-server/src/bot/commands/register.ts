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

    cmd("catalog", "(User) Browse cards by category — see what you own and what's missing", s => s
      .addStringOption(o => o.setName("category").setDescription("Which group to view").setRequired(true)
        .addChoices(
          { name: "🟡 Legendary", value: "legendary" },
          { name: "🟣 Epic", value: "epic" },
          { name: "🔵 Rare", value: "rare" },
          { name: "🟢 Uncommon", value: "uncommon" },
          { name: "⚪ Common", value: "common" },
          { name: "🎆 Event Exclusive", value: "event" },
          { name: "💎 Limited Edition", value: "limited" },
          { name: "🃏 All cards", value: "all" },
        ))
      .addUserOption(o => o.setName("user").setDescription("Check another member's ownership (default: you)"))),

    cmd("top", "(User) Top 10 collectors leaderboard", s => s),

    cmd("burn", "(User) Burn duplicate cards for DN Shards", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name to burn").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("amount").setDescription("How many copies to burn (default 1)").setMinValue(1))
      .addBooleanOption(o => o.setName("all").setDescription("Burn every copy you own of this card"))
      .addBooleanOption(o => o.setName("shiny").setDescription("Burn shiny copies (2× shards) instead of normal copies"))),

    cmd("shards", "(User) Check your DN Shards balance", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's balance"))),

    cmd("trade", "(User) Propose a trade — cards, shards, or both", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to trade with").setRequired(true))
      .addStringOption(o => o.setName("offer").setDescription("Card you are offering").setAutocomplete(true))
      .addStringOption(o => o.setName("want").setDescription("Card you want in return").setAutocomplete(true))
      .addIntegerOption(o => o.setName("offer_shards").setDescription("💠 shards you offer (optional)").setMinValue(1))
      .addIntegerOption(o => o.setName("want_shards").setDescription("💠 shards you want (optional)").setMinValue(1))),

    cmd("gift", "(User) Gift DN Shards to another member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to send shards to").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount of 💠 shards to gift").setRequired(true).setMinValue(1))),

    cmd("trades", "(User) View your pending trade offers", s => s),
    cmd("tradehistory", "(User) View recent completed trades", s => s
      .addUserOption(o => o.setName("user").setDescription("Whose history to view (default: you)").setRequired(false))),

    cmd("accept", "(User) Accept a pending trade offer", s => s
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /trades").setRequired(true).setMinValue(1))),

    cmd("decline", "(User) Decline or cancel a trade offer", s => s
      .addIntegerOption(o => o.setName("id").setDescription("Trade ID from /trades").setRequired(true).setMinValue(1))),

    cmd("help", "(User) Show DN Cards player commands", s => s),

    cmd("adminhelp", "(Admin) Show admin & setup commands", s => s),

    cmd("daily", "(User) Claim your daily DN Shards reward", s => s),

    cmd("pack", "(User) Open a card pack — pick a tier", s => s
      .addStringOption(o => o.setName("tier")
        .setDescription("Which pack to open (default: Basic)")
        .addChoices(
          { name: "🥉 Basic (cheapest, standard rates)",       value: "basic" },
          { name: "🥈 Premium (better rates, costs more)",     value: "premium" },
          { name: "🥇 Legendary (no commons, top-tier odds)",  value: "legendary" },
        ))),

    cmd("packstats", "(User) See your pack costs, weekly caps & cooldown", s => s),

    cmd("tradein", "(User) Burn 5 cards of one rarity for 1 random card of the next tier up", s => s
      .addStringOption(o => o.setName("rarity").setDescription("Rarity of cards to trade in").setRequired(true)
        .addChoices(
          { name: "Common → Uncommon", value: "common" },
          { name: "Uncommon → Rare", value: "uncommon" },
          { name: "Rare → Epic", value: "rare" },
          { name: "Epic → Legendary", value: "epic" },
        ))),

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
    cmd("config", "(Admin) Open the server config panel — visual toggles for catch mode, intervals, etc.", s => s),

    cmd("adminhub", "(Admin) Quick hub — manage admins, timeouts, and see server state", s => s),

    cmd("drop", "(Admin) Force-drop a card — for events and giveaways", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for a random drop").setAutocomplete(true))),

    cmd("massdrop", "(Admin abuse) Drop a big batch of cards — mostly low tier with a few bangers", s => s
      .addIntegerOption(o => o.setName("amount").setDescription("How many cards to drop (10-25, default 15)").setMinValue(10).setMaxValue(25))),

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

    // ── Card Events (limited-time spawn boosts) ──────────────────────────────
    cmd("event", "(Admin) Run limited-time card events — boost a card's spawn rate", s => s
      .addSubcommand(sc => sc.setName("start").setDescription("Start a limited-time card event")
        .addStringOption(o => o.setName("card").setDescription("Card to boost").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("duration").setDescription("How long (e.g. 30m, 2h, 1d — max 14d)").setRequired(true))
        .addNumberOption(o => o.setName("multiplier").setDescription("Weight multiplier (1.1–50, default 2)").setMinValue(1.1).setMaxValue(50)))
      .addSubcommand(sc => sc.setName("list").setDescription("Show active card events in this server"))
      .addSubcommand(sc => sc.setName("stop").setDescription("Stop an active event early")
        .addIntegerOption(o => o.setName("id").setDescription("Event ID from /event list").setRequired(true).setMinValue(1)))),

    // ── Card Set Management ───────────────────────────────────────────────────
    cmd("loadset", "(Admin) Upload a JSON card set to add to your roster", s => s
      .addAttachmentOption(o => o.setName("file").setDescription("JSON file with cards to import"))
      .addStringOption(o => o.setName("name").setDescription("Custom set name (defaults to JSON's set.name or filename)"))
      .addBooleanOption(o => o.setName("defaults").setDescription("Testing only — load the built-in starter roster"))),

    cmd("unloadset", "(Admin) Remove a card set (cards + related collections/trades)", s => s
      .addStringOption(o => o.setName("set").setDescription("Set name from /listsets (e.g. 'defaults', 'v1')").setRequired(true).setAutocomplete(true))),

    cmd("listsets", "(Admin) List all loaded card sets and their sizes", s => s),
  ];
}

export const USER_COMMAND_NAMES = new Set([
  "collection", "rank", "info", "list", "catalog", "top",
  "burn", "shards", "trade", "trades", "accept", "decline", "help",
  "daily", "pack", "packstats", "achievements", "wishlist", "gift", "tradein",
]);

export const ADMIN_COMMAND_NAMES = new Set([
  "config", "adminhub", "adminhelp", "drop", "massdrop", "give", "giveshards", "takeback", "takeshards", "event",
]);

export const CARDSET_COMMAND_NAMES = new Set([
  "loadset", "unloadset", "listsets",
]);
