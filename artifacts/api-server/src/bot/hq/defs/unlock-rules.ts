// ─────────────────────────────────────────────────────────────────────────────
// HQ — declarative unlock rules.
//
// Every theme, room and decoration carries an `UnlockRule` describing what a
// player must accomplish in DN Cards to earn it. Rules are evaluated against a
// single `HqProgress` snapshot (built by bot/hq/engine.ts from the EXISTING
// systems — collection, battles, raids, achievements, daily streak). One
// evaluator; no per-item code, so new content is pure data.
// ─────────────────────────────────────────────────────────────────────────────

// A read-only snapshot of the player's progress across the systems HQ rewards.
// Assembled once per reconcile/render by the engine so rule evaluation touches
// no database.
export interface HqProgress {
  accountLevel: number;
  uniqueCards: number;
  totalCards: number;
  netWorth: number;
  shinyOwned: number;
  battleWins: number;
  raidBossesCleared: number;
  raidCampaignComplete: boolean;
  completedSets: number;
  dailyStreak: number;
  ownsLimited: boolean;
  achievementKeys: Set<string>;
}

export type UnlockRule =
  | { kind: "always" }
  | { kind: "accountLevel"; n: number }
  | { kind: "collectionUnique"; n: number }
  | { kind: "shinyOwned"; n: number }
  | { kind: "battleWins"; n: number }
  | { kind: "raidBoss" }        // any raid boss cleared
  | { kind: "raidCampaign" }    // the whole raid campaign complete
  | { kind: "setComplete"; n?: number } // n completed sets (default 1)
  | { kind: "dailyStreak"; n: number }
  | { kind: "ownsLimited" }     // owns any limited-edition card
  | { kind: "achievement"; key: string };

// True when the player currently satisfies the rule. Total and side-effect free.
export function evalUnlockRule(rule: UnlockRule, p: HqProgress): boolean {
  switch (rule.kind) {
    case "always":           return true;
    case "accountLevel":     return p.accountLevel >= rule.n;
    case "collectionUnique": return p.uniqueCards >= rule.n;
    case "shinyOwned":       return p.shinyOwned >= rule.n;
    case "battleWins":       return p.battleWins >= rule.n;
    case "raidBoss":         return p.raidBossesCleared >= 1;
    case "raidCampaign":     return p.raidCampaignComplete;
    case "setComplete":      return p.completedSets >= (rule.n ?? 1);
    case "dailyStreak":      return p.dailyStreak >= rule.n;
    case "ownsLimited":      return p.ownsLimited;
    case "achievement":      return p.achievementKeys.has(rule.key);
    default: {
      // Exhaustiveness guard — a new rule kind that forgets a branch fails
      // closed (locked) rather than unlocking everything.
      const _never: never = rule;
      void _never;
      return false;
    }
  }
}

// A short player-facing hint describing how to earn the item ("Win 100 battles").
// Used on locked rooms/themes and in the "just unlocked" toast.
export function unlockLabel(rule: UnlockRule): string {
  switch (rule.kind) {
    case "always":           return "Available from the start";
    case "accountLevel":     return `Reach account level ${rule.n}`;
    case "collectionUnique": return `Collect ${rule.n} unique cards`;
    case "shinyOwned":       return `Own ${rule.n} shiny card${rule.n === 1 ? "" : "s"}`;
    case "battleWins":       return `Win ${rule.n} battle${rule.n === 1 ? "" : "s"}`;
    case "raidBoss":         return "Defeat a raid boss";
    case "raidCampaign":     return "Complete the raid campaign";
    case "setComplete":      return (rule.n ?? 1) > 1 ? `Complete ${rule.n} sets` : "Complete a card set";
    case "dailyStreak":      return `Reach a ${rule.n}-day login streak`;
    case "ownsLimited":      return "Own a limited-edition card";
    case "achievement":      return "Unlock a linked achievement";
    default:                 return "Keep playing to unlock";
  }
}

// A compact machine tag stored in hq_unlocks.source so the earning story is
// durable even if the rule text changes later.
export function unlockSourceTag(rule: UnlockRule): string {
  switch (rule.kind) {
    case "accountLevel":     return `accountLevel>=${rule.n}`;
    case "collectionUnique": return `collectionUnique>=${rule.n}`;
    case "shinyOwned":       return `shinyOwned>=${rule.n}`;
    case "battleWins":       return `battleWins>=${rule.n}`;
    case "setComplete":      return `setComplete>=${rule.n ?? 1}`;
    case "dailyStreak":      return `dailyStreak>=${rule.n}`;
    case "achievement":      return `achievement:${rule.key}`;
    default:                 return rule.kind;
  }
}
