// Animation / Embed Engine — the cinematic visuals.
//
// Everything a battle shows the player is built here: HP/energy/ultimate bars,
// the live combat card, intro frames, and the victory screen. The battle lives
// in ONE message that these builders keep re-rendering (embed editing), which is
// what makes it feel alive without spamming the channel. Rarity colors come
// straight from the existing project palette (cards-data).

import { EmbedBuilder } from "discord.js";
import { rarityLabel, rarityEmoji, rarityColor, type RarityDisplayMap } from "../cards-data.js";
import type { Combatant, Rarity } from "./types.js";

export interface BattleView {
  a: Combatant;          // side 0 (challenger)
  b: Combatant;          // side 1 (opponent / AI)
  turnNumber: number;
  currentSide: 0 | 1;
  staked: boolean;
  log: string[];
  turnEndsAt?: number;   // epoch ms for the turn timer countdown
  displayMap: RarityDisplayMap | null;   // source-of-truth rarity display overrides
}

const BATTLE_COLOR = 0xed4245;

// ── Progress bars ────────────────────────────────────────────────────────────
// `██████░░░░ 60%` style bar. Exported for reuse by prep/summary screens.
export function bar(value: number, max: number, width = 10, filled = "█", empty = "░"): string {
  return `${meter(value, max, width, filled, empty)} ${pct(value, max)}%`;
}

function meter(value: number, max: number, width = 10, filled = "█", empty = "░"): string {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const n = Math.max(0, Math.min(width, Math.round(pct * width)));
  return filled.repeat(n) + empty.repeat(width - n);
}

function hpBar(value: number, max: number): string {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const width = 12;
  const n = Math.max(0, Math.min(width, Math.round(pct * width)));
  const glyph = pct > 0.5 ? "🟩" : pct > 0.25 ? "🟨" : "🟥";
  return glyph.repeat(n) + "⬛".repeat(width - n);
}

function pct(value: number, max: number): number {
  return max <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, value / max)) * 100);
}

function rarityColorOf(r: Rarity, displayMap: RarityDisplayMap | null): number {
  return rarityColor(r, null, displayMap) ?? BATTLE_COLOR;
}

function statusLine(c: Combatant): string {
  if (c.status.length === 0 && c.frozenTurns === 0) return "";
  const parts = c.status.map(s => `${s.emoji}${s.turns > 1 ? `×${s.turns}` : ""}`);
  if (c.frozenTurns > 0 && !c.status.some(s => s.kind === "freeze")) parts.push(`❄️×${c.frozenTurns}`);
  return parts.length ? `\n${parts.join(" ")}` : "";
}

// A combatant's stat block for the live battle embed.
export function combatantField(c: Combatant, active: boolean, displayMap: RarityDisplayMap | null): { name: string; value: string; inline: boolean } {
  const rEmoji = rarityEmoji(c.cardRarity, null, displayMap) ?? "•";
  const rLabel = rarityLabel(c.cardRarity, null, displayMap) ?? c.cardRarity;
  const turnMark = active ? "🔹 " : "";
  const name = `${turnMark}${rEmoji} ${c.cardName}`;
  const lines = [
    `<@${c.userId}>`.replace(/^<@AI>$/, "🤖 **AI**") + ` · *${rLabel}*`,
    `❤️ ${hpBar(c.hp, c.stats.maxHealth)}`,
    `\`${Math.max(0, c.hp)}/${c.stats.maxHealth}\`${c.shield > 0 ? ` 🛡️ ${c.shield}` : ""}`,
    `⚡ \`${meter(c.energy, c.stats.energyMax, 8)}\` ${pct(c.energy, c.stats.energyMax)}%`,
    `💀 \`${meter(c.ultimate, c.stats.ultimateMax, 8)}\` ${pct(c.ultimate, c.stats.ultimateMax)}%`,
  ];
  const st = statusLine(c);
  if (st) lines.push(st.trim());
  if (c.specialEffect) {
    lines.push(c.specialCooldownRemaining > 0
      ? `✨ ${c.specialCardName ?? "Special"} (⏳${c.specialCooldownRemaining})`
      : `✨ ${c.specialCardName ?? "Special"} ready`);
  }
  return { name, value: lines.join("\n"), inline: true };
}

// Player is "AI" — render mention safely.
function who(c: Combatant): string {
  return c.isAi ? `🤖 **AI (${c.aiDifficulty ?? "normal"})**` : `<@${c.userId}>`;
}

// ── Live combat embed ────────────────────────────────────────────────────────
export function buildCombatEmbed(v: BattleView, opts?: { currentMove?: string }): EmbedBuilder {
  const active = v.currentSide === 0 ? v.a : v.b;
  const embed = new EmbedBuilder()
    .setColor(rarityColorOf(active.cardRarity, v.displayMap))
    .setTitle(`⚔️ Card Battle — Turn ${v.turnNumber}${v.staked ? " · 💰 Staked" : ""}`)
    .addFields(
      combatantField(v.a, v.currentSide === 0, v.displayMap),
      combatantField(v.b, v.currentSide === 1, v.displayMap),
    );

  if (active.cardImageUrl) embed.setThumbnail(active.cardImageUrl);

  const logText = v.log.length ? v.log.slice(-6).join("\n") : "_The battlefield is quiet…_";
  embed.addFields({ name: "📜 Battle Log", value: logText.slice(0, 1024), inline: false });

  const turnLine = active.isAi
    ? `🤖 **AI** is deciding…`
    : `🔹 ${who(active)} — it's your move!`;
  const timer = v.turnEndsAt ? ` · ends <t:${Math.floor(v.turnEndsAt / 1000)}:R>` : "";
  embed.addFields({ name: "🎯 Current Turn", value: turnLine + timer, inline: false });

  if (opts?.currentMove) embed.setFooter({ text: opts.currentMove });
  return embed;
}

// ── Intro animation frames ───────────────────────────────────────────────────
export function buildIntroFrame(v: BattleView, frame: number): EmbedBuilder {
  const e = new EmbedBuilder().setColor(BATTLE_COLOR);
  switch (frame) {
    case 0:
      e.setTitle("⚔️ Battle Starting…").setDescription("The arena crackles with energy.");
      break;
    case 1:
      e.setTitle("🔥 A challenger enters!")
        .setDescription(`${rarityEmoji(v.a.cardRarity, null, v.displayMap)} **${v.a.cardName}** steps onto the battlefield for ${who(v.a)}!`);
      if (v.a.cardImageUrl) e.setThumbnail(v.a.cardImageUrl);
      break;
    case 2:
      e.setTitle("💥 The opponent answers!")
        .setDescription(`${rarityEmoji(v.b.cardRarity, null, v.displayMap)} **${v.b.cardName}** rises to fight for ${who(v.b)}!`);
      if (v.b.cardImageUrl) e.setThumbnail(v.b.cardImageUrl);
      break;
    default:
      e.setTitle("🪙 Coin toss decides who strikes first…")
        .setDescription(`${rarityEmoji(v.a.cardRarity, null, v.displayMap)} **${v.a.cardName}**  ⚔️  **${v.b.cardName}** ${rarityEmoji(v.b.cardRarity, null, v.displayMap)}`)
        .addFields(
          { name: who(v.a), value: `❤️ ${v.a.stats.maxHealth} · ⚔️ ${v.a.stats.attack} · 🛡️ ${v.a.stats.defense}`, inline: true },
          { name: who(v.b), value: `❤️ ${v.b.stats.maxHealth} · ⚔️ ${v.b.stats.attack} · 🛡️ ${v.b.stats.defense}`, inline: true },
        );
      break;
  }
  return e;
}

export function buildCoinFlipEmbed(v: BattleView, firstSide: 0 | 1, call: string): EmbedBuilder {
  const first = firstSide === 0 ? v.a : v.b;
  return new EmbedBuilder()
    .setColor(BATTLE_COLOR)
    .setTitle(`🪙 The coin lands on **${call.toUpperCase()}**!`)
    .setDescription(`${who(first)} with **${first.cardName}** moves first!`);
}

// ── Victory screen ───────────────────────────────────────────────────────────
export function buildWinnerEmbed(
  v: BattleView, winnerSide: 0 | 1 | null, rewardLines: string[],
): EmbedBuilder {
  const e = new EmbedBuilder();
  if (winnerSide === null) {
    e.setColor(0x99aab5).setTitle("🤝 Draw!").setDescription("Both cards fell together — an even match.");
  } else {
    const w = winnerSide === 0 ? v.a : v.b;
    const l = winnerSide === 0 ? v.b : v.a;
    e.setColor(rarityColorOf(w.cardRarity, v.displayMap))
      .setTitle("🏆 Victory!")
      .setDescription(`${rarityEmoji(w.cardRarity, null, v.displayMap)} **${w.cardName}** defeats **${l.cardName}**!\n${who(w)} wins the battle.`);
    if (w.cardImageUrl) {
      e.setThumbnail(w.cardImageUrl)
       .setImage(w.cardImageUrl);
    }
  }
  e.addFields(
    combatantField(v.a, false, v.displayMap),
    combatantField(v.b, false, v.displayMap),
  );
  if (rewardLines.length) e.addFields({ name: "🎁 Rewards", value: rewardLines.join("\n").slice(0, 1024), inline: false });
  e.setFooter({ text: `Battle lasted ${v.turnNumber} turn${v.turnNumber === 1 ? "" : "s"}` });
  return e;
}
