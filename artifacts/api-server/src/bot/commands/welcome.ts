import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { getOrCreateGuildSettings, isAdmin } from "../db.js";
import { getShinyName } from "../cards-data.js";

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
// Small, spaced-out sections — Welcome · Rules · Good to Know · Dive In — each
// separated by the animated GIF banner. Kept short on purpose: the full command
// reference lives in the interactive `/help` hub. Each section stays editable
// via `/embed` (keys: welcome · rules · commands).
// NOT in EPHEMERAL_COMMANDS — visible to everyone.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleWelcome(interaction: ChatInputCommandInteraction): Promise<void> {
  const shinySettings = interaction.guildId ? await getOrCreateGuildSettings(interaction.guildId) : null;
  const shinyName = getShinyName(shinySettings);
  const guildId   = interaction.guildId;
  const guildName = interaction.guild?.name ?? "this server";

  // ── 1 · Welcome ─────────────────────────────────────────────────────────────
  const welcome = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("🃏 Welcome to DN Cards")
    .setDescription(
      `Welcome to **${guildName}** — DarkNight's military collectible card game. Tanks, jets, warships, bosses, and the odd cursed community card drop right here in chat.\n\n` +
      "**When a card spawns, just type its name to catch it.** That's the core loop — then hoard, battle, trade, and climb the leaderboard.",
    )
    .setImage(DIVIDER_GIF);

  await applyEmbedOverride(welcome, {
    guildId, key: "welcome", defaultImageUrl: DIVIDER_GIF,
    ctx: { guild: guildName, username: interaction.user.username, userId: interaction.user.id },
  });

  // ── 2 · Rules & Fair Play ───────────────────────────────────────────────────
  const rules = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("📜 Rules & Fair Play")
    .setDescription(
      "• **Be cool** — follow the server rules and keep chat friendly.\n" +
      "• **No cheating** — macros, self-bots, or auto-typers to snipe catches are bannable.\n" +
      "• **Fair catches** — ties break by Discord's own message timestamp, not bot speed. Got the 🎯 but lost? Someone genuinely typed it first — no bugs, no favouritism.\n" +
      "• **Trade honestly** — deals over 3:1 in value show a ⚠️ warning; it's a heads-up, not a block.",
    )
    .setImage(DIVIDER_GIF);

  await applyEmbedOverride(rules, {
    guildId, key: "rules", defaultImageUrl: DIVIDER_GIF, ctx: { guild: guildName },
  });

  // ── 3 · Good to Know ────────────────────────────────────────────────────────
  const info = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("💡 Good to Know")
    .addFields(
      { name: "🎯 Catching", value: "Type the card name exactly (spelling matters, caps don't). A 🎯 means you're in the pool. Cards stay up 60–120s — no need to race milliseconds." },
      { name: "💠 Shards & Packs", value: "Earn shards from `/daily`, burning duplicates, achievements & quests. Spend them on `/pack` — 🥉 Basic · 🥈 Premium · 🥇 Legendary." },
      { name: `✨ ${shinyName} Cards`, value: `Every catch and pull has a **0.5%** chance to mint a rare ${shinyName} — worth extra and tracked separately.` },
      { name: "🗂️ Sets", value: "Spawns pull from the server's **active set**. Browse sets and track completion with `/set_hub`." },
    )
    .setImage(DIVIDER_GIF);

  await applyEmbedOverride(info, {
    guildId, key: "commands", defaultImageUrl: DIVIDER_GIF, ctx: { guild: guildName },
  });

  // ── 4 · Dive In ─────────────────────────────────────────────────────────────
  const start = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🎮 Dive In")
    .setDescription(
      "**Plenty to do here:**\n" +
      "🃏 Collect & complete sets · 💠 Open packs · 🔄 Trade & use the `/market`\n" +
      "⚔️ Battle players or AI · 🐉 Team up for co-op boss `/raid`s · 🤝 Join a `/squad`\n" +
      "🎯 Daily & weekly `/quests` · 🎉 Enter `/giveaways` for real prizes\n\n" +
      "**Start now:**\n" +
      "① `/daily` — grab free shards\n" +
      "② Watch chat and **type card names** to catch\n" +
      "③ `/pack` — open your first pack\n" +
      "④ **`/help`** — the full interactive guide to every feature",
    )
    .setFooter({ text: `🌐 ${SITE_URL}  ·  Run /help for the complete guide` })
    .setImage(DIVIDER_GIF);

  await interaction.editReply({ embeds: [welcome, rules, info, start] });
}

// ─────────────────────────────────────────────────────────────────────────────
// /welcome_admin — ephemeral, admin-only onboarding guide.
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
      "Random spawns only fire from the **active set**. Run `/set_hub` (clickable panel) " +
      "to pick one. No active set = no random spawns (admin `/drop` always works).\n\n" +

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
      "`/set_hub` — clickable panel (create, activate, export, toggle showcase).\n" +
      "`/set_admin` — advanced set hub (weights, bulk operations, import/export).\n" +
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
          "`/mass_drop [amount]` — 10–25 cards in a batch (event use)\n" +
          "`/give user:@ name:<card>` · `/take_back user:@ name:<card>`\n" +
          "`/give_shards user:@ amount:<n>` · `/take_shards user:@ amount:<n>`",
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
          "`/admin_hub` — manage admins, timeouts, channels & server state\n" +
          "`/admin_help` — full admin reference",
        inline: false,
      },
      {
        name: "🗂️ Sets",
        value:
          "`/set_hub` — **clickable panel** (recommended) — browse, create, activate, export\n" +
          "`/set_admin` — advanced hub — rarity weights, bulk add/remove, import/export",
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
    .setFooter({ text: "Player commands → /help  ·  Full admin reference → /admin_help" });

  await interaction.editReply({ embeds: [quickstart, cardEditing, cheatsheet] });
}
