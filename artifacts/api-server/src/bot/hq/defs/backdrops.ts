// ─────────────────────────────────────────────────────────────────────────────
// HQ — backdrop registry (data-only).
//
// A backdrop is the scene BEHIND the room — the sky/landscape you see when the
// walls are open ("outside"), or a vista peeking above the walls. Same pattern
// as walls.ts / floors.ts: id + art key + unlock rule, resolve-to-default. Some
// are default, others are EARNED (account level, battle wins, achievements) — not
// just shop/drops. Add a backdrop = append here + drop a PNG in the manifest.
// ─────────────────────────────────────────────────────────────────────────────

import type { UnlockRule } from "./unlock-rules.js";

export interface HqBackdrop {
  id: string;
  name: string;
  emoji: string;
  spriteKey: string;   // manifest key: "backdrop/<id>"
  unlock: UnlockRule;
}

export const HQ_BACKDROPS: HqBackdrop[] = [
  { id: "none", name: "None (plain)", emoji: "⬛", spriteKey: "backdrop/none", unlock: { kind: "always" } },
  { id: "grass", name: "Meadow", emoji: "🌱", spriteKey: "backdrop/grass", unlock: { kind: "always" } },
  { id: "forest", name: "Forest", emoji: "🌲", spriteKey: "backdrop/forest", unlock: { kind: "always" } },
  { id: "fall", name: "Autumn", emoji: "🍂", spriteKey: "backdrop/fall", unlock: { kind: "accountLevel", n: 8 } },
  { id: "desert", name: "Desert", emoji: "🏜️", spriteKey: "backdrop/desert", unlock: { kind: "battleWins", n: 25 } },
  { id: "castles", name: "Castle Vista", emoji: "🏯", spriteKey: "backdrop/castles", unlock: { kind: "achievement", key: "raid_campaign_complete" } },
];

export const DEFAULT_BACKDROP_ID = "none";

const BY_ID = new Map<string, HqBackdrop>(HQ_BACKDROPS.map(b => [b.id, b]));

export function resolveBackdrop(id: string | null | undefined): HqBackdrop {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_BACKDROP_ID)!;
}
export function getBackdropById(id: string): HqBackdrop | undefined { return BY_ID.get(id); }
