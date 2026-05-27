import {
  SlashCommandBuilder, PermissionFlagsBits,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

type AnySlashBuilder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

function cmd(name: string, desc: string, build: (s: SlashCommandBuilder) => AnySlashBuilder) {
  return build(
    new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false),
  ).toJSON();
}

// Admin commands hide from non-admin members in the Discord slash menu.
// Server owners can re-grant access per-role in Server Settings → Integrations
// → DN Cards → Command Permissions. Bot still enforces server-side regardless.
function adminCmd(name: string, desc: string, build: (s: SlashCommandBuilder) => AnySlashBuilder) {
  return build(
    new SlashCommandBuilder()
      .setName(name).setDescription(desc).setDMPermission(false)
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
      .addStringOption(o => o.setName("category").setDescription("Optional: jump straight to a category (default: overview)")
        .addChoices(
          { name: "🔮 Mythic", value: "mythic" },
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

    cmd("welcome", "(User) Welcome to DN Cards — game intro, quick start & commands", s => s),

    adminCmd("setup", "(Admin) Interactive server setup wizard — channels, spawns, rates, toggles", s => s),

    adminCmd("setchannels", "(Admin) Interactive channel configurator (spawn, trade, …)", s => s),

    cmd("help", "(User) Show DN Cards player commands", s => s),

    adminCmd("adminhelp", "(Admin) Show admin & setup commands", s => s),

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
          { name: "Legendary → Mythic", value: "legendary" },
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
    adminCmd("config", "(Admin) Open the server config panel — visual toggles for catch mode, intervals, etc.", s => s),

    adminCmd("adminhub", "(Admin) Quick hub — manage admins, timeouts, and see server state", s => s),

    adminCmd("drop", "(Admin) Force-drop a card — for events and giveaways", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for a random drop").setAutocomplete(true))),

    adminCmd("massdrop", "(Admin abuse) Drop a big batch of cards — mostly low tier with a few bangers", s => s
      .addIntegerOption(o => o.setName("amount").setDescription("How many cards to drop (10-25, default 15)").setMinValue(10).setMaxValue(25))),

    adminCmd("give", "(Admin) Give a card directly to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to receive the card").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("amount").setDescription("How many copies to give (default 1, max 100)").setMinValue(1).setMaxValue(100))),

    adminCmd("giveshards", "(Admin) Give DN Shards to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to receive shards").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount of shards").setRequired(true).setMinValue(1))),

    adminCmd("takeback", "(Admin) Remove a card from a member's collection", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to take the card from").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("amount").setDescription("How many copies to remove (default 1, max 100)").setMinValue(1).setMaxValue(100))),

    adminCmd("takeshards", "(Admin) Deduct DN Shards from a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to deduct shards from").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to deduct").setRequired(true).setMinValue(1))),

    // ── Card Events (limited-time spawn boosts) ──────────────────────────────
    adminCmd("event", "(Admin) Run limited-time card events — boost a card's spawn rate", s => s
      .addSubcommand(sc => sc.setName("start").setDescription("Start a limited-time card event")
        .addStringOption(o => o.setName("card").setDescription("Card to boost").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("duration").setDescription("How long (e.g. 30m, 2h, 1d — max 14d)").setRequired(true))
        .addNumberOption(o => o.setName("multiplier").setDescription("Weight multiplier (1.1–50, default 2)").setMinValue(1.1).setMaxValue(50)))
      .addSubcommand(sc => sc.setName("list").setDescription("Show active card events in this server"))
      .addSubcommand(sc => sc.setName("stop").setDescription("Stop an active event early")
        .addIntegerOption(o => o.setName("id").setDescription("Event ID from /event list").setRequired(true).setMinValue(1)))),

    // ── Card Set Management ───────────────────────────────────────────────────
    adminCmd("loadset", "(Admin) Upload a JSON card set to add to your roster", s => s
      .addAttachmentOption(o => o.setName("file").setDescription("JSON file with cards to import"))
      .addStringOption(o => o.setName("name").setDescription("Custom set name (defaults to JSON's set.name or filename)"))
      .addBooleanOption(o => o.setName("defaults").setDescription("Testing only — load the built-in starter roster"))),

    adminCmd("unloadset", "(Admin) Remove a card set (cards + related collections/trades)", s => s
      .addStringOption(o => o.setName("set").setDescription("Set name from /listsets (e.g. 'defaults', 'v1')").setRequired(true).setAutocomplete(true))),

    adminCmd("listsets", "(Admin) List all loaded card sets and their sizes", s => s),

    adminCmd("addadmin", "(Admin) Grant bot admin access to a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to add as bot admin").setRequired(true))),

    adminCmd("removeadmin", "(Admin) Revoke bot admin access from a member", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to remove from bot admins").setRequired(true))),

    adminCmd("listadmins", "(Admin) List current bot admins", s => s),

    adminCmd("editcard", "(Admin) Edit any card — rarity, worth, image, name, etc.", s => s
      .addStringOption(o => o.setName("name").setDescription("Card to edit").setRequired(true).setAutocomplete(true))),

    adminCmd("rarityname", "(Admin) Customize the Mythic tier — pick its name, emoji, and color", s => s
      .addStringOption(o => o.setName("name").setDescription("New name for the Mythic tier (e.g. 'Prismatic', 'Apex')").setRequired(true).setMaxLength(32))
      .addStringOption(o => o.setName("emoji").setDescription("Single emoji to represent it (e.g. 🌈 or 💎)").setRequired(true).setMaxLength(8))
      .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #ff2d92 (optional — keeps current if blank)").setMaxLength(9))
      .addBooleanOption(o => o.setName("reset").setDescription("Reset back to default Mythic / 🔮 / pink"))),

    // ── /rarity — owns ALL writes to rarity_profiles, custom_rarities,
    //              and card_rarity_overrides. The website only reads these.
    adminCmd("rarity", "(Admin) Manage rarity profiles, custom tiers, and card-tier assignments", s => s
      .addSubcommandGroup(g => g.setName("profile").setDescription("Per-tier worth/burn/drop-weight overrides for built-in rarities")
        .addSubcommand(sc => sc.setName("set").setDescription("Override worth/burn/weight for a built-in rarity")
          .addStringOption(o => o.setName("rarity").setDescription("Which built-in tier to override").setRequired(true)
            .addChoices(
              { name: "⚪ Common",    value: "common" },
              { name: "🟢 Uncommon",  value: "uncommon" },
              { name: "🔵 Rare",      value: "rare" },
              { name: "🟣 Epic",      value: "epic" },
              { name: "🟡 Legendary", value: "legendary" },
              { name: "🔮 Mythic",    value: "mythic" },
            ))
          .addIntegerOption(o => o.setName("worth").setDescription("Override worth (💠 per card). Omit to leave unchanged.").setMinValue(0))
          .addIntegerOption(o => o.setName("burn").setDescription("Override burn value (💠 per burn). Omit to leave unchanged.").setMinValue(0))
          .addNumberOption(o => o.setName("weight").setDescription("Override drop weight. Omit to leave unchanged.").setMinValue(0)))
        .addSubcommand(sc => sc.setName("reset").setDescription("Clear all overrides for one built-in rarity")
          .addStringOption(o => o.setName("rarity").setDescription("Which tier to reset").setRequired(true)
            .addChoices(
              { name: "⚪ Common",    value: "common" },
              { name: "🟢 Uncommon",  value: "uncommon" },
              { name: "🔵 Rare",      value: "rare" },
              { name: "🟣 Epic",      value: "epic" },
              { name: "🟡 Legendary", value: "legendary" },
              { name: "🔮 Mythic",    value: "mythic" },
            )))
        .addSubcommand(sc => sc.setName("list").setDescription("Show current profile overrides for this server")))
      .addSubcommandGroup(g => g.setName("custom").setDescription("Brand-new rarity tiers beyond the 6 built-ins")
        .addSubcommand(sc => sc.setName("add").setDescription("Create a new custom rarity tier")
          .addStringOption(o => o.setName("slug").setDescription("Short id (e.g. 'ultra', 'prismatic'). Lowercase, 1-32 chars.").setRequired(true).setMaxLength(32))
          .addStringOption(o => o.setName("name").setDescription("Display name").setRequired(true).setMaxLength(32))
          .addStringOption(o => o.setName("emoji").setDescription("Emoji shown next to the tier (e.g. 🌈)").setRequired(true).setMaxLength(8))
          .addNumberOption(o => o.setName("position").setDescription("Ladder position. Built-ins are 1-6. 5.5 = between legendary and mythic.").setRequired(true).setMinValue(0.01).setMaxValue(100))
          .addIntegerOption(o => o.setName("worth").setDescription("Worth in 💠 per card").setRequired(true).setMinValue(0))
          .addIntegerOption(o => o.setName("burn").setDescription("Burn value in 💠").setRequired(true).setMinValue(0))
          .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #ff2d92").setMaxLength(9))
          .addNumberOption(o => o.setName("weight").setDescription("Drop weight (default 1.0)").setMinValue(0))
          .addBooleanOption(o => o.setName("droppable").setDescription("Can cards in this tier spawn randomly? (default yes)"))
          .addBooleanOption(o => o.setName("inpacks").setDescription("Include this tier in /pack pools? (default no)")))
        .addSubcommand(sc => sc.setName("edit").setDescription("Edit an existing custom tier — only the fields you set will change")
          .addStringOption(o => o.setName("slug").setDescription("Existing tier slug").setRequired(true).setMaxLength(32))
          .addStringOption(o => o.setName("name").setDescription("New display name").setMaxLength(32))
          .addStringOption(o => o.setName("emoji").setDescription("New emoji").setMaxLength(8))
          .addNumberOption(o => o.setName("position").setDescription("New ladder position").setMinValue(0.01).setMaxValue(100))
          .addIntegerOption(o => o.setName("worth").setDescription("New worth").setMinValue(0))
          .addIntegerOption(o => o.setName("burn").setDescription("New burn value").setMinValue(0))
          .addStringOption(o => o.setName("color").setDescription("New hex color").setMaxLength(9))
          .addNumberOption(o => o.setName("weight").setDescription("New drop weight").setMinValue(0))
          .addBooleanOption(o => o.setName("droppable").setDescription("Toggle droppable"))
          .addBooleanOption(o => o.setName("inpacks").setDescription("Toggle pack inclusion")))
        .addSubcommand(sc => sc.setName("remove").setDescription("Delete a custom tier (cards in it revert to their built-in rarity)")
          .addStringOption(o => o.setName("slug").setDescription("Tier slug to remove").setRequired(true).setMaxLength(32)))
        .addSubcommand(sc => sc.setName("list").setDescription("List all custom tiers in this server")))
      .addSubcommandGroup(g => g.setName("card").setDescription("Assign or unassign a card to a custom rarity tier")
        .addSubcommand(sc => sc.setName("assign").setDescription("Put a card into a custom tier — tier's values fully replace the card's gameplay values")
          .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName("slug").setDescription("Custom tier slug").setRequired(true).setMaxLength(32)))
        .addSubcommand(sc => sc.setName("unassign").setDescription("Remove the custom-tier override — card reverts to its built-in rarity")
          .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true))))),

    // ── /embed — owns ALL writes to embed_overrides. Replaces the old
    //              /admin/embeds dashboard page.
    adminCmd("embed", "(Admin) Customize bot embeds — title, footer, color, image, etc.", s => s
      .addSubcommand(sc => sc.setName("show").setDescription("Show current overrides for one embed")
        .addStringOption(o => o.setName("key").setDescription("Which embed").setRequired(true)
          .addChoices(
            { name: "spawn",    value: "spawn"    },
            { name: "claimed",  value: "claimed"  },
            { name: "daily",    value: "daily"    },
            { name: "pack",     value: "pack"     },
            { name: "trade",    value: "trade"    },
            { name: "welcome",  value: "welcome"  },
            { name: "rules",    value: "rules"    },
            { name: "commands", value: "commands" },
          )))
      .addSubcommand(sc => sc.setName("set").setDescription("Set one field on an embed override")
        .addStringOption(o => o.setName("key").setDescription("Which embed").setRequired(true)
          .addChoices(
            { name: "spawn",    value: "spawn"    },
            { name: "claimed",  value: "claimed"  },
            { name: "daily",    value: "daily"    },
            { name: "pack",     value: "pack"     },
            { name: "trade",    value: "trade"    },
            { name: "welcome",  value: "welcome"  },
            { name: "rules",    value: "rules"    },
            { name: "commands", value: "commands" },
          ))
        .addStringOption(o => o.setName("field").setDescription("Which field to set").setRequired(true)
          .addChoices(
            { name: "enabled",                 value: "enabled" },
            { name: "title",                   value: "title" },
            { name: "footer",                  value: "footer" },
            { name: "descriptionPrefix",       value: "descriptionPrefix" },
            { name: "color (hex)",             value: "color" },
            { name: "customImageUrl",          value: "customImageUrl" },
            { name: "imageMode",               value: "imageMode" },
            { name: "showWorth",               value: "showWorth" },
            { name: "showDropChance",          value: "showDropChance" },
            { name: "rarityColor: common",     value: "rarityColor.common" },
            { name: "rarityColor: uncommon",   value: "rarityColor.uncommon" },
            { name: "rarityColor: rare",       value: "rarityColor.rare" },
            { name: "rarityColor: epic",       value: "rarityColor.epic" },
            { name: "rarityColor: legendary",  value: "rarityColor.legendary" },
            { name: "rarityColor: mythic",     value: "rarityColor.mythic" },
          ))
        .addStringOption(o => o.setName("value").setDescription("Value — hex for colors, true/false for toggles, text for title/footer (empty clears)").setRequired(true).setMaxLength(1000)))
      .addSubcommand(sc => sc.setName("reset").setDescription("Reset one field (or the whole embed if no field given)")
        .addStringOption(o => o.setName("key").setDescription("Which embed").setRequired(true)
          .addChoices(
            { name: "spawn",    value: "spawn"    },
            { name: "claimed",  value: "claimed"  },
            { name: "daily",    value: "daily"    },
            { name: "pack",     value: "pack"     },
            { name: "trade",    value: "trade"    },
            { name: "welcome",  value: "welcome"  },
            { name: "rules",    value: "rules"    },
            { name: "commands", value: "commands" },
          ))
        .addStringOption(o => o.setName("field").setDescription("Specific field to reset — omit to wipe the whole override")
          .addChoices(
            { name: "enabled",                 value: "enabled" },
            { name: "title",                   value: "title" },
            { name: "footer",                  value: "footer" },
            { name: "descriptionPrefix",       value: "descriptionPrefix" },
            { name: "color",                   value: "color" },
            { name: "customImageUrl",          value: "customImageUrl" },
            { name: "imageMode",               value: "imageMode" },
            { name: "showWorth",               value: "showWorth" },
            { name: "showDropChance",          value: "showDropChance" },
            { name: "rarityColor: common",     value: "rarityColor.common" },
            { name: "rarityColor: uncommon",   value: "rarityColor.uncommon" },
            { name: "rarityColor: rare",       value: "rarityColor.rare" },
            { name: "rarityColor: epic",       value: "rarityColor.epic" },
            { name: "rarityColor: legendary",  value: "rarityColor.legendary" },
            { name: "rarityColor: mythic",     value: "rarityColor.mythic" },
          )))),

    // ── Dashboard ─────────────────────────────────────────────────────────────
    adminCmd("dashboard", "(Admin) Get a one-time link to set up or reset your web dashboard login", s => s),

    // ── /sets (user, read-only) ───────────────────────────────────────────────
    cmd("sets", "(User) Browse card sets and your collection progress", s => s
      .addSubcommand(sc => sc.setName("list").setDescription("List every card set on this server"))
      .addSubcommand(sc => sc.setName("active").setDescription("Show the set that random spawns currently pull from"))
      .addSubcommand(sc => sc.setName("view").setDescription("Show every card in a set")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("progress").setDescription("Show set-by-set completion for a member")
        .addUserOption(o => o.setName("user").setDescription("Member to inspect (defaults to you)")))),

    // ── /setadmin (admin mutations on sets) ───────────────────────────────────
    adminCmd("setadmin", "(Admin) Manage card sets — create, edit membership, choose the active spawn set", s => s
      .addSubcommand(sc => sc.setName("create").setDescription("Create a new set")
        .addStringOption(o => o.setName("name").setDescription("Set name (slug-safe)").setRequired(true))
        .addStringOption(o => o.setName("description").setDescription("Optional human description")))
      .addSubcommand(sc => sc.setName("rename").setDescription("Rename a set")
        .addStringOption(o => o.setName("from").setDescription("Current name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("to").setDescription("New name").setRequired(true)))
      .addSubcommand(sc => sc.setName("delete").setDescription("Delete a set (cards survive — only memberships removed)")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("add").setDescription("Add a card to a set")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("remove").setDescription("Remove a card from a set")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("move").setDescription("Move a card between two sets")
        .addStringOption(o => o.setName("from").setDescription("From set").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("to").setDescription("To set").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("bulkadd").setDescription("Add many cards at once (comma-separated)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("cards").setDescription("Comma-separated card names").setRequired(true)))
      .addSubcommand(sc => sc.setName("bulkremove").setDescription("Remove many cards at once (comma-separated)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("cards").setDescription("Comma-separated card names").setRequired(true)))
      .addSubcommand(sc => sc.setName("active").setDescription("Make this set the active spawn pool for the server")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("deactivate").setDescription("Clear the active set (disables random spawns)"))
      .addSubcommand(sc => sc.setName("view").setDescription("View a set's full membership")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))),
  ];
}

export const USER_COMMAND_NAMES = new Set([
  "collection", "rank", "info", "list", "catalog", "top",
  "burn", "shards", "trade", "trades", "accept", "decline", "help", "welcome",
  "daily", "pack", "packstats", "achievements", "wishlist", "gift", "tradein", "tradehistory",
  "sets",
]);

export const ADMIN_COMMAND_NAMES = new Set([
  "config", "adminhub", "adminhelp", "drop", "massdrop", "give", "giveshards", "takeback", "takeshards", "event", "setchannels", "dashboard", "setup",
  "addadmin", "removeadmin", "listadmins", "editcard", "rarityname", "rarity", "embed",
  "setadmin",
]);

export const CARDSET_COMMAND_NAMES = new Set([
  "loadset", "unloadset", "listsets",
]);
