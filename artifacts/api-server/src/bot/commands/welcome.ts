import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { isAdmin } from "../db.js";

// Thin animated divider GIF used as the separator image at the bottom of each
// embed. The rainbow-glow line (4 KB, GitHub user-images CDN) renders as a
// full-width animated stripe between embeds in Discord.
const DIVIDER_GIF =
  "https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif";

const BRAND_COLOR  = 0xe63946;   // DarkNight red
const ADMIN_COLOR  = 0xeb459e;   // pink for admin embeds

const SITE_URL  = "https://dncards.com";
const SITE_ADMIN = `${SITE_URL}/admin`;

// ── Helper — build the Replit-hosted admin-dashboard URL ─────────────────────
function dashboardAdminUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  return domain ? `https://${domain}/admin` : SITE_ADMIN;
}

// ─────────────────────────────────────────────────────────────────────────────
// /welcome — public, member-facing. Drops in #welcome or #info channels.
// Two clean embeds separated by the animated GIF divider line.
// NOT in EPHEMERAL_COMMANDS — visible to everyone.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleWelcome(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId   = interaction.guildId;
  const guildName = interaction.guild?.name ?? "this server";

  // ── Embed 1: Welcome & Quick Start ─────────────────────────────────────────
  const welcome = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("🃏 Welcome to DN Cards")
    .setDescription(
      "DarkNight's military collectible card game — tanks, jets, warships, bosses, " +
      "and the occasional cursed community card. Cards drop randomly. You catch them. " +
      "You hoard them. You flex a 👑 Legendary on someone still grinding Commons. It's a lifestyle.\n\n" +

      "**Getting Started**\n" +
      "① **Watch the spawn channel** — when a card drops, just **type its name** to catch it. " +
        "No slash command. No button. Just type. (Unless the server is in button mode — then click.)\n" +
      "② **`/daily`** — free shards every day. 7-day streak = 💠 1,000 shard achievement. Easy.\n" +
      "③ **`/pack`** — spend shards on 5-card packs. 🥉 Basic (250 💠) · 🥈 Premium (750 💠) · 🥇 Legendary (2,000 💠, no commons).\n" +
      "④ **`/burn`** — turn duplicate cards into shards. Burn, reinvest, repeat.\n" +
      "⑤ **`/top`** — check where you stand. Goal: 👑 Dark Commander.",
    )
    .setImage(DIVIDER_GIF);  // animated divider line between this embed and the next

  await applyEmbedOverride(welcome, {
    guildId,
    key: "welcome",
    defaultImageUrl: DIVIDER_GIF,
    ctx: { guild: guildName, username: interaction.user.username, userId: interaction.user.id },
  });

  // ── Embed 2: Things to Know ─────────────────────────────────────────────────
  const rules = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📌 Things You Actually Need to Know")
    .setDescription(
      "**🎯 How Catching Works**\n" +
      "Type the card name exactly — capitalisation doesn't matter, spelling does. " +
      "You'll see a 🎯 reaction when your catch was **registered**. " +
      "That's not a win confirmation — it means you're in the pool. " +
      "If two people type the name within the same split-second, Discord's own message timestamp decides the winner, " +
      "not bot processing speed. So if you got 🎯 but lost, someone else genuinely sent their message before you. No bugs, no foul play.\n\n" +

      "**⏳ Lag & Discord Being Discord**\n" +
      "Discord embeds take a moment to load — that's normal, the card is catchable the whole time. " +
      "Cards stay up for the full catch window (usually 60–120 s), so you're not racing milliseconds on every drop. " +
      "If you catch successfully you'll see 🔥 Burn / 💾 Keep / 🔄 Trade buttons in the spawn message.\n\n" +

      "**🏆 Leaderboard**\n" +
      "Use `/top` for the in-Discord net-worth leaderboard. " +
      `Browse the full card roster, featured cards, and stats at **[${SITE_URL}](${SITE_URL})**.\n\n` +

      "**🗂️ Card Sets**\n" +
      "Random spawns only pull from the server's **active set** — admins rotate these for seasons and events. " +
      "`/sets active` shows what's in rotation right now. `/sets progress set:<…>` shows how close you are to completing a set. " +
      "Completing full sets can unlock special achievements with shard payouts.\n\n" +

      "**✨ Shinies**\n" +
      "Every catch, pack pull, and trade-in has a **0.5% chance** of minting a shiny — " +
      "worth **2× the normal burn/trade value**. They show up separately in your collection. " +
      "Getting one is genuinely rare. Cherish it or burn it for the bag, your call.\n\n" +

      "**💠 Shards & Economy**\n" +
      "Earn: daily claims · burning cards · achievements · trade-ins · admin gifts. " +
      "Spend: packs · trade offers · `/gift` to friends. " +
      "Packs share one cooldown across tiers but each tier has its own **separate weekly cap** — " +
      "hit the Legendary cap and you can still open Basics. Caps reset Monday 00:00 UTC.\n\n" +

      "**🔄 Trading**\n" +
      "`/trade user:@ offer:<card> want:<card>` — mix in shards with `offer_shards`/`want_shards`. " +
      "If the deal is more than **3:1 in value**, an orange ⚠️ banner warns the short side. " +
      "Trade still goes through if accepted. Use `/wishlist add name:<card>` to get pinged when your target spawns.\n\n" +

      "**📖 Commands Quick-Ref**\n" +
      "`/collection` · `/rank` · `/info` · `/list` · `/catalog` · `/top` · `/achievements`\n" +
      "`/daily` · `/pack` · `/packstats` · `/burn` · `/tradein` · `/shards` · `/gift`\n" +
      "`/trade` · `/trades` · `/accept` · `/decline` · `/tradehistory` · `/wishlist`\n" +
      "`/sets list|active|view|progress` · `/help`",
    )
    .setFooter({ text: `🌐 ${SITE_URL}  ·  💡 Card name fields autocomplete — use the dropdown` })
    .setImage(DIVIDER_GIF);

  await applyEmbedOverride(rules, {
    guildId,
    key: "rules",
    defaultImageUrl: DIVIDER_GIF,
    ctx: { guild: guildName },
  });

  await interaction.editReply({ embeds: [welcome, rules] });
}

// ─────────────────────────────────────────────────────────────────────────────
// /welcomeadmin — ephemeral, admin-only onboarding guide.
// Three embeds: Quick-Start checklist · Card Editing guide · Command cheat-sheet.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleWelcomeAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  // NOTE: admin.ts dispatcher has already called deferReply(ephemeral) — do NOT defer again here.
  if (!interaction.guild) { await interaction.editReply("❌ Must be used inside a server."); return; }
  const isOwner   = interaction.guild.ownerId === interaction.user.id;
  const member    = interaction.member;
  const hasAdminPerm =
    member &&
    "permissions" in member &&
    typeof (member as { permissions?: unknown }).permissions === "object" &&
    (member as { permissions: { has: (p: string) => boolean } }).permissions.has("Administrator");
  const dbAdmin = await isAdmin(interaction.guild.id, interaction.user.id);
  if (!isOwner && !hasAdminPerm && !dbAdmin) {
    await interaction.editReply("❌ Admins only.");
    return;
  }

  const adminUrl = dashboardAdminUrl();

  // ── Embed 1: Setup Checklist ──────────────────────────────────────────────
  const quickstart = new EmbedBuilder()
    .setColor(ADMIN_COLOR)
    .setTitle("🛠️ Admin Quick-Start — DN Cards")
    .setDescription(
      "Do these **in order** the first time:\n\n" +

      "**✅ Step 1 — `/setup`**\n" +
      "Interactive wizard — spawn channel, drop interval, catch mode (type/button/both), " +
      "rarity weights, and the default starter card roster. One flow, everything configured.\n\n" +

      "**✅ Step 2 — Activate a Card Set**\n" +
      "Random spawns only fire from the **active set**. Run `/sethub` (clickable panel) " +
      "or `/setadmin active set:<name>`. No active set = no random spawns (admin `/drop` always works).\n\n" +

      "**✅ Step 3 — Add & Edit Cards**\n" +
      `• **Website** → [${SITE_ADMIN}](${SITE_ADMIN}) — display name, image, description, featured/hidden, sort order.\n` +
      "• **Discord prefix commands** → `!addcard` / `!editcard <Name>` — rarity, worth, burn, spawn chance, packs.\n\n" +

      "**✅ Step 4 — Dashboard Login**\n" +
      "Run `/dashboard` — bot DMs you a one-time login link. Do this for every admin who needs site access.\n\n" +

      "**✅ Step 5 — Test It**\n" +
      "Run `/drop` (no name = random from active set). If nothing spawns, check the set has droppable cards and the spawn channel is configured.",
    )
    .setImage(DIVIDER_GIF);

  // ── Embed 2: Card Editing — Website vs Discord ────────────────────────────
  const cardEditing = new EmbedBuilder()
    .setColor(ADMIN_COLOR)
    .setTitle("🃏 Card Editing — Website vs Discord")
    .setDescription(
      "The website and bot share **one database** but own different columns. " +
      "Gameplay values are **read-only on the website** on purpose — change them in Discord.\n\n" +

      "**🌐 Website (display overrides only)**\n" +
      `Go to **[Card Manager](${adminUrl})** → pick a card → edit in the side panel.\n` +
      "You can change: Display Name · Image URL · Description · Flavor Text · Hidden from Site · Featured · Sort Weight.\n" +
      "Everything else (rarity, worth, burn, spawn chance, packs) is shown read-only for reference.\n" +
      `Public card roster: **[${SITE_URL}](${SITE_URL})**\n\n` +

      "**🎮 Discord (gameplay values — prefix commands)**\n" +
      "```\n" +
      "!addcard          — guided wizard: name, rarity, worth, image, etc.\n" +
      "!addlimited       — limited edition (copy cap)\n" +
      "!addevent         — event-exclusive (never random-drops)\n" +
      "!editcard <Name>  — edit any field on an existing card\n" +
      "!removecard <Name>— archive (stops spawning, keeps collections intact)\n" +
      "!import           — bulk import from JSON file attachment\n" +
      "```\n" +
      "Images must be **URLs** (Imgur, Discord CDN). No file uploads in prefix commands.\n\n" +

      "**🗂️ Sets (spawn rotation)**\n" +
      "`/sethub` — clickable panel (create, activate, export, toggle showcase).\n" +
      "`/setadmin` — typed subcommands for everything the panel does, plus bulk operations.\n" +
      "Export any set to JSON → re-import with `!loadset` + file attachment. Full roundtrip.",
    )
    .setImage(DIVIDER_GIF);

  // ── Embed 3: Admin Cheat-Sheet ────────────────────────────────────────────
  const cheatsheet = new EmbedBuilder()
    .setColor(ADMIN_COLOR)
    .setTitle("⚡ Admin Command Cheat-Sheet")
    .addFields(
      {
        name: "🎁 Drops & Giveaways",
        value:
          "`/drop [name]` — single drop (bypasses active-set check)\n" +
          "`/massdrop [amount]` — 10–25 cards in a batch (event use)\n" +
          "`/give user:@ name:<card>` · `/takeback user:@ name:<card>`\n" +
          "`/giveshards user:@ amount:<n>` · `/takeshards user:@ amount:<n>`",
        inline: false,
      },
      {
        name: "🎯 Limited-Time Events",
        value:
          "`/event start card:<Name> duration:<30m|2h|1d> [multiplier:<n>]` — boost a card's spawn weight\n" +
          "`/event list` · `/event stop id:<n>`",
        inline: false,
      },
      {
        name: "⚙️ Config & Channels",
        value:
          "`/setup` — first-time wizard · `/config` — visual config panel\n" +
          "`/adminhub` — manage admins, timeouts, channels & server state\n" +
          "`/adminhelp` — full admin reference",
        inline: false,
      },
      {
        name: "🗂️ Sets",
        value:
          "`/sethub` — **clickable panel** (recommended)\n" +
          "`/setadmin active set:<…>` · `/setadmin deactivate`\n" +
          "`/setadmin add set:<…> card:<…>` · `/setadmin exportall` — full backup",
        inline: false,
      },
      {
        name: "🎨 Appearance",
        value:
          "`/embed set key:<embed> field:<field> value:<v>` — override spawn/claimed/daily/pack/trade embeds\n" +
          "`/rarity profile set rarity:<tier> …` — worth/burn/weight per-rarity\n" +
          "`/rarityname name:<…> emoji:<…>` — rename the Mythic tier",
        inline: false,
      },
      {
        name: "🌐 Website",
        value:
          `Public: **[${SITE_URL}](${SITE_URL})** — card roster, news, player suggestions\n` +
          `Admin: **[${adminUrl}](${adminUrl})** — card display overrides, news posts, suggestion queue\n` +
          "Run `/dashboard` to get your login link (one-time DM).",
        inline: false,
      },
    )
    .setFooter({ text: "Player commands → /help  ·  Full admin reference → /adminhelp" });

  await interaction.editReply({ embeds: [quickstart, cardEditing, cheatsheet] });
}
