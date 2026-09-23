// UnbelievaBoat cash helpers for games & store — always talk to the live API.
// Unlike pets soft-free mode, economy games require a configured token + link.

import { isUbConfigured, ubApi, type UbUserBalance } from "../../lib/unbelievaboat/client.js";
import { getOrCreateUbSettings } from "../../lib/unbelievaboat/db.js";
import { currencyLabel } from "./branding.js";

export class CashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashError";
  }
}

export async function requireEconomy(guildId: string): Promise<{ ubGuildId: string; symbol: string }> {
  if (!isUbConfigured()) {
    throw new CashError("UnbelievaBoat API token is not configured (set `UNBELIEVABOAT_TOKEN`).");
  }
  const settings = await getOrCreateUbSettings(guildId);
  if (!settings.enabled) {
    throw new CashError("UnbelievaBoat link is disabled — ask an admin to enable it in `/unbelievaboat`.");
  }
  const ubGuildId = settings.ubGuildId || guildId;
  let symbol = settings.currencyLabel ?? "";
  try {
    const g = await ubApi.getGuild(ubGuildId);
    if (!symbol) symbol = g.symbol || "";
  } catch {
    /* symbol optional */
  }
  return { ubGuildId, symbol: currencyLabel(symbol) };
}

export async function getCashBalance(guildId: string, userId: string): Promise<UbUserBalance & { symbol: string }> {
  const { ubGuildId, symbol } = await requireEconomy(guildId);
  const bal = await ubApi.getUserBalance(ubGuildId, userId);
  return { ...bal, symbol };
}

export async function spendCash(
  guildId: string,
  userId: string,
  amount: number,
  reason: string,
): Promise<UbUserBalance & { symbol: string }> {
  if (amount <= 0) throw new CashError("Amount must be positive.");
  const { ubGuildId, symbol } = await requireEconomy(guildId);
  const bal = await ubApi.getUserBalance(ubGuildId, userId);
  if ((bal.cash ?? 0) < amount) {
    throw new CashError(`Not enough UnbelievaBoat cash. Need **${amount}** ${symbol}, have **${bal.cash ?? 0}**.`);
  }
  const next = await ubApi.patchUserBalance(ubGuildId, userId, { cash: -amount, reason });
  return { ...next, symbol };
}

export async function earnCash(
  guildId: string,
  userId: string,
  amount: number,
  reason: string,
): Promise<UbUserBalance & { symbol: string }> {
  if (amount <= 0) throw new CashError("Amount must be positive.");
  const { ubGuildId, symbol } = await requireEconomy(guildId);
  const next = await ubApi.patchUserBalance(ubGuildId, userId, { cash: amount, reason });
  return { ...next, symbol };
}

export function fmtCash(n: number): string {
  return new Intl.NumberFormat().format(Math.trunc(n));
}
