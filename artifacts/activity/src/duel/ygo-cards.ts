// ─────────────────────────────────────────────────────────────────────────────
// Real Yu-Gi-Oh card data.
//
// The DUEL is played with authentic Yu-Gi-Oh cards — real names, real card
// text, real Level / Attribute / Type / ATK / DEF and real effects — while the
// ARTWORK is always the server's own card image. Every server card is bound to
// a real card "template" of a matching power tier, so a duel plays by the real
// game's numbers while showing your art.
//
// The record shape mirrors the reference duel project's card database
// (key/name/level/attribute/race/atk/def/description).
// ─────────────────────────────────────────────────────────────────────────────

import type { DuelAttribute, DuelEffect } from "./types";

export interface YgoMonster {
  key: number;            // real passcode
  name: string;
  level: number;
  attribute: DuelAttribute;
  race: string;           // Dragon / Spellcaster / Warrior / …
  atk: number;
  def: number;
  description: string;    // the real card text
  effect: DuelEffect | null;
}

// ── Monsters, ordered low → high power. Binding picks by tier. ───────────────
export const YGO_MONSTERS: YgoMonster[] = [
  {
    key: 40640057, name: "Kuriboh", level: 1, attribute: "DARK", race: "Fiend", atk: 300, def: 200,
    description: "During damage calculation, if your opponent's monster attacks (Quick Effect): You can discard this card; you take no battle damage from that battle.",
    effect: null,
  },
  {
    key: 31560081, name: "Magician of Faith", level: 1, attribute: "LIGHT", race: "Spellcaster", atk: 300, def: 400,
    description: "FLIP: Target 1 Spell in your Graveyard; add that target to your hand.",
    effect: { kind: "drawOnSummon", count: 1 },
  },
  {
    key: 54652250, name: "Man-Eater Bug", level: 2, attribute: "EARTH", race: "Insect", atk: 450, def: 600,
    description: "FLIP: Target 1 monster on the field; destroy that target.",
    effect: { kind: "flip:destroy" },
  },
  {
    key: 71625222, name: "Time Wizard", level: 2, attribute: "LIGHT", race: "Spellcaster", atk: 500, def: 400,
    description: "Once per turn: You can toss a coin and call it. If you call it right, destroy all monsters your opponent controls.",
    effect: null,
  },
  {
    key: 46448938, name: "Trap Master", level: 3, attribute: "EARTH", race: "Warrior", atk: 500, def: 1100,
    description: "FLIP: Target 1 Set Spell/Trap Card on the field; destroy that target.",
    effect: null,
  },
  {
    key: 26202165, name: "Sangan", level: 3, attribute: "DARK", race: "Fiend", atk: 1000, def: 600,
    description: "If this card is sent from the field to the Graveyard: Add 1 monster with 1500 or less ATK from your Deck to your hand.",
    effect: { kind: "drawOnSummon", count: 1 },
  },
  {
    key: 78193831, name: "Silver Fang", level: 3, attribute: "EARTH", race: "Beast", atk: 1200, def: 800,
    description: "A snow wolf that's beautiful to the eye, but absolutely vicious in battle.",
    effect: null,
  },
  {
    key: 40374923, name: "Baby Dragon", level: 3, attribute: "WIND", race: "Dragon", atk: 1200, def: 700,
    description: "Much more than just a child, this dragon is a clever combatant that quickly grows in power.",
    effect: null,
  },
  {
    key: 40374924, name: "Mammoth Graveyard", level: 3, attribute: "EARTH", race: "Dinosaur", atk: 1200, def: 800,
    description: "A mammoth that guards the graves of its brethren, it can retaliate from beyond the grave.",
    effect: null,
  },
  {
    key: 13039848, name: "Giant Soldier of Stone", level: 3, attribute: "EARTH", race: "Rock", atk: 1300, def: 2000,
    description: "A giant warrior made of stone. A punch from this creature has earth-shaking results.",
    effect: null,
  },
  {
    key: 78010363, name: "Aqua Madoor", level: 4, attribute: "WATER", race: "Spellcaster", atk: 1200, def: 2000,
    description: "A wizard of the waters who conjures a liquid wall to crush any enemies who oppose him.",
    effect: null,
  },
  {
    key: 32452818, name: "Beaver Warrior", level: 4, attribute: "EARTH", race: "Beast-Warrior", atk: 1200, def: 1500,
    description: "What this creature lacks in size it makes up for in defense when battling in the plains.",
    effect: null,
  },
  {
    key: 76922029, name: "Witch of the Black Forest", level: 4, attribute: "DARK", race: "Spellcaster", atk: 1100, def: 1200,
    description: "If this card is sent from the field to the Graveyard: Add 1 monster with 1500 or less DEF from your Deck to your hand.",
    effect: { kind: "drawOnSummon", count: 1 },
  },
  {
    key: 76812113, name: "Feral Imp", level: 4, attribute: "DARK", race: "Fiend", atk: 1300, def: 1400,
    description: "A playful little fiend that lurks in the dark, waiting to attack an unwary enemy.",
    effect: null,
  },
  {
    key: 76812114, name: "Harpie Lady", level: 4, attribute: "WIND", race: "Winged Beast", atk: 1300, def: 1400,
    description: "A beautiful but dangerous winged creature that strikes with razor-sharp talons.",
    effect: null,
  },
  {
    key: 91152256, name: "Celtic Guardian", level: 4, attribute: "EARTH", race: "Warrior", atk: 1400, def: 1200,
    description: "An elf who learned to wield a sword, he baffles enemies with lightning-swift attacks.",
    effect: null,
  },
  {
    key: 10202894, name: "Skull Red Bird", level: 4, attribute: "WIND", race: "Winged Beast", atk: 1550, def: 1200,
    description: "A ferocious bird that attacks enemies with wings as sharp as blades.",
    effect: null,
  },
  {
    key: 5053103, name: "Battle Ox", level: 4, attribute: "EARTH", race: "Beast-Warrior", atk: 1700, def: 1000,
    description: "A monster with tremendous power, it destroys enemies with a swing of its axe.",
    effect: null,
  },
  {
    key: 50930991, name: "Neo the Magic Swordsman", level: 4, attribute: "LIGHT", race: "Spellcaster", atk: 1700, def: 1000,
    description: "A swordsman who mastered magic, his blade cuts through spells as easily as armour.",
    effect: null,
  },
  {
    key: 48305365, name: "Axe Raider", level: 4, attribute: "EARTH", race: "Warrior", atk: 1700, def: 1150,
    description: "An axe-wielding monster of tremendous strength and agility.",
    effect: null,
  },
  {
    key: 97590747, name: "La Jinn the Mystical Genie of the Lamp", level: 4, attribute: "DARK", race: "Fiend", atk: 1800, def: 1000,
    description: "A genie of the lamp that is often used for wicked purposes.",
    effect: null,
  },
  {
    key: 11321183, name: "Dark Blade", level: 4, attribute: "DARK", race: "Warrior", atk: 1800, def: 1500,
    description: "A ruthless warrior in black armour, wielding twin blades that cut through the night.",
    effect: null,
  },
  {
    key: 14898066, name: "Vorse Raider", level: 4, attribute: "DARK", race: "Beast-Warrior", atk: 1900, def: 1200,
    description: "A savage beast-warrior whose axe has claimed countless duels.",
    effect: { kind: "gainAtk", amount: 300 },
  },
  {
    key: 69140098, name: "Gemini Elf", level: 4, attribute: "EARTH", race: "Spellcaster", atk: 1900, def: 900,
    description: "Elf twins that attack in tandem, striking with alternating blows.",
    effect: { kind: "gainAtk", amount: 300 },
  },
  {
    key: 11091375, name: "Luster Dragon", level: 4, attribute: "WIND", race: "Dragon", atk: 1900, def: 1600,
    description: "A dragon of shimmering sapphire, prized for both its beauty and its ferocity.",
    effect: { kind: "gainAtk", amount: 300 },
  },
  {
    key: 21417692, name: "Dark Elf", level: 4, attribute: "DARK", race: "Spellcaster", atk: 2000, def: 800,
    description: "Pay 1000 Life Points to activate this card. Once per turn, this monster can attack directly.",
    effect: { kind: "pierce" },
  },
  {
    key: 70781052, name: "Summoned Skull", level: 6, attribute: "DARK", race: "Fiend", atk: 2500, def: 1200,
    description: "A fiend with dark powers for confusing the enemy. Among the Fiend-Type monsters, this one boasts considerable force.",
    effect: { kind: "pierce" },
  },
  {
    key: 77585513, name: "Jinzo", level: 6, attribute: "DARK", race: "Machine", atk: 2400, def: 1500,
    description: "Trap Cards cannot be activated. The effects of all face-up Trap Cards are negated.",
    effect: { kind: "negateTraps" },
  },
  {
    key: 30190809, name: "Judge Man", level: 6, attribute: "EARTH", race: "Warrior", atk: 2200, def: 1500,
    description: "A muscled warrior who wields two clubs and passes judgment on all who challenge him.",
    effect: { kind: "pierce" },
  },
  {
    key: 28279543, name: "Curse of Dragon", level: 5, attribute: "DARK", race: "Dragon", atk: 2000, def: 1500,
    description: "A wicked dragon that taps into dark forces to execute a powerful attack.",
    effect: { kind: "burn", amount: 400 },
  },
  {
    key: 70095154, name: "Cyber Dragon", level: 5, attribute: "LIGHT", race: "Machine", atk: 2100, def: 1600,
    description: "If your opponent controls a monster and you control no monsters, you can Special Summon this card (from your hand).",
    effect: { kind: "burn", amount: 400 },
  },
  {
    key: 74677422, name: "Red-Eyes Black Dragon", level: 7, attribute: "DARK", race: "Dragon", atk: 2400, def: 2000,
    description: "A ferocious dragon with a deadly attack.",
    effect: { kind: "pierce" },
  },
  {
    key: 6368038, name: "Gaia The Fierce Knight", level: 7, attribute: "EARTH", race: "Warrior", atk: 2300, def: 2100,
    description: "A knight whose horse travels faster than the wind. His battle-charge is a force to be reckoned with.",
    effect: { kind: "pierce" },
  },
  {
    key: 46986414, name: "Dark Magician", level: 7, attribute: "DARK", race: "Spellcaster", atk: 2500, def: 2100,
    description: "The ultimate wizard in terms of attack and defense.",
    effect: { kind: "pierce" },
  },
  {
    key: 89631139, name: "Blue-Eyes White Dragon", level: 8, attribute: "LIGHT", race: "Dragon", atk: 3000, def: 2500,
    description: "This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.",
    effect: { kind: "doubleAttack" },
  },
];

// ── Real Spells & Traps ──────────────────────────────────────────────────────
export interface YgoSpellTrap {
  key: number;
  name: string;
  kind: "spell" | "trap";
  /** Normal / Quick-Play / Continuous / Equip / Counter — shown on the card. */
  sub: string;
  description: string;
  effect: DuelEffect;
}

export const YGO_SPELLS: YgoSpellTrap[] = [
  {
    key: 55144522, name: "Pot of Greed", kind: "spell", sub: "Normal",
    description: "Draw 2 cards.",
    effect: { kind: "spell:draw", count: 2 },
  },
  {
    key: 53129443, name: "Dark Hole", kind: "spell", sub: "Normal",
    description: "Destroy all monsters on the field.",
    effect: { kind: "spell:destroyAll" },
  },
  {
    key: 12580477, name: "Raigeki", kind: "spell", sub: "Normal",
    description: "Destroy all monsters your opponent controls.",
    effect: { kind: "spell:destroyAllOpp" },
  },
  {
    key: 5318639, name: "Mystical Space Typhoon", kind: "spell", sub: "Quick-Play",
    description: "Target 1 Spell/Trap on the field; destroy that target.",
    effect: { kind: "spell:destroySpellTrap" },
  },
  {
    key: 66788016, name: "Fissure", kind: "spell", sub: "Normal",
    description: "Destroy the 1 face-up monster your opponent controls that has the lowest ATK.",
    effect: { kind: "spell:fissure" },
  },
  {
    key: 14087893, name: "Book of Moon", kind: "spell", sub: "Quick-Play",
    description: "Target 1 face-up monster on the field; change that target to face-down Defense Position.",
    effect: { kind: "spell:flipTarget" },
  },
  {
    key: 83764718, name: "Monster Reborn", kind: "spell", sub: "Normal",
    description: "Target 1 monster in either GY; Special Summon it.",
    effect: { kind: "spell:reborn" },
  },
  {
    key: 46130346, name: "Rush Recklessly", kind: "spell", sub: "Quick-Play",
    description: "Target 1 monster on the field; it gains 700 ATK until the end of this turn.",
    effect: { kind: "spell:boost", amount: 700 },
  },
  {
    key: 87880531, name: "Dian Keto the Cure Master", kind: "spell", sub: "Normal",
    description: "Gain 1000 Life Points.",
    effect: { kind: "spell:heal", amount: 1500 },
  },
  {
    key: 40619825, name: "Axe of Despair", kind: "spell", sub: "Equip",
    description: "The equipped monster gains 1000 ATK.",
    effect: { kind: "equip:atk", atk: 1000 },
  },
  {
    key: 44394295, name: "Sword of Deep-Seated", kind: "spell", sub: "Equip",
    description: "The equipped monster gains 500 ATK/DEF.",
    effect: { kind: "equip:atk", atk: 500, def: 500 },
  },
  {
    key: 20721928, name: "Banner of Courage", kind: "spell", sub: "Continuous",
    description: "During your Battle Phase, all monsters you control gain 200 ATK.",
    effect: { kind: "continuous:allyAtk", amount: 400 },
  },
];

export const YGO_TRAPS: YgoSpellTrap[] = [
  {
    key: 44095762, name: "Mirror Force", kind: "trap", sub: "Normal",
    description: "When an opponent's monster declares an attack: Destroy all your opponent's Attack Position monsters.",
    effect: { kind: "trap:mirror" },
  },
  {
    key: 62279055, name: "Magic Cylinder", kind: "trap", sub: "Normal",
    description: "When an opponent's monster declares an attack: Negate the attack, and if you do, inflict damage to your opponent equal to that monster's ATK.",
    effect: { kind: "trap:cylinder" },
  },
  {
    key: 56120475, name: "Sakuretsu Armor", kind: "trap", sub: "Normal",
    description: "When an opponent's monster declares an attack: Target the attacking monster; destroy that target.",
    effect: { kind: "trap:sakuretsu" },
  },
  {
    key: 14315573, name: "Negate Attack", kind: "trap", sub: "Counter",
    description: "When an opponent's monster declares an attack: Negate the attack, then end the Battle Phase.",
    effect: { kind: "trap:negateAttack" },
  },
  {
    key: 4206964, name: "Trap Hole", kind: "trap", sub: "Normal",
    description: "When your opponent Normal or Flip Summons 1 monster with 1000 or more ATK: Target that monster; destroy that target.",
    effect: { kind: "trap:trapHole", threshold: 1000 },
  },
  {
    key: 97077563, name: "Call of the Haunted", kind: "trap", sub: "Continuous",
    description: "Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position.",
    effect: { kind: "trap:reborn" },
  },
];

export const YGO_SUPPORT: YgoSpellTrap[] = [...YGO_SPELLS, ...YGO_TRAPS];

// ── Binding server cards to real templates ───────────────────────────────────
// A server card keeps its own art and name; the real card supplies the Level,
// Attribute, Type, ATK/DEF, card text and effect. The binding is deterministic
// on the card id, so the same DN card is always the same real card.

/** Pick a real monster template for a card of the given power (0..1 tier). */
export function templateForTier(cardId: number, tier: number): YgoMonster {
  const t = Math.max(0, Math.min(0.999, tier));
  // Map the tier onto a window of the roster so strong cards land on strong
  // templates, with a deterministic spread inside that window.
  const span = 5;
  const centre = Math.floor(t * (YGO_MONSTERS.length - 1));
  const lo = Math.max(0, centre - Math.floor(span / 2));
  const hi = Math.min(YGO_MONSTERS.length - 1, lo + span - 1);
  const range = hi - lo + 1;
  const pick = lo + (hashId(cardId) % range);
  return YGO_MONSTERS[pick]!;
}

function hashId(id: number): number {
  let h = (id * 2654435761) >>> 0;
  h ^= h >>> 13; h = (h * 1274126177) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
