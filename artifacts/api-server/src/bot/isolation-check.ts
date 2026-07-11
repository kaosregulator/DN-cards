/**
 * isolation-check.ts — Boot-time cross-server data-isolation canary
 *
 * ⚠️ REPLIT SAFETY REVIEW — READ THIS ⚠️
 * Cards are per-server (cards.guild_id). This bot MUST NEVER let one Discord
 * server read, spawn, or delete another server's cards. The code paths are
 * hardened (see db.ts getAllCards / cardVisibilityFilter — no guildId → no
 * rows), but data on disk can still drift. This self-check runs ONCE at boot
 * and shouts in the logs (grep for `[ISOLATION]` / `[REPLIT]`) if it spots any
 * of these danger signs, so a human notices BEFORE players do:
 *
 *   1. Cards with a NULL/empty guild_id — an un-owned card is visible to no one
 *      under the strict filter, and is a symptom of a bad insert/migration.
 *   2. The HOME server's card count dropping below a floor — the classic
 *      "someone mass-deleted the 120 default cards" disaster. Tune the floor
 *      with ISOLATION_HOME_CARD_FLOOR (default 50).
 *   3. Collection/progress rows that point at a card owned by a DIFFERENT
 *      guild — a cross-tenant contamination that should be impossible.
 *
 * This check is READ-ONLY. It never mutates data — it only reports. If it ever
 * fires, investigate; do not assume it's a false alarm.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { HOME_GUILD_ID } from "./home-guild.js";

const HOME_CARD_FLOOR = Number(process.env["ISOLATION_HOME_CARD_FLOOR"] ?? "50");

type CountRow = { n: number };
function firstCount(res: unknown): number {
  const rows = (res as { rows?: Array<CountRow> }).rows ?? (res as Array<CountRow>);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? Number(row.n) : 0;
}

export async function runIsolationSelfCheck(): Promise<void> {
  try {
    // 1) Orphaned cards — null or empty guild_id.
    const orphaned = firstCount(await db.execute(
      sql`SELECT count(*)::int AS n FROM cards WHERE guild_id IS NULL OR guild_id = ''`,
    ));
    if (orphaned > 0) {
      logger.error(
        { orphanedCards: orphaned },
        `[ISOLATION][REPLIT] ${orphaned} card(s) have a NULL/empty guild_id. ` +
        "These are owned by no server and are invisible under the strict per-guild filter. " +
        "Investigate the insert/migration that created them before players notice missing cards.",
      );
    }

    // 2) Home-server card count floor — mass-delete canary.
    if (HOME_GUILD_ID) {
      const homeCards = firstCount(await db.execute(
        sql`SELECT count(*)::int AS n FROM cards WHERE guild_id = ${HOME_GUILD_ID}`,
      ));
      if (homeCards < HOME_CARD_FLOOR) {
        logger.error(
          { homeCards, floor: HOME_CARD_FLOOR, homeGuildId: HOME_GUILD_ID },
          `[ISOLATION][REPLIT] Home server has only ${homeCards} cards (floor ${HOME_CARD_FLOOR}). ` +
          "This can mean the default roster was mass-deleted or a bad restore ran. " +
          "If this is unexpected, STOP and check the DB before doing anything else. " +
          "(Adjust the floor with ISOLATION_HOME_CARD_FLOOR if the drop is intentional.)",
        );
      } else {
        logger.info({ homeCards, homeGuildId: HOME_GUILD_ID }, "[ISOLATION] Home roster OK");
      }
    } else {
      logger.warn(
        "[ISOLATION][REPLIT] HOME_GUILD_ID is not set. The website/dashboard gate and the " +
        "home-roster canary both depend on it — set HOME_GUILD_ID to your main server's ID.",
      );
    }

    // 3) Collection rows pointing at a card owned by a DIFFERENT guild.
    const crossColl = firstCount(await db.execute(sql`
      SELECT count(*)::int AS n
      FROM collections col
      JOIN cards c ON c.id = col.card_id
      WHERE c.guild_id <> col.guild_id
    `));
    if (crossColl > 0) {
      logger.error(
        { crossGuildCollectionRows: crossColl },
        `[ISOLATION][REPLIT] ${crossColl} collection row(s) reference a card owned by a DIFFERENT server. ` +
        "This is cross-tenant contamination that should be impossible — a player in one server appears " +
        "to own another server's card. Investigate before it spreads (trades, net-worth, leaderboards).",
      );
    }

    if (orphaned === 0 && crossColl === 0) {
      logger.info("[ISOLATION] Cross-server isolation self-check passed (no orphaned cards, no cross-guild collections).");
    }
  } catch (err) {
    // Never let the canary crash boot — it's a diagnostic, not a gate.
    logger.error({ err }, "[ISOLATION] Isolation self-check failed to run (non-fatal).");
  }
}
