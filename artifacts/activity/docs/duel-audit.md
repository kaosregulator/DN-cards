# Duel Engine — Feature Audit vs. Reference Repositories

Audit of every duel mechanic in the two reference projects, mapped to the DN
Cards Phaser 4 engine (`src/duel/*`), with a port decision and priority.

Reference sources:

- **yugioh_web** (rickypeng99) — a React/Redux browser duel. JS rules we can port
  directly: phases, normal/tribute summon, attack-position combat, card kinds
  (monster/spell/trap + sub-types), effect/spell/trap scaffolding.
  Key files: `Core/Summon`, `Core/Battle`, `Core/Effect`, `Components/Card/utils/constant.js`,
  `Store/reducers/{gameMeta,battleMeta}Reducer.js`.
- **YGOProUnity_V2** (lllyasviel) — a Unity client over **ocgcore** (the real
  Yu-Gi-Oh rules engine). Not portable as code (C#/C++/Lua), but its client
  protocol (`coreWrapper.cs` `GameMessage` enum, `Ocgcore.cs`) is the definitive
  **checklist of every mechanic** a complete duel has. We port the *behaviour*,
  not the code.

Legend — **Status**: ✅ done · 🟡 partial · ⛔ missing. **Priority**: P0 highest.

---

## 1. Turn structure & phases

| Mechanic | yugioh_web | ocgcore | DN status | Notes / port |
|---|---|---|---|---|
| Draw → Standby → MP1 → Battle → MP2 → End | `PHASE` | `NewPhase(41)` | ✅ | Implemented in `engine.nextPhase/endTurn`. |
| First turn skips Draw | — | yes | ✅ | `createDuel` starts P1 in MP1, no draw. |
| New Turn / turn pass | `CHANGE_PHASE` | `NewTurn(40)` | ✅ | `endTurn`. |
| Standby-phase triggers | — | phase triggers | ⛔ P3 | No card needs it yet. |
| Battle Phase skippable / no BP turn 1 going first | — | rule | 🟡 P3 | We allow BP turn 1; optional rule. |

## 2. Summoning methods

| Mechanic | yugioh_web | ocgcore | DN status | Notes / port |
|---|---|---|---|---|
| Normal Summon (1/turn) | `Core/Summon` | `Summoning/Summoned(60/61)` | ✅ | `summonMonster`. |
| Tribute Summon (Lv5–6:1, 7+:2) | tribute() | `SelectTribute(20)` | ✅ | `tributesNeeded` + tribute pick. |
| Set (face-down defense) | `SET_SUMMON` | `Set(54)` | ✅ | position `"set"`. |
| Flip Summon | — | `FlipSummoning/FlipSummoned(64/65)` | ✅ | `changePosition` flips set → face-up. |
| Special Summon (from GY/hand/deck) | can_special_summon | `SpSummoning/SpSummoned(62/63)` | 🟡→✅ **P0** | Add via effects (Monster Reborn, Call of the Haunted). |
| Fusion / Ritual / Synchro / Xyz / Link | types only | full | ⛔ P4 | Out of scope for server cards. |

## 3. Battle / combat

| Mechanic | yugioh_web | ocgcore | DN status | Notes / port |
|---|---|---|---|---|
| Attack declaration | `perform_attack` | `Attack(110)` | ✅ | `declareAttack`. |
| ATK vs ATK, destroy loser, LP diff | `Core/Battle` | `Battle(111)` | ✅ | |
| ATK vs DEF (defense pos) | — (missing!) | yes | ✅ | We add DEF math (repo lacks it). |
| Piercing (trample) | — | yes | ✅ | `effect:pierce`. |
| Direct attack | `DST_DIRECT_ATTACK` | yes | ✅ | |
| Face-down flips on attack | — | `FlipSummoning` | ✅ | |
| One attack per monster / Battle | implicit | `AttackDisabled(112)` | ✅ | `hasAttacked`. |
| Multiple attackers (double attack) | — | effect | ✅ | `effect:doubleAttack`. |
| Damage Step start/end windows | — | `DamageStepStart/End(113/114)` | 🟡 P2 | Add as a response window for battle traps. |
| Replay (attack target leaves) | — | rule | 🟡 P3 | We re-resolve to direct if target gone. |
| Cannot attack turn 1 going first | — | rule | 🟡 P3 | |

## 4. Card effect / activation system

| Mechanic | yugioh_web | ocgcore | DN status | Notes / port |
|---|---|---|---|---|
| Normal Spell activation | `SpellType/NormalSpell` | `SelectIdleCmd(11)` | ✅ | `activateSpellFromHand`. |
| Set Spell/Trap | — | `Set(54)` | ✅ | `setSpellTrap`. |
| Trap activation (from set) | Trap scaffold | `Chaining(70)` | 🟡→✅ **P0** | Generalize into a real response/chain. |
| Quick-Play Spell (from hand/set, fast) | QUICK type | spell speed 2 | ⛔ **P1** | Add spell-speed & response window. |
| Continuous Spell/Trap (stays on field) | CONTINUOUS | yes | ⛔ **P1** | Persistent zone effect (field ATK aura). |
| Equip Spell (attach to a monster) | EQUIPMENT | `Equip(93)/Unequip(95)` | ⛔ **P1** | ATK/DEF mod bound to a monster. |
| Field Spell | ENVIRONMENT | yes | ⛔ P2 | Attribute-wide ATK aura. |
| Targeting (select a card for an effect) | — | `SelectCard(15)/CardTarget(96)/BecomeTarget(83)` | ⛔ **P0** | Targeted destroy/reborn/equip. |
| Counters (add/remove) | — | `AddCounter/RemoveCounter(101/102)` | ⛔ P3 | No card needs it yet. |
| LP cost to activate | — | `PayLpCost(100)` | ⛔ P3 | Optional for some spells. |
| Flip effect (on flip) | — | `FlipSummoned` trigger | 🟡→✅ **P1** | Trigger effect when a set monster flips. |
| Trigger / ignition / continuous classification | — | full | 🟡 P2 | Model timing tags on effects. |
| Missed timing | — | `MissedEffect(120)` | ⛔ P4 | Too fine-grained. |

## 5. Chain & timing

| Mechanic | yugioh_web | ocgcore | DN status | Notes / port |
|---|---|---|---|---|
| Chain build (LIFO) | — | `Chaining/Chained(70/71)` | ⛔ **P0** | Chain stack in state. |
| Chain resolve (reverse order) | — | `ChainSolving/Solved(72/73)` | ⛔ **P0** | Resolve top-down. |
| Chain end | — | `ChainEnd(74)` | ⛔ **P0** | |
| Negation (negate activation/effect) | — | `ChainNegated/Disabled(75/76)` | 🟡→✅ **P1** | "Negate Attack", counter traps. |
| Spell speed gating (who can respond) | QUICK | yes | 🟡 P1 | Traps + quick-plays = speed 2. |
| Response windows (attack, summon, spell) | — | `SelectChain(16)` | ⛔ **P0** | Offer set cards as responses. |

## 6. Player interaction / requests (ocgcore request messages)

| Request | ocgcore | DN status | Notes |
|---|---|---|---|
| Select Idle Command (summon/set/activate) | `SelectIdleCmd(11)` | ✅ (UI) | Hand tap menu. |
| Select Battle Command (attack/end BP) | `SelectBattleCmd(10)` | ✅ (UI) | Tap monster → target. |
| Select Card / Tribute / Place / Position | `15/20/18/19` | 🟡 P0 | Add target + position selection UI. |
| Select Chain (respond?) | `SelectChain(16)` | ⛔ P0 | Response prompt. |
| Select Yes/No, Effect Y/N, Option | `12/13/14` | ⛔ P1 | Confirm optional effects. |
| Announce (race/attr/card/number) | `140–143` | ⛔ P4 | Declaration spells only. |
| Coin toss / dice | `130/131` | ⛔ P3 | Random effects. |

## 7. Animation / presentation (Ocgcore.cs)

| Behaviour | ocgcore | DN status | Notes |
|---|---|---|---|
| Card move between zones | `Move(50)` | ✅ | Full re-render + fx. |
| Attack lunge / clash / impact | `Attack/Battle` | ✅ | `attackAnim/impact`. |
| Summon flourish | `Summoning` | 🟡 | Flash; could add a spawn tween. |
| Position change flip | `PosChange(53)` | ✅ | |
| Damage / recover numbers + LP bar | `Damage/Recover/LpUpdate` | ✅ | Floating numbers + LP pop. |
| Chain link sparks / activation pulse | `Chaining` | 🟡 | `pulseCenter`; per-card chain fx P2. |
| Destroy burst | `Move`→grave | ✅ | Particle burst. |
| Turn / phase banners | `NewTurn/NewPhase` | ✅ | |

## 8. AI behaviour

| Behaviour | DN status | Notes / port |
|---|---|---|
| Summon best affordable monster + position | ✅ | `ai.pickSummon`. |
| Attack evaluation (beatable targets, direct) | ✅ | `ai.planNextAction`. |
| Set traps | ✅ | |
| Activate beneficial spells | 🟡→✅ P0 | Extend for targeted spells (Dark Hole, Raigeki, Reborn). |
| Respond to attacks/summons via chain | 🟡→✅ P0 | Decide chain responses. |
| Position defensively when behind | ✅ | |

---

## Prioritised implementation backlog (this milestone)

- **P0 — Effect & chain core** (`duel/effects.ts`, chain in `engine`): targeting,
  a resolving chain stack, response windows for attack/summon/spell, special
  summon, negation. Foundation for everything else.
- **P0 — Spell/Trap library** (`duel/cards.ts`): blank cards with **real
  Yu-Gi-Oh effects + initials** (DH Dark Hole, RG Raigeki, MST Mystical Space
  Typhoon, MR Monster Reborn, PoG Pot of Greed, MF Mirror Force, TH Trap Hole,
  MC Magic Cylinder, NA Negate Attack, SA Sakuretsu Armor, FIS Fissure,
  BoM Book of Moon, CoH Call of the Haunted, EQ equip). Monsters stay the
  server's real cards.
- **P1 — Continuous / Equip / Field spells**, quick-play spell speed, flip effects.
- **P1 — AI** uses the chain + targeted spells.
- **P0 — Automated tests** (`vitest`) covering phases, summon/tribute, combat
  math (ATK/DEF/pierce/direct), each spell/trap effect, chains, negation,
  special summon, and a full simulated game (no crash / always terminates).
- **UI** — targeting selection, set-card response prompts, chain visualisation.

Out of scope (documented, not ported): Fusion/Ritual/Synchro/Xyz/Link summons,
Pendulum, counters, coin/dice declaration spells, missed timing — none apply to
the server's monster-image card set.

## Implementation status (updated)

All P0 and P1 backlog items are now **implemented and covered by tests**
(`src/duel/__tests__/*`, 45 tests incl. a 150-game simulation):

- ✅ Effect + chain core — response windows for attack & summon, single-link
  chain, negation, `continuePending` resolution (`engine.ts`).
- ✅ Targeting + special summon + continuous-modifier recomputation.
- ✅ Spell/Trap library with real effects + initials (`cards.ts`): PoG, DH, RG,
  MST, FIS, BoM, MR, RC, FM, AoD (equip), WF (continuous), MF, MC, SA, NA, TH,
  CoH. Monsters remain the server's real cards.
- ✅ Equip / Continuous / Field spells; flip effects.
- ✅ AI plays targeted removal / reborn and answers chain windows.
- ✅ UI: target selection, set-card activation, response prompts, chain fx.

### Since the first pass

- ✅ **Real Yu-Gi-Oh card data** (`ygo-cards.ts`) — 34 monsters, 12 spells and 6
  traps with their true names, card text, Level/Attribute/Type/ATK/DEF and
  effects. Server cards bind to them deterministically by id + power tier, so
  the duel plays by the real game's numbers while showing your artwork.
- ✅ **Fusion Summoning** — Polymerization + an Extra Deck (Flame Swordsman,
  Dark Paladin, Gaia the Dragon Champion, Blue-Eyes Ultimate Dragon), material
  Level-sum requirements, and a vortex Fusion animation.
- ✅ **Search effects** — Sangan / Witch of the Black Forest add a monster from
  the Deck when sent to the Graveyard. All destruction paths were routed through
  one trigger-aware helper so death triggers fire wherever a monster dies.
- ✅ **Jinzo** — "Trap Cards cannot be activated" closes every trap window.
- ✅ **Presentation** — tilted perspective playmat, LP plates with draining
  bars, phase strip, Deck/GY columns, fanned hand, monster spawn animations,
  VS intro, and a battle transition from the overworld.

Remaining (documented, intentionally out of scope for the server's monster-image
card set): Ritual/Synchro/Xyz/Link/Pendulum summons, counters, coin/dice
declaration effects, missed-timing, and multi-link counter-chains (Seven Tools).
Quick-Play spell-speed and Damage-Step sub-windows are P2 follow-ups.

The battle system's P0/P1 scope is **complete**, and the surrounding game
(overworld, shop, encounters) is built and covered by tests.
