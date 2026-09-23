// UnbelievaBoat public branding — always spell the full name for players.
// Never surface the internal "UB" shorthand in Discord-facing copy.

export const UNBELIEVABOAT_BOT_ID = "292953664492929025";
export const UNBELIEVABOAT_ICON =
  `https://cdn.discordapp.com/avatars/${UNBELIEVABOAT_BOT_ID}/e81ffdbb910a3757b874a890b2a92740.webp?size=128`;
export const UNBELIEVABOAT_NAME = "UnbelievaBoat";
export const UNBELIEVABOAT_COLOR = 0xe91e8c;

export const UNBELIEVABOAT_AUTHOR = {
  name: UNBELIEVABOAT_NAME,
  iconURL: UNBELIEVABOAT_ICON,
} as const;

/** Webhook username Discord allows (no "discord"/"clyde"). */
export const UNBELIEVABOAT_WEBHOOK_USERNAME = "UnbelievaBoat";

export function currencyLabel(symbol: string | null | undefined, fallback = "💵"): string {
  const s = (symbol ?? "").trim();
  return s.length > 0 ? s : fallback;
}
