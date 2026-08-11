// 🎲 Dice Claim (mockup mg7) — roll 1d20 against a rarity-scaled target to
// capture the card. Legendary needs 15+, Mythic 18+, etc.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, diceTargetForRarity, type ButtonSpec } from "./shared.js";

export const diceGame: MiniGameDefinition = {
  key: "dice",
  name: "Dice Claim",
  blurb: "Roll 1d20 over a rarity-scaled target to capture.",
  timeoutMs: 20000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const target = diceTargetForRarity(session.card.rarity);
    session.state.target = target;
    const stars = Math.max(1, Math.min(5, Math.round((target - 4) / 3)));
    const buttons: ButtonSpec[] = [{ action: "roll", label: "ROLL (1D20)", emoji: "🎲", style: ButtonStyle.Primary }];
    return renderScreen(session, {
      theme: 0xa855f7,
      icon: "🎲",
      title: "CARD DROP",
      subtitle: `(Difficulty: ${session.rarityLabel.toUpperCase()})`,
      lines: [
        `To capture this ${session.rarityLabel} card,`,
        `you must roll **${target}+**.`,
      ],
      statusLabel: `${"★".repeat(stars)}  ·  TARGET ROLL`,
      statusValue: `${target}+`,
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
    }, {
      animateIntro: true,
      buttons,
      title: "🎲 CARD DROP",
      description: `To capture this **${session.rarityLabel}** card, roll **${target}+** on 1d20.`,
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    if (action !== "roll") return { done: false, render: await this.start(session) as MiniGameRender };
    const target = session.state.target as number;
    const roll = Math.floor(Math.random() * 20) + 1;
    if (roll >= target) {
      return { done: true, win: true, render: await winScreen(session, `You rolled **${roll}** (needed ${target}+) — captured!`) };
    }
    return { done: true, win: false, render: await loseScreen(session, `You rolled **${roll}** (needed ${target}+) — it slipped away.`) };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "You never rolled — the card wandered off.");
  },
};
