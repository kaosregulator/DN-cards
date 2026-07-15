// ─────────────────────────────────────────────────────────────────────────────
// Unified /help hub — one interactive, animated command that documents the WHOLE
// DN Cards project: collecting, economy, trading & market, battles/raids/squads,
// giveaways, quests & reputation, Echo/AFK, and (for admins) the full admin tool
// set. A single ephemeral message with an animated banner and a topic dropdown;
// picking a topic live-edits the embed to that page (no new messages, no spam).
//
// Editable: the embed runs through applyEmbedOverride("help"), so admins can
// rebrand the banner/color/title/footer any time with `/embed set key:help …`.
//
// Every player + admin command is represented here — this is the single source
// of truth that replaces the older split help embeds.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction,
  GuildMember,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags, PermissionFlagsBits,
} from "discord.js";
import { applyEmbedOverride } from "../embed-overrides.js";
import { isAdmin as isDbAdmin, getOrCreateGuildSettings } from "../db.js";
import { getShinyName } from "../cards-data.js";
import {
  HELP_BANNER, SECTION_COLOR, siteUrl, type HelpSection,
} from "../help-banners.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

interface SectionMeta { id: HelpSection; emoji: string; label: string; blurb: string; adminOnly?: boolean }

// Order = dropdown order. "home" is the landing page.
const SECTIONS: SectionMeta[] = [
  { id: "home",     emoji: "🏠", label: "Overview & Getting Started", blurb: "What DN Cards is + how to start" },
  { id: "collect",  emoji: "🃏", label: "Collecting & Cards",         blurb: "Catch, browse, rank, level, cosmetics" },
  { id: "economy",  emoji: "💠", label: "Economy & Packs",            blurb: "Daily, shards, packs, burn, trade-in" },
  { id: "trade",    emoji: "🔄", label: "Trading & Marketplace",      blurb: "Trades, gifts, wishlist, auctions" },
  { id: "battle",   emoji: "⚔️", label: "Battles, Raids & Squads",    blurb: "Duels, co-op bosses, teams" },
  { id: "giveaway", emoji: "🎉", label: "Giveaways",                  blurb: "Win prizes through activity" },
  { id: "quests",   emoji: "🎯", label: "Quests & Reputation",        blurb: "Daily/weekly goals, rep, thanks" },
  { id: "social",   emoji: "🔊", label: "Echo Messages & AFK",        blurb: "Encrypted whispers, away status" },
  { id: "bob",      emoji: "🤖", label: "Bob — Games & Chaos",        blurb: "Roulette, mini-games, roasts, Bob" },
  { id: "admin",    emoji: "🛠️", label: "Admin Toolbox",              blurb: "Setup, config & management (admins)", adminOnly: true },
];

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleHelpHub(
  interaction: ChatInputCommandInteraction, opening: HelpSection = "home",
): Promise<void> {
  // Callers may or may not have deferred already (e.g. /help defers
  // ephemerally; !help / direct /help may not). Normalize.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(EPHEMERAL).catch(() => {});
  }
  const admin = await memberIsAdmin(interaction);
  const embed = await buildPage(interaction, opening);
  await interaction.editReply({ embeds: [embed], components: buildComponents(opening, admin) });
}

// ── Component router (help:* select + buttons) ───────────────────────────────
export async function handleHelpHubComponent(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":"); // help:select | help:home
  const admin = await memberIsAdmin(interaction);
  let section: HelpSection = "home";
  if (interaction.isStringSelectMenu()) section = (interaction.values[0] as HelpSection) ?? "home";
  else if (parts[1] === "home") section = "home";

  if (section === "admin" && !admin) {
    await interaction.reply({ content: "🛠️ The Admin section is only available to server administrators.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  const embed = await buildPage(interaction, section);
  await interaction.update({ embeds: [embed], components: buildComponents(section, admin) }).catch(() => {});
}

// ── Components (topic dropdown + nav buttons) ─────────────────────────────────
function buildComponents(current: HelpSection, admin: boolean) {
  const options = SECTIONS
    .filter(s => !s.adminOnly || admin)
    .map(s => ({ label: s.label, value: s.id, description: s.blurb, emoji: s.emoji, default: s.id === current }));

  const select = new StringSelectMenuBuilder()
    .setCustomId("help:select")
    .setPlaceholder("📖 Jump to a topic…")
    .addOptions(options);

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("help:home").setLabel("Home").setEmoji("🏠").setStyle(ButtonStyle.Secondary).setDisabled(current === "home"),
    new ButtonBuilder().setLabel("Website").setEmoji("🌐").setStyle(ButtonStyle.Link).setURL(siteUrl()),
  );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), nav];
}

// ── Page builder ─────────────────────────────────────────────────────────────
async function buildPage(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  section: HelpSection,
): Promise<EmbedBuilder> {
  const guildId = interaction.guildId;
  const settings = guildId ? await getOrCreateGuildSettings(guildId).catch(() => null) : null;
  const shiny = getShinyName(settings);
  const site = siteUrl();

  const embed = new EmbedBuilder().setColor(SECTION_COLOR[section]);
  PAGES[section](embed, { shiny, site });
  embed.setImage(HELP_BANNER); // animated banner stripe (overridable below)

  // Let admins rebrand the help embed via `/embed set key:help …`.
  await applyEmbedOverride(embed, {
    guildId,
    key: "help",
    defaultImageUrl: HELP_BANNER,
    ctx: { guild: interaction.guild?.name ?? "this server" },
  });
  return embed;
}

interface PageCtx { shiny: string; site: string }
type PageFn = (e: EmbedBuilder, ctx: PageCtx) => void;

const NAV_HINT = "\n\n*Use the 📖 dropdown below to jump to any topic.*";

const PAGES: Record<HelpSection, PageFn> = {
  // ── Overview ───────────────────────────────────────────────────────────────
  home: (e, { site }) => {
    e.setTitle("🃏 DN Cards — Full Guide")
      .setDescription(
        "**DarkNight's military collectible card game.** Tanks, jets, warships, bosses, and the odd cursed community card drop right into your server. Catch them, hoard them, battle with them, trade them, and flex your collection.\n\n" +
        "**How catching works**\n" +
        "When a card spawns in the drop channel, just **type its name** to catch it — no command needed *(unless the server uses button mode, then you click)*. First valid catch wins; Discord's own message timestamp breaks ties fairly.\n\n" +
        "**Your first five minutes**\n" +
        "① `/daily` — grab free 💠 shards\n" +
        "② Watch the spawn channel and **type card names** to catch\n" +
        "③ `/pack tier:basic` — spend shards on a 5-card pack\n" +
        "④ `/collection` — see what you own\n" +
        "⑤ `/burn` duplicates → more shards → repeat\n\n" +
        "**What else is here** — battles & co-op raids, squads, a player marketplace, giveaways, daily/weekly quests, reputation, encrypted Echo whispers, and more. Pick a topic below.\n\n" +
        "💡 New to the server? Run `/welcome` for the public intro & rules." +
        `\n\n🌐 Full roster & stats: **[${site}](${site})**`,
      )
      .setFooter({ text: "DN Cards · pick a topic below to see every command" });
  },

  // ── Collecting ───────────────────────────────────────────────────────────────
  collect: (e, { shiny }) => {
    e.setTitle("🃏 Collecting & Cards")
      .setDescription("Everything about catching, browsing, and showing off cards." + NAV_HINT)
      .addFields(
        { name: "🎯 Catch & Browse", value:
          "**Type a card's name** in the spawn channel to catch it.\n" +
          "`/collection [user]` — your (or someone's) collection\n" +
          "`/info name:<card>` — details, worth, drop chance\n" +
          "`/list` — full roster grouped by rarity\n" +
          "`/catalog category:<rarity|event|limited|all>` — browse by type\n" +
          "`/search query:<text>` — free-text card search" },
        { name: "🏅 Progress & Rank", value:
          "`/rank [user]` — collector rank & progression\n" +
          "`/top` — net-worth leaderboard\n" +
          "`/achievements [user]` — unlocked badges\n" +
          "`/collector` — opt in/out of the spawn-ping collector role\n" +
          "`/calendar` — your login streak calendar" },
        { name: "⭐ Card Upgrades & Cosmetics", value:
          "`/level [card]` — a card's battle level & stars\n" +
          "`/frame` — equip a cosmetic frame on a card\n" +
          "`/lock name:<card>` — lock/favorite a card so it's safe from bulk burns" },
        { name: "🗂️ Card Sets", value:
          "`/set_hub` — browse every set, see which one is active, and check your completion\n" +
          "Click any set in the panel for full details and progress." },
        { name: `✨ ${shiny} Cards`, value:
          `Every catch, pack pull, and trade-in has a **0.5%** chance to mint a ${shiny} card — tracked separately and worth more on burn.` },
      );
  },

  // ── Economy ──────────────────────────────────────────────────────────────────
  economy: (e) => {
    e.setTitle("💠 Economy & Packs")
      .setDescription("Earn and spend **DN Shards** — the currency behind everything." + NAV_HINT)
      .addFields(
        { name: "💰 Earn Shards", value:
          "`/daily` — free shards daily (streak bonus grows the payout)\n" +
          "`/burn name:<card> [amount] [all] [shiny:true]` — destroy duplicates for 💠\n" +
          "`/shards [user]` — check a balance\n" +
          "Also earned from achievements, quests, battles, and trade-ins." },
        { name: "📦 Packs", value:
          "`/pack tier:<basic|premium|legendary>` — open a 5-card pack\n" +
          "🥉 Basic 250 💠 · 🥈 Premium 750 💠 · 🥇 Legendary 2,000 💠 (no commons)\n" +
          "`/pack_stats` — your costs, weekly caps & cooldown\n" +
          "Tiers share one cooldown but each has its **own weekly cap** (resets Mon 00:00 UTC)." },
        { name: "♻️ Trade-In", value:
          "`/trade_in rarity:<r>` — burn **5** of one rarity to roll **1** of the next tier up." },
        { name: "🎁 Gifting", value:
          "`/gift user:@Member amount:<n>` — send shards to a friend." },
      );
  },

  // ── Trading & Market ─────────────────────────────────────────────────────────
  trade: (e) => {
    e.setTitle("🔄 Trading & Marketplace")
      .setDescription("Move cards between players — directly, or on the open market." + NAV_HINT)
      .addFields(
        { name: "🤝 Direct Trades", value:
          "`/trade user:@Member offer:<card> want:<card>` — propose a trade\n" +
          "Add `offer_shards:<n>` / `want_shards:<n>` to mix in 💠 (or trade pure shards)\n" +
          "`/trades` — pending offers · `/trade_history [user]`\n" +
          "`/accept id:<n>` · `/decline id:<n>` (or use the buttons on the offer)\n" +
          "Deals over **3:1** in value show an orange ⚠️ fairness warning (informational)." },
        { name: "📌 Wishlist", value:
          "`/wishlist add name:<card>` — get pinged when it spawns\n" +
          "`/wishlist remove name:<card>` · `/wishlist list [user]`" },
        { name: "🏪 Marketplace", value:
          "`/market sell name:<card> price:<n> [hours:<n>] [buyout:<n>]` — fixed sale or timed auction\n" +
          "`/market browse [seller] [kind]` — see active listings\n" +
          "`/market buy id:<n>` — buy a listing (or auction buyout)\n" +
          "`/market bid id:<n> amount:<n>` — bid on an auction\n" +
          "`/market cancel id:<n>` · `/market mine` — manage your listings & bids" },
      );
  },

  // ── Battles / Raids / Squads ─────────────────────────────────────────────────
  battle: (e) => {
    e.setTitle("⚔️ Battles, Raids & Squads")
      .setDescription("Put your cards to work — 1v1 duels, co-op boss raids, and team play." + NAV_HINT)
      .addFields(
        { name: "⚔️ Card Battles", value:
          "`/battle fight [opponent]` — challenge a player, or leave empty to fight the AI\n" +
          "`/battle profile [user]` — record, rank & stats\n" +
          "`/battle leaderboard [scope] [sort]` — rankings (guild or global)\n" +
          "`/battle achievements [user]` — battle badges\n" +
          "`/battle daily` — today's battle challenges & progress" },
        { name: "🐉 Co-op Boss Raids", value:
          "`/raid bosses` — list the raid bosses on this server\n" +
          "`/raid start boss:<name>` — open a raid lobby; teammates **Join**, pick a card, and fight a shared-HP boss together\n" +
          "Clear it for shards + card XP. Bosses are admin-created." },
        { name: "🤝 Squads", value:
          "`/squad create name:<…> [tag] [description]` — found a squad\n" +
          "`/squad join name:<…>` · `/squad leave` · `/squad disband`\n" +
          "`/squad info [name]` — combined stats & roster · `/squad list` — squad leaderboard" },
      );
  },

  // ── Giveaways ────────────────────────────────────────────────────────────────
  giveaway: (e) => {
    e.setTitle("🎉 Giveaways")
      .setDescription("Win prizes by playing. Admins post giveaways; you earn chances through real activity." + NAV_HINT)
      .addFields(
        { name: "👀 See & Track", value:
          "`/giveaways` — active giveaways: prizes, live countdown, requirements & your standing\n" +
          "`/giveaway progress [id]` — your per-requirement progress and 🎟️ entries" },
        { name: "🎟️ How Entering Works", value:
          "Most giveaways track **activity** — catching cards, winning battles, opening packs, joining raids, chatting, and more count automatically toward the requirements.\n" +
          "**Entry mode:** more activity = more entries = better odds.\n" +
          "**Completion mode:** finish every requirement to qualify.\n" +
          "Open giveaways have an **Enter** button instead." },
        { name: "🎁 Claiming", value:
          "When a giveaway ends, its message updates with the winners and a **Claim Prize** button. Winners click to receive DN Cards prizes automatically (cards/packs/shards); community prizes are handed off by an admin. Claim before the timer runs out or it rerolls!" },
      );
  },

  // ── Quests & Reputation ──────────────────────────────────────────────────────
  quests: (e) => {
    e.setTitle("🎯 Quests & Reputation")
      .setDescription("Extra goals and community standing layered on top of everyday play." + NAV_HINT)
      .addFields(
        { name: "🎯 Quests", value:
          "`/quests` — your **daily** and **weekly** objectives (catch, open packs, trade, battle, burn, claim daily).\n" +
          "Progress tracks automatically as you play; complete them for 💠 shards and the occasional free pack." },
        { name: "⭐ Reputation", value:
          "`/rep give @user` — give someone +1 rep\n" +
          "`/rep check [@user]` — see a rep score · `/rep top` — leaderboard" },
        { name: "🙏 Thanks", value:
          "`/thanks give @user` — thank a helpful member\n" +
          "`/thanks top` — most-appreciated leaderboard" },
      );
  },

  // ── Echo & AFK ────────────────────────────────────────────────────────────────
  social: (e) => {
    e.setTitle("🔊 Echo Messages & AFK")
      .setDescription("Encrypted whispers and away-status tools." + NAV_HINT)
      .addFields(
        { name: "🔐 Echo-Whisper", value:
          "`/whisper user:@Member` — send an encrypted message only that member can reveal\n" +
          "`/admin_secret` — post an encrypted staff message only authorized roles can reveal\n" +
          "Recipients click **🔐 View** to decrypt — nobody else can read it." },
        { name: "💤 AFK Secretary", value:
          "`/afk [message] [duration]` — set an away status; the bot replies for you when you're pinged and clears it when you're back\n" +
          "`/afk_setup` — (admin) configure the AFK Secretary for the server" },
      );
  },

  // ── Bob ─────────────────────────────────────────────────────────────────────
  bob: (e) => {
    e.setTitle("🤖 Bob — Games & Chaos")
      .setDescription("Bob is the server's chaotic entertainment NPC. His own coins 🪙, his own games, his own moods. Rarely he turns 🔵 **Blue** (evil, double rewards) or 🙃 **Upside-Down** (glitched, weird). Separate from cards — just for fun." + NAV_HINT)
      .addFields(
        { name: "🎛️ Start Here", value:
          "`/bob` — the interactive hub: Games, Roast, Tasks, Quests, Rewards, Talk, Stats" },
        { name: "🔫 Roulette & Duels", value:
          "`/bob_roulette` — survive the chamber for coins + a survival streak\n" +
          "`/bob_duel user:@member` — challenge someone; first BANG loses" },
        { name: "🎲 Mini-Games & Talk", value:
          "Coin Flip · Dice · Higher/Lower · Slots · Lucky Wheel · Guess the Emoji (all in `/bob`)\n" +
          "`/bob_roast user:@member` — get roasted · `/bob_talk [message]` — chat with Bob" },
        { name: "📊 Progress", value:
          "`/bob_stats [user]` — your coins, luck %, streaks & records\n" +
          "`/bob_leaderboard` — richest, most wins, best streaks, biggest gamblers & more\n" +
          "Daily tasks + long-term quests hand out coins, XP and titles as you play." },
      );
  },

  // ── Admin ─────────────────────────────────────────────────────────────────────
  admin: (e, { site }) => {
    e.setTitle("🛠️ Admin Toolbox")
      .setDescription("Setup, configuration, and management. Most live under `/admin` (and prefix `!` commands for setup)." + NAV_HINT)
      .addFields(
        { name: "🚀 First-Time Setup", value:
          "`/setup` — interactive setup wizard (spawn channel, interval, catch mode, roster)\n" +
          "`/config` — visual config panel · `/admin_hub` — admins, timeouts, channels, state\n" +
          "`/dashboard` — DM yourself a website login link · `/admin_help` — full admin reference" },
        { name: "🎁 Drops, Gives & Events", value:
          "`/drop [name]` · `/mass_drop [amount]`\n" +
          "`/give` / `takeback` (cards) · `/give_shards` / `takeshards`\n" +
          "`/event start card:<…> duration:<…> [multiplier]` · `/event list` · `/event stop id:<…>`" },
        { name: "🗂️ Cards & Sets", value:
          "`/set_hub` — clickable set manager · `/set_admin …` — typed set commands\n" +
          "`!addcard` / `!editcard <Name>` / `!import` — card creation & editing (prefix commands)\n" +
          "`/rarity …` — rarity names, colors, worth, burn, weights" },
        { name: "🎨 Appearance & Embeds", value:
          "`/embed set key:<embed> field:<field> value:<v>` — customize any embed (incl. **key:help** to rebrand this guide)\n" +
          "`/rarityname …` — rename/recolor the Mythic tier" },
        { name: "⚔️ Feature Admin", value:
          "`/battle_admin` — battle system hub (setup, rules, rewards, seasons)\n" +
          "`/raid_admin create|edit|list|enable|delete` — co-op raid bosses\n" +
          "`/giveaway_admin create|edit|end|winners|list|reroll` — run giveaways\n" +
          "`/bob_admin` — configure Bob (toggles, odds, rewards, cooldown, event channels)\n" +
          "`/echo …` — Echo-Whisper viewer roles, override & stats" },
        { name: "🌐 Website", value: `Public: **[${site}](${site})** · Admin dashboard: run \`/dashboard\` for your login link.` },
      );
  },
};

// ── Admin check ──────────────────────────────────────────────────────────────
async function memberIsAdmin(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
): Promise<boolean> {
  const member = interaction.member as GuildMember | null;
  if (member && "permissions" in member && typeof member.permissions !== "string" &&
      member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.guild && interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.guildId) return isDbAdmin(interaction.guildId, interaction.user.id).catch(() => false);
  return false;
}
