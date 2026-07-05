import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
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
    // ── User Commands ─────────────────────────────────────────────────────────
    cmd("collection", "(User) View your collection", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's collection"))),

    cmd("rank", "(User) Your rank and progression", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's rank"))),

    cmd("info", "(User) Details, worth, and drop chance", s => s
      .addStringOption(o => o.setName("name").setDescription("Name to look up").setRequired(true).setAutocomplete(true))),

    cmd("list", "(User) Full roster grouped by rarity", s => s),

    cmd("catalog", "(User) Browse by category — see what you own and what's missing", s => s
      .addStringOption(o => o.setName("category").setDescription("Optional: jump straight to a category (default: overview)")
        .addChoices(
          { name: "🔮 Extra", value: "mythic" },
          { name: "🟡 Legendary", value: "legendary" },
          { name: "🟣 Epic", value: "epic" },
          { name: "🔵 Rare", value: "rare" },
          { name: "🟢 Uncommon", value: "uncommon" },
          { name: "⚪ Common", value: "common" },
          { name: "🎆 Event Exclusive", value: "event" },
          { name: "💎 Limited Edition", value: "limited" },
          { name: "🃏 All", value: "all" },
        ))
      .addUserOption(o => o.setName("user").setDescription("Check another member's ownership (default: you)"))),

    cmd("top", "(User) Top 10 collectors leaderboard", s => s),

    cmd("burn", "(User) Burn duplicates for DN Shards", s => s
      .addStringOption(o => o.setName("name").setDescription("Name to burn").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("amount").setDescription("How many copies to burn (default 1)").setMinValue(1))
      .addBooleanOption(o => o.setName("all").setDescription("Burn every copy you own of this card"))
      .addBooleanOption(o => o.setName("shiny").setDescription("Burn shiny copies (2× shards) instead of normal copies"))),

    cmd("shards", "(User) Check your DN Shards balance", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's balance"))),

    cmd("trade", "(User) Propose a trade — cards, shards, or both", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to trade with").setRequired(true))
      .addStringOption(o => o.setName("offer").setDescription("Name you are offering").setAutocomplete(true))
      .addStringOption(o => o.setName("want").setDescription("Name you want in return").setAutocomplete(true))
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

    cmd("welcome", "(User) Welcome — game intro, quick start & commands", s => s),

    adminCmd("setup", "(Admin) Interactive server setup wizard — channels, spawns, rates, toggles", s => s),

    cmd("help", "(User) Show player commands", s => s),

    adminCmd("adminhelp", "(Admin) Show admin & setup commands", s => s),

    cmd("daily", "(User) Claim your daily DN Shards reward", s => s),

    cmd("pack", "(User) Open a pack — type to search tiers and custom packs", s => s
      .addStringOption(o => o.setName("tier")
        .setDescription("Which pack to open — built-in or custom (type to search, default: Basic)")
        .setAutocomplete(true))),

    cmd("packstats", "(User) View pack costs, weekly caps & cooldown", s => s),

    cmd("tradein", "(User) Burn 5 of one rarity for 1 of the next tier up", s => s
      .addStringOption(o => o.setName("rarity").setDescription("Rarity to trade in").setRequired(true).setAutocomplete(true))),

    cmd("achievements", "(User) View unlocked achievements", s => s
      .addUserOption(o => o.setName("user").setDescription("View another member's achievements"))),

    cmd("wishlist", "(User) Manage your wishlist — get pinged when wished cards spawn", s => s
      .addSubcommand(sc => sc.setName("add").setDescription("Add to your wishlist")
        .addStringOption(o => o.setName("name").setDescription("Name to add").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("remove").setDescription("Remove from your wishlist")
        .addStringOption(o => o.setName("name").setDescription("Name to remove").setRequired(true).setAutocomplete(true)))
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
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addBooleanOption(o => o.setName("secondary").setDescription("Apply to the secondary spawn stream instead of the primary (default: false)")))
      .addSubcommand(sc => sc.setName("deactivate").setDescription("Clear the active set — random spawns disabled until one is chosen")
        .addBooleanOption(o => o.setName("secondary").setDescription("Deactivate the secondary spawn stream instead of the primary (default: false)")))
      .addSubcommand(sc => sc.setName("view").setDescription("View all cards in a set")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("setweight").setDescription("Override a rarity's spawn chance when this set is active")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("rarity").setDescription("Rarity tier").setRequired(true)
          .addChoices(
            { name: "Common", value: "common" }, { name: "Uncommon", value: "uncommon" },
            { name: "Rare", value: "rare" }, { name: "Epic", value: "epic" },
            { name: "Legendary", value: "legendary" }, { name: "Extra", value: "mythic" },
          ))
        .addIntegerOption(o => o.setName("weight").setDescription("Set-specific spawn chance % (0 = disable that rarity while active)").setRequired(true).setMinValue(0)))
      .addSubcommand(sc => sc.setName("clearweight").setDescription("Remove a per-set spawn chance override (falls back to server rarity setup)")
        .addStringOption(o => o.setName("set").setDescription("Set name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("rarity").setDescription("Leave empty to clear all overrides on this set")
          .addChoices(
            { name: "Common", value: "common" }, { name: "Uncommon", value: "uncommon" },
            { name: "Rare", value: "rare" }, { name: "Epic", value: "epic" },
            { name: "Legendary", value: "legendary" }, { name: "Extra", value: "mythic" },
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
      .addSubcommand(sc => sc.setName("quickstart").setDescription("Create a set, add all cards, activate it, and disable secondary stream")
        .addStringOption(o => o.setName("name").setDescription("Set name (e.g. MT)").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Optional: spawn channel to set")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
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
      .addStringOption(o => o.setName("type").setDescription("Card type/tag — type to search existing types or enter a new one").setRequired(true).setAutocomplete(true))
      .addAttachmentOption(o => o.setName("image").setDescription("Upload card image/GIF with Discord's file picker"))
      .addStringOption(o => o.setName("set").setDescription("Optional set to add this card to immediately").setAutocomplete(true))
      .addStringOption(o => o.setName("description").setDescription("Card description (up to 500 chars)").setMaxLength(500))
      .addBooleanOption(o => o.setName("limited").setDescription("Limited edition — capped copy count?"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies if limited (default 50)").setMinValue(1))
      .addBooleanOption(o => o.setName("event_exclusive").setDescription("Event exclusive — never spawns randomly?"))),

    adminCmd("editcard", "(Admin) Edit a card — optionally upload a replacement image/GIF", s => s
      .addStringOption(o => o.setName("name").setDescription("Card to edit").setRequired(true).setAutocomplete(true))
      .addAttachmentOption(o => o.setName("image").setDescription("Optional replacement image/GIF upload"))
      .addIntegerOption(o => o.setName("max_copies").setDescription("Max copies for a limited edition card (set 0 or blank to remove limit)").setMinValue(0))
      .addIntegerOption(o => o.setName("total_minted").setDescription("Current number of copies that exist (careful: manual override)").setMinValue(0))
      .addBooleanOption(o => o.setName("limited").setDescription("Mark this card as limited edition (enforces max_copies cap)"))),


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

    // ── Dashboard ─────────────────────────────────────────────────────────────
    adminCmd("dashboard", "(Admin) Get a one-time link to set up or reset your web dashboard login", s => s),

    // ── /edituser — interactive member editor (cards, shinies, shards) ─────────
    adminCmd("edituser", "(Admin) Edit a member's cards, shinies, and shards", s => s
      .addUserOption(o => o.setName("user").setDescription("Member to edit").setRequired(true))),

    // ── /rep (user, reputation system) ────────────────────────────────────────
    cmd("rep", "(User) Reputation system — give rep, check rep, and see the leaderboard", s => s
      .addSubcommand(sc => sc.setName("give").setDescription("Give +1 rep to another member (24h cooldown per person)")
        .addUserOption(o => o.setName("user").setDescription("Member to rep").setRequired(true)))
      .addSubcommand(sc => sc.setName("check").setDescription("Check a member's rep score")
        .addUserOption(o => o.setName("user").setDescription("Member to check (default: you)")))
      .addSubcommand(sc => sc.setName("top").setDescription("Top 10 most reputed members on this server"))),

    // ── /sets (user, read-only) ───────────────────────────────────────────────
    cmd("sets", "(User) Browse card sets and your collection progress", s => s
      .addSubcommand(sc => sc.setName("list").setDescription("List every card set on this server"))
      .addSubcommand(sc => sc.setName("active").setDescription("Show the set that random spawns currently pull from"))
      .addSubcommand(sc => sc.setName("view").setDescription("Show every card in a set")
        .addStringOption(o => o.setName("name").setDescription("Set name").setRequired(true).setAutocomplete(true)))
      .addSubcommand(sc => sc.setName("progress").setDescription("Show set-by-set completion for a member")
        .addUserOption(o => o.setName("user").setDescription("Member to inspect (defaults to you)")))),

    // ── /menu — interactive main menu hub ────────────────────────────────────
    cmd("menu", "(User) Open the DN Cards interactive main menu — collection, packs, burn & trades in one place", s => s),

    // ── /dnvalues* — DN values lookup (data from dnvalues.com) ─────────────
    cmd("dnvaluesearch", "(User) Search DN values by name, rarity, or tag — values from dnvalues.com", s => s
      .addStringOption(o => o.setName("query").setDescription("Search keyword (leave blank for full list)"))),
    cmd("dnvaluelist", "(User) Show all DN values sorted by value — values from dnvalues.com", s => s),
    cmd("dnvalueinfo", "(User) Show full details for a DN value item — values from dnvalues.com", s => s
      .addStringOption(o => o.setName("name").setDescription("Item name (exact match)").setRequired(true).setAutocomplete(true))),
    cmd("dnvaluecalc", "(User) Open a DN values trade calculator hub — values from dnvalues.com", s => s
      .addStringOption(o => o.setName("item").setDescription("Item name to add to the calculator").setAutocomplete(true))
      .addStringOption(o => o.setName("side").setDescription("Which side to add to")
        .addChoices({ name: "Your offer", value: "your" }, { name: "Their offer", value: "their" }))
      .addIntegerOption(o => o.setName("quantity").setDescription("How many copies (default 1)").setMinValue(1))
      .addStringOption(o => o.setName("tier").setDescription("Value tier: low, mid, or high (default mid)")
        .addChoices({ name: "Low", value: "low" }, { name: "Mid", value: "mid" }, { name: "High", value: "high" }))
      .addIntegerOption(o => o.setName("stars").setDescription("Stars 1-5 (default 1)").setMinValue(1).setMaxValue(5))),
    cmd("dnhelp", "(User) Show DN values command help — values from dnvalues.com", s => s),

  ];
}


type CommandJson = ReturnType<SlashCommandBuilder["toJSON"]>;

const USER_HUB_COMMANDS = new Set([
  "collection", "rank", "info", "list", "catalog", "top", "burn", "shards",
  "trade", "gift", "trades", "tradehistory", "accept", "decline", "welcome",
  "help", "daily", "pack", "packstats", "tradein", "achievements",
]);

const ADMIN_HUB_COMMANDS = new Set([
  "setup", "config", "adminhub", "sethub", "set_admin", "deletecard",
  "welcomeadmin", "adminhelp", "drop", "massdrop", "give", "giveshards",
  "takeback", "takeshards", "addcard", "editcard", "dashboard",
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

export const USER_COMMAND_NAMES = new Set(["cards", "wishlist", "sets", "rep", "menu", "dnvaluesearch", "dnvaluelist", "dnvalueinfo", "dnvaluecalc", "dnhelp"]);

export const ADMIN_COMMAND_NAMES = new Set(["admin", "setadmin", "event", "rarity", "embed", "edituser"]);
