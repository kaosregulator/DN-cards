// UnbelievaBoat cash helpers — spend from cash first, then bank if needed.
// Payouts always land in cash (matches UnbelievaBoat income behaviour).

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

export type SpendBreakdown = {
  fromCash: number;
  fromBank: number;
  balance: UbUserBalance & { symbol: string };
};

/**
 * Spend `amount` using wallet cash first, then bank. Throws if total is short.
 * Returns how much came from each pocket.
 */
export async function spendFunds(
  guildId: string,
  userId: string,
  amount: number,
  reason: string,
): Promise<SpendBreakdown> {
  if (amount <= 0) throw new CashError("Amount must be positive.");
  const { ubGuildId, symbol } = await requireEconomy(guildId);
  const bal = await ubApi.getUserBalance(ubGuildId, userId);
  const cash = bal.cash ?? 0;
  const bank = bal.bank ?? 0;
  const total = cash + bank;
  if (total < amount) {
    throw new CashError(
      `Not enough UnbelievaBoat funds. Need **${fmtCash(amount)}** ${symbol}, ` +
      `have **${fmtCash(cash)}** cash + **${fmtCash(bank)}** bank = **${fmtCash(total)}**.`,
    );
  }
  const fromCash = Math.min(cash, amount);
  const fromBank = amount - fromCash;
  const patch: { cash?: number; bank?: number; reason: string } = { reason };
  if (fromCash > 0) patch.cash = -fromCash;
  if (fromBank > 0) patch.bank = -fromBank;
  const next = await ubApi.patchUserBalance(ubGuildId, userId, patch);
  return { fromCash, fromBank, balance: { ...next, symbol } };
}

/** @deprecated Prefer spendFunds — kept for call sites that only meant cash. */
export async function spendCash(
  guildId: string,
  userId: string,
  amount: number,
  reason: string,
): Promise<UbUserBalance & { symbol: string }> {
  const r = await spendFunds(guildId, userId, amount, reason);
  return r.balance;
}

/** Credit cash (not bank). */
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

export function formatSpendNote(fromCash: number, fromBank: number, symbol: string): string {
  if (fromBank <= 0) return `Paid **${fmtCash(fromCash)}** ${symbol} from cash`;
  if (fromCash <= 0) return `Paid **${fmtCash(fromBank)}** ${symbol} from bank`;
  return `Paid **${fmtCash(fromCash)}** cash + **${fmtCash(fromBank)}** bank ${symbol}`;
}
