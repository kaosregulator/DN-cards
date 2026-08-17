import Phaser from "phaser";
import { getContext } from "../core/context";
import type { DuelSetup, DuelState, DuelEvent, MonsterPosition, PlayerId, TargetRef, DuelEffect } from "../duel/types";
import {
  createDuel, nextPhase, endTurn, summonMonster, setSpellTrap, activateSpellFromHand,
  activateSetCard, changePosition, declareAttack, canNormalSummon, canActivateFromHand,
  tributesNeeded, boardOf, effAtk, effDef, responseOptions, respondToWindow, passWindow,
} from "../duel/engine";
import { planNextAction, planResponse } from "../duel/ai";
import { targetSpecFor, isPersistentSpell, trapIsMainPhase, type TargetSpec } from "../duel/effects";
import { enrichSetup } from "../duel/cards";
import { makeCardFace, makeCardBack, artKey } from "../ui/card";

// ─────────────────────────────────────────────────────────────────────────────
// DuelScene — the true Yu-Gi-Oh style board. Presents a real duel driven by the
// framework-free engine (duel/*), using the player's REAL cards for art & names.
// Both player and AI drive the engine one action at a time so every move gets
// its own animation beat. Non-authoritative: nothing is granted or spent.
// ─────────────────────────────────────────────────────────────────────────────

interface DuelSceneData {
  setup?: DuelSetup;
  returnTo?: string; // scene key to return to on exit (e.g. "World" or "Menu")
}

type Mode = "idle" | "tribute" | "attackTarget" | "spellTarget" | "busy";

export class DuelScene extends Phaser.Scene {
  private state!: DuelState;
  private returnTo = "Menu";

  private board!: Phaser.GameObjects.Container; // rebuilt every render
  private fx!: Phaser.GameObjects.Container;    // transient effects
  private ui!: Phaser.GameObjects.Container;    // persistent HUD

  private lpText: Record<PlayerId, Phaser.GameObjects.Text> = {} as never;
  private phaseText!: Phaser.GameObjects.Text;
  private msgText!: Phaser.GameObjects.Text;
  private turnBanner!: Phaser.GameObjects.Text;
  private primaryBtn!: Phaser.GameObjects.Container;
  private endBtn!: Phaser.GameObjects.Container;

  private mode: Mode = "idle";
  private tributePick: number[] = [];
  private tributeContext: { handIndex: number; position: MonsterPosition; need: number } | null = null;
  private attacker: number | null = null;
  // Spell targeting.
  private spellCtx: { handIndex: number; setZone: number | null; effect: DuelEffect; spec: TargetSpec; picked: TargetRef[] } | null = null;

  constructor() { super("Duel"); }

  init(data: DuelSceneData): void {
    this.returnTo = data?.returnTo ?? "Menu";
    if (data?.setup) this.pendingSetup = data.setup;
  }
  private pendingSetup: DuelSetup | null = null;

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    this.cameras.main.setBackgroundColor("#0a0d16");
    this.ui = this.add.container(0, 0).setDepth(1000);
    this.fx = this.add.container(0, 0).setDepth(800);
    this.board = this.add.container(0, 0).setDepth(100);

    const loading = this.centerMsg("Shuffling the deck…");

    let setup = this.pendingSetup;
    if (!setup) {
      try {
        setup = await getContext(this).api.duel();
      } catch {
        loading.setText("Couldn't load your duel deck.\nTap to go back.");
        this.input.once("pointerdown", () => this.exit());
        return;
      }
    }
    // Swap the deck's support slots for the tested spell/trap library.
    setup = enrichSetup(setup);
    await this.preloadArt(setup);
    loading.destroy();

    this.state = createDuel(setup);
    this.buildHud();
    this.renderBoard();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
    this.showTurnBanner("Your Turn");
    this.refreshControls();
  }

  private onResize = (): void => { if (this.state) { this.layoutHud(); this.renderBoard(); } };

  // ── Art preload ───────────────────────────────────────────────────────────
  private preloadArt(setup: DuelSetup): Promise<void> {
    const ids = new Set<number>();
    for (const c of [...setup.player.deck, ...setup.opponent.deck]) {
      if (c.cardId != null && c.art) ids.add(c.cardId);
    }
    if (ids.size === 0) return Promise.resolve();
    const api = getContext(this).api;
    return new Promise((resolve) => {
      let pending = ids.size;
      const done = () => { if (--pending <= 0) resolve(); };
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.on(Phaser.Loader.Events.FILE_COMPLETE, done);
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, done);
      for (const id of ids) this.load.image(artKey(id), api.cardArtUrl(id));
      // Safety timeout so a slow/blocked image never hangs the duel.
      this.time.delayedCall(9000, () => resolve());
      this.load.start();
    });
  }

  // ── Layout helpers ──────────────────────────────────────────────────────────
  private get W(): number { return this.scale.width; }
  private get H(): number { return this.scale.height; }
  private cardW(): number { return Math.max(46, Math.min(84, this.W / 7.4)); }
  private zoneXs(): number[] {
    const cw = this.cardW();
    const gap = cw * 1.16;
    const startX = this.W / 2 - 2 * gap;
    return [0, 1, 2, 3, 4].map((i) => startX + i * gap);
  }
  private rowY(row: "oppST" | "oppMon" | "pMon" | "pST"): number {
    const map = { oppST: 0.135, oppMon: 0.30, pMon: 0.545, pST: 0.71 };
    return this.H * map[row];
  }

  // ── Persistent HUD ────────────────────────────────────────────────────────
  private buildHud(): void {
    const mk = (txt: string, size: number, color: string) =>
      this.add.text(0, 0, txt, { fontFamily: "system-ui, sans-serif", fontSize: `${size}px`, color, fontStyle: "bold" });

    this.lpText.opponent = mk("", 18, "#ff9db2");
    this.lpText.player = mk("", 18, "#8ef0bd");
    this.phaseText = mk("", 14, "#9db2ff");
    this.msgText = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#c9d4ff",
    });
    this.turnBanner = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "34px", color: "#fff", fontStyle: "bold",
      stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setDepth(3000);

    this.primaryBtn = this.makeButton("Next", 0x2b57b8, () => this.onPrimary());
    this.endBtn = this.makeButton("End Turn", 0x8a3550, () => this.onEndTurn());

    this.ui.add([this.lpText.opponent, this.lpText.player, this.phaseText, this.msgText, this.primaryBtn, this.endBtn]);
    this.add.existing(this.turnBanner);
    this.layoutHud();
  }

  private layoutHud(): void {
    this.lpText.opponent.setPosition(12, 10);
    this.lpText.player.setPosition(12, this.H - 30);
    this.phaseText.setPosition(this.W / 2, 12).setOrigin(0.5, 0);
    this.msgText.setPosition(this.W / 2, this.H * 0.47).setOrigin(0.5);
    this.turnBanner.setPosition(this.W / 2, this.H / 2);
    this.positionButton(this.primaryBtn, this.W - 12, this.H - 74, 1, 0);
    this.positionButton(this.endBtn, this.W - 12, this.H - 36, 1, 0);
  }

  private makeButton(label: string, color: number, onClick: () => void): Phaser.GameObjects.Container {
    const w = 118, h = 32;
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    g.fillStyle(color, 1); g.fillRoundedRect(-w, 0, w, h, 8);
    g.lineStyle(1.5, 0xffffff, 0.25); g.strokeRoundedRect(-w, 0, w, h, 8);
    const t = this.add.text(-w / 2, h / 2, label, {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0.5);
    c.add([g, t]);
    c.setData("label", t);
    c.setData("bg", g);
    c.setData("color", color);
    c.setData("w", w); c.setData("h", h);
    c.setSize(w, h);
    c.setInteractive(new Phaser.Geom.Rectangle(-w, 0, w, h), Phaser.Geom.Rectangle.Contains);
    c.on("pointerdown", onClick);
    return c;
  }
  private positionButton(c: Phaser.GameObjects.Container, x: number, y: number, _ox: number, _oy: number): void {
    c.setPosition(x, y);
  }
  private setButtonLabel(c: Phaser.GameObjects.Container, label: string): void {
    (c.getData("label") as Phaser.GameObjects.Text).setText(label);
  }
  private setButtonEnabled(c: Phaser.GameObjects.Container, on: boolean): void {
    c.setAlpha(on ? 1 : 0.4);
    if (on) c.setInteractive(); else c.disableInteractive();
  }

  // ── Rendering the field + hand ──────────────────────────────────────────────
  private renderBoard(): void {
    this.board.removeAll(true);
    const xs = this.zoneXs();
    const cw = this.cardW(), ch = cw * 1.42;

    // Field divider glow.
    const g = this.add.graphics();
    g.fillStyle(0x101830, 0.5); g.fillRect(0, this.H * 0.42, this.W, this.H * 0.02);
    this.board.add(g);

    // Opponent zones (top).
    this.renderMonsterRow("opponent", xs, this.rowY("oppMon"), cw, ch, true);
    this.renderSpellRow("opponent", xs, this.rowY("oppST"), cw, ch);
    // Player zones (bottom).
    this.renderSpellRow("player", xs, this.rowY("pST"), cw, ch);
    this.renderMonsterRow("player", xs, this.rowY("pMon"), cw, ch, false);

    // Deck / graveyard counts.
    const dText = (b: PlayerId, y: number) => {
      const bd = boardOf(this.state, b);
      this.board.add(this.add.text(this.W - 10, y, `Deck ${bd.deck.length}  GY ${bd.graveyard.length}`, {
        fontFamily: "monospace", fontSize: "11px", color: "#5f6b96",
      }).setOrigin(1, 0.5));
    };
    dText("opponent", this.rowY("oppST") - ch / 2 - 12);
    dText("player", this.rowY("pST") + ch / 2 + 12);

    this.renderHand(cw, ch);
    this.updateHud();
  }

  private renderMonsterRow(who: PlayerId, xs: number[], y: number, cw: number, ch: number, top: boolean): void {
    const b = boardOf(this.state, who);
    for (let z = 0; z < 5; z++) {
      const x = xs[z]!;
      this.board.add(this.zoneSlot(x, y, cw, ch, 0x2b3960));
      const m = b.monsters[z];
      if (!m) continue;
      let card: Phaser.GameObjects.Container;
      if (!m.faceUp) {
        card = makeCardBack(this, cw, ch);
      } else {
        card = makeCardFace(this, { ...m.card, atk: effAtk(m), def: effDef(m) }, cw, ch);
      }
      // Defense position → rotate 90°.
      if (m.position !== "attack") card.setAngle(90);
      card.setPosition(x, y);
      this.board.add(card);

      // Interactions on own monsters.
      if (who === "player" && this.state.turn === "player") {
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.onOwnMonsterTap(z));
      }
      // Attack-target selection highlights opponent monsters.
      if (this.mode === "attackTarget" && who === "opponent") {
        this.highlight(x, y, cw, ch, 0xff5a6a);
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.resolvePlayerAttack(z));
      }
      // Tribute selection highlights own monsters.
      if (this.mode === "tribute" && who === "player") {
        const picked = this.tributePick.includes(z);
        this.highlight(x, y, cw, ch, picked ? 0x2ecc71 : 0xffd75e);
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.toggleTribute(z));
      }
      // Spell targeting highlights legal monster targets.
      if (this.mode === "spellTarget" && this.spellCtx?.spec.area === "monster"
        && this.legalTargetSides(this.spellCtx.spec).includes(who)
        && (!this.spellCtx.spec.faceUpOnly || m.faceUp)) {
        this.highlight(x, y, cw, ch, 0x35c48a);
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.onTargetTap(who, "monster", z));
      }
      void top;
    }
  }

  private renderSpellRow(who: PlayerId, xs: number[], y: number, cw: number, ch: number): void {
    const b = boardOf(this.state, who);
    for (let z = 0; z < 5; z++) {
      const x = xs[z]!;
      this.board.add(this.zoneSlot(x, y, cw * 0.94, ch * 0.94, 0x2a2350));
      const s = b.spellTraps[z];
      if (!s) continue;
      const card = s.faceUp ? makeCardFace(this, s.card, cw, ch) : makeCardBack(this, cw, ch);
      card.setPosition(x, y).setScale(0.94);
      this.board.add(card);
      const hit = () => card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
      // Player may activate their own set cards during a Main Phase.
      if (who === "player" && !s.faceUp && this.mode === "idle" && this.state.turn === "player") {
        hit(); card.on("pointerdown", () => this.onOwnSpellTrapTap(z));
      }
      // Spell targeting highlights legal spell/trap targets (e.g. MST).
      if (this.mode === "spellTarget" && this.spellCtx?.spec.area === "spellTrap"
        && this.legalTargetSides(this.spellCtx.spec).includes(who)) {
        this.highlight(x, y, cw, ch, 0x35c48a);
        hit(); card.on("pointerdown", () => this.onTargetTap(who, "spellTrap", z));
      }
    }
  }

  private renderHand(cw: number, ch: number): void {
    const b = this.state.player;
    const hw = cw * 1.16, hh = hw * 1.42;
    const n = b.hand.length;
    const maxSpan = this.W - 24;
    const spacing = Math.min(hw * 1.05, n > 0 ? maxSpan / n : hw);
    const totalW = spacing * (n - 1);
    const startX = this.W / 2 - totalW / 2;
    const y = this.H - hh / 2 - 6;
    for (let i = 0; i < n; i++) {
      const card = b.hand[i]!;
      const x = startX + i * spacing;
      const face = makeCardFace(this, card, hw, hh);
      face.setPosition(x, y);
      this.board.add(face);
      const myTurn = this.state.turn === "player" && this.mode === "idle";
      if (myTurn) {
        face.setInteractive(new Phaser.Geom.Rectangle(-hw / 2, -hh / 2, hw, hh), Phaser.Geom.Rectangle.Contains);
        face.on("pointerover", () => face.setY(y - 14));
        face.on("pointerout", () => face.setY(y));
        face.on("pointerdown", () => this.onHandTap(i));
      } else {
        face.setAlpha(0.9);
      }
    }
  }

  private zoneSlot(x: number, y: number, w: number, h: number, color: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.lineStyle(1.5, color, 0.7);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 6);
    g.fillStyle(color, 0.08);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 6);
    return g;
  }
  private highlight(x: number, y: number, w: number, h: number, color: number): void {
    const g = this.add.graphics().setDepth(50);
    g.lineStyle(3, color, 0.95);
    g.strokeRoundedRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4, 8);
    this.board.add(g);
  }

  // ── HUD update ──────────────────────────────────────────────────────────────
  private updateHud(): void {
    this.lpText.opponent.setText(`${this.state.opponent.name}   LP ${this.state.opponent.lp}`);
    this.lpText.player.setText(`${this.state.player.name}   LP ${this.state.player.lp}`);
    this.phaseText.setText(`${this.state.turn === "player" ? "Your" : "Foe"} turn · ${phaseName(this.state.phase)}`);
  }

  private refreshControls(): void {
    const myTurn = this.state.turn === "player" && !this.state.winner;
    this.setButtonEnabled(this.endBtn, myTurn && this.mode === "idle");
    this.setButtonEnabled(this.primaryBtn, myTurn && this.mode === "idle");
    if (this.state.phase === "MAIN1") this.setButtonLabel(this.primaryBtn, "To Battle");
    else if (this.state.phase === "BATTLE") this.setButtonLabel(this.primaryBtn, "End Battle");
    else this.setButtonLabel(this.primaryBtn, "Next Phase");
  }

  // ── Player input ─────────────────────────────────────────────────────────────
  private onPrimary(): void {
    if (this.state.turn !== "player" || this.mode !== "idle") return;
    if (this.state.phase === "MAIN1") this.applyPlayer(nextPhase(this.state)); // → BATTLE
    else if (this.state.phase === "BATTLE") this.applyPlayer(nextPhase(this.state)); // → MAIN2
    else this.applyPlayer(nextPhase(this.state));
  }
  private onEndTurn(): void {
    if (this.state.turn !== "player" || this.mode !== "idle") return;
    this.applyPlayer(endTurn(this.state), true);
  }

  private onHandTap(i: number): void {
    const card = this.state.player.hand[i];
    if (!card) return;
    if (card.kind === "monster") {
      const chk = canNormalSummon(this.state, "player", i);
      if (!chk.ok) { this.flash(chk.reason ?? "Can't summon."); return; }
      const need = tributesNeeded(card.level);
      const opts: Array<[string, () => void]> = [
        ["Summon (ATK)", () => this.beginSummon(i, "attack", need)],
        ["Set (DEF)", () => this.beginSummon(i, "set", need)],
      ];
      this.actionMenu(card.name + (need ? `  ·  needs ${need} tribute${need > 1 ? "s" : ""}` : ""), opts);
    } else {
      const opts: Array<[string, () => void]> = [];
      if (card.kind === "spell") {
        const spec = targetSpecFor(card.effect);
        opts.push(["Activate", () => {
          const chk = canActivateFromHand(this.state, "player", i);
          if (!chk.ok) { this.flash(chk.reason ?? "Can't activate."); return; }
          if (spec) this.beginSpellTarget(i, null, card.effect!, spec);
          else this.applyPlayer(activateSpellFromHand(this.state, "player", i));
        }]);
      }
      opts.push([card.kind === "trap" ? "Set Trap" : "Set", () => this.applyPlayer(setSpellTrap(this.state, "player", i))]);
      this.actionMenu(`${card.name}\n${card.desc}`, opts);
    }
  }

  // ── Spell targeting ─────────────────────────────────────────────────────────
  private beginSpellTarget(handIndex: number, setZone: number | null, effect: DuelEffect, spec: TargetSpec): void {
    // Grave targets use a list picker; field targets use tap-to-select.
    if (spec.area === "grave") { this.pickGraveTarget(handIndex, setZone, effect, spec); return; }
    this.spellCtx = { handIndex, setZone, effect, spec, picked: [] };
    this.mode = "spellTarget";
    this.flash(`Select a target for the effect.`);
    this.renderBoard();
  }

  private legalTargetSides(spec: TargetSpec): PlayerId[] {
    if (spec.side === "own") return ["player"];
    if (spec.side === "opp") return ["opponent"];
    return ["player", "opponent"];
  }

  private onTargetTap(side: PlayerId, area: "monster" | "spellTrap", zone: number): void {
    const ctx = this.spellCtx; if (!ctx) return;
    const ref: TargetRef = { side, kind: area, zone } as TargetRef;
    ctx.picked = [ref];
    this.finishSpell(ctx);
  }

  private finishSpell(ctx: NonNullable<DuelScene["spellCtx"]>): void {
    this.mode = "idle"; this.spellCtx = null;
    if (ctx.setZone != null) this.applyPlayer(activateSetCard(this.state, "player", ctx.setZone, ctx.picked));
    else this.applyPlayer(activateSpellFromHand(this.state, "player", ctx.handIndex, ctx.picked));
  }

  private pickGraveTarget(handIndex: number, setZone: number | null, effect: DuelEffect, spec: TargetSpec): void {
    const sides = this.legalTargetSides(spec);
    const choices: Array<[string, () => void]> = [];
    for (const side of sides) {
      boardOf(this.state, side).graveyard.forEach((c, idx) => {
        if (c.kind !== "monster") return;
        choices.push([`${side === "player" ? "Your" : "Foe"} GY: ${c.name} (${c.atk})`, () => {
          const picked: TargetRef[] = [{ side, kind: "grave", index: idx }];
          if (setZone != null) this.applyPlayer(activateSetCard(this.state, "player", setZone, picked));
          else this.applyPlayer(activateSpellFromHand(this.state, "player", handIndex, picked));
        }]);
      });
    }
    if (!choices.length) { this.flash("No valid monster in the Graveyard."); return; }
    void effect;
    this.actionMenu("Choose a monster to Special Summon", choices.slice(0, 6));
  }

  private onOwnSpellTrapTap(zone: number): void {
    if (this.mode !== "idle") return;
    if (this.state.turn !== "player" || (this.state.phase !== "MAIN1" && this.state.phase !== "MAIN2")) return;
    const st = this.state.player.spellTraps[zone];
    if (!st || st.faceUp) return;
    const eff = st.card.effect;
    const canPlay = eff && (st.card.kind === "spell" || trapIsMainPhase(eff));
    if (!canPlay) { this.flash("That Trap can only respond to an attack or summon."); return; }
    this.actionMenu(`${st.card.name}\n${st.card.desc}`, [["Activate", () => {
      const spec = targetSpecFor(eff);
      if (isPersistentSpell(eff) && spec) this.beginSpellTarget(-1, zone, eff!, spec);
      else if (spec) this.beginSpellTarget(-1, zone, eff!, spec);
      else this.applyPlayer(activateSetCard(this.state, "player", zone, []));
    }]]);
  }

  private beginSummon(handIndex: number, position: MonsterPosition, need: number): void {
    if (need === 0) {
      this.applyPlayer(summonMonster(this.state, "player", handIndex, position, []));
      return;
    }
    this.mode = "tribute";
    this.tributePick = [];
    this.tributeContext = { handIndex, position, need };
    this.flash(`Tap ${need} of your monsters to Tribute.`);
    this.renderBoard();
  }
  private toggleTribute(z: number): void {
    const ctx = this.tributeContext; if (!ctx) return;
    const at = this.tributePick.indexOf(z);
    if (at >= 0) this.tributePick.splice(at, 1);
    else if (this.tributePick.length < ctx.need) this.tributePick.push(z);
    if (this.tributePick.length === ctx.need) {
      const { handIndex, position } = ctx;
      const picks = [...this.tributePick];
      this.mode = "idle"; this.tributeContext = null; this.tributePick = [];
      this.applyPlayer(summonMonster(this.state, "player", handIndex, position, picks));
    } else {
      this.renderBoard();
    }
  }

  private onOwnMonsterTap(z: number): void {
    if (this.mode !== "idle") return;
    const m = this.state.player.monsters[z]; if (!m) return;
    if (this.state.phase === "BATTLE") {
      if (!m.faceUp || m.position !== "attack") { this.flash("Only face-up ATK monsters attack."); return; }
      const maxA = m.card.effect?.kind === "doubleAttack" ? 2 : 1;
      if (m.hasAttacked >= maxA) { this.flash("Already attacked."); return; }
      this.attacker = z;
      // Direct attack allowed only if opponent has no monsters.
      const canDirect = !this.state.opponent.monsters.some((x) => x !== null);
      this.mode = "attackTarget";
      this.flash(canDirect ? "Tap a foe monster, or the foe's field to attack directly." : "Tap a foe monster to attack.");
      this.renderBoard();
      if (canDirect) this.showDirectTarget();
    } else if (this.state.phase === "MAIN1" || this.state.phase === "MAIN2") {
      this.applyPlayer(changePosition(this.state, "player", z));
    }
  }

  private showDirectTarget(): void {
    const g = this.add.graphics().setDepth(60);
    g.fillStyle(0xff5a6a, 0.10); g.fillRect(0, this.rowY("oppST") - this.cardW(), this.W, this.cardW() * 2);
    g.lineStyle(2, 0xff5a6a, 0.8); g.strokeRect(6, this.rowY("oppST") - this.cardW() * 0.9, this.W - 12, this.cardW() * 1.8);
    this.board.add(g);
    const zone = new Phaser.GameObjects.Zone(this, this.W / 2, this.rowY("oppMon"), this.W, this.cardW() * 2);
    this.add.existing(zone);
    zone.setInteractive();
    zone.on("pointerdown", () => this.resolvePlayerAttack("direct"));
    this.board.add(zone);
  }

  private resolvePlayerAttack(target: number | "direct"): void {
    if (this.attacker == null) return;
    const from = this.attacker;
    this.attacker = null; this.mode = "idle";
    this.applyPlayer(declareAttack(this.state, "player", from, target));
  }

  // ── Applying engine results ──────────────────────────────────────────────────
  private applyPlayer(events: DuelEvent[], endedTurn = false): void {
    this.mode = "busy";
    this.playEvents(events)
      .then(() => this.resolveWindows())
      .then(() => {
        this.renderBoard();
        if (this.state.winner) { this.onWin(); return; }
        this.mode = "idle";
        this.refreshControls();
        if (endedTurn || this.state.turn === "opponent") this.runAiTurn();
      });
  }

  /** Drive any open response window to completion (AI auto, player prompt). */
  private async resolveWindows(): Promise<void> {
    let guard = 0;
    while (this.state.awaiting && !this.state.winner && guard++ < 12) {
      const responder = this.state.awaiting.responder;
      let events: DuelEvent[];
      if (responder === "opponent") {
        const r = planResponse(this.state);
        events = r ? respondToWindow(this.state, r.zone, r.targets) : passWindow(this.state);
      } else {
        const choice = await this.promptResponse();
        events = choice != null ? respondToWindow(this.state, choice, []) : passWindow(this.state);
      }
      await this.playEvents(events);
      this.renderBoard();
    }
  }

  /** Ask the player whether to activate one of their set cards in response. */
  private promptResponse(): Promise<number | null> {
    const opts = responseOptions(this.state);
    if (opts.length === 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const choices: Array<[string, () => void]> = opts.map((o) => [
        `Activate ${o.card.name}`, () => resolve(o.zone),
      ]);
      this.actionMenu("Respond to the opponent?", choices, () => resolve(null));
    });
  }

  private async runAiTurn(): Promise<void> {
    this.mode = "busy";
    this.refreshControls();
    await this.wait(500);
    let guard = 0;
    while (this.state.turn === "opponent" && !this.state.winner && guard++ < 80) {
      await this.resolveWindows();
      if (this.state.winner) { this.onWin(); return; }
      const action = planNextAction(this.state);
      if (!action) { if (this.state.awaiting) continue; break; }
      let events: DuelEvent[] = [];
      switch (action.type) {
        case "summon": events = summonMonster(this.state, "opponent", action.handIndex, action.position, action.tributeZones); break;
        case "set": events = setSpellTrap(this.state, "opponent", action.handIndex); break;
        case "activateSpell": events = activateSpellFromHand(this.state, "opponent", action.handIndex, action.targets); break;
        case "toBattle": events = nextPhase(this.state); break;
        case "attack": events = declareAttack(this.state, "opponent", action.fromZone, action.target); break;
        case "end": events = endTurn(this.state); break;
      }
      await this.playEvents(events);
      await this.resolveWindows();
      this.renderBoard();
      if (this.state.winner) { this.onWin(); return; }
      await this.wait(action.type === "attack" ? 450 : 560);
    }
    if (this.state.winner) { this.onWin(); return; }
    this.mode = "idle";
    this.showTurnBanner("Your Turn");
    this.refreshControls();
    this.renderBoard();
  }

  // Animate a batch of events (one logical action). State is already final, so
  // we animate from event data as overlays, then the caller re-renders.
  private async playEvents(events: DuelEvent[]): Promise<void> {
    for (const e of events) {
      switch (e.t) {
        case "turn": this.showTurnBanner(e.who === "player" ? "Your Turn" : `${this.state.opponent.name}'s Turn`); await this.wait(300); break;
        case "phase": this.phaseText.setText(`${e.who === "player" ? "Your" : "Foe"} turn · ${phaseName(e.phase)}`); break;
        case "draw": if (e.who === "player") this.flash(`Draw: ${e.card.name}`); await this.wait(90); break;
        case "summon": this.flash(`${who(e.who)} ${e.position === "set" ? "sets" : "summons"} ${e.card.name}`); await this.wait(260); break;
        case "specialSummon": this.flash(`${who(e.who)} Special Summons ${e.card.name}`); this.pulseCenter(e.card.color); await this.wait(320); break;
        case "flip": await this.wait(160); break;
        case "activate": this.flash(e.text); this.pulseCenter(e.card.color); await this.wait(360); break;
        case "chainResolve": this.pulseCenter(e.card.color); await this.wait(120); break;
        case "negate": this.flash(e.text); this.pulseCenter(0xffd75e); await this.wait(300); break;
        case "equip": this.flash(`Equipped ${e.card.name}`); await this.wait(180); break;
        case "window": await this.wait(80); break;
        case "buff": this.flash(e.text); await this.wait(160); break;
        case "attackDeclare": this.flash(`${who(e.who)} attacks!`); await this.wait(140); break;
        case "clash": await this.attackAnim(e.who, e.fromZone, e.toZone); break;
        case "destroy": this.destroyBurst(e.who, e.zone); await this.wait(200); break;
        case "damage": this.damageNumber(e.who, e.amount); this.tweenLp(e.who); await this.wait(260); break;
        case "heal": this.tweenLp(e.who); this.flash(`+${e.amount} LP`); await this.wait(200); break;
        case "deckout": this.flash(`${who(e.who)} decked out!`); await this.wait(300); break;
        case "log": break;
        case "win": break;
      }
    }
  }

  // ── Effects ──────────────────────────────────────────────────────────────────
  private zonePos(who: PlayerId, zone: number): { x: number; y: number } {
    const xs = this.zoneXs();
    const y = who === "player" ? this.rowY("pMon") : this.rowY("oppMon");
    return { x: xs[zone] ?? this.W / 2, y };
  }
  private async attackAnim(who: PlayerId, fromZone: number, to: number | "direct"): Promise<void> {
    const from = this.zonePos(who, fromZone);
    const target = to === "direct"
      ? { x: this.W / 2, y: who === "player" ? this.rowY("oppMon") : this.rowY("pMon") }
      : this.zonePos(who === "player" ? "opponent" : "player", to);
    const streak = this.add.graphics().setDepth(1500);
    streak.lineStyle(4, 0xfff2a8, 0.9);
    streak.lineBetween(from.x, from.y, target.x, target.y);
    this.fx.add(streak);
    const orb = this.add.circle(from.x, from.y, 8, 0xffd75e).setDepth(1600);
    this.fx.add(orb);
    await new Promise<void>((res) => {
      this.tweens.add({ targets: orb, x: target.x, y: target.y, duration: 240, ease: "Quad.In", onComplete: () => res() });
    });
    this.impact(target.x, target.y);
    streak.destroy(); orb.destroy();
    await this.wait(120);
  }
  private impact(x: number, y: number): void {
    const ring = this.add.circle(x, y, 6, 0xffffff, 0.9).setDepth(1700);
    this.fx.add(ring);
    this.tweens.add({ targets: ring, radius: 42, alpha: 0, duration: 320, ease: "Cubic.Out", onComplete: () => ring.destroy() });
    this.cameras.main.shake(120, 0.006);
  }
  private destroyBurst(who: PlayerId, zone: number): void {
    const { x, y } = this.zonePos(who, zone);
    for (let i = 0; i < 8; i++) {
      const p = this.add.circle(x, y, 3, 0xff8a5a).setDepth(1650);
      this.fx.add(p);
      const a = (i / 8) * Math.PI * 2;
      this.tweens.add({ targets: p, x: x + Math.cos(a) * 40, y: y + Math.sin(a) * 40, alpha: 0, duration: 380, onComplete: () => p.destroy() });
    }
  }
  private damageNumber(who: PlayerId, amount: number): void {
    const y = who === "player" ? this.H - 60 : 50;
    const t = this.add.text(this.W / 2, y, `-${amount}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "30px", color: "#ff6a7a", fontStyle: "bold", stroke: "#000", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(2000);
    this.fx.add(t);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, scale: 1.3, duration: 850, ease: "Cubic.Out", onComplete: () => t.destroy() });
  }
  private tweenLp(who: PlayerId): void {
    // LP text reflects state on next updateHud; do a quick color pop.
    const txt = this.lpText[who];
    this.tweens.add({ targets: txt, scale: 1.25, duration: 120, yoyo: true });
    this.updateHud();
  }
  private pulseCenter(color: number): void {
    const g = this.add.circle(this.W / 2, this.H / 2, 12, color, 0.5).setDepth(1400);
    this.fx.add(g);
    this.tweens.add({ targets: g, radius: 120, alpha: 0, duration: 500, onComplete: () => g.destroy() });
  }

  // ── Small UI bits ────────────────────────────────────────────────────────────
  private actionMenu(title: string, options: Array<[string, () => void]>, onCancel?: () => void): void {
    const overlay = this.add.container(0, 0).setDepth(2500);
    const bg = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.5).setOrigin(0).setInteractive();
    overlay.add(bg);
    const panelW = Math.min(340, this.W - 40);
    const rows = options.length + 1;
    const panelH = 66 + rows * 46;
    const px = this.W / 2, py = this.H / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x141a2e, 0.98); panel.fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 12);
    panel.lineStyle(1.5, 0x3a4a80, 1); panel.strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 12);
    overlay.add(panel);
    overlay.add(this.add.text(px, py - panelH / 2 + 12, title, {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#e6ecff", fontStyle: "bold", align: "center", wordWrap: { width: panelW - 24 },
    }).setOrigin(0.5, 0));
    let cancelled = true;
    const close = () => { if (cancelled) onCancel?.(); overlay.destroy(true); };
    bg.on("pointerdown", close);
    let oy = py - panelH / 2 + 60;
    const all: Array<[string, () => void]> = [...options, ["Cancel", () => { }]];
    for (const [label, fn] of all) {
      const rowBg = this.add.rectangle(px, oy + 18, panelW - 24, 38, label === "Cancel" ? 0x2a2f45 : 0x24407e, 1)
        .setStrokeStyle(1, 0x4a5a90).setInteractive();
      const rowTxt = this.add.text(px, oy + 18, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#fff", fontStyle: "bold",
      }).setOrigin(0.5);
      rowBg.on("pointerdown", () => { cancelled = false; overlay.destroy(true); fn(); });
      overlay.add([rowBg, rowTxt]);
      oy += 46;
    }
  }

  private flash(text: string): void {
    this.msgText.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.msgText);
    this.tweens.add({ targets: this.msgText, alpha: 0.55, duration: 2200, ease: "Linear" });
  }
  private showTurnBanner(text: string): void {
    this.turnBanner.setText(text).setAlpha(0).setScale(0.7);
    this.tweens.add({ targets: this.turnBanner, alpha: 1, scale: 1, duration: 260, yoyo: true, hold: 420, onComplete: () => this.turnBanner.setAlpha(0) });
  }
  private centerMsg(text: string): Phaser.GameObjects.Text {
    return this.add.text(this.W / 2, this.H / 2, text, {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#9db2ff", align: "center",
    }).setOrigin(0.5).setDepth(4000);
  }
  private wait(ms: number): Promise<void> { return new Promise((res) => this.time.delayedCall(ms, res)); }

  private onWin(): void {
    this.mode = "busy";
    const won = this.state.winner === "player";
    const overlay = this.add.container(0, 0).setDepth(3000);
    overlay.add(this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.7).setOrigin(0).setInteractive());
    overlay.add(this.add.text(this.W / 2, this.H / 2 - 30, won ? "🏆 VICTORY" : "💀 DEFEAT", {
      fontFamily: "system-ui, sans-serif", fontSize: "44px", color: won ? "#ffd75e" : "#ff6a7a", fontStyle: "bold", stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5));
    overlay.add(this.add.text(this.W / 2, this.H / 2 + 24, "Tap to continue", {
      fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#c9d4ff",
    }).setOrigin(0.5));
    this.input.once("pointerdown", () => this.exit());
  }

  private exit(): void {
    this.scene.start(this.returnTo, { duelWon: this.state?.winner === "player" });
  }
}

function phaseName(p: string): string {
  return { DRAW: "Draw Phase", STANDBY: "Standby", MAIN1: "Main Phase 1", BATTLE: "Battle Phase", MAIN2: "Main Phase 2", END: "End Phase" }[p] ?? p;
}
function who(id: PlayerId): string { return id === "player" ? "You" : "Foe"; }
