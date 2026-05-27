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
// Dispatcher (user.ts) does NOT add this to EPHEMERAL_COMMANDS, so the reply
// is visible to everyone in the channel.
export async function handleWelcome(interaction: ChatInputCommandInteraction): Promise<void> {
  const welcomeBanner = bannerUrl("welcome");
  const rulesBanner = bannerUrl("rules");
  const commandsBanner = bannerUrl("commands");

  // ── 1. WELCOME — game intro + quick start ─────────────────────────────────
  const welcome = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("🃏 Welcome to DN Cards")
    .setDescription(
      "**DN Cards** is DarkNight's collectible military trading card game.\n" +
      "Collect cards, build your roster, trade with the squad, and climb the leaderboard.\n\n" +
      "**🚀 Quick Start**\n" +
      "• **Step 1** — Watch the spawn channel. When a card appears, **type its name exactly** to catch it.\n" +
      "• **Step 2** — Run `/daily` every day for **💠 DN Shards** (streak bonus up to +200).\n" +
      "• **Step 3** — Spend shards on `/pack tier:basic|premium|legendary` to pull more cards.\n" +
      "• **Step 4** — Burn duplicates with `/burn` for shards, or `/trade` with friends.\n" +
      "• **Step 5** — Check your progress with `/collection`, `/rank`, and `/top`.",
    );
  if (welcomeBanner) welcome.setImage(welcomeBanner);
  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name ?? "";
  await applyEmbedOverride(welcome, {
    guildId, key: "welcome", defaultImageUrl: welcomeBanner,
    ctx: { guild: guildName, username: interaction.user.username, userId: interaction.user.id },
  });

  // ── 2. RULES — things every collector should know ──────────────────────────
  const rules = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📌 Things to Know")
    .setDescription(
      "**🎖️ Rarities** — Common · Uncommon · Rare · Epic · Legendary · 🔮 Mythic. Higher rarity = rarer drop and worth more shards. Mythic is the apex tier — admin-only by default; admins can rename it per-server with `/rarityname`.\n\n" +
      "**✨ Shinies** — Every random catch, pack pull, and trade-in has a flat **0.5%** chance to mint a shiny. " +
      "Shinies count at **2× worth & burn**, are tracked separately, and aren't tradeable in v1. " +
      "Use `/burn shiny:true` to torch the shiny pile specifically.\n\n" +
      "**🎴 Pack Tiers** — 🥉 Basic (💠 250) · 🥈 Premium (💠 750) · 🥇 Legendary (💠 2,000, no commons). " +
      "Each tier has its own weekly cap; cooldown is shared across all tiers (resets Monday 00:00 UTC).\n\n" +
      "**🔄 Trading** — `/trade` is propose/accept. Trades with a value gap **>3:1** show an orange ⚠️ banner " +
      "so the disadvantaged side can decide informed. Trades still go through if accepted.\n\n" +
      "**🎯 Limited-Time Events** — Admins can boost any card's spawn rate for a set duration. " +
      "Announced in the spawn channel — check `/event list` to see what's hot right now.\n\n" +
      "**🏆 Net Worth & Rank** — `/top` ranks by net worth (sum of all card worth, shinies at 2×). " +
      "Unique cards unlock collector ranks: 🪖 Recruit → 👑 Dark Commander.\n\n" +
      "**🏅 Achievements** — unlockables auto-trigger on milestones (first catch, 7-day streak, collecting unique cards, etc.) " +
      "and pay 💠 shards. Set-completion achievements unlock when you own every card in a set — static ones fire for any completed set; " +
      "admins can flag special sets with `/setadmin showcase` to award a bonus achievement on top. See yours with `/achievements`.",
    );
  if (rulesBanner) rules.setImage(rulesBanner);
  await applyEmbedOverride(rules, {
    guildId, key: "rules", defaultImageUrl: rulesBanner,
    ctx: { guild: guildName },
  });

  // ── 3. COMMANDS — full cheat sheet ─────────────────────────────────────────
  const commands = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("⚡ Commands Cheat Sheet")
    .setDescription(
      "**📦 Collection & Progress**\n" +
      "• `/collection [user]` — your caught cards\n" +
      "• `/rank [user]` — collector rank & progression\n" +
      "• `/info name:<card>` — card details & drop chance\n" +
      "• `/list` — full roster by rarity · `/catalog category:<…>` — browse a category\n" +
      "• `/top` — leaderboard · `/achievements [user]` — your badges\n\n" +
      "**💠 Economy**\n" +
      "• `/daily` — claim daily shards (streak bonus)\n" +
      "• `/pack tier:<basic|premium|legendary>` — open a 5-card pack\n" +
      "• `/packstats` — costs, weekly caps, cooldown\n" +
      "• `/burn name:<card> [amount] [all] [shiny:true]` — burn for shards\n" +
      "• `/tradein rarity:<r>` — burn 5 of one tier for 1 of the next\n" +
      "• `/shards [user]` — check balance · `/gift user:@ amount:<n>` — send shards\n\n" +
      "**🔄 Trading**\n" +
      "• `/trade user:@ offer:<card> want:<card>` — propose (add `offer_shards`/`want_shards` to mix in 💠)\n" +
      "• `/trades` — pending · `/tradehistory [user]` — recent · `/accept id:<n>` · `/decline id:<n>`\n\n" +
      "**📌 Wishlist**\n" +
      "• `/wishlist add|remove|list` — get pinged when wished cards spawn\n\n" +
      "**🗂️ Card Sets**\n" +
      "• `/sets list` — all sets · `/sets active` — current spawn pool\n" +
      "• `/sets view set:<…>` — cards in a set · `/sets progress set:<…>` — your completion %\n\n" +
      "**ℹ️ Help**\n" +
      "• `/help` — player commands · `/adminhelp` — admin commands (admins only)",
    )
    .setFooter({ text: "Tip: most card-name fields autocomplete as you type — pick from the dropdown." });
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
