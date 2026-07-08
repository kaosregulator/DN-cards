import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Message, type GuildMember, type TextChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { getAfkSettings, getAfk } from "./models.js";
import {
  AFK_BRAND, AFK_EMOJI, GRACE_PERIOD_MS,
  canPostIntercept, registerDismissOwner, clearAfkForUser,
} from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// AFK Secretary — messageCreate hook.
//
// Two independent jobs on every guild message:
//   1. RETURN clear — if the author is AFK with the "on return" trigger and the
//      45-second grace window has elapsed, welcome them back.
//   2. Ping intercept — if the message pings anyone currently AFK, post the
//      Secretary embed (rate-limited per channel by the cross-fire guard).
//
// Non-consuming: this never returns "handled" and never blocks the host bot's
// prefix / card-catch pipeline. Wire it as a fire-and-forget call in
// index.ts's MessageCreate listener.
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAfkMessage(msg: Message): Promise<void> {
  if (msg.author.bot || !msg.guild) return;
  const guildId = msg.guild.id;

  // ── 1) RETURN grace calculator ─────────────────────────────────────────────
  await maybeClearOnReturn(msg, guildId).catch(err =>
    logger.debug({ err }, "AFK return-clear skipped"));

  // ── 2) Ping intercept ──────────────────────────────────────────────────────
  await maybeIntercept(msg, guildId).catch(err =>
    logger.debug({ err }, "AFK intercept skipped"));
}

/** Clears the author's AFK if they used the "on return" trigger and are past grace. */
async function maybeClearOnReturn(msg: Message, guildId: string): Promise<void> {
  const state = await getAfk(guildId, msg.author.id);
  if (!state || state.removalMethod !== "RETURN") return;

  // The Return Grace Period: ignore any message sent within 45s of going AFK so
  // a final "brb" doesn't instantly cancel the away state.
  const elapsed = Date.now() - state.startTime.getTime();
  if (elapsed < GRACE_PERIOD_MS) return;

  await clearAfkForUser(msg.client, guildId, msg.author.id, "RETURN");

  const welcome = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_SUCCESS)
    .setDescription(`${AFK_EMOJI.RETURN} Welcome back, <@${msg.author.id}> — your AFK is cleared.`)
    .setFooter({ text: AFK_BRAND.FOOTER });

  try {
    const reply = await msg.reply({ embeds: [welcome], allowedMentions: { repliedUser: false } });
    // Self-clean after 10s to keep the channel tidy.
    setTimeout(() => { reply.delete().catch(() => { /* already gone */ }); }, 10_000);
  } catch { /* channel perms — ignore */ }
}

/** Posts a single Secretary embed if the message pings an AFK member. */
async function maybeIntercept(msg: Message, guildId: string): Promise<void> {
  if (msg.mentions.users.size === 0) return;

  const settings = await getAfkSettings(guildId);
  if (!settings.secretaryEnabled) return;

  // Find the first pinged member who is actually AFK (self-pings ignored).
  let afkTarget: { id: string; member: GuildMember | null; state: Awaited<ReturnType<typeof getAfk>> } | null = null;
  for (const [id, user] of msg.mentions.users) {
    if (user.bot || id === msg.author.id) continue;
    const state = await getAfk(guildId, id);
    if (state) {
      const member = msg.guild!.members.cache.get(id) ?? await msg.guild!.members.fetch(id).catch(() => null);
      afkTarget = { id, member, state };
      break;
    }
  }
  if (!afkTarget || !afkTarget.state) return;

  // Cross-Fire Intercept Guard: at most one Secretary embed per channel per 10s.
  if (!canPostIntercept(msg.channel.id)) return;

  const { id, member, state } = afkTarget;
  const displayName = member?.displayName ?? msg.mentions.users.get(id)?.username ?? "That member";
  const awaySince = Math.floor(state.startTime.getTime() / 1000);
  const trigger =
    state.removalMethod === "RETURN" ? "when they next speak"
    : state.removalMethod === "STATUS" ? "when they come back online"
    : state.autoRemoveAt ? `<t:${Math.floor(state.autoRemoveAt.getTime() / 1000)}:R>` : "soon";

  const embed = new EmbedBuilder()
    .setColor(AFK_BRAND.COLOR_MUTED)
    .setAuthor({ name: `${displayName} is away`, iconURL: member?.displayAvatarURL() })
    .setDescription(
      `${AFK_EMOJI.PROFILE} <@${id}> is currently **AFK** and can't see your message right now.`,
    )
    .addFields(
      { name: "💬 Their note", value: `> ${state.reason}`, inline: false },
      // <t:…:R> renders relative to EACH viewer's local clock — timezone-safe.
      { name: "🕒 Away since", value: `<t:${awaySince}:R>`, inline: true },
      { name: "↩️ Returns", value: trigger, inline: true },
    )
    .setFooter({ text: AFK_BRAND.FOOTER })
    .setTimestamp();

  // pingerId (msg.author.id) is baked into the Dismiss customId so only the
  // first pinger may clear it during the ownership lock.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`afk:note:${id}`).setStyle(ButtonStyle.Primary).setEmoji(AFK_EMOJI.NOTE).setLabel("Leave a Note"),
    new ButtonBuilder().setCustomId(`afk:notify:${id}`).setStyle(ButtonStyle.Secondary).setEmoji(AFK_EMOJI.NOTIFY).setLabel("Notify Me"),
    new ButtonBuilder().setCustomId(`afk:profile:${id}`).setStyle(ButtonStyle.Secondary).setEmoji(AFK_EMOJI.PROFILE).setLabel("View Profile"),
    new ButtonBuilder().setCustomId(`afk:dismiss:${id}:${msg.author.id}`).setStyle(ButtonStyle.Danger).setEmoji(AFK_EMOJI.DISMISS).setLabel("Dismiss"),
  );

  try {
    const channel = msg.channel as TextChannel;
    const sent = await channel.send({ embeds: [embed], components: [row] });
    registerDismissOwner(sent.id, msg.author.id);
  } catch (err) {
    logger.debug({ err, channelId: msg.channel.id }, "AFK secretary embed send failed");
  }
}
