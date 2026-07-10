// Prize fulfilment. DN Cards prizes ride the EXISTING economy so a giveaway
// win mints real cards / packs / shards into the winner's account exactly like
// normal gameplay. Community prizes (Nitro / custom) can't be auto-granted, so
// they produce a receipt line for the admin to hand off; role prizes are
// applied directly when the bot can manage the role.

import type { GiveawayPrize } from "@workspace/db";
import type { Guild } from "discord.js";
import { addShards } from "../db.js";
import { grantFreePack } from "../battle/pack-grant.js";
import { logger } from "../../lib/logger.js";

export interface GrantResult {
  // Lines describing what the winner received (auto-fulfilled).
  granted: string[];
  // Lines for prizes an admin must hand off manually.
  manual: string[];
}

export async function grantPrizes(
  guild: Guild, userId: string, prizes: GiveawayPrize[],
): Promise<GrantResult> {
  const granted: string[] = [];
  const manual: string[] = [];

  for (const p of prizes) {
    try {
      switch (p.type) {
        case "shards": {
          const amount = p.qty ?? 0;
          if (amount > 0) {
            await addShards(guild.id, userId, amount);
            granted.push(`💠 ${amount.toLocaleString()} DN Shards`);
          }
          break;
        }
        case "pack": {
          const count = Math.max(1, p.qty ?? 1);
          const tier = p.packTier ?? "basic";
          for (let i = 0; i < count; i++) await grantFreePack(guild.id, userId, tier);
          granted.push(`📦 ${count}× ${tier} pack`);
          break;
        }
        case "cards": {
          const count = Math.max(1, p.qty ?? 1);
          if (p.cardId) {
            // Reuse the real acquisition path so the card is minted into the
            // winner's collection just like a caught card. Never mutates the
            // original card definition.
            const { catchCard } = await import("../db.js");
            for (let i = 0; i < count; i++) await catchCard(guild.id, userId, p.cardId, { noShiny: true });
            granted.push(`🃏 ${count}× ${p.cardName ?? `Card #${p.cardId}`}`);
          } else {
            // No specific card selected — leave to admin (e.g. "10 Legendary Cards").
            manual.push(`🃏 ${p.label}`);
          }
          break;
        }
        case "role": {
          if (p.roleId) {
            const member = await guild.members.fetch(userId).catch(() => null);
            const role = guild.roles.cache.get(p.roleId) ?? await guild.roles.fetch(p.roleId).catch(() => null);
            if (member && role) {
              await member.roles.add(role).catch(() => { manual.push(`🎭 ${p.label} (couldn't assign automatically)`); });
              granted.push(`🎭 ${role.name}`);
            } else {
              manual.push(`🎭 ${p.label}`);
            }
          } else {
            manual.push(`🎭 ${p.label}`);
          }
          break;
        }
        case "nitro":
        case "custom":
        default:
          manual.push(`${p.emoji ?? "🎁"} ${p.label}`);
          break;
      }
    } catch (err) {
      logger.warn({ err, prize: p }, "grantPrizes: prize fulfilment failed");
      manual.push(`${p.emoji ?? "🎁"} ${p.label}`);
    }
  }
  return { granted, manual };
}
