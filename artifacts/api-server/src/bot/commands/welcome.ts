import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { isAdmin } from "../db.js";

// Section banners — one word per banner, used as dividers between categories.
// Files live in the dashboard's public/ folder so they ship with the static
// site and are reachable through the shared proxy at the dashboard root.
function bannerUrl(name: "welcome" | "rules" | "commands"): string | null {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (!domain) return null;
  return `https://${domain}/banner-${name}.png`;
}

const BRAND_COLOR = 0xe63946;

// Public welcome post — designed to be dropped in a #welcome or #info channel
// as a permanent guide. Three embeds, each led by its own single-word banner.
// Member-facing only — no admin content. Dispatcher (user.ts) does NOT add
// this to EPHEMERAL_COMMANDS, so the reply is visible to everyone.
export async function handleWelcome(interaction: ChatInputCommandInteraction): Promise<void> {
  const welcomeBanner = bannerUrl("welcome");
  const rulesBanner = bannerUrl("rules");
  const commandsBanner = bannerUrl("commands");

  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name ?? "this server";

  // ── 1. WELCOME — hype intro + quick start ─────────────────────────────────
  const welcome = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("🃏 Welcome to DN Cards — DarkNight's Military Collectible Game")
    .setDescription(
      "You've just stepped into the **DarkNight card game** — tanks, jets, ships, bosses, " +
      "and the occasional cursed community card. Cards drop randomly in the spawn channel. " +
      "You catch them. You hoard them. You flex on people with a 👑 Legendary while they're still sitting on Commons. Classic.\n\n" +
      "**🚀 Getting Started (do these first)**\n" +
      "① **Watch the spawn channel.** When a card drops, **type its name exactly** to catch it — no commands, no buttons (unless the server uses button mode). Fast fingers win, but it's fair — see the catching section below.\n" +
      "② **Run `/daily`** every day. Free shards, streak bonus, and after 7 days in a row you unlock an achievement worth 💠 1,000 shards. Easy money.\n" +
      "③ **Open packs with `/pack`.** 🥉 Basic costs 250 💠, 🥈 Premium 750 💠, 🥇 Legendary 2,000 💠 (no commons, way better odds). Five cards per pack.\n" +
      "④ **Burn your duplicates** with `/burn`. Converts them to shards so you can open more packs. The cycle of life.\n" +
      "⑤ **Check your rank** with `/rank` and see where you stand on `/top`. 🪖 Recruit today, 👑 Dark Commander eventually.",
    );
  if (welcomeBanner) welcome.setImage(welcomeBanner);
  await applyEmbedOverride(welcome, {
    guildId, key: "welcome", defaultImageUrl: welcomeBanner,
    ctx: { guild: guildName, username: interaction.user.username, userId: interaction.user.id },
  });

  // ── 2. NEED TO KNOW — mechanics, catching, lag, sets, economy ─────────────
  const rules = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📌 Things Every Collector Needs to Know")
    .setDescription(
      "**🎯 How Catching Actually Works**\n" +
      "Type the card name exactly when it appears in the spawn channel — spelling counts, caps don't. " +
      "When you get it right the bot reacts with 🎯. That means **your catch was registered**, not that you won. " +
      "Here's the deal: if two people type the name within a split second of each other, both get collected and " +
      "the winner is whoever Discord **stamped as earliest** — not whoever the bot processed first. " +
      "So if you see 🎯 but someone else gets the card, they genuinely sent their message before you. No bugs, no lag cheating — it's fair by design.\n\n" +
      "**⏳ Lag, Discord, and You**\n" +
      "Discord's message delivery isn't instant — your message might arrive at the bot slightly after it left your keyboard. " +
      "That's normal. The system uses Discord's own timestamps (not bot arrival time) so connection speed isn't an advantage. " +
      "If spawns feel slow to appear, that's Discord's embed loading time, not the bot. " +
      "Cards stay catchable for a configurable window (usually 60–120s), so you're not racing milliseconds on every drop.\n\n" +
      "**🗂️ Card Sets — What's Actually Dropping**\n" +
      "Cards come from the server's **active set** — admins rotate these to run themed seasons, events, and special collections. " +
      "Use `/sets active` to see what's currently in rotation, `/sets list` to see all sets, and `/sets progress set:<…>` to track how close you are to completing one. " +
      "Completing a full set can unlock special achievements (the good kind, with shards attached).\n\n" +
      "**✨ Shinies**\n" +
      "Every catch, pack pull, and trade-in has a **0.5% chance** to mint a shiny version. " +
      "Shinies count at **2× worth and burn value**, show up separately in your collection, and cannot be traded yet. " +
      "They're rare enough that getting one is an actual moment. Use `/burn shiny:true` if you ever want to cash one in.\n\n" +
      "**💠 Shards & Economy**\n" +
      "DN Shards are the currency. Earn them: daily claim · burning cards · achievements · trades · trade-ins. " +
      "Spend them: packs · trading offers · gifting to friends (`/gift`). " +
      "Packs have a shared cooldown across all tiers and a separate weekly cap per tier — hit the Legendary cap and you can still open Basics. " +
      "Caps reset Monday 00:00 UTC. Check your usage with `/packstats`.\n\n" +
      "**🎖️ Rarities & Worth** — Common (most drops) → Uncommon → Rare → Epic → Legendary → 🔮 Mythic (apex, nearly never random-drops). " +
      "Higher rarity = worth more shards. Net worth = sum of all your cards' worth; shinies count at 2×. " +
      "Admins run limited-time events that temporarily boost specific cards' drop rates — check `/event list` to see what's live.\n\n" +
      "**🔄 Trading**\n" +
      "Propose trades with `/trade user:@ offer:<card> want:<card>`. Mix in shards with `offer_shards` / `want_shards`. " +
      "If the value gap is more than **3:1**, an orange ⚠️ warning shows up so the short end can make an informed choice — it's informational only, the trade still goes through if accepted. " +
      "Use `/wishlist add name:<card>` to get pinged the moment a card you want spawns.\n\n" +
      "**🏅 Achievements & Ranks**\n" +
      "Achievements unlock automatically on milestones — first catch, 7-day streak, collecting X unique cards, burning 50 cards, completing a set — and each one pays shards. " +
      "Collector ranks (🪖 Recruit → 👑 Dark Commander) are based on unique cards owned. See yours with `/achievements` and `/rank`.",
    );
  if (rulesBanner) rules.setImage(rulesBanner);
  await applyEmbedOverride(rules, {
    guildId, key: "rules", defaultImageUrl: rulesBanner,
    ctx: { guild: guildName },
  });

  // ── 3. COMMANDS — member cheat sheet ──────────────────────────────────────
  const commands = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("⚡ Command Cheat Sheet")
    .setDescription(
      "**📦 Your Collection**\n" +
      "• `/collection [user]` — all your caught cards, paginated by rarity\n" +
      "• `/rank [user]` — collector rank & how many unique cards to the next tier\n" +
      "• `/info name:<card>` — card stats, drop chance, worth, burn value\n" +
      "• `/list` — full card roster by rarity\n" +
      "• `/catalog` — browse cards by category and see which ones you're missing\n" +
      "• `/top` — net-worth leaderboard + top pack openers\n" +
      "• `/achievements [user]` — your unlocked badges and their payout\n\n" +
      "**💠 Economy**\n" +
      "• `/daily` — claim your daily shards (streak bonus up to +200 💠/day)\n" +
      "• `/shards [user]` — check your balance\n" +
      "• `/pack tier:<basic|premium|legendary>` — open a 5-card pack\n" +
      "• `/packstats` — your costs, weekly cap usage, cooldown remaining\n" +
      "• `/burn name:<card> [amount:<n>] [all:true] [shiny:true]` — convert cards to shards\n" +
      "• `/tradein rarity:<tier>` — burn 5 of one rarity for 1 random card of the next tier up\n" +
      "• `/gift user:@ amount:<n>` — send shards to a friend\n\n" +
      "**🔄 Trading**\n" +
      "• `/trade user:@ offer:<card> want:<card>` — propose a trade (add `offer_shards`/`want_shards` for mixed deals)\n" +
      "• `/trades` — see your pending trade offers\n" +
      "• `/tradehistory [user]` — recent completed trades\n" +
      "• `/accept id:<n>` · `/decline id:<n>` — accept or cancel a trade\n\n" +
      "**📌 Wishlist**\n" +
      "• `/wishlist add|remove|list` — get pinged in the spawn channel when your wished cards drop\n\n" +
      "**🗂️ Card Sets**\n" +
      "• `/sets list` — all sets and their card counts\n" +
      "• `/sets active` — what's currently in the spawn rotation\n" +
      "• `/sets view set:<…>` — every card in a specific set\n" +
      "• `/sets progress set:<…>` — how close you are to completing a set\n\n" +
      "**ℹ️ Help**\n" +
      "• `/help` — full player command reference",
    )
    .setFooter({ text: "💡 Card name fields autocomplete as you type — use the dropdown, don't guess spellings." });
  if (commandsBanner) commands.setImage(commandsBanner);
  await applyEmbedOverride(commands, {
    guildId, key: "commands", defaultImageUrl: commandsBanner,
    ctx: { guild: guildName },
  });

  await interaction.editReply({ embeds: [welcome, rules, commands] });
}

// Admin onboarding guide — ephemeral, admins only.
// Three embeds: Quick Start checklist, Card Management (website + Discord),
// and the full admin command reference cheat-sheet.
export async function handleWelcomeAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) { await interaction.editReply("❌ Must be used inside a server."); return; }
  const isOwner = interaction.guild.ownerId === interaction.user.id;
  const member = interaction.member;
  const hasAdminPerm = member && "permissions" in member && typeof (member as { permissions?: unknown }).permissions === "object"
    && (member as { permissions: { has: (p: string) => boolean } }).permissions.has("Administrator");
  const dbAdmin = await isAdmin(interaction.guild.id, interaction.user.id);
  if (!isOwner && !hasAdminPerm && !dbAdmin) {
    await interaction.editReply("❌ Admins only.");
    return;
  }

  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  const siteUrl = domain ? `https://${domain}` : "your dashboard URL";
  const adminUrl = domain ? `https://${domain}/admin` : `${siteUrl}/admin`;

  const ADMIN_COLOR = 0xeb459e;

  // ── Embed 1: Admin Quick-Start ─────────────────────────────────────────────
  const quickstart = new EmbedBuilder()
    .setColor(ADMIN_COLOR)
    .setTitle("🛠️ Admin Quick-Start — DN Cards")
    .setDescription(
      "Welcome to the admin side of DN Cards. Here's your setup checklist — do these in order the first time.\n\n" +
      "**✅ Step 1 — Run `/setup`**\n" +
      "Interactive wizard: pick your spawn channel, set the interval, choose catch mode (type / button / both), configure rarity weights, and add the default starter card roster in one flow.\n\n" +
      "**✅ Step 2 — Activate a Card Set**\n" +
      "Random spawns only pull from the **active set**. Run `/sethub` and hit **✅ Set Active** on a set, or use `/setadmin active set:<name>`. With no active set, random spawns are paused (admin `/drop` still works).\n\n" +
      "**✅ Step 3 — Add/Edit Cards**\n" +
      "• **Website** (recommended for display tweaks): go to `" + adminUrl + "` → Card Manager. Edit display name, image, description, flavor, visibility, featured status, sort order.\n" +
      "• **Discord** (for gameplay values): use `!addcard` / `!editcard <Name>` prefix commands for rarity, worth, burn, drop weight, packs, and limited/event flags. Prefix defaults to `!`.\n\n" +
      "**✅ Step 4 — Configure the Dashboard Login**\n" +
      "Run `/dashboard` — the bot DMs you a one-time login link. Share `/dashboard` with other trusted admins too.\n\n" +
      "**✅ Step 5 — Test a Drop**\n" +
      "Run `/drop` (no name = random from active set). If nothing spawns, check that your active set has droppable cards and the spawn channel is set.",
    );

  // ── Embed 2: Card Editing — Website vs Discord ────────────────────────────
  const cardEditing = new EmbedBuilder()
    .setColor(ADMIN_COLOR)
    .setTitle("🃏 Card Editing — Website vs Discord")
    .setDescription(
      "The website and the bot share **one database** but own different columns. Never edit gameplay values on the site — they're read-only there on purpose.\n\n" +
      "**🌐 Website — Presentation Only**\n" +
      `Go to **[Card Manager](${adminUrl})** → pick a card → side panel opens.\n` +
      "Editable: Display Name · Image URL · Description · Flavor Text · Hidden from Site · Featured · Sort Weight\n" +
      "Read-only (shown for reference): Rarity · Worth · Burn · Drop Weight · Packs · Archived\n" +
      "To access: run `/dashboard` in Discord → click the DM link → navigate to `/admin`.\n\n" +
      "**🎮 Discord — Gameplay Values (prefix commands)**\n" +
      "```\n" +
      "!addcard          — guided wizard: name, rarity, worth, image, etc.\n" +
      "!addlimited       — limited-edition card (set a copy cap)\n" +
      "!addevent         — event-exclusive (never random-drops)\n" +
      "!editcard <Name>  — edit any field on an existing card\n" +
      "!removecard <Name>— archive the card (stops spawning, keeps collections)\n" +
      "!import           — bulk-import cards from a JSON file attachment\n" +
      "```\n" +
      "Card images must be **URLs** (Imgur, Discord CDN, etc.) — no file attachments in prefix commands.\n\n" +
      "**🗂️ Sets (spawn rotation)**\n" +
      "Use `/sethub` for a clickable panel, or `/setadmin` for typed subcommands:\n" +
      "`create · rename · delete · add · remove · bulkadd · bulkremove · active · deactivate · view · export · exportall`\n" +
      "Export any set to JSON and re-import with `!loadset` + file attachment.",
    );

  // ── Embed 3: Admin Command Cheat-Sheet ────────────────────────────────────
  const cheatsheet = new EmbedBuilder()
    .setColor(ADMIN_COLOR)
    .setTitle("⚡ Admin Command Cheat-Sheet")
    .addFields(
      {
        name: "🎁 Drops & Giveaways",
        value:
          "`/drop [name]` — force a single drop (bypasses active-set restriction)\n" +
          "`/massdrop [amount]` — batch drop 10–25 cards (event use)\n" +
          "`/give user:@ name:<card>` · `/takeback user:@ name:<card>`\n" +
          "`/giveshards user:@ amount:<n>` · `/takeshards user:@ amount:<n>`",
        inline: false,
      },
      {
        name: "🎯 Limited-Time Events",
        value:
          "`/event start card:<Name> duration:<30m|2h|1d> [multiplier:<n>]` — boost a card's spawn weight\n" +
          "`/event list` — see active boosts · `/event stop id:<n>` — end early",
        inline: false,
      },
      {
        name: "⚙️ Config & Channels",
        value:
          "`/setup` — interactive first-time setup · `/config` — visual config panel\n" +
          "`/setchannels` — pick spawn/trade channel from dropdown\n" +
          "`/adminhub` — manage bot admins & catch timeouts\n" +
          "`/adminhelp` — full admin reference",
        inline: false,
      },
      {
        name: "🗂️ Sets (Quick Reference)",
        value:
          "`/sethub` — **clickable panel** (recommended)\n" +
          "`/setadmin active set:<…>` · `/setadmin deactivate`\n" +
          "`/setadmin add set:<…> card:<…>` · `/setadmin export set:<…>`\n" +
          "`/setadmin exportall` — full backup JSON",
        inline: false,
      },
      {
        name: "🎨 Appearance",
        value:
          "`/embed set key:<embed> field:<field> value:<v>` — override spawn/claimed/daily/pack/trade embeds\n" +
          "`/rarity profile set rarity:<tier> …` — override worth/burn/weight per-rarity for this server\n" +
          "`/rarityname name:<…> emoji:<…>` — rename the Mythic tier",
        inline: false,
      },
      {
        name: "🌐 Website",
        value:
          `**Card Manager:** [${adminUrl}](${adminUrl}) — display overrides, featured cards, hidden cards\n` +
          `**News:** [${adminUrl}/news](${adminUrl}/news) — post announcements\n` +
          `**Suggestions:** [${adminUrl}/suggestions](${adminUrl}/suggestions) — player feedback queue\n` +
          "Run `/dashboard` to get your login link.",
        inline: false,
      },
    )
    .setFooter({ text: "Player commands are in /help · Full admin reference in /adminhelp" });

  await interaction.editReply({ embeds: [quickstart, cardEditing, cheatsheet] });
}
