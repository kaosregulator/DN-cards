// ─────────────────────────────────────────────────────────────────────────────
// Tag vocabulary.
//
// The planner matches a user's words ("make him yawn", "yelling") against the
// tags on every track in the pool. Those tags come from two places, and both go
// through here so they speak the same language:
//   • the source emoji's NAME  — "Yawning face" → yawn, tired, open, mouth
//   • the layer's ROLE         — a layer named "eye_L" → eyes, blink
//
// Keeping the normalization in one place means the harvester and the hand-
// authored builtin tracks tag things identically, so a borrowed Noto yawn and a
// builtin fallback yawn are found by the same query.
// ─────────────────────────────────────────────────────────────────────────────

import type { Region } from "../types.js";

/**
 * Canonical motion tags. Not exhaustive — free tags are allowed — but these are
 * the ones the lexicon and planner reason about, so they are spelled once here.
 */
export const CANONICAL_TAGS = [
  // expressions / moods
  "happy", "grin", "smile", "laugh", "sad", "cry", "tears", "angry", "mad",
  "shock", "surprise", "fear", "love", "wink", "silly", "sleepy", "tired",
  "sick", "dizzy", "cool", "smug", "sneeze", "yawn", "shout", "yell", "sing",
  "kiss", "think", "confused", "neutral", "party", "cold", "hot",
  // mouth motions
  "open", "wide", "close", "chew", "talk", "gasp", "pout", "smirk",
  // eye motions
  "blink", "squint", "widen", "roll", "look", "shut",
  // brow motions
  "raise", "furrow", "worry",
  // whole-body motions
  "nod", "shake", "tilt", "bob", "bounce", "spin", "wobble", "lean", "shiver",
  "pulse", "zoom", "float", "quake",
] as const;

/** Words in an emoji/layer name that map onto a canonical tag (or several). */
const NAME_MAP: Record<string, string[]> = {
  yawning: ["yawn", "tired", "open", "sleepy"],
  sleeping: ["sleepy", "tired", "close"],
  sleepy: ["sleepy", "tired"],
  tired: ["tired", "sleepy"],
  grinning: ["grin", "happy", "smile", "open"],
  grin: ["grin", "happy", "smile"],
  beaming: ["grin", "happy", "smile", "wide"],
  smiling: ["smile", "happy"],
  smile: ["smile", "happy"],
  laughing: ["laugh", "happy", "open", "tears"],
  joy: ["laugh", "happy", "tears"],
  rofl: ["laugh", "happy", "tilt"],
  crying: ["cry", "sad", "tears"],
  sobbing: ["cry", "sad", "tears", "open"],
  loudly: ["cry", "open", "tears"],
  sad: ["sad", "worry"],
  frowning: ["sad", "worry"],
  pensive: ["sad", "think"],
  disappointed: ["sad"],
  angry: ["angry", "mad", "furrow"],
  pouting: ["angry", "mad", "pout", "furrow"],
  rage: ["angry", "mad", "shout"],
  screaming: ["shock", "fear", "open", "wide"],
  fearful: ["fear", "shock", "widen"],
  anguished: ["fear", "open"],
  astonished: ["surprise", "shock", "open", "wide"],
  surprised: ["surprise", "shock", "widen", "open"],
  hushed: ["surprise", "open"],
  gasping: ["gasp", "surprise", "open"],
  open: ["open", "surprise"],
  flushed: ["shock", "widen"],
  hearts: ["love", "happy"],
  kissing: ["kiss", "love", "pout"],
  kiss: ["kiss", "love", "pout"],
  wink: ["wink", "silly", "blink"],
  winking: ["wink", "silly", "blink"],
  tongue: ["silly", "open"],
  zany: ["silly", "wink", "wobble"],
  goofy: ["silly", "wink"],
  smirking: ["smirk", "smug"],
  unamused: ["neutral", "roll", "smug"],
  rolling: ["roll", "silly"],
  expressionless: ["neutral", "close"],
  neutral: ["neutral"],
  thinking: ["think", "smirk"],
  raised: ["raise", "smug", "think"],
  eyebrow: ["raise", "brows"],
  confused: ["confused", "tilt"],
  dizzy: ["dizzy", "spin", "roll"],
  woozy: ["dizzy", "wobble"],
  exploding: ["shock", "open"],
  cold: ["cold", "shiver"],
  freezing: ["cold", "shiver", "shake"],
  hot: ["hot", "open"],
  sneezing: ["sneeze", "sick"],
  sick: ["sick"],
  nauseated: ["sick"],
  vomiting: ["sick", "open"],
  cowboy: ["cool", "smile"],
  sunglasses: ["cool", "smug"],
  partying: ["party", "happy"],
  celebration: ["party", "happy"],
  shushing: ["think"],
  singing: ["sing", "open", "happy"],
  yelling: ["yell", "shout", "open", "wide"],
  megaphone: ["yell", "shout"],
  sleeping_symbol: ["sleepy"],
  relieved: ["neutral", "close"],
  drooling: ["silly", "open"],
  shaking: ["shake", "quake", "shock"],
  head: ["nod", "shake"],
  nodding: ["nod"],
  spinning: ["spin"],
};

/** Layer-name substrings → region, for the harvester's role detection. */
const LAYER_REGION: Array<[RegExp, Region]> = [
  [/\b(all|head|face|null|root|body|base)\b/i, "global"],
  [/brow|eyebrow/i, "brows"],
  [/(^|[^a-z])eye|lid|lash|pupil|iris/i, "eyes"],
  [/mouth|lip|teeth|tongue|jaw/i, "mouth"],
  [/cheek|blush|tear/i, "cheeks"],
];

/** Best-guess region for a Lottie layer name. Defaults to global. */
export function regionForLayer(layerName: string): Region {
  for (const [re, region] of LAYER_REGION) if (re.test(layerName)) return region;
  return "global";
}

/**
 * Turn a human name ("Yawning face", "eye_L") into canonical + raw tags. The raw
 * words survive too so a search for an exact emoji name still lands.
 */
export function tagsFromName(name: string): string[] {
  const out = new Set<string>();
  const words = name
    .toLowerCase()
    .replace(/^emoji[_ ]*/i, "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  for (const w of words) {
    out.add(w);
    const mapped = NAME_MAP[w];
    if (mapped) for (const t of mapped) out.add(t);
  }
  return [...out];
}
