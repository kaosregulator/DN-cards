// Logging Engine — posts battle outcomes to the guild's configured log channel.
//
// Best-effort and non-blocking: failures never affect the battle. The channel
// id comes from battle_settings.logChannelId (set in the admin hub / wizard).

import { EmbedBuilder, AttachmentBuilder, type Client, type TextChannel } from "discord.js";
import { logger } from "../../lib/logger.js";
import { getBattleSettings } from "./config-engine.js";

export async function logBattleResult(
  client: Client, guildId: string, embed: EmbedBuilder,
  image?: { buffer: Buffer; name: string },
): Promise<void> {
  try {
    const settings = await getBattleSettings(guildId);
    if (!settings.logChannelId) return;
    const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    // Re-attach the image here (attachments can't be shared across messages), so
    // an embed that references attachment://<name> resolves in the log channel.
    const files = image ? [new AttachmentBuilder(image.buffer, { name: image.name })] : [];
    await (channel as TextChannel).send({ embeds: [embed], files }).catch(() => {});
  } catch (err) {
    logger.debug({ err, guildId }, "battle log post failed (non-fatal)");
  }
}
