// 🗺️ Map Exploration — a grid of locations; the card is hidden at one. Choose
// where to investigate.
import { ButtonStyle } from "discord.js";
import type { MiniGameDefinition, MiniGameSession, MiniGameOutcome, MiniGameRender } from "../types.js";
import { renderScreen, winScreen, loseScreen, type ButtonSpec } from "./shared.js";

const THEME = 0x22c55e;
const LOCATIONS: { action: string; label: string; emoji: string }[] = [
  { action: "hq", label: "HQ", emoji: "🏢" },
  { action: "forest", label: "Forest", emoji: "🌲" },
  { action: "factory", label: "Factory", emoji: "🏭" },
  { action: "camp", label: "Camp", emoji: "⛺" },
  { action: "airfield", label: "Airfield", emoji: "🚁" },
  { action: "harbor", label: "Harbor", emoji: "🌊" },
];

export const mapGame: MiniGameDefinition = {
  key: "map",
  name: "Map Exploration",
  blurb: "Search the right location to find the card.",
  timeoutMs: 20000,

  start(session: MiniGameSession): Promise<MiniGameRender> {
    const winning = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)]!.action;
    session.state.winning = winning;
    const buttons: ButtonSpec[] = LOCATIONS.map(l => ({
      action: `go:${l.action}`, label: l.label, emoji: l.emoji, style: ButtonStyle.Secondary,
    }));
    return renderScreen(session, {
      theme: THEME,
      icon: "🗺️",
      title: "FIELD",
      titleTail: "RECON",
      lines: ["A card is hidden in the area.", "Choose where to investigate.", "Pick the right location!"],
      cardArtUrl: session.cardArtUrl,
      cardName: session.card.name,
      rarityLabel: session.rarityLabel,
      rarityColor: session.rarityColor,
      hideCardArt: true,
      cardBadge: "HIDDEN",
    }, {
      animateIntro: true,
      buttons,
      title: "🗺️ FIELD RECON",
      description: "A card is hidden somewhere on the map. **Choose where to investigate.**",
    });
  },

  async handle(session: MiniGameSession, action: string): Promise<MiniGameOutcome> {
    const winning = session.state.winning as string;
    const picked = action.split(":")[1];
    const loc = LOCATIONS.find(l => l.action === picked);
    if (picked === winning) {
      return { done: true, win: true, render: await winScreen(session, `You searched the ${loc?.label} — card found!`) };
    }
    const winLoc = LOCATIONS.find(l => l.action === winning);
    return { done: true, win: false, render: await loseScreen(session, `Nothing at the ${loc?.label}. It was hiding at the ${winLoc?.label}.`) };
  },

  onTimeout(session: MiniGameSession): Promise<MiniGameRender> {
    return loseScreen(session, "Recon timed out — the trail went cold.");
  },
};
