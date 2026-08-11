// The joke "battle menu" for the wild-encounter opener. The player is shown a
// few shuffled options — every one FAILS with a funny line, then the real
// mini-game begins. Pure flavour; the outcome is always "the card is still wild".

export const MENU_OPTIONS: string[] = [
  "PET THE CARD", "ASK NICELY", "THROW SHARDS AT IT", "POCKET THE CARD", "SCREAM",
  "RUN IN CIRCLES", "BLUFF", "OFFER IT A SNACK", "CALL YOUR MOM",
  "PRETEND YOU DIDN'T SEE IT", "STARE AT IT", "THROW A CARD AT IT",
  "YELL “YOU'RE MINE!”", "BRIBE THE CARD", "INTIMIDATE IT", "DO A BACKFLIP",
  "PANIC", "TACTICAL RETREAT", "SEND IT A DM", "ASK FOR ITS AUTOGRAPH",
];

// Negative-result tails; one is picked at random and appended to the action.
const FAIL_TAILS: readonly string[] = [
  "…it wasn't impressed. 😐",
  "…nothing happened. It just stared.",
  "…it dodged effortlessly.",
  "…that only made it angrier.",
  "…it rolled its eyes at you.",
  "…the card remained completely unbothered.",
  "…and somehow you look more foolish now.",
  "…it let out an unimpressed sigh.",
  "…it's still wild. Nice try.",
  "…that was NOT the move.",
];

export interface MenuChoice { action: string; label: string; }

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

// Four shuffled options. action encodes the option's label index so the click
// handler can look the label back up.
export function pickMenu(): MenuChoice[] {
  const idx = shuffle(MENU_OPTIONS.map((_, i) => i)).slice(0, 4);
  return idx.map(i => ({ action: `menu:${i}`, label: MENU_OPTIONS[i]! }));
}

export function labelForAction(action: string): string {
  const i = Number(action.split(":")[1]);
  return MENU_OPTIONS[i] ?? "DO SOMETHING";
}

export function menuQuip(label: string, cardName: string): string {
  const tail = FAIL_TAILS[Math.floor(Math.random() * FAIL_TAILS.length)]!;
  return `You tried to **${label}** ${tail}\n\nThe wild **${cardName}** won't go down that easy — **engage it!**`;
}
