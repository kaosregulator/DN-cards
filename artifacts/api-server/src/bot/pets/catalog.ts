// Data-driven egg + discovery catalog. Not DN Cards rarities.
// Limited supply numbers live HERE, not in admin settings — admins chase them too.

import type { PetSpecies } from "./engine.js";

export type DiscoveryVariant = "normal" | "shiny" | "exotic";

export const DISCOVERY_VARIANTS: DiscoveryVariant[] = ["normal", "shiny", "exotic"];

export const VARIANT_LABEL: Record<DiscoveryVariant, string> = {
  normal: "Normal",
  shiny: "✨ Shiny",
  exotic: "🌈 Exotic",
};

export type EggTheme = "meadow" | "tide" | "ember" | "frost" | "grove" | "candy" | "shadow" | "relic" | "dragon" | "void" | "aurora" | "ancient";

export type EggDef = {
  key: string;
  label: string;
  blurb: string;
  /** Frostwindz PNG filename (64×64). */
  sprite: string;
  theme: EggTheme;
  price: number;
  /** Wall-clock incubation. */
  timerMs: number;
  /** Resale before hatch (UB). */
  sellValue: number;
  /** Species weights. Mystery until hatch. */
  species: Partial<Record<PetSpecies, number>>;
  /** Discovery weights per 1000. */
  discover: Record<DiscoveryVariant, number>;
  /** Regular shop listing. Limited eggs are never listed here. */
  shop: boolean;
  limited: boolean;
};

const SPECIES_EVEN: Partial<Record<PetSpecies, number>> = { dragon: 1, cat: 1, dog: 1, hamster: 1 };

export const EGG_DEFS: EggDef[] = [
  {
    key: "meadow", label: "Meadow Egg", blurb: "Soft shell. Quick warm-up.",
    sprite: "egg_1.png", theme: "meadow", price: 400, timerMs: 2 * 60_000, sellValue: 160,
    species: { cat: 3, hamster: 3, dog: 2, dragon: 1 }, discover: { normal: 975, shiny: 20, exotic: 5 },
    shop: true, limited: false,
  },
  {
    key: "tide", label: "Tide Egg", blurb: "Salt glitter. Something swims inside.",
    sprite: "egg_6.png", theme: "tide", price: 450, timerMs: 2 * 60_000, sellValue: 180,
    species: { cat: 2, dog: 2, hamster: 2, dragon: 1 }, discover: { normal: 970, shiny: 22, exotic: 8 },
    shop: true, limited: false,
  },
  {
    key: "ember", label: "Ember Egg", blurb: "Warm cracks. Don't rush it.",
    sprite: "egg_3.png", theme: "ember", price: 700, timerMs: 5 * 60_000, sellValue: 280,
    species: { dragon: 5, dog: 2, cat: 1, hamster: 1 }, discover: { normal: 960, shiny: 30, exotic: 10 },
    shop: true, limited: false,
  },
  {
    key: "frost", label: "Frost Egg", blurb: "Cold to the touch.",
    sprite: "egg_8.png", theme: "frost", price: 700, timerMs: 5 * 60_000, sellValue: 280,
    species: { cat: 4, hamster: 3, dragon: 1, dog: 1 }, discover: { normal: 960, shiny: 30, exotic: 10 },
    shop: true, limited: false,
  },
  {
    key: "grove", label: "Grove Egg", blurb: "Moss and quiet.",
    sprite: "egg_5.png", theme: "grove", price: 650, timerMs: 5 * 60_000, sellValue: 250,
    species: { dog: 4, hamster: 3, cat: 2, dragon: 1 }, discover: { normal: 965, shiny: 25, exotic: 10 },
    shop: true, limited: false,
  },
  {
    key: "candy", label: "Candy Egg", blurb: "Too pretty to sell. Probably.",
    sprite: "egg_10.png", theme: "candy", price: 900, timerMs: 5 * 60_000, sellValue: 360,
    species: SPECIES_EVEN, discover: { normal: 940, shiny: 40, exotic: 20 },
    shop: true, limited: false,
  },
  {
    key: "shadow", label: "Shadow Egg", blurb: "Half an hour in the dark.",
    sprite: "egg_15.png", theme: "shadow", price: 1600, timerMs: 30 * 60_000, sellValue: 640,
    species: { dragon: 3, cat: 3, dog: 2, hamster: 1 }, discover: { normal: 880, shiny: 80, exotic: 40 },
    shop: true, limited: false,
  },
  {
    key: "relic", label: "Relic Egg", blurb: "Shiny-biased. Two hours. Expensive on purpose.",
    sprite: "egg_18.png", theme: "relic", price: 5000, timerMs: 2 * 60 * 60_000, sellValue: 1800,
    species: { dragon: 4, cat: 2, dog: 2, hamster: 1 }, discover: { normal: 400, shiny: 500, exotic: 100 },
    shop: true, limited: false,
  },
  // Daily limited — supply hardcoded, rotated by date. Not admin-grantable.
  {
    key: "dragonheart", label: "Dragonheart Egg", blurb: "LIMITED. Three exist today. Then trade only.",
    sprite: "egg_4.png", theme: "dragon", price: 8000, timerMs: 24 * 60 * 60_000, sellValue: 4000,
    species: { dragon: 8, dog: 1, cat: 1, hamster: 1 }, discover: { normal: 350, shiny: 450, exotic: 200 },
    shop: false, limited: true,
  },
  {
    key: "starvoid", label: "Starvoid Egg", blurb: "LIMITED. Three exist today. Then trade only.",
    sprite: "egg_12.png", theme: "void", price: 9000, timerMs: 24 * 60 * 60_000, sellValue: 4500,
    species: { cat: 4, dragon: 3, hamster: 2, dog: 1 }, discover: { normal: 300, shiny: 450, exotic: 250 },
    shop: false, limited: true,
  },
  {
    key: "aurora", label: "Aurora Egg", blurb: "LIMITED. Three exist today. Then trade only.",
    sprite: "egg_20.png", theme: "aurora", price: 8500, timerMs: 24 * 60 * 60_000, sellValue: 4200,
    species: SPECIES_EVEN, discover: { normal: 250, shiny: 400, exotic: 350 },
    shop: false, limited: true,
  },
  {
    key: "ancient", label: "Ancient Egg", blurb: "LIMITED. Three exist today. Then trade only.",
    sprite: "egg_19.png", theme: "ancient", price: 8000, timerMs: 24 * 60 * 60_000, sellValue: 4000,
    species: { dog: 3, dragon: 3, hamster: 2, cat: 2 }, discover: { normal: 320, shiny: 480, exotic: 200 },
    shop: false, limited: true,
  },
];

export const LIMITED_POOL = EGG_DEFS.filter(e => e.limited);
/** Hard cap. Not a setting. Admins cannot raise this. */
export const LIMITED_SUPPLY = 3;

export const HATCH_ITEMS = [
  { key: "time_sand", label: "Time Sand", blurb: "Cut remaining incubation in half", price: 400 },
  { key: "instant_crack", label: "Instant Crack", blurb: "Egg is ready to hatch now", price: 1200 },
] as const;

export function eggDef(key: string): EggDef | undefined {
  return EGG_DEFS.find(e => e.key === key);
}

export function shopEggs(): EggDef[] {
  return EGG_DEFS.filter(e => e.shop);
}

export function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministic daily limited egg. Same guild + date → same egg. No admin pick. */
export function limitedEggFor(guildId: string, date = utcDateKey()): EggDef {
  let h = 0;
  const s = `${guildId}:${date}`;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return LIMITED_POOL[h % LIMITED_POOL.length]!;
}

export function rollWeighted<T extends string>(weights: Partial<Record<T, number>>): T {
  const entries = (Object.entries(weights) as [T, number | undefined][])
    .filter((pair): pair is [T, number] => typeof pair[1] === "number" && pair[1] > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  let r = Math.random() * (total || 1);
  for (const [k, n] of entries) {
    r -= n;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1]![0];
}

export function formatTimer(ms: number): string {
  if (ms <= 0) return "ready";
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 36) return rm ? `${h}h ${rm}m` : `${h}h`;
  return `${Math.ceil(h / 24)}d`;
}
