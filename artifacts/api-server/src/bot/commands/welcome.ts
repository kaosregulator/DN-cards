import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { applyEmbedOverride } from "../embed-overrides.js";

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
      "**🏅 Achievements** — 10 unlockables auto-trigger on milestones (first catch, 7-day streak, etc.) " +
      "and pay shards. See yours with `/achievements`.",
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
