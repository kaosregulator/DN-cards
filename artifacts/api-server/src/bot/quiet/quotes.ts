// ─────────────────────────────────────────────────────────────────────────────
// Quiet Room — short message / quote library (100+)
//
// Themes cover breaks, thinking, overwhelm, hope, self-kindness, light Discord
// chaos jokes, and general life thoughts. Intentionally NOT a crisis-hotline
// script. Keep tones calm, human, and varied.
// ─────────────────────────────────────────────────────────────────────────────

export type QuietTheme =
  | "general"
  | "think"
  | "encouragement"
  | "support"
  | "overwhelmed"
  | "discord"
  | "hope"
  | "rest"
  | "growth"
  | "tomorrow"
  | "kindness"
  | "calm";

export interface QuietQuote {
  id: string;
  theme: QuietTheme;
  text: string;
}

/** Staff-facing theme choices for `/quiet user:… theme:…`. */
export const QUIET_THEME_CHOICES: { name: string; value: QuietTheme; emoji: string }[] = [
  { name: "General Quiet", value: "general", emoji: "🌙" },
  { name: "Think & Reflect", value: "think", emoji: "🧠" },
  { name: "Encouragement", value: "encouragement", emoji: "🌱" },
  { name: "Support", value: "support", emoji: "❤️" },
  { name: "Overwhelmed", value: "overwhelmed", emoji: "😮‍💨" },
  { name: "Too Much Discord", value: "discord", emoji: "😂" },
  { name: "Hope", value: "hope", emoji: "🌤️" },
  { name: "Rest", value: "rest", emoji: "🛌" },
  { name: "Calm", value: "calm", emoji: "🧘" },
];

export const QUIET_QUOTES: QuietQuote[] = [
  // ── general ──────────────────────────────────────────────────────────────
  { id: "g01", theme: "general", text: "Everything is still here. You can just be still for a bit." },
  { id: "g02", theme: "general", text: "Take your time. There's nowhere you need to be." },
  { id: "g03", theme: "general", text: "Nothing is chasing you here." },
  { id: "g04", theme: "general", text: "You don't have to explain needing a break." },
  { id: "g05", theme: "general", text: "Silence is allowed. So is staying as long as you want." },
  { id: "g06", theme: "general", text: "The room doesn't need anything from you." },
  { id: "g07", theme: "general", text: "You can put the world down for a minute." },
  { id: "g08", theme: "general", text: "Being quiet is not disappearing. It's pausing." },
  { id: "g09", theme: "general", text: "This space asks for nothing. Keep it that way." },
  { id: "g10", theme: "general", text: "Come back when the noise feels smaller." },

  // ── think ────────────────────────────────────────────────────────────────
  { id: "t01", theme: "think", text: "Give yourself a little room to think." },
  { id: "t02", theme: "think", text: "You don't have to solve everything right now." },
  { id: "t03", theme: "think", text: "One clear thought is enough for this moment." },
  { id: "t04", theme: "think", text: "Sometimes stepping away is exactly what you need." },
  { id: "t05", theme: "think", text: "Let the question sit. Answers don't always rush." },
  { id: "t06", theme: "think", text: "You can think without performing the thinking." },
  { id: "t07", theme: "think", text: "Clarity likes quiet more than pressure." },
  { id: "t08", theme: "think", text: "Not every thought needs a reply yet." },
  { id: "t09", theme: "think", text: "Slow is still a valid speed for figuring things out." },
  { id: "t10", theme: "think", text: "The messy middle gets quieter when you stop forcing it." },

  // ── encouragement ────────────────────────────────────────────────────────
  { id: "e01", theme: "encouragement", text: "One thing at a time is still progress." },
  { id: "e02", theme: "encouragement", text: "You have gotten through hard days before. This is just a pause." },
  { id: "e03", theme: "encouragement", text: "Small steps count even when nobody sees them." },
  { id: "e04", theme: "encouragement", text: "You're allowed to start over as many times as you need." },
  { id: "e05", theme: "encouragement", text: "Showing up softly still counts as showing up." },
  { id: "e06", theme: "encouragement", text: "You don't have to be impressive to be okay." },
  { id: "e07", theme: "encouragement", text: "Steady beats perfect. Always." },
  { id: "e08", theme: "encouragement", text: "Keep the bar low enough that you can clear it today." },
  { id: "e09", theme: "encouragement", text: "You're doing better than the loudest part of your brain claims." },
  { id: "e10", theme: "encouragement", text: "Return when you're ready — not when you feel finished." },

  // ── support / kindness ───────────────────────────────────────────────────
  { id: "s01", theme: "support", text: "Be gentle with yourself in here." },
  { id: "s02", theme: "support", text: "You don't owe anyone a performance right now." },
  { id: "s03", theme: "support", text: "It's okay if today is a quiet day." },
  { id: "s04", theme: "kindness", text: "Talk to yourself the way you'd talk to a friend who's tired." },
  { id: "s05", theme: "kindness", text: "You are not behind for needing rest." },
  { id: "s06", theme: "support", text: "Nobody is grading this break." },
  { id: "s07", theme: "kindness", text: "Softness is not weakness. It's maintenance." },
  { id: "s08", theme: "support", text: "You can put the hard conversation down until later." },
  { id: "s09", theme: "kindness", text: "Treat this quiet like a small kindness you finally kept." },
  { id: "s10", theme: "support", text: "You're allowed to take up less space for a while." },

  // ── overwhelmed ──────────────────────────────────────────────────────────
  { id: "o01", theme: "overwhelmed", text: "Too much at once is still too much. Breathe first." },
  { id: "o02", theme: "overwhelmed", text: "You don't have to catch every notification." },
  { id: "o03", theme: "overwhelmed", text: "If everything feels loud, this room can be the volume knob." },
  { id: "o04", theme: "overwhelmed", text: "Put down the list. Pick it up later." },
  { id: "o05", theme: "overwhelmed", text: "Overwhelm shrinks when you stop answering everything." },
  { id: "o06", theme: "overwhelmed", text: "You can wait out the spike without fixing the whole day." },
  { id: "o07", theme: "overwhelmed", text: "Less input. More air. That's enough for now." },
  { id: "o08", theme: "overwhelmed", text: "It's okay to mute the world without muting yourself forever." },
  { id: "o09", theme: "overwhelmed", text: "You are not failing because you needed quiet." },
  { id: "o10", theme: "overwhelmed", text: "Step back. The pile will still be there — calmer, maybe." },

  // ── discord / lighthearted ───────────────────────────────────────────────
  { id: "d01", theme: "discord", text: "Congratulations. You escaped Discord for a minute." },
  { id: "d02", theme: "discord", text: "The chaos will still be here when you get back." },
  { id: "d03", theme: "discord", text: "Seventeen channels can wait. Really." },
  { id: "d04", theme: "discord", text: "No pings. No drama. Just you and a quiet corner." },
  { id: "d05", theme: "discord", text: "Server energy: off. Brain fans: spinning down." },
  { id: "d06", theme: "discord", text: "You left the group chat without leaving the group chat." },
  { id: "d07", theme: "discord", text: "Ghost town mode: unlocked." },
  { id: "d08", theme: "discord", text: "If Discord was a mall, you just found the empty hallway." },
  { id: "d09", theme: "discord", text: "Ping-free zone. Treat it like a rare drop." },
  { id: "d10", theme: "discord", text: "The timeline can argue without you for a bit." },

  // ── hope ─────────────────────────────────────────────────────────────────
  { id: "h01", theme: "hope", text: "Tomorrow doesn't need to look like today." },
  { id: "h02", theme: "hope", text: "Quiet now can mean clearer later." },
  { id: "h03", theme: "hope", text: "Even heavy days have edges. You're near one." },
  { id: "h04", theme: "hope", text: "Something softer is still possible after this pause." },
  { id: "h05", theme: "hope", text: "You can come back whenever you're ready." },
  { id: "h06", theme: "hope", text: "The next good moment hasn't been cancelled." },
  { id: "h07", theme: "hope", text: "Rest is part of the path, not a detour off it." },
  { id: "h08", theme: "hope", text: "You don't have to feel hopeful to leave space for hope." },
  { id: "h09", theme: "hope", text: "There's still room for things to get lighter." },
  { id: "h10", theme: "hope", text: "This break is a door, not a dead end." },

  // ── rest ─────────────────────────────────────────────────────────────────
  { id: "r01", theme: "rest", text: "Rest doesn't need to be earned." },
  { id: "r02", theme: "rest", text: "Close the tabs in your head for a while." },
  { id: "r03", theme: "rest", text: "Stillness is doing something. It's recovering." },
  { id: "r04", theme: "rest", text: "Let your shoulders drop. Nobody's watching the scoreboard." },
  { id: "r05", theme: "rest", text: "A short rest can outrun a long crash." },
  { id: "r06", theme: "rest", text: "You can stop bracing. This corner is soft." },
  { id: "r07", theme: "rest", text: "Idle is allowed. Productive can wait." },
  { id: "r08", theme: "rest", text: "Your body keeps the receipts. Pay it in quiet." },
  { id: "r09", theme: "rest", text: "No countdown. No homework. Just air." },
  { id: "r10", theme: "rest", text: "Sleepy thoughts are welcome here too." },

  // ── growth / starting over ───────────────────────────────────────────────
  { id: "w01", theme: "growth", text: "Starting over is still moving." },
  { id: "w02", theme: "growth", text: "You can rewrite the next hour without rewriting your whole life." },
  { id: "w03", theme: "growth", text: "Growth includes the days you choose silence." },
  { id: "w04", theme: "growth", text: "Leaving a noisy pattern is progress, even quietly." },
  { id: "w05", theme: "growth", text: "You don't have to become someone new tonight." },
  { id: "w06", theme: "growth", text: "Resetting is a skill. You're practicing it." },
  { id: "w07", theme: "growth", text: "The next version of you can arrive slowly." },
  { id: "w08", theme: "growth", text: "You can outgrow a mood without explaining the exit." },

  // ── tomorrow ─────────────────────────────────────────────────────────────
  { id: "y01", theme: "tomorrow", text: "Leave some of this for morning-you." },
  { id: "y02", theme: "tomorrow", text: "Not every knot needs untying before sleep." },
  { id: "y03", theme: "tomorrow", text: "Today can end unfinished. That's still an ending." },
  { id: "y04", theme: "tomorrow", text: "Save a little energy for the version of you that wakes up." },
  { id: "y05", theme: "tomorrow", text: "The night doesn't require a full report." },
  { id: "y06", theme: "tomorrow", text: "Park the worry. Pick it up after coffee — or don't." },

  // ── calm ─────────────────────────────────────────────────────────────────
  { id: "c01", theme: "calm", text: "In. Out. Again. That's the whole plan for now." },
  { id: "c02", theme: "calm", text: "Let the edges of the day blur a little." },
  { id: "c03", theme: "calm", text: "You can sit with the quiet without filling it." },
  { id: "c04", theme: "calm", text: "Soft light. Soft thoughts. Soft exit when you're ready." },
  { id: "c05", theme: "calm", text: "The storm outside this room can keep raining without you." },
  { id: "c06", theme: "calm", text: "Nothing urgent survives honesty for long. Start with quiet." },
  { id: "c07", theme: "calm", text: "Lower the volume on everything that isn't breath." },
  { id: "c08", theme: "calm", text: "Here, time stretches. Use as much as you need." },

  // ── extras for variety (≥100) ────────────────────────────────────────────
  { id: "x01", theme: "general", text: "Disappear without leaving. Return without explaining." },
  { id: "x02", theme: "think", text: "Half-formed ideas deserve quiet too." },
  { id: "x03", theme: "encouragement", text: "You're allowed to be unfinished and still worthy of rest." },
  { id: "x04", theme: "discord", text: "Mute the server energy. Keep your own." },
  { id: "x05", theme: "hope", text: "A quieter mind leaves room for better surprises." },
  { id: "x06", theme: "overwhelmed", text: "If your brain has too many tabs open, close a few here." },
  { id: "x07", theme: "rest", text: "Lie low. The world has volume control, and you found it." },
  { id: "x08", theme: "kindness", text: "You don't need a reason to be kinder to yourself." },
  { id: "x09", theme: "calm", text: "Let this be the least dramatic place in your day." },
  { id: "x10", theme: "growth", text: "Choosing quiet is a decision. Honor it." },
  { id: "x11", theme: "support", text: "Whatever brought you here can wait outside the door." },
  { id: "x12", theme: "tomorrow", text: "You can meet tomorrow with emptier hands." },
  { id: "x13", theme: "general", text: "Stay as long as the silence helps." },
  { id: "x14", theme: "discord", text: "No replies required. Not even to yourself." },
  { id: "x15", theme: "think", text: "Protect the thought until it's ready to be spoken." },
  { id: "x16", theme: "hope", text: "Light finds people who stopped sprinting for a second." },
  { id: "x17", theme: "encouragement", text: "You can return softer and still be strong." },
  { id: "x18", theme: "overwhelmed", text: "Shrink the world to one room. That's not giving up." },
  { id: "x19", theme: "calm", text: "Let the ambient noise be the only conversation." },
  { id: "x20", theme: "rest", text: "Pause like you mean it." },
];

export function getQuoteById(id: string): QuietQuote | undefined {
  return QUIET_QUOTES.find(q => q.id === id);
}

export function quotesForTheme(theme: QuietTheme | null | undefined): QuietQuote[] {
  if (!theme) return QUIET_QUOTES;
  const filtered = QUIET_QUOTES.filter(q => q.theme === theme);
  return filtered.length > 0 ? filtered : QUIET_QUOTES;
}

/**
 * Pick a random quote, preferring `theme` and avoiding `recentIds` when possible.
 */
export function pickQuietQuote(
  theme: QuietTheme | null | undefined,
  recentIds: string[] = [],
): QuietQuote {
  const pool = quotesForTheme(theme);
  const fresh = pool.filter(q => !recentIds.includes(q.id));
  const use = fresh.length > 0 ? fresh : pool;
  return use[Math.floor(Math.random() * use.length)]!;
}
