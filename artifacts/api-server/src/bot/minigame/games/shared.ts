// Shared helpers for the individual mini-games: button rows, canvas rendering,
// and the win/lose result screens. Keeps each game file to just its mechanic.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MiniGameSession, MiniGameRender } from "../types.js";
import {
  renderMiniGameStill, renderMiniGameIntro, MG_FILE, MG_GIF_FILE,
  type MiniGameScreenSpec,
} from "../canvas.js";

export interface ButtonSpec {
  action: string;
  label: string;
  style?: ButtonStyle;
  emoji?: string;
  disabled?: boolean;
}

// Build one or more 5-wide button rows. customId = `mg:<sessionId>:<action>`.
export function buildRows(session: MiniGameSession, buttons: ButtonSpec[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const b of buttons.slice(i, i + 5)) {
      const btn = new ButtonBuilder()
        .setCustomId(`mg:${session.id}:${b.action}`)
        .setLabel(b.label)
        .setStyle(b.style ?? ButtonStyle.Secondary);
      if (b.emoji) btn.setEmoji(b.emoji);
      if (b.disabled) btn.setDisabled(true);
      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

// Render a mini-game screen: canvas (animated intro when requested, else a still)
// + the embed description text. Best-effort canvas — null just drops the image.
export async function renderScreen(
  session: MiniGameSession,
  spec: MiniGameScreenSpec,
  opts: { animateIntro?: boolean; buttons?: ButtonSpec[]; description?: string; title?: string },
): Promise<MiniGameRender> {
  const wantGif = !!opts.animateIntro && session.animate;
  const image = wantGif
    ? await renderMiniGameIntro(spec)
    : await renderMiniGameStill(spec);
  const imageName = wantGif && image ? MG_GIF_FILE : MG_FILE;
  return {
    title: opts.title ?? `${spec.icon ?? "🎯"} ${spec.title} ${spec.titleTail ?? ""}`.trim(),
    description: opts.description ?? spec.lines.join("\n"),
    color: spec.theme,
    image,
    imageName,
    components: opts.buttons ? buildRows(session, opts.buttons) : [],
  };
}

// A caught-it win screen (no buttons — the manager grants the card next).
export async function winScreen(session: MiniGameSession, flavor: string): Promise<MiniGameRender> {
  const spec: MiniGameScreenSpec = {
    theme: 0x2ecc71,
    icon: "✅",
    title: "CARD",
    titleTail: "SECURED",
    lines: [flavor, "", `**${session.card.name}** is yours.`],
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarityLabel: session.rarityLabel,
    rarityColor: session.rarityColor,
  };
  return renderScreen(session, spec, {
    description: `✅ ${flavor}\n\n**${session.card.name}** is yours!`,
    title: "✅ CARD SECURED",
  });
}

// A card-escaped lose screen.
export async function loseScreen(session: MiniGameSession, flavor: string): Promise<MiniGameRender> {
  const spec: MiniGameScreenSpec = {
    theme: 0x636e72,
    icon: "💨",
    title: "CARD",
    titleTail: "ESCAPED",
    lines: [flavor, "", "It slipped away…"],
    cardArtUrl: session.cardArtUrl,
    cardName: session.card.name,
    rarityLabel: session.rarityLabel,
    rarityColor: 0x636e72,
    hideCardArt: false,
  };
  return renderScreen(session, spec, {
    description: `💨 ${flavor}\n\n**${session.card.name}** got away — better luck next spawn.`,
    title: "💨 CARD ESCAPED",
  });
}

// Rarity → dice target (roll a d20 >= target to capture). Scales with rarity.
export function diceTargetForRarity(rarity: string): number {
  switch (rarity) {
    case "mythic": return 18;
    case "legendary": return 15;
    case "epic": return 12;
    case "rare": return 10;
    case "uncommon": return 8;
    default: return 6;
  }
}
