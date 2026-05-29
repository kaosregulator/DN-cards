import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  createCardEvent, listActiveCardEvents, stopCardEvent,
  getCardByName, getOrCreateGuildSettings,
} from "../db.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity, rarityLabel, rarityEmoji } from "../cards-data.js";
import { getRarityDisplayOverrides } from "../db.js";

// Accepts compact durations: "30m", "2h", "1d". Returns ms or null on parse fail.
// Capped at 14 days so a typo doesn't pin a card on the boost board forever.
const MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
function parseDuration(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^(\d+)\s*([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!;
  const mul = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const ms = n * mul;
  return ms > MAX_DURATION_MS ? null : ms;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  if (h < 24) return mr > 0 ? `${h}h ${mr}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr > 0 ? `${d}d ${hr}h` : `${d}d`;
}

// Best-effort announcement in the configured spawn channel. Silently no-ops
// if there's no spawn channel or we can't post — the command's reply still
// confirms the change to the admin.
async function announce(
  interaction: ChatInputCommandInteraction, content: string,
): Promise<void> {
  if (!interaction.guild) return;
  try {
    const settings = await getOrCreateGuildSettings(interaction.guild.id);
    if (!settings.spawnChannelId) return;
    const channel = interaction.guild.channels.cache.get(settings.spawnChannelId) as TextChannel | undefined;
    if (!channel) return;
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch {
    // ignore — announcement is non-essential
  }
}

// Caller (admin.ts) must defer the reply ephemerally BEFORE invoking this so
// the admin permission check happens uniformly with other admin commands.
export async function handleEventCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  // ── /event start ─────────────────────────────────────────────────────────
  if (sub === "start") {
    const cardName = interaction.options.getString("card", true);
    const durationStr = interaction.options.getString("duration", true);
    const multiplier = interaction.options.getNumber("multiplier") ?? 2;

    if (multiplier < 1.1 || multiplier > 50) {
      await interaction.editReply("❌ Multiplier must be between 1.1 and 50.");
      return;
    }
    const ms = parseDuration(durationStr);
    if (ms == null) {
      await interaction.editReply(
        "❌ Invalid duration. Use a number + unit, e.g. `30m`, `2h`, `1d` (max 14d).",
      );
      return;
    }

    const card = await getCardByName(cardName);
    if (!card) {
      await interaction.editReply(`❌ Card "**${cardName}**" not found.`);
      return;
    }
    if (!card.droppable || card.isArchived) {
      await interaction.editReply(
        `❌ **${card.name}** isn't currently droppable — boosting it would have no effect.`,
      );
      return;
    }

    // Warn (but don't block) if the card isn't in the active spawn set —
    // the boost will silently no-op because random spawns only pull from
    // active-set members.
    let setWarning = "";
    try {
      const { getActiveSet, isCardInSet } = await import("../db.js");
      const active = await getActiveSet(guildId);
      if (!active) {
        setWarning = `\n⚠️ **No active set is selected**, so random spawns are disabled and this event will have no effect until you set one with \`/setadmin active\`.`;
      } else if (!(await isCardInSet(active.id, card.id))) {
        setWarning = `\n⚠️ **${card.name}** isn't in the active set \`${active.name}\`, so the boost won't fire on random spawns. Add it with \`/setadmin add set:${active.name} card:${card.name}\`.`;
      }
    } catch { /* non-fatal — skip warn */ }

    const endsAt = new Date(Date.now() + ms);
    const event = await createCardEvent({
      guildId, cardId: card.id, weightMultiplier: multiplier,
      endsAt, createdBy: interaction.user.id,
    });

    const r = card.rarity as Rarity;
    const displayMap = await getRarityDisplayOverrides(guildId);
    const rLabel = rarityLabel(r, null, displayMap);
    const rEmoji = rarityEmoji(r, null, displayMap);
    await interaction.editReply(
      `✅ Started event **#${event.id}** — ${rEmoji} **${card.name}** spawns at ` +
      `**${multiplier.toFixed(1)}×** weight for **${formatRemaining(ms)}** ` +
      `(ends <t:${Math.floor(endsAt.getTime() / 1000)}:R>).` + setWarning,
    );

    await announce(
      interaction,
      `🎉 **Limited-Time Event!** ${rEmoji} **${card.name}** ` +
      `(${rLabel}) is spawning **${multiplier.toFixed(1)}× more often** ` +
      `for the next **${formatRemaining(ms)}** — ends <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`,
    );
    return;
  }

  // ── /event list ──────────────────────────────────────────────────────────
  if (sub === "list") {
    const events = await listActiveCardEvents(guildId);
    if (events.length === 0) {
      await interaction.editReply("📭 No active events right now. Start one with `/event start`.");
      return;
    }
    const lines = events.map(e => {
      const remain = formatRemaining(e.endsAt.getTime() - Date.now());
      return `\`#${e.id}\` **${e.cardName}** — ${e.weightMultiplier.toFixed(1)}× · ` +
        `ends <t:${Math.floor(e.endsAt.getTime() / 1000)}:R> *(${remain})*`;
    });
    const embed = new EmbedBuilder()
      .setTitle("🎉 Active Card Events")
      .setColor(0xe84393)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Stop one with /event stop id:<ID>" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /event stop ──────────────────────────────────────────────────────────
  if (sub === "stop") {
    const id = interaction.options.getInteger("id", true);
    const stopped = await stopCardEvent(guildId, id);
    if (!stopped) {
      await interaction.editReply(
        `❌ Event **#${id}** isn't active in this server (or was already stopped).`,
      );
      return;
    }
    await interaction.editReply(
      `✅ Stopped event **#${id}** — **${stopped.cardName}** is back to normal drop rate.`,
    );
    await announce(interaction, `🛑 The **${stopped.cardName}** event has ended.`);
    return;
  }

  await interaction.editReply("❌ Unknown event subcommand.");
}
