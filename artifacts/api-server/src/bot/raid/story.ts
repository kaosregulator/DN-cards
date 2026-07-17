// ─────────────────────────────────────────────────────────────────────────────
// Raid story scripts — the "you reached Boss Raids" gym-battle moment.
//
// Every boss gets a short, default opening script so raids FEEL like an earned
// milestone (Pokémon-gym energy) without any per-boss authoring. Lines are
// picked deterministically from template pools seeded by the boss id, so a
// given boss always greets the party the same way — it becomes "their" line —
// while future bosses/card sets automatically get a fitting script of their own.
// An admin-written boss `description` is woven in when present, never replaced.
// ─────────────────────────────────────────────────────────────────────────────

import type { RaidBoss } from "@workspace/db";

// Deterministic pick: same boss → same lines, no storage needed.
function pick<T>(pool: T[], seed: number, salt: number): T {
  return pool[Math.abs(seed * 31 + salt * 17) % pool.length]!;
}

// Arrival lines — the "you made it to the gym" beat.
const ARRIVALS = [
  "You've battled through the ranks... and the ground here feels different.",
  "The arena gates close behind you. There's no crowd — only the challenge ahead.",
  "Few collectors ever stand where you're standing now.",
  "Your cards brought you this far. Now they face what waits at the top.",
  "The air is heavy. Something enormous has been waiting for a worthy party.",
];

// Boss taunts by rarity tier — mythic bosses talk bigger than rare ones.
const TAUNTS: Record<string, string[]> = {
  mythic: [
    "“So the rumors were true. Someone actually made it here. Show me it wasn't luck.”",
    "“I have ended a hundred parties like yours. Make this one interesting.”",
    "“You bring cards to face ME? Bold. Futile — but bold.”",
  ],
  legendary: [
    "“Many challenge me. Few leave with their decks intact.”",
    "“You've earned the right to lose to me. Begin.”",
    "“Impressive climb. Shame it ends here.”",
  ],
  default: [
    "“Another party comes to test itself. Very well — attack together, or fall together.”",
    "“Strength brought you here. Only teamwork gets you out.”",
    "“Show me the bond between you and your cards.”",
  ],
};

// Closing coach line — sets up the co-op mechanic in one sentence.
const COACH = [
  "Fight as one — the boss punishes the weakest link.",
  "Coordinate your strikes. Nobody clears this alone.",
  "Shields up, timing tight — this is what the grind was for.",
  "One target. One party. One shot at glory.",
];

// Three discrete cutscene beats shown one-at-a-time before the VS screen, the
// last always landing on "Let the Raid Begin!". Deterministic per boss so a
// given boss's intro reads consistently.
export function buildRaidIntroBeats(boss: RaidBoss): string[] {
  const seed = boss.id;
  const taunts = TAUNTS[boss.rarity] ?? TAUNTS["default"]!;
  return [
    `🏟️ *${pick(ARRIVALS, seed, 1)}*`,
    boss.description
      ? `*${boss.description}*\n\n${pick(taunts, seed, 2)} — **${boss.name}**`
      : `${pick(taunts, seed, 2)} — **${boss.name}**`,
    `⚔️ **Let the Raid Begin!**\n*${pick(COACH, seed, 3)}*`,
  ];
}

// The lobby/intro script: arrival beat, boss taunt (or admin flavor), coach line.
export function buildRaidIntroScript(boss: RaidBoss): string {
  const seed = boss.id;
  const taunts = TAUNTS[boss.rarity] ?? TAUNTS["default"]!;
  const lines = [
    `🏟️ *${pick(ARRIVALS, seed, 1)}*`,
    boss.description ? `*${boss.description}*` : undefined,
    `${pick(taunts, seed, 2)} — **${boss.name}**`,
    `⚔️ *${pick(COACH, seed, 3)}*`,
  ].filter(Boolean);
  return lines.join("\n\n");
}

// Random pick: unlike `pick()` above, this shuffles every time it's called —
// used for end-of-raid beats so a party doesn't see the same victory/loss line
// on every run against the same boss.
function shuffle<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// Victory beat used on the clear screen, above the roster gallery. Shuffled
// (not per-boss deterministic) so every clear feels a little different.
export function buildRaidClearLine(boss: RaidBoss, remaining: number): string {
  const falls = [
    `**${boss.name}** falls. The arena goes silent.`,
    `**${boss.name}** crashes down — the party stands victorious.`,
    `It's over. **${boss.name}** has been defeated.`,
  ];
  const next = remaining > 0
    ? `One boss down — **${remaining}** still stand${remaining === 1 ? "s" : ""}. The climb continues.`
    : "Every boss on this server has a challenger to fear now.";
  return `${shuffle(falls)}\n${next}`;
}

// Loss beat used on the wipe/timeout screen, above the defeat canvas. Shuffled
// per-occurrence, same as the clear line above.
export function buildRaidWipeLine(boss: RaidBoss): string {
  const wipes = [
    `**${boss.name}** stands unchallenged. The party is down.`,
    `It's over — **${boss.name}** overwhelms the party.`,
    `The party falls. **${boss.name}** doesn't even look tired.`,
  ];
  return `${shuffle(wipes)}\nRegroup, level your cards, and try again.`;
}
