import {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  getGlobalServerRanking, sortByMetric, cacheGuildName, setServerOptOut,
  type RankMetric, type ServerRankRow,
} from "./store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Server-vs-server global leaderboard.
//
//   /serverrank top [metric]   (user)  — ranks whole servers against each other
//   /serverrank visibility     (admin) — hide/show THIS server on the board
//
// Only coarse server-level totals are compared (shards, packs, trades won,
// battles won) — never per-player card/rarity data. The whole point is to give
// each community a reason to push their SERVER up the global board.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = 0xf1c40f;
const METRIC_LABEL: Record<RankMetric, string> = {
  power: "🏆 Power Score",
  shards: "💠 Total Shards",
  packs: "🎴 Packs Opened",
  battles: "⚔️ Battles Won",
  trades: "🤝 Trades Won",
};

export function buildServerRankCommandJson() {
  return new SlashCommandBuilder()
    .setName("serverrank")
    .setDescription("Global leaderboard — how this server stacks up against every other DN Cards server")
    .setDMPermission(false)
    .addSubcommand(sc => sc
      .setName("top")
      .setDescription("Show the global server-vs-server leaderboard")
      .addStringOption(o => o
        .setName("metric")
        .setDescription("Which stat to rank by (default: overall Power Score)")
        .addChoices(
          { name: "🏆 Power Score (overall)", value: "power" },
          { name: "💠 Total Shards", value: "shards" },
          { name: "🎴 Packs Opened", value: "packs" },
          { name: "⚔️ Battles Won", value: "battles" },
          { name: "🤝 Trades Won", value: "trades" },
        )))
    .addSubcommand(sc => sc
      .setName("visibility")
      .setDescription("(Admin) Show or hide this server on the global leaderboard")
      .addBooleanOption(o => o
        .setName("hidden")
        .setDescription("True = hide this server from the global board")
        .setRequired(true)))
    .toJSON();
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function lineFor(rank: number, r: ServerRankRow, metric: RankMetric, isHere: boolean): string {
  const medals = ["🥇", "🥈", "🥉"];
  const prefix = medals[rank - 1] ?? `**#${rank}**`;
  const name = r.guildName ?? "Unknown server";
  const here = isHere ? " ⬅️ **you**" : "";
  let metricStr: string;
  switch (metric) {
    case "shards": metricStr = `${fmt(r.totalShards)} 💠`; break;
    case "packs": metricStr = `${fmt(r.packsOpened)} packs`; break;
    case "battles": metricStr = `${fmt(r.battlesWon)} wins`; break;
    case "trades": metricStr = `${fmt(r.tradesWon)} trades`; break;
    default: metricStr = `${fmt(r.score)} pts`; break;
  }
  return `${prefix} **${name}** — ${metricStr}${here}`;
}

export async function handleServerRankCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guild.id;

  if (sub === "visibility") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      await interaction.editReply("❌ Only admins can change this server's leaderboard visibility.");
      return;
    }
    const hidden = interaction.options.getBoolean("hidden", true);
    await setServerOptOut(guildId, hidden);
    await interaction.editReply(
      hidden
        ? "🙈 This server is now **hidden** from the global leaderboard."
        : "🌍 This server is now **visible** on the global leaderboard.",
    );
    return;
  }

  // sub === "top" — public so servers can flex their standing.
  await interaction.deferReply();
  const metric = (interaction.options.getString("metric") as RankMetric | null) ?? "power";

  // Refresh this guild's cached display name so it's always current on the board.
  await cacheGuildName(guildId, interaction.guild.name).catch(() => { /* ignore */ });

  let rows = await getGlobalServerRanking();
  // Backfill display names for any guilds the bot can currently see.
  for (const r of rows) {
    if (!r.guildName) {
      const g = interaction.client.guilds.cache.get(r.guildId);
      if (g) r.guildName = g.name;
    }
  }

  rows = sortByMetric(rows, metric);

  if (rows.length === 0) {
    await interaction.editReply("No servers have any activity yet — be the first to put yours on the board!");
    return;
  }

  const top = rows.slice(0, 10);
  const myIndex = rows.findIndex(r => r.guildId === guildId);
  const lines = top.map((r, i) => lineFor(i + 1, r, metric, r.guildId === guildId));

  // If this server isn't in the top 10, append its own standing.
  if (myIndex >= 10) {
    lines.push("…");
    lines.push(lineFor(myIndex + 1, rows[myIndex], metric, true));
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🌍 Global Server Leaderboard")
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `Ranked by ${METRIC_LABEL[metric].replace(/^[^ ]+ /, "")} · ${rows.length} server${rows.length === 1 ? "" : "s"} competing`,
    })
    .setTimestamp();

  // Show this server's full stat breakdown as a field.
  if (myIndex >= 0) {
    const me = rows[myIndex];
    embed.addFields({
      name: `📊 ${me.guildName ?? interaction.guild.name} — your stats`,
      value:
        `🏆 Power **${fmt(me.score)}** · #${myIndex + 1} overall\n` +
        `💠 ${fmt(me.totalShards)} shards · 🎴 ${fmt(me.packsOpened)} packs · ` +
        `⚔️ ${fmt(me.battlesWon)} battle wins · 🤝 ${fmt(me.tradesWon)} trades`,
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
