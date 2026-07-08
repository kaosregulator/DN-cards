// Logging Engine — posts battle outcomes to the guild's configured log channel.
//
// Best-effort and non-blocking: failures never affect the battle. The channel
// id comes from battle_settings.logChannelId (set in the admin hub / wizard).

import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { logger } from "../../lib/logger.js";
import { getBattleSettings } from "./config-engine.js";

export async function logBattleResult(
  client: Client, guildId: string, embed: EmbedBuilder,
): Promise<void> {
  try {
    const settings = await getBattleSettings(guildId);
    if (!settings.logChannelId) return;
    const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    await (channel as TextChannel).send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    logger.debug({ err, guildId }, "battle log post failed (non-fatal)");
  }
}
