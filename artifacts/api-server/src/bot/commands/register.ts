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

function buildLegacyCommands() {
  return [
    // ── User Commands ───────────────────────���────────────────────────────────[...]
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

    cmd("help", "(User) Show DN Cards player commands", s => s),

    adminCmd("adminhelp", "(Admin) Show admin & setup commands", s => s),

    cmd("daily", "(User) Claim your daily DN Shards reward", s => s),

    cmd("quests", "(User) View daily & weekly quests — earn shards and packs", s => s),

    cmd("level", "(User) View a card's battle level, XP, and unlocked frames", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name (leave empty for your top leveled cards)").setAutocomplete(true))),

    cmd("frame", "(User) Equip a cosmetic frame on a card you've leveled", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("style").setDescription("Frame to equip (leave empty to list options)"))),

    cmd("lock", "(User) Lock/favorite a card so it can't be burned or traded in", s => s
      .addStringOption(o => o.setName("name").setDescription("Card to lock/unlock").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("state").setDescription("Lock or unlock (default: toggle)")
        .addChoices({ name: "lock", value: "on" }, { name: "unlock", value: "off" }))),

    cmd("collector", "(User) Toggle spawn pings — join/leave the collector ping role", s => s),

    cmd("search", "(User) Search the roster by name, rarity, or type — see what you own", s => s
      .addStringOption(o => o.setName("query").setDescription("Text to match in the card name"))
      .addStringOption(o => o.setName("rarity").setDescription("Filter by rarity")
        .addChoices(
          { name: "⚪ Common", value: "common" }, { name: "🟢 Uncommon", value: "uncommon" },
          { name: "🔵 Rare", value: "rare" }, { name: "🟣 Epic", value: "epic" },
          { name: "🟡 Legendary", value: "legendary" }, { name: "🔴 Mythic", value: "mythic" }))
      .addStringOption(o => o.setName("type").setDescription("Filter by card type"))
      .addStringOption(o => o.setName("owned").setDescription("Only owned or only missing")
        .addChoices({ name: "Owned", value: "owned" }, { name: "Missing", value: "missing" }))),

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
      .addStringOption(o => o.setName("rarity").setDescription("Rarity of cards to trade in").setRequired(true).setAutocomplete(true))),

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

    adminCmd("sethub", "(Admin) Clickable set manager — create sets, add cards, activate spawn pool, export with one click", s => s),

    adminCmd("set_admin", "(Admin) Interactive set hub — full set management with buttons and dropdowns, no subcommands needed", s => s),

    adminCmd("deletecard", "(Admin) Permanently delete a card from the roster", s => s
      .addStringOption(o => o.setName("name").setDescription("Card to delete").setRequired(true).setAutocomplete(true))),

    adminCmd("setadmin", "(Admin) Manage card sets — create, add cards, set active spawn pool, export/import", s => s
      .addSubcommand(sc => sc.setName("create").setDescription("Create a new set")
        .addStringOption(o => o.setName("name").setDescription("Set name (e.g. v1, halloween-2026)").setRequired(true))
        .addStringOption(o => o.setName("description").setDescription("Optional description")))
      .addSubcommand(sc => sc.setName("rename").setDescription("Rename a set")
        .addStringOption(o => o.setName("from").setDescription("Current set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("to").setDescription("New name").setRequired(true)))
      .addSubcommand(sc => sc.setName("delete").setDescription("Delete a set (cards kept)")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("add").setDescription("Add a card to a set")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("remove").setDescription("Remove a card from a set (card kept)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("move").setDescription("Move a card from one set to another")
        .addStringOption(o => o.setName("from").setDescription("Source set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("to").setDescription("Destination set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("card").setDescription("Card name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("bulkadd").setDescription("Add multiple cards to a set (comma-separated names)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("cards").setDescription("Comma-separated card names").setRequired(true)))
      .addSubcommand(sc => sc.setName("bulkremove").setDescription("Remove multiple cards from a set (comma-separated names)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("cards").setDescription("Comma-separated card names").setRequired(true)))
      .addSubcommand(sc => sc.setName("active").setDescription("Set the active spawn pool for this server")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("deactivate").setDescription("Clear the active set — random spawns disabled until one is chosen"))
      .addSubcommand(sc => sc.setName("view").setDescription("View all cards in a set")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("setweight").setDescription("Override a rarity's spawn chance when this set is active")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true)
          .addChoices(
            { name: "Common", value: "common" }, { name: "Uncommon", value: "uncommon" },
            { name: "Rare", value: "rare" }, { name: "Epic", value: "epic" },
            { name: "Legendary", value: "legendary" }, { name: "Mythic", value: "mythic" },
          ))
        .addIntegerOption(o => o.setName("weight").setDescription("Set-specific spawn chance % (0 = disable that rarity while active)").setRequired(true).setMinValue(0)))
      .addSubcommand(sc => sc.setName("clearweight").setDescription("Remove a per-set spawn chance override (falls back to server rarity setup)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("rarity").setDescription("Leave empty to clear all overrides on this set")
          .addChoices(
            { name: "Common", value: "common" }, { name: "Uncommon", value: "uncommon" },
            { name: "Rare", value: "rare" }, { name: "Epic", value: "epic" },
            { name: "Legendary", value: "legendary" }, { name: "Mythic", value: "mythic" },
          )))
      .addSubcommand(sc => sc.setName("showweights").setDescription("Show per-set rarity spawn chance overrides")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("showcase").setDescription("Toggle set-completion achievement for this set")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addBooleanOption(o => o.setName("enabled").setDescription("Enable or disable the completion achievement").setRequired(true)))
      .addSubcommand(sc => sc.setName("export").setDescription("Export a set as a JSON file attachment")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("exportall").setDescription("Export all sets as a JSON bundle")
        .addStringOption(o => o.setName("sets").setDescription("Comma-separated set names to include (leave empty for all)")))
      .addSubcommand(sc => sc.setName("assignall").setDescription("Assign all unassigned cards to a set (creates set if needed)")
        .addStringOption(o => o.setName("set").setDescription("Destination set name").setRequired(true))
        .addBooleanOption(o => o.setName("includearchived").setDescription("Include archived cards (default false)"))
        .addBooleanOption(o => o.setName("includedroppablefalse").setDescription("Include non-droppable cards (default false)")))
      .addSubcommand(sc => sc.setName("exportcards").setDescription("Export every card as a flat JSON (no set info)")
        .addBooleanOption(o => o.setName("includearchived").setDescription("Include archived cards (default false)")))
      .addSubcommand(sc => sc.setName("load").setDescription("Import cards + set from a JSON file attachment")
        .addAttachmentOption(o => o.setName("file").setDescription("JSON file from /setadmin export or exportall").setRequired(true))
        .addStringOption(o => o.setName("name").setDescription("Override set name (single-set files only)")))
      .addSubcommand(sc => sc.setName("unload").setDescription("Unload (delete members of) a set — cards kept")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("listloaded").setDescription("List all loaded sets and their card counts"))),

    adminCmd("welcomeadmin", "(Admin) Post the admin onboarding guide — setup, card editing, website, and commands", s => s),

    adminCmd("drop", "(Admin) Force-drop a card — for events and giveaways", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name — leave empty for a random drop from active set").setAutocomplete(true))
      .addStringOption(o => o.setName("set").setDescription("Pick a specific set to drop from (ignores active set)").setAutocomplete(true))),

    adminCmd("massdrop", "(Admin) Drop a big batch of cards — mostly low tier with a few bangers", s => s
      .addIntegerOption(o => o.setName("amount").setDescription("How many cards to drop (10-25, default 15)").setMinValue(10).setMaxValue(25))
      .addStringOption(o => o.setName("set").setDescription("Pick a specific set to drop from (ignores active set)").setAutocomplete(true))),

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

    adminCmd("collectorrole", "(Admin) Set the opt-in role that gets pinged on every spawn", s => s
      .addRoleOption(o => o.setName("role").setDescription("Role to ping on spawns (leave empty to clear)"))),

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

    adminCmd("addcard", "(Admin) Create a new card — upload an image/GIF from Discord", s => s
      .addStringOption(o => o.setName("name").setDescription("Card name").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("rarity").setDescription("Built-in rarity tier — type to search").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("type").setDescription("Card type").setRequired(true)
        .addChoices(
          { name: "tank",        value: "tank"        },
          { name: "aircraft",    value: "aircraft"    },
          { name: "ship",        value: "ship"        },
          { name: "vehicle",     value: "vehicle"     },
          { name: "infantry",    value: "infantry"    },
          { name: "boss",        value: "boss"        },
          { name: "community",   value: "community"   },
          { name: "event",       value: "event"       },
          { name: "achievement", value: "achievement" },
          { name: "limited",     value: "limited"     },
        ))
      .addAttachmentOption(o => o.setName("image").setDescription("Upload card image/GIF with Discord's file picker"))
      .addStringOption(o => o.setName("set").setDescription("Optional set to add this card to immediately").setAutocomplete(true))
      .addStringOption(o => o.setName("description").setDescription("Card description (up to 500 chars)").setMaxLength(500))
      .addBooleanOption(o => o.setName("limited").setDescription("Limited edition — capped copy count?"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies if limited (default 50)").setMinValue(1))
      .addBooleanOption(o => o.setName("event_exclusive").setDescription("Event exclusive — never spawns randomly?"))),

    adminCmd("editcard", "(Admin) Edit a card — optionally upload a replacement image/GIF", s => s
      .addStringOption(o => o.setName("name").setDescription("Card to edit").setRequired(true).setAutocomplete(true))
      .addAttachmentOption(o => o.setName("image").setDescription("Optional replacement image/GIF upload"))),

    // ── /rarity — hub command: display names, economy overrides, custom tiers, card assignments
    adminCmd("rarity", "(Admin) Edit built-in rarity names, colors, spawn %, worth, and burn", s => s),

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

    // ── Dashboard ──────��──────────────────────────────────────────────────[...]
    adminCmd("dashboard", "(Admin) Get a one-time link to set up or reset your web dashboard login", s => s),

    // ── /rep (user, reputation system) ────────────────────────────────────────
    cmd("rep", "(User) Reputation system — give rep, check rep, remove rep, and see the leaderboard", s => s
      .addSubcommand(sc => sc.setName("give").setDescription("Give +1 rep to another member (24h cooldown per person)")
        .addUserOption(o => o.setName("user").setDescription("Member to rep").setRequired(true)))
      .addSubcommand(sc => sc.setName("check").setDescription("Check a member's rep score")
        .addUserOption(o => o.setName("user").setDescription("Member to check (default: you)")))
      .addSubcommand(sc => sc.setName("top").setDescription("Top 10 most reputed members on this server"))
      .addSubcommand(sc => sc.setName("remove").setDescription("(Admin) Remove rep from a member")
        .addUserOption(o => o.setName("user").setDescription("Member to remove rep from").setRequired(true))
        .addIntegerOption(o => o.setName("amount").setDescription("Amount of rep to remove (default: 1)").setMinValue(1))
        .addStringOption(o => o.setName("reason").setDescription("Optional reason for removal")))),

    // ── /thanks (user, gratitude tracking) ────────���───────────────────────────
    cmd("thanks", "(User) Thank members for being helpful — track appreciation", s => s
      .addSubcommand(sc => sc.setName("give").setDescription("Give thanks to a helpful member (24h cooldown per person)")
        .addUserOption(o => o.setName("user").setDescription("Member to thank").setRequired(true)))
      .addSubcommand(sc => sc.setName("top").setDescription("Top 10 most appreciated members on this server"))),

    // ── /battle (user, Card Battle System) ────────────────────────────────────
    cmd("battle", "(User) Card battles — challenge players or AI, view stats & leaderboards", s => s
      .addSubcommand(sc => sc.setName("fight").setDescription("Start a battle — challenge a player, or leave empty to fight the AI")
        .addUserOption(o => o.setName("opponent").setDescription("Player to challenge (empty = battle the AI)")))
      .addSubcommand(sc => sc.setName("profile").setDescription("View a battle profile — record, rank, stats")
        .addUserOption(o => o.setName("user").setDescription("Whose profile to view (default: you)")))
      .addSubcommand(sc => sc.setName("leaderboard").setDescription("Battle rankings")
        .addStringOption(o => o.setName("scope").setDescription("Guild or global").addChoices(
          { name: "This server", value: "guild" }, { name: "Global (opt-in)", value: "global" }))
        .addStringOption(o => o.setName("sort").setDescription("Sort by").addChoices(
          { name: "Rank points", value: "rank" }, { name: "Wins", value: "wins" }, { name: "Best streak", value: "streak" })))
      .addSubcommand(sc => sc.setName("achievements").setDescription("View unlocked battle achievements")
        .addUserOption(o => o.setName("user").setDescription("Whose achievements to view (default: you)")))
      .addSubcommand(sc => sc.setName("daily").setDescription("View today's battle challenges and progress"))),

    // ── /battleadmin (admin, Battle System configuration) ─────────────────────
    adminCmd("battleadmin", "(Admin) Battle system hub — setup wizard, rules, rewards, cards, seasons", s => s),

    // ── /raid (user, Co-op Boss Raids) ────────────────────────────────────────
    cmd("raid", "(User) Team up to take down a boss — co-op raid", s => s
      .addSubcommand(sc => sc.setName("start").setDescription("Start a raid lobby for a boss")
        .addStringOption(o => o.setName("boss").setDescription("Which boss to raid").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("bosses").setDescription("List the raid bosses available on this server"))),

    // ── /raidadmin (admin, Boss management) ───────────────────────────────────
    adminCmd("raidadmin", "(Admin) Create and tune co-op raid bosses", s => s
      .addSubcommand(sc => sc.setName("create").setDescription("Create a new raid boss")
        .addStringOption(o => o.setName("name").setDescription("Boss name").setRequired(true))
        .addStringOption(o => o.setName("description").setDescription("Flavor text"))
        .addStringOption(o => o.setName("image").setDescription("Boss image URL"))
        .addStringOption(o => o.setName("archetype").setDescription("Combat archetype (default boss)"))
        .addStringOption(o => o.setName("rarity").setDescription("Reference rarity (default mythic)"))
        .addIntegerOption(o => o.setName("health").setDescription("Base health (per-player oriented)").setMinValue(100))
        .addIntegerOption(o => o.setName("attack").setDescription("Base attack").setMinValue(1))
        .addIntegerOption(o => o.setName("defense").setDescription("Base defense").setMinValue(0))
        .addIntegerOption(o => o.setName("minstars").setDescription("Min card stars to join (1-5)").setMinValue(1).setMaxValue(5))
        .addIntegerOption(o => o.setName("minlevel").setDescription("Min battle level to join").setMinValue(1))
        .addIntegerOption(o => o.setName("minplayers").setDescription("Min players").setMinValue(1).setMaxValue(10))
        .addIntegerOption(o => o.setName("maxplayers").setDescription("Max players").setMinValue(1).setMaxValue(10))
        .addIntegerOption(o => o.setName("enrage").setDescription("Boss enrages after N rounds (0 = never)").setMinValue(0))
        .addIntegerOption(o => o.setName("reward").setDescription("Shards per survivor on clear").setMinValue(0))
        .addIntegerOption(o => o.setName("cardxp").setDescription("Bonus card XP per survivor on clear").setMinValue(0)))
      .addSubcommand(sc => sc.setName("edit").setDescription("Edit an existing boss")
        .addStringOption(o => o.setName("name").setDescription("Boss to edit").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("description").setDescription("Flavor text"))
        .addStringOption(o => o.setName("image").setDescription("Boss image URL"))
        .addStringOption(o => o.setName("archetype").setDescription("Combat archetype"))
        .addIntegerOption(o => o.setName("health").setDescription("Base health").setMinValue(100))
        .addIntegerOption(o => o.setName("attack").setDescription("Base attack").setMinValue(1))
        .addIntegerOption(o => o.setName("defense").setDescription("Base defense").setMinValue(0))
        .addIntegerOption(o => o.setName("minstars").setDescription("Min card stars (1-5)").setMinValue(1).setMaxValue(5))
        .addIntegerOption(o => o.setName("minlevel").setDescription("Min battle level").setMinValue(1))
        .addIntegerOption(o => o.setName("minplayers").setDescription("Min players").setMinValue(1).setMaxValue(10))
        .addIntegerOption(o => o.setName("maxplayers").setDescription("Max players").setMinValue(1).setMaxValue(10))
        .addIntegerOption(o => o.setName("enrage").setDescription("Enrage round (0 = never)").setMinValue(0))
        .addIntegerOption(o => o.setName("reward").setDescription("Shards per survivor").setMinValue(0))
        .addIntegerOption(o => o.setName("cardxp").setDescription("Bonus card XP per survivor").setMinValue(0)))
      .addSubcommand(sc => sc.setName("list").setDescription("List all raid bosses on this server"))
      .addSubcommand(sc => sc.setName("enable").setDescription("Enable or disable a boss")
        .addStringOption(o => o.setName("name").setDescription("Boss").setRequired(true).setAutocomplete(true))
        .addBooleanOption(o => o.setName("enabled").setDescription("Enabled?").setRequired(true)))
      .addSubcommand(sc => sc.setName("delete").setDescription("Delete a boss")
        .addStringOption(o => o.setName("name").setDescription("Boss to delete").setRequired(true).setAutocomplete(true)))),

    // ── /sets (user, read-only) ───────────────────────────────────────────────
    cmd("sets", "(User) Browse card sets and your collection progress", s => s
      .addSubcommand(sc => sc.setName("list").setDescription("List every card set on this server"))
      .addSubcommand(sc => sc.setName("active").setDescription("Show the set that random spawns currently pull from"))
      .addSubcommand(sc => sc.setName("view").setDescription("Show every card in a set")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("progress").setDescription("Show set-by-set completion for a member")
        .addUserOption(o => o.setName("user").setDescription("Member to inspect (defaults to you)")))),

    // ── /market (user, Marketplace) ───────────────────────────────────────────
    cmd("market", "(User) Buy, sell, and auction cards for DN Shards", s => s
      .addSubcommand(sc => sc.setName("sell").setDescription("List a card for sale, or as a timed auction")
        .addStringOption(o => o.setName("name").setDescription("Card to sell").setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName("price").setDescription("Sale price, or auction starting bid").setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName("hours").setDescription("Auction length in hours (omit for a fixed-price sale)").setMinValue(1).setMaxValue(168))
        .addIntegerOption(o => o.setName("buyout").setDescription("Optional instant-buy price for an auction").setMinValue(1)))
      .addSubcommand(sc => sc.setName("browse").setDescription("Browse active market listings")
        .addUserOption(o => o.setName("seller").setDescription("Only show a specific seller's listings"))
        .addStringOption(o => o.setName("kind").setDescription("Filter by type")
          .addChoices({ name: "For sale", value: "sale" }, { name: "Auctions", value: "auction" })))
      .addSubcommand(sc => sc.setName("buy").setDescription("Buy a fixed-price listing (or auction buyout)")
        .addIntegerOption(o => o.setName("id").setDescription("Listing ID").setRequired(true).setMinValue(1)))
      .addSubcommand(sc => sc.setName("bid").setDescription("Bid on an auction")
        .addIntegerOption(o => o.setName("id").setDescription("Listing ID").setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName("amount").setDescription("Your bid in shards").setRequired(true).setMinValue(1)))
      .addSubcommand(sc => sc.setName("cancel").setDescription("Cancel one of your listings")
        .addIntegerOption(o => o.setName("id").setDescription("Listing ID").setRequired(true).setMinValue(1)))
      .addSubcommand(sc => sc.setName("mine").setDescription("View your listings and active bids"))),

    // ── Echo-Whisper (encrypted messaging addon) ──────────────────────────────
    cmd("whisper", "(User) Send an encrypted whisper only a chosen member can read", s => s
      .addUserOption(o => o.setName("user").setDescription("The member who can read this message").setRequired(true))),

    cmd("adminsecret", "(User) Post an encrypted staff message only authorized roles can reveal", s => s),

    adminCmd("echo", "(Admin) Echo-Whisper hub — viewer roles, admin override, stats, config", s => s
      .addSubcommand(sc => sc.setName("role").setDescription("Manage roles allowed to reveal /adminsecret messages")
        .addStringOption(o => o.setName("action").setDescription("Add, remove, or list").setRequired(true)
          .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }, { name: "list", value: "list" }))
        .addRoleOption(o => o.setName("role").setDescription("Role to add or remove")))
      .addSubcommand(sc => sc.setName("override").setDescription("Toggle whether admins can decrypt any message")
        .addStringOption(o => o.setName("mode").setDescription("Enable or disable admin override").setRequired(true)
          .addChoices({ name: "enable", value: "enable" }, { name: "disable", value: "disable" })))
      .addSubcommand(sc => sc.setName("whisper").setDescription("View whisper configuration"))
      .addSubcommand(sc => sc.setName("adminsecret").setDescription("View adminsecret configuration"))
      .addSubcommand(sc => sc.setName("stats").setDescription("View Echo-Whisper usage stats"))
      .addSubcommand(sc => sc.setName("config").setDescription("View Echo-Whisper configuration"))),

  ];
}


type CommandJson = ReturnType<SlashCommandBuilder["toJSON"]>;

const USER_HUB_COMMANDS = new Set([
  "collection", "rank", "info", "list", "catalog", "top", "burn", "shards",
  "trade", "gift", "trades", "tradehistory", "accept", "decline", "welcome",
  "help", "daily", "quests", "pack", "packstats", "tradein", "achievements",
  "level", "frame", "lock", "search", "collector", "calendar",
]);

const ADMIN_HUB_COMMANDS = new Set([
  "setup", "config", "adminhub", "sethub", "set_admin", "deletecard",
  "welcomeadmin", "adminhelp", "drop", "massdrop", "give", "giveshards",
  "takeback", "takeshards", "addcard", "editcard", "dashboard", "collectorrole",
]);

const ADMIN_HUB_NAMES: Record<string, string> = {
  adminhub: "hub",
  sethub: "set-hub",
  set_admin: "set-manager",
  welcomeadmin: "welcome",
  adminhelp: "help",
};

function consolidateCommands(commands: CommandJson[], names: Set<string>, hubName: string, description: string, admin = false): CommandJson {
  const selected = commands.filter(command => names.has(command.name));
  return {
    name: hubName, description, type: 1, dm_permission: false,
    ...(admin ? { default_member_permissions: PermissionFlagsBits.Administrator.toString() } : {}),
    options: selected.map(command => ({
      type: 1,
      name: ADMIN_HUB_NAMES[command.name] ?? command.name,
      description: command.description.replace(/^\((?:User|Admin)\)\s*/, "").slice(0, 100),
      options: command.options,
    })),
  } as CommandJson;
}

export function buildCommands() {
  const legacy = buildLegacyCommands() as CommandJson[];
  const consolidatedNames = new Set([...USER_HUB_COMMANDS, ...ADMIN_HUB_COMMANDS]);
  return [
    consolidateCommands(legacy, USER_HUB_COMMANDS, "cards", "Player command hub for DN Cards"),
    consolidateCommands(legacy, ADMIN_HUB_COMMANDS, "admin", "Admin command hub for DN Cards", true),
    ...legacy.filter(command => !consolidatedNames.has(command.name)),
  ];
}

export const USER_COMMAND_NAMES = new Set(["cards", "wishlist", "sets", "rep", "thanks"]);

export const ADMIN_COMMAND_NAMES = new Set(["admin", "setadmin", "event", "rarity", "embed"]);
