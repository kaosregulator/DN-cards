// ─────────────────────────────────────────────────────────────────────────────
// Gesture presets — named, decomposed movements.
//
//   SIGH
//   ├── eyes:  slow close      (tags: blink, close)
//   ├── mouth: exhale          (tags: exhale, open)
//   ├── head:  slight drop     (tags: nod, drop)
//   └── effect: —
//
// A preset does NOT hard-bind tracks. It names, per region, the TAGS the planner
// should look for, so the actual movement is still borrowed from whichever emoji
// in the pool matches best (and swapped by the user afterwards). This is what
// keeps the library combinable: the same "exhale" mouth can pair with a nod for
// a sigh or with a shake for a groan. `escalate` adds motion only at the harder
// intensities — the mechanism behind cry → ugly-crying.
// ─────────────────────────────────────────────────────────────────────────────

import type { GesturePreset } from "../types.js";

export const GESTURES: GesturePreset[] = [
  {
    id: "sigh", name: "Sigh", emoji: "😮‍💨", match: ["sigh", "exhale", "relieved", "tired"],
    parts: { eyes: ["blink", "close", "squint"], mouth: ["exhale", "open", "talk"], global: ["nod", "drop", "bob"] },
    effects: ["steam"], timingMs: 1800,
  },
  {
    id: "yawn", name: "Yawn", emoji: "🥱", match: ["yawn", "sleepy", "tired", "bored"],
    parts: { eyes: ["squint", "close", "blink"], mouth: ["yawn", "open", "wide"], global: ["tilt", "drop"] },
    timingMs: 2000, escalate: { insane: { effects: ["tears"] } },
  },
  {
    id: "cry", name: "Cry", emoji: "😢", match: ["cry", "crying", "sad", "sob", "tears", "weep"],
    parts: { eyes: ["squint", "close"], mouth: ["pout", "open"], global: ["nod", "bob"] },
    effects: ["tears"], timingMs: 1400,
    escalate: {
      dramatic: { parts: { global: ["shake", "quake"] } },
      insane: { parts: { global: ["shake"], mouth: ["shout", "open"] }, effects: ["tears", "sweat"] },
    },
  },
  {
    id: "laugh", name: "Laugh", emoji: "😂", match: ["laugh", "laughing", "lol", "haha", "funny", "joy"],
    parts: { eyes: ["squint", "close"], mouth: ["laugh", "grin", "open"], global: ["bounce", "wobble", "tilt"] },
    timingMs: 1100, escalate: { dramatic: { effects: ["tears"] }, insane: { parts: { global: ["shake"] }, effects: ["tears"] } },
  },
  {
    id: "yell", name: "Yell", emoji: "😱", match: ["yell", "yelling", "shout", "scream", "screaming", "rage", "angry"],
    parts: { eyes: ["widen", "open"], mouth: ["shout", "yell", "open", "wide"], brows: ["furrow"], global: ["zoom", "shake"] },
    timingMs: 900, escalate: { dramatic: { effects: ["steam"] }, insane: { parts: { global: ["shake"] }, effects: ["steam", "anger"] } },
  },
  {
    id: "grin", name: "Grin", emoji: "😁", match: ["grin", "smile", "smiling", "happy", "cheeky"],
    parts: { eyes: ["squint", "blink"], mouth: ["grin", "smile", "open"], global: ["bob", "bounce"] },
    timingMs: 1300, escalate: { insane: { effects: ["sparkles"] } },
  },
  {
    id: "wink", name: "Wink", emoji: "😉", match: ["wink", "flirt", "cheeky", "sly"],
    parts: { eyes: ["wink", "blink"], mouth: ["smirk", "smile"], global: ["tilt"] },
    timingMs: 1200, effects: [],
  },
  {
    id: "nod", name: "Nod yes", emoji: "🙂", match: ["nod", "yes", "agree", "ok", "okay"],
    parts: { global: ["nod"], eyes: ["blink"] }, timingMs: 1200,
  },
  {
    id: "shakeno", name: "Shake no", emoji: "🙅", match: ["no", "nope", "deny", "disagree", "shake"],
    parts: { global: ["shake"], mouth: ["pout"] }, timingMs: 1000,
  },
  {
    id: "think", name: "Thinking", emoji: "🤔", match: ["think", "thinking", "hmm", "curious", "confused", "ponder"],
    parts: { brows: ["raise"], eyes: ["look", "roll"], mouth: ["smirk"], global: ["tilt", "lean"] },
    timingMs: 1800,
  },
  {
    id: "shock", name: "Shocked", emoji: "😲", match: ["shock", "shocked", "surprise", "surprised", "gasp", "wow", "omg"],
    parts: { eyes: ["widen", "open"], mouth: ["gasp", "open"], brows: ["raise"], global: ["zoom"] },
    timingMs: 900, escalate: { insane: { parts: { global: ["shake"] } } },
  },
  {
    id: "love", name: "In love", emoji: "🥰", match: ["love", "heart", "hearts", "adore", "crush", "cute"],
    parts: { eyes: ["blink", "squint"], mouth: ["smile", "grin"], cheeks: ["love"], global: ["bob", "pulse"] },
    effects: ["hearts"], timingMs: 1600,
  },
  {
    id: "kiss", name: "Blow a kiss", emoji: "😘", match: ["kiss", "muah", "smooch"],
    parts: { eyes: ["wink", "blink"], mouth: ["pout", "kiss"], global: ["lean"] },
    effects: ["hearts"], timingMs: 1400,
  },
  {
    id: "dizzy", name: "Dizzy", emoji: "😵‍💫", match: ["dizzy", "woozy", "confused", "spin", "drunk"],
    parts: { eyes: ["roll", "squint"], mouth: ["talk"], global: ["wobble", "spin"] },
    effects: ["dizzy"], timingMs: 1600,
  },
  {
    id: "sleepy", name: "Sleepy", emoji: "😴", match: ["sleep", "sleepy", "sleeping", "zzz", "drowsy"],
    parts: { eyes: ["close", "blink"], mouth: ["talk"], global: ["bob", "drop"] },
    timingMs: 2200,
  },
  {
    id: "sneeze", name: "Sneeze", emoji: "🤧", match: ["sneeze", "achoo", "sick", "cold"],
    parts: { eyes: ["squint", "close"], mouth: ["shout", "open"], global: ["nod", "zoom"] },
    effects: ["sweat"], timingMs: 1000, escalate: { insane: { parts: { global: ["shake"] } } },
  },
  {
    id: "party", name: "Party", emoji: "🥳", match: ["party", "celebrate", "hype", "excited", "yay"],
    parts: { eyes: ["blink"], mouth: ["grin", "open"], global: ["bounce", "wobble"] },
    effects: ["sparkles"], timingMs: 1100, escalate: { insane: { parts: { global: ["shake"] } } },
  },
  {
    id: "cold", name: "Freezing", emoji: "🥶", match: ["cold", "freezing", "shiver", "brr"],
    parts: { eyes: ["squint"], mouth: ["pout"], global: ["shiver", "shake"] },
    timingMs: 900,
  },
  {
    id: "sing", name: "Sing", emoji: "🎤", match: ["sing", "singing", "song", "talk", "talking", "speak"],
    parts: { eyes: ["blink"], mouth: ["talk", "open"], global: ["bob", "wobble"] },
    timingMs: 1200,
  },
  {
    id: "smug", name: "Smug", emoji: "😏", match: ["smug", "smirk", "sly", "cool", "confident"],
    parts: { eyes: ["squint"], mouth: ["smirk"], brows: ["raise"], global: ["lean", "tilt"] },
    timingMs: 1600,
  },
];

/** The generic, faceless fallback: whole-emoji motion + sparkle, works on anything. */
export const UNIVERSAL_GESTURE: GesturePreset = {
  id: "universal", name: "Liven up", emoji: "✨",
  match: [],
  parts: { global: ["bounce", "bob", "wobble", "pulse"] },
  effects: ["sparkles"], timingMs: 1200,
  escalate: { dramatic: { parts: { global: ["shake"] } }, insane: { parts: { global: ["spin", "shake"] } } },
};
