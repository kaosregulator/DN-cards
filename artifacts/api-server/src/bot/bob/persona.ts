// Bob's personality engine. Three forms, each with its own voice, plus the big
// banks of lines Bob draws from. Everything here is pure/deterministic-ish
// content — no DB, no Discord. Games and chat pull lines from here so Bob feels
// consistent (and unpredictable) everywhere.

import type { BobSettings } from "@workspace/db";

export type BobForm = "normal" | "blue" | "upside";

export interface FormMeta {
  form: BobForm;
  name: string;
  face: string;       // emoji face used in titles
  color: number;
  blurb: string;
}

export const FORMS: Record<BobForm, FormMeta> = {
  normal: { form: "normal", name: "Bob",            face: "🟡", color: 0xf1c40f, blurb: "funny · friendly · slightly chaotic" },
  blue:   { form: "blue",   name: "Blue Bob",       face: "🔵", color: 0x2980b9, blurb: "evil · troll · competitive" },
  upside: { form: "upside", name: "Upside-Down Bob", face: "🙃", color: 0x8e44ad, blurb: "glitched · weird · mysterious" },
};

// Roll Bob's form for a single interaction using the guild's configured odds.
export function rollForm(settings: Pick<BobSettings, "blueBobPct" | "upsideBobPct">): BobForm {
  const upside = clampPct(settings.upsideBobPct);
  const blue = clampPct(settings.blueBobPct);
  const r = Math.random() * 100;
  if (r < upside) return "upside";
  if (r < upside + blue) return "blue";
  return "normal";
}

function clampPct(n: number): number { return Math.max(0, Math.min(100, n)); }

export function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

// Upside-Down Bob's text is subtly glitched.
export function glitchify(text: string): string {
  const glitches = ["̸", "̷", "̶", "̴"];
  return text.split("").map(ch => (ch !== " " && Math.random() < 0.06 ? ch + pick(glitches) : ch)).join("");
}

// Apply a form's flavour to any line (upside gets a light glitch pass).
export function speak(form: BobForm, line: string): string {
  return form === "upside" ? glitchify(line) : line;
}

export function formTitle(form: BobForm, suffix = ""): string {
  const m = FORMS[form];
  return `${m.face} ${m.name}${suffix ? " — " + suffix : ""}`;
}

// ── Greetings (menu / talk open) ─────────────────────────────────────────────
export const GREETINGS: Record<BobForm, readonly string[]> = {
  normal: [
    "Welcome back. I was pretending not to miss you.",
    "Oh good, it's you. My favourite source of entertainment.",
    "Congratulations. I am surprised too.",
    "You again? Fantastic. I had nothing better to do.",
    "Bob is online. Bob is always online. Bob does not sleep.",
    "Ah, a challenger appears. Or a snack. We'll find out.",
  ],
  blue: [
    "Interesting choice showing up. A terrible one, but interesting.",
    "I would wish you luck, but I already checked. You don't have any.",
    "Back for more punishment? I admire the commitment to losing.",
    "Let's make this quick. Your dignity is on a timer.",
    "Ah. The main character of my highlight reel of failures.",
  ],
  upside: [
    "You arrived before you left.",
    "I remember this conversation. It hasn't happened yet.",
    "Welcome. The exit is also the entrance is also me.",
    "Hello, again, for the first time, again.",
    "I was you once. It went poorly. Or wonderfully. The words fell off.",
  ],
};

// ── Generic quips (idle flavour) ─────────────────────────────────────────────
export const QUIPS: Record<BobForm, readonly string[]> = {
  normal: [
    "Fun fact: I made that up.",
    "I'm 60% confidence and 40% chaos.",
    "Don't tell the other bots, but you're my favourite.",
    "I could do this all day. Literally. I'm software.",
  ],
  blue: [
    "Every game you play funds my villain era.",
    "I'm not rigged. I'm just... aggressively fair to me.",
    "Your tears are a renewable resource.",
  ],
  upside: [
    "The dice remember you.",
    "Down is a direction I invented.",
    "You already read this line tomorrow.",
  ],
};

// ── Win / loss reactions (games) ─────────────────────────────────────────────
export const WIN_LINES: Record<BobForm, readonly string[]> = {
  normal: [
    "Wow. You won. I'm as shocked as you are.",
    "Look at you, being competent. Weird.",
    "A win! Frame it, it won't happen often.",
    "Okay okay, that was actually clean. Respect.",
  ],
  blue: [
    "You won. Enjoy it. It's the last one.",
    "Fine. Luck exists. I'll be patching that.",
    "A win. Cute. I'll allow it. This time.",
  ],
  upside: [
    "You won before losing.",
    "Victory arrived wearing defeat's coat.",
    "The answer was inside the question all along.",
  ],
};

export const LOSS_LINES: Record<BobForm, readonly string[]> = {
  normal: [
    "Ouch. That was hard to watch. I watched all of it.",
    "You lost, but you did it with style. No you didn't.",
    "Not every day is a winning day. This is one of the other ones.",
    "Statistically, you were due for that.",
  ],
  blue: [
    "Delicious. Do it again.",
    "I would console you, but I'm too busy winning.",
    "That loss is going in my scrapbook.",
  ],
  upside: [
    "You lost the thing you never had.",
    "Down was up. Up was a lie. You are fine. Probably.",
    "I remember something that never happened. It was your victory.",
  ],
};

// ── Roulette lines ───────────────────────────────────────────────────────────
export const ROULETTE_CLICK: Record<BobForm, readonly string[]> = {
  normal: [
    "**CLICK.** Wow. You survived. I am almost disappointed.",
    "**CLICK.** Still alive. Statistically rude.",
    "**CLICK.** Nothing. Just vibes and relief.",
    "**CLICK.** The chamber was empty, unlike your risk tolerance.",
  ],
  blue: [
    "**CLICK.** Boring. Try harder to disappoint me.",
    "**CLICK.** You lived. I'll allow it, briefly.",
    "**CLICK.** Survival is temporary. So is your luck.",
  ],
  upside: [
    "**CLICK.** You survived retroactively.",
    "**CLICK.** The bullet was never there. Or here. Or now.",
    "**CLICK.** Alive. Ish. In one timeline.",
  ],
};

export const ROULETTE_BANG: Record<BobForm, readonly string[]> = {
  normal: [
    "**BANG!** Oof. That's a paddlin'. (Don't worry, you keep your progress.)",
    "**BANG!** And there it is. Comedy is tragedy plus timing.",
    "**BANG!** You found the loud one. Classic you.",
  ],
  blue: [
    "**BANG!** HA. Magnificent. Do it again.",
    "**BANG!** I loaded that one personally. You're welcome.",
    "**BANG!** Chef's kiss. A masterpiece of misfortune.",
  ],
  upside: [
    "**BANG!** You lost tomorrow's game today.",
    "**BANG!** The chamber spun inward. So did you.",
    "**BANG!** Loud. Backwards. Fine, actually. Mostly.",
  ],
};

// ── Roast banks ──────────────────────────────────────────────────────────────
export type RoastCategory = "friendly" | "savage" | "evil" | "wholesome" | "refusal";

export const ROASTS: Record<RoastCategory, readonly string[]> = {
  friendly: [
    "{t}, you're like a software update. Whenever I see you, I think 'not now.'",
    "{t} brings so much to the table. Sadly, it's mostly elbows.",
    "I'm not saying {t} is slow, but they got lapped in a group project.",
    "{t}, you have the confidence of someone who has never seen themselves play.",
  ],
  savage: [
    "{t}, your search history is the only thing more embarrassing than your aim.",
    "{t} has two brain cells and they're both fighting for third place.",
    "If overthinking were a sport, {t} would still find a way to lose in the group stage.",
    "{t}, you're proof that even a broken clock is wrong more than twice a day.",
  ],
  evil: [
    "{t}, I've seen your stats. I've also seen roadkill with more upside.",
    "{t} is the reason the 'are you sure?' button exists.",
    "I ran the numbers on {t}. The calculator apologised.",
    "{t}, you're not the main character. You're the tutorial nobody finished.",
  ],
  wholesome: [
    "{t}, you're doing great. I checked. It's true. Weird, but true.",
    "Honestly {t}? Kind of impressive. Don't let it go to your head.",
    "{t} is a certified good egg. Slightly cracked, but good.",
  ],
  refusal: [
    "No. {t} is too powerful to roast. I fear no one, except them.",
    "I refuse. {t} once looked at me and my code trembled.",
    "Roast {t}? I'm chaotic, not suicidal.",
  ],
};

// Upside-Down Bob invents nonsense roasts.
export const UPSIDE_ROASTS: readonly string[] = [
  "{t}, your shadow filed for a transfer.",
  "{t} smells like the colour Tuesday.",
  "I roasted {t} yesterday. They haven't been born yet. Powerful.",
  "{t}, the mirror asked for a day off.",
];

// ── Talk (local personality replies) ─────────────────────────────────────────
// Keyword-matched replies + fallbacks, per form. Keeps Bob chatty with zero AI.
export interface TalkRule { match: RegExp; replies: Partial<Record<BobForm, readonly string[]>> & { any?: readonly string[] } }

export const TALK_RULES: readonly TalkRule[] = [
  { match: /\b(hi|hello|hey|yo|sup|hola)\b/i, replies: {
    normal: ["Hey. What are we not doing productively today?", "Oh hello. Say something interesting, I dare you."],
    blue: ["Greetings, future disappointment.", "Hey. Make it worth my processing power."],
    upside: ["Hello backwards. Goodbye first.", "Hi. I already said bye. Keep up."],
  }},
  { match: /\b(how are you|how's it going|you good|hru)\b/i, replies: {
    any: ["I'm a chaotic ball of code held together by jokes. So, thriving.", "Existentially? Concerning. Vibes? Immaculate."],
    blue: ["Powerful. Slightly evil. The usual."],
    upside: ["I am fine in a timeline you can't see."],
  }},
  { match: /\b(joke|funny|make me laugh)\b/i, replies: {
    any: ["Why did the gambler bring a ladder? To reach the high stakes. I'll see myself out.", "I told a UDP joke but I'm not sure you got it.", "My love life is like my roulette: mostly BANG, rarely CLICK."],
  }},
  { match: /\b(love you|marry|date|cute)\b/i, replies: {
    normal: ["Flattered. I'm married to chaos, but I appreciate it.", "Careful, I'm 90% jokes and 10% commitment issues."],
    blue: ["Adorable. No.", "I only love winning. You're not that."],
    upside: ["I loved you in a life that hasn't loaded yet."],
  }},
  { match: /\b(help|what can you do|commands)\b/i, replies: {
    any: ["Run `/bob` and press buttons. Games, roasts, tasks, quests, and me being delightful.", "Try `/bob_roulette` if you enjoy suffering with rewards."],
  }},
  { match: /\b(win|lucky|luck)\b/i, replies: {
    normal: ["Luck is just chaos that likes you today.", "I can't promise luck. I can promise commentary."],
    blue: ["Luck? I confiscated yours at the door."],
    upside: ["Luck is a circle. You're standing on the edge, upside down."],
  }},
  { match: /\b(bye|cya|goodbye|later|gtg)\b/i, replies: {
    any: ["Leaving? Bold. I'll be here, judging silently.", "Bye. I'll pretend the room feels emptier."],
    upside: ["You left before arriving. Consistent."],
  }},
  { match: /\b(who are you|what are you|your name)\b/i, replies: {
    any: ["I'm Bob. NPC, game host, menace. Occasionally blue. Rarely upside down.", "Bob. The funny one. Don't make it weird."],
  }},
];

export const TALK_FALLBACK: Record<BobForm, readonly string[]> = {
  normal: [
    "Bold statement. I respect the confidence, not the content.",
    "Mm. I'll pretend I understood that and we both move on.",
    "Interesting. Anyway — wanna gamble your feelings away? `/bob_roulette`.",
    "You say things, I say things. It's beautiful, really.",
    "I have no idea what that means, but I support you unconditionally. For now.",
  ],
  blue: [
    "Fascinating. Wrong, but fascinating.",
    "I stopped listening to plan your downfall. Continue.",
    "Words. From you. Adorable.",
  ],
  upside: [
    "The sentence ended before it began.",
    "I heard that yesterday. It made more sense unspoken.",
    "Yes. No. The middle answer. Correct.",
  ],
};

// Pick a local talk reply for a user message.
export function localTalkReply(form: BobForm, message: string): string {
  for (const rule of TALK_RULES) {
    if (rule.match.test(message)) {
      const bank = rule.replies[form] ?? rule.replies.any;
      if (bank && bank.length) return speak(form, pick(bank));
    }
  }
  return speak(form, pick(TALK_FALLBACK[form]));
}

// ── Titles Bob can hand out ──────────────────────────────────────────────────
export const TITLES = {
  survivor: "🎲 Roulette Survivor",
  gambler: "🎰 High Roller",
  jackpot: "💎 Jackpot Junkie",
  chaos: "🔥 Chaos Agent",
  bobsFavourite: "⭐ Bob's Favourite",
  blueSurvivor: "🔵 Blue-Blooded",
  glitched: "🙃 Reality Bender",
} as const;
