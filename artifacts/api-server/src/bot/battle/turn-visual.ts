// ─────────────────────────────────────────────────────────────────────────────
// Turn visuals — the SHARED bridge from combat resolution to the animation
// pipeline. Both the 1v1 battle-manager AND co-op raids use these helpers so a
// resolved move maps to the same on-screen attack frame (scene, damage, crit,
// subtitle) everywhere. Combat logic stays in combat-engine; this is purely the
// "how do we picture what just happened" layer, with no combat state of its own.
// ─────────────────────────────────────────────────────────────────────────────

import type { Combatant, MoveType, TurnResult } from "./types.js";
import type { RenderCard } from "./image/render.js";
import type { AttackScene } from "../animations/index.js";
import { getBattleItem } from "./items.js";
import { getMoveset } from "./movesets.js";

// Everything the shared attack-frame renderer needs about a single resolved
// move, derived from HP-pool deltas + the event flashes the engine emits.
export interface MoveVisual {
  damage: number;      // pool lost by the foe (hp + shield)
  selfGain: number;    // pool gained by the actor (heal/shield)
  isCrit: boolean;
  isHit: boolean;
  scene: AttackScene;
  subtitle?: string;
}

// Compute the visual for a resolved move. Pass the foe/actor pool totals
// captured IMMEDIATELY BEFORE resolveMove ran.
export function computeMoveVisual(
  move: MoveType, result: TurnResult, actor: Combatant, foe: Combatant,
  foePoolBefore: number, selfPoolBefore: number,
): MoveVisual {
  const damage = Math.max(0, foePoolBefore - (foe.hp + foe.shield));
  const selfGain = Math.max(0, (actor.hp + actor.shield) - selfPoolBefore);
  const isCrit = result.events.some(e => e.flash === "crit");
  const scene = deriveAttackScene(move, result, isCrit, damage, actor, foe);
  const subtitle = sceneSubtitle(scene, selfGain, result);
  return { damage, selfGain, isCrit, isHit: damage > 0, scene, subtitle };
}

// Map a resolved move to a canvas SCENE so the shared renderer themes the frame
// (special/ultimate/KO/counter/heal/shield/buff/debuff). Reads the event flashes
// the combat engine already emits — no new combat state.
export function deriveAttackScene(
  move: MoveType, result: TurnResult, isCrit: boolean, damage: number,
  actor: Combatant, foe: Combatant,
): AttackScene {
  if (result.koed || foe.hp <= 0) return "ko";
  const flashes = new Set(result.events.map(e => e.flash));
  if (move === "ultimate") return "ultimate";
  if (flashes.has("counter")) return "counter";
  if (move === "defend" || flashes.has("shield") || flashes.has("shield_break")) return "shield";
  if (flashes.has("heal")) return "heal";
  if (move === "charge") return "buff";
  if (move === "item") {
    const item = actor.item ?? getBattleItem(actor.itemId);
    switch (item?.effectType) {
      case "heal": return "heal";
      case "shield": return "shield";
      case "buff": case "energy": return "buff";
      case "debuff": return "debuff";
      case "status": return item.target === "foe" ? "debuff" : "buff";
      default: return "item";
    }
  }
  if (move === "special") return "special";
  if (damage <= 0 && (move === "attack")) return "miss";
  if (isCrit) return "crit";
  return "attack";
}

// A short caption under the impact FX for self-affecting scenes.
export function sceneSubtitle(scene: AttackScene, selfGain: number, result: TurnResult): string | undefined {
  if (scene === "heal" && selfGain > 0) return `+${selfGain.toLocaleString()} HP`;
  if (scene === "shield" && selfGain > 0) return `+${selfGain.toLocaleString()} shield`;
  if (scene === "buff") return "Empowered";
  if (scene === "debuff") return "Weakened";
  if (scene === "counter") return "Reversed!";
  void result;
  return undefined;
}

// Build a RenderCard for the attack-frame renderer straight from a Combatant,
// without needing the battle runtime's rarity display map. Prefers the
// combatant's resolved display rarity; the renderer falls back to a rarity
// effect colour when rarityColor is null.
export function combatantToRenderCard(c: Combatant): RenderCard {
  const display = c.cardRarityDisplay;
  return {
    name: c.cardName,
    rarity: c.cardRarity,
    rarityLabel: display ? `${display.emoji} ${display.label}` : c.cardRarity,
    rarityColor: display?.color ?? null,
    cardId: c.cardId,
    cardType: c.cardType,
    artUrl: c.cardImageUrl,
    attack: c.stats.attack,
    special: getMoveset(c.moveset)?.name ?? null,
  };
}
