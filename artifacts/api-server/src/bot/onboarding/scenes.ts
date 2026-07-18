// ─────────────────────────────────────────────────────────────────────────────
// Onboarding scenes — tutorial "scripts" built from the reusable scripted-
// Discord layers. Each scene is just a declarative list of timed UI layers, so
// new lessons are authored here without writing any new animation code. This is
// the payoff of the discord.ts toolkit: chapters are data, not renderers.
// ─────────────────────────────────────────────────────────────────────────────

import type { AnimationResult } from "../animations/types.js";
import {
  renderScriptedScene, chatMessage, typingIndicator, slashInput, buttonRow, botReply, cursor, DISCORD,
} from "../animations/cinematic/discord.js";

// Chapter 1 demo: the bot shows a new player how earning works — a slash command
// is typed with autocomplete, the bot "thinks", replies with a reward embed, and
// a follow-up button is pressed. Purely a demonstration; the player acts for real
// right after, in the live command.
export async function renderDailyDemo(username: string): Promise<AnimationResult | null> {
  const name = (username || "you").slice(0, 16);
  return renderScriptedScene({
    channelName: "dn-cards",
    durationMs: 5200,
    seed: `onb-daily-${name}`,
    layers: [
      slashInput({
        command: "/daily", y: 380, width: 688, at: 0.02, typeUntil: 0.28,
        autocomplete: [
          { label: "/daily", desc: "Claim your daily DN Shards reward" },
          { label: "/pack", desc: "Open a card pack" },
        ],
        highlight: 0, showPopupUntil: 0.32,
      }),
      cursor({ points: [{ at: 0.0, x: 360, y: 300 }, { at: 0.3, x: 210, y: 402 }, { at: 0.34, x: 210, y: 402 }], clicks: [0.33] }),
      chatMessage({ author: name, authorColor: 0x57f287, avatarColor: 0x57f287, timestamp: "today", lines: ["/daily"], y: 92, at: 0.36 }),
      typingIndicator({ y: 150, at: 0.44, until: 0.6 }),
      botReply({ title: "Daily Reward Claimed!", lines: ["You received 500 shards.", "Streak: 1 day"], color: DISCORD.green, y: 150, at: 0.62, width: 560 }),
      buttonRow({ buttons: [{ label: "Open Collection", style: "blurple" }], x: 70, y: 300, at: 0.8, pressIndex: 0, pressAt: 0.94 }),
      cursor({ points: [{ at: 0.8, x: 210, y: 402 }, { at: 0.93, x: 130, y: 318 }], clicks: [0.94] }),
    ],
  });
}
