import Phaser from "phaser";
import { getContext } from "../core/context";
import type { DuelSetup, DuelState, DuelEvent, MonsterPosition, PlayerId, TargetRef, DuelEffect, DuelCard } from "../duel/types";
import {
  createDuel, nextPhase, endTurn, summonMonster, setSpellTrap, activateSpellFromHand,
  activateSetCard, changePosition, declareAttack, canNormalSummon, canActivateFromHand,
  tributesNeeded, boardOf, effAtk, effDef, responseOptions, respondToWindow, passWindow, otherId,
} from "../duel/engine";
import { planNextAction, planResponse } from "../duel/ai";
import { targetSpecFor, isPersistentSpell, trapIsMainPhase, type TargetSpec } from "../duel/effects";
import { enrichSetup } from "../duel/cards";
import { makeCardFace, makeCardBack, artKey } from "../ui/card";
import { makeField, zoneU, SIDE_U, ROW_Z, type FieldLayout } from "../ui/field";
import { LpPanel } from "../ui/lpPanel";

// ─────────────────────────────────────────────────────────────────────────────
// DuelScene — the true Yu-Gi-Oh style board. Presents a real duel driven by the
// framework-free engine (duel/*), using the player's REAL cards for art & names.
// Both player and AI drive the engine one action at a time so every move gets
// its own animation beat. Non-authoritative: nothing is granted or spent.
// ─────────────────────────────────────────────────────────────────────────────

interface DuelSceneData {
  setup?: DuelSetup;
  returnTo?: string;      // scene key to return to on exit (e.g. "World" or "Menu")
  pvp?: boolean;          // local hot-seat pass-and-play (no AI)
  npcId?: string;         // world duelist being challenged (marks them beaten on a win)
  opponentName?: string;  // display name override for the AI side
}

type Mode = "idle" | "tribute" | "attackTarget" | "spellTarget" | "busy";

export class DuelScene extends Phaser.Scene {
  private state!: DuelState;
  private returnTo = "Menu";

  private board!: Phaser.GameObjects.Container; // rebuilt every render
  private fx!: Phaser.GameObjects.Container;    // transient effects
  private ui!: Phaser.GameObjects.Container;    // persistent HUD

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

  // Local hot-seat PvP: no AI, board flips to whoever's turn it is.
  private pvp = false;
  private viewer: PlayerId = "player"; // side rendered at the bottom + controlled now
  private controlledTurn: PlayerId = "player";

  constructor() { super("Duel"); }

  init(data: DuelSceneData): void {
    this.returnTo = data?.returnTo ?? "Menu";
    this.pvp = !!data?.pvp;
    this.npcId = data?.npcId ?? null;
    this.opponentName = data?.opponentName ?? null;
    if (data?.setup) this.pendingSetup = data.setup;
  }
  private pendingSetup: DuelSetup | null = null;
  private npcId: string | null = null;
  private opponentName: string | null = null;

  /** The side shown at the bottom / currently controlled. */
  private get foe(): PlayerId { return otherId(this.viewer); }
  private setViewer(): void { this.viewer = this.pvp ? this.state.turn : "player"; this.controlledTurn = this.state.turn; }

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
    if (this.opponentName) setup = { ...setup, opponent: { ...setup.opponent, name: this.opponentName } };
    await this.preloadArt(setup);
    loading.destroy();

    this.state = createDuel(setup);
    this.setViewer();
    this.buildHud();
    this.renderBoard();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
    await this.duelIntro();
    this.showTurnBanner(this.pvp ? `${this.state.player.name}'s Turn` : "Your Turn");
    this.refreshControls();
  }

  /** "DUEL START" VS splash before the first turn. */
  private async duelIntro(): Promise<void> {
    this.mode = "busy";
    const overlay = this.add.container(0, 0).setDepth(3400);
    overlay.add(this.add.rectangle(0, 0, this.W, this.H, 0x05070f, 0.86).setOrigin(0));
    const p = this.add.text(this.W / 2, this.H * 0.4, this.state.player.name, {
      fontFamily: "system-ui, sans-serif", fontSize: "26px", color: "#8ef0bd", fontStyle: "bold",
    }).setOrigin(0.5).setAlpha(0);
    const vs = this.add.text(this.W / 2, this.H * 0.5, "VS", {
      fontFamily: "system-ui, sans-serif", fontSize: "52px", color: "#ffd75e", fontStyle: "bold", stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5).setScale(0.4).setAlpha(0);
    const o = this.add.text(this.W / 2, this.H * 0.6, this.state.opponent.name, {
      fontFamily: "system-ui, sans-serif", fontSize: "26px", color: "#ff9db2", fontStyle: "bold",
    }).setOrigin(0.5).setAlpha(0);
    const go = this.add.text(this.W / 2, this.H * 0.74, "⚔  DUEL START", {
      fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#e6ecff", fontStyle: "bold",
    }).setOrigin(0.5).setAlpha(0);
    overlay.add([p, vs, o, go]);
    const tw = (t: Phaser.GameObjects.GameObject, d: number, extra: Record<string, unknown> = {}) =>
      new Promise<void>((res) => this.tweens.add({ targets: t, alpha: 1, duration: 220, delay: d, ease: "Cubic.Out", ...extra, onComplete: () => res() }));
    await tw(p, 60, { x: { from: this.W / 2 - 40, to: this.W / 2 } });
    await tw(o, 0, { x: { from: this.W / 2 + 40, to: this.W / 2 } });
    this.cameras.main.shake(180, 0.004);
    await tw(vs, 0, { scale: 1, ease: "Back.Out", duration: 260 });
    await tw(go, 120);
    await this.wait(520);
    await new Promise<void>((res) => this.tweens.add({ targets: overlay, alpha: 0, duration: 320, onComplete: () => res() }));
    overlay.destroy(true);
    this.mode = "idle";
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

  /** The tilted playmat's projection, rebuilt whenever the frame resizes. */
  private field!: FieldLayout;
  private ensureField(): FieldLayout {
    this.field = makeField(this.W, this.H);
    return this.field;
  }
  /** Depth of a board row, from the VIEWER's perspective. */
  private rowDepth(who: PlayerId, kind: "mon" | "st"): number {
    const mine = who === this.viewer;
    if (kind === "mon") return mine ? ROW_Z.playerMon : ROW_Z.oppMon;
    return mine ? ROW_Z.playerST : ROW_Z.oppST;
  }
  private slotAt(who: PlayerId, kind: "mon" | "st", zone: number): { x: number; y: number; w: number; h: number; s: number } {
    const z = this.rowDepth(who, kind);
    const p = this.field.project(zoneU(zone), z);
    const size = this.field.cardSize(z);
    const shrink = kind === "st" ? 0.92 : 1;
    return { x: p.x, y: p.y, w: size.w * shrink, h: size.h * shrink, s: p.s };
  }
  private cardW(): number { return this.field.cardSize(ROW_Z.playerMon).w; }

  // ── Persistent HUD ────────────────────────────────────────────────────────
  private lpPanels: Partial<Record<PlayerId, LpPanel>> = {};
  private phasePills: Array<{ key: string; bg: Phaser.GameObjects.Rectangle; tx: Phaser.GameObjects.Text }> = [];

  private buildHud(): void {
    this.ui.removeAll(true);
    this.lpPanels.player?.destroy();
    this.lpPanels.opponent?.destroy();
    this.phasePills = [];

    // Corner LP plates (viewer bottom-left, foe top-right).
    this.lpPanels[this.viewer] = new LpPanel(this, {
      name: boardOf(this.state, this.viewer).name, maxLp: this.state.startingLp,
      accent: 0x35c48a, align: "left",
    });
    this.lpPanels[this.foe] = new LpPanel(this, {
      name: boardOf(this.state, this.foe).name, maxLp: this.state.startingLp,
      accent: 0xe0556f, align: "right",
    });
    this.ui.add([this.lpPanels[this.viewer]!.container, this.lpPanels[this.foe]!.container]);

    // Phase strip.
    const phases = ["DRAW", "STANDBY", "MAIN1", "BATTLE", "MAIN2", "END"];
    const short: Record<string, string> = { DRAW: "DP", STANDBY: "SP", MAIN1: "M1", BATTLE: "BP", MAIN2: "M2", END: "EP" };
    for (const p of phases) {
      const bg = this.add.rectangle(0, 0, 30, 18, 0x1b2340).setStrokeStyle(1, 0x3a4a80);
      const tx = this.add.text(0, 0, short[p]!, {
        fontFamily: "system-ui, sans-serif", fontSize: "10px", color: "#7d8bb8", fontStyle: "bold",
      }).setOrigin(0.5);
      this.phasePills.push({ key: p, bg, tx });
      this.ui.add([bg, tx]);
    }

    this.phaseText = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#9db2ff", fontStyle: "bold",
    }).setOrigin(0.5, 0);
    this.msgText = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#c9d4ff",
    }).setOrigin(0.5);
    this.turnBanner = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "34px", color: "#fff", fontStyle: "bold",
      stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setDepth(3000);

    this.primaryBtn = this.makeButton("Next", 0x2b57b8, () => this.onPrimary());
    this.endBtn = this.makeButton("End Turn", 0x8a3550, () => this.onEndTurn());

    this.ui.add([this.phaseText, this.msgText, this.primaryBtn, this.endBtn]);
    this.add.existing(this.turnBanner);
    this.layoutHud();
  }

  private layoutHud(): void {
    this.lpPanels[this.foe]?.place(this.W - 10, 8);
    this.lpPanels[this.viewer]?.place(10, this.H - 68);
    // Phase strip runs down the right edge of the mat.
    const px = this.W - 22;
    const py = this.H * 0.20;
    this.phasePills.forEach((p, i) => {
      p.bg.setPosition(px, py + i * 22);
      p.tx.setPosition(px, py + i * 22);
    });
    this.phaseText.setPosition(this.W / 2, 8);
    this.msgText.setPosition(this.W / 2, this.H * 0.70);
    this.turnBanner.setPosition(this.W / 2, this.H / 2);
    this.positionButton(this.primaryBtn, this.W - 12, this.H - 78, 1, 0);
    this.positionButton(this.endBtn, this.W - 12, this.H - 40, 1, 0);
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
    this.ensureField();
    this.drawMat();

    // Far side first so nearer cards overlap correctly.
    this.renderSpellRow(this.foe);
    this.renderMonsterRow(this.foe);
    this.renderMonsterRow(this.viewer);
    this.renderSpellRow(this.viewer);
    this.renderSideColumns();

    this.renderHand();
    this.updateHud();
  }

  /** The tilted playmat: a trapezoid with a centre line and zone guides. */
  private drawMat(): void {
    const f = this.field;
    const c = f.corners();
    const g = this.add.graphics().setDepth(-10);
    // Mat body with a soft gradient feel (two stacked fills).
    g.fillStyle(0x101a33, 0.95);
    g.fillPoints(c.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true);
    g.lineStyle(2, 0x3f5590, 0.85);
    g.strokePoints(c.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true);
    // Centre divider along the mat's midline.
    const l = f.project(-0.02, ROW_Z.centre), r = f.project(1.02, ROW_Z.centre);
    g.lineStyle(2, 0x5a7ad0, 0.5);
    g.lineBetween(l.x, l.y, r.x, r.y);
    // Faint horizon glow behind the far edge.
    g.fillStyle(0x2b57b8, 0.10);
    g.fillEllipse(f.cx, c[0]!.y, (c[1]!.x - c[0]!.x) * 1.2, 46);
    this.board.add(g);
  }

  /** Deck / Graveyard columns flanking each side of the mat. */
  private renderSideColumns(): void {
    for (const who of [this.foe, this.viewer] as PlayerId[]) {
      const b = boardOf(this.state, who);
      const z = this.rowDepth(who, "mon");
      const size = this.field.cardSize(z);
      const mine = who === this.viewer;
      const slots: Array<[number, string, number]> = [
        [SIDE_U.right, "DECK", b.deck.length],
        [SIDE_U.left, "GY", b.graveyard.length],
      ];
      for (const [u, label, count] of slots) {
        const p = this.field.project(u, z);
        const g = this.add.graphics();
        g.lineStyle(1.5, 0x3a4a80, 0.8);
        g.strokeRoundedRect(p.x - size.w / 2, p.y - size.h / 2, size.w, size.h, 5);
        if (count > 0) {
          g.fillStyle(label === "DECK" ? 0x241132 : 0x2a1a1a, 0.9);
          g.fillRoundedRect(p.x - size.w / 2, p.y - size.h / 2, size.w, size.h, 5);
          g.lineStyle(1.5, label === "DECK" ? 0x7b46b0 : 0x8a5555, 0.9);
          g.strokeRoundedRect(p.x - size.w / 2, p.y - size.h / 2, size.w, size.h, 5);
        }
        this.board.add(g);
        this.board.add(this.add.text(p.x, p.y, `${label}\n${count}`, {
          fontFamily: "monospace", fontSize: `${Math.max(7, Math.round(size.w / 4.2))}px`,
          color: mine ? "#9db2ff" : "#c08a9a", align: "center",
        }).setOrigin(0.5));
      }
    }
  }

  private renderMonsterRow(who: PlayerId): void {
    const b = boardOf(this.state, who);
    for (let z = 0; z < 5; z++) {
      const { x, y, w: cw, h: ch } = this.slotAt(who, "mon", z);
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
      // Nearer rows draw over farther ones.
      card.setDepth(Math.round(y));
      this.board.add(card);

      // Interactions on own monsters.
      if (who === this.viewer && this.state.turn === this.viewer) {
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.onOwnMonsterTap(z));
      }
      // Attack-target selection highlights the foe's monsters.
      if (this.mode === "attackTarget" && who === this.foe) {
        this.highlight(x, y, cw, ch, 0xff5a6a);
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.resolvePlayerAttack(z));
      }
      // Tribute selection highlights own monsters.
      if (this.mode === "tribute" && who === this.viewer) {
        const picked = this.tributePick.includes(z);
        this.highlight(x, y, cw, ch, picked ? 0x2ecc71 : 0xffd75e);
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.toggleTribute(z));
      }
      // Spell targeting highlights legal monster targets.
      if (this.mode === "spellTarget" && this.spellCtx?.spec.area === "monster"
        && this.legalTargetSides(this.spellCtx.spec).includes(who)
        && (!this.spellCtx.spec.faceUpOnly || m.faceUp)) {
        const picked = this.spellCtx.picked.some((p) => p.kind === "monster" && p.side === who && p.zone === z);
        this.highlight(x, y, cw, ch, picked ? 0xffd75e : 0x35c48a);
        card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
        card.on("pointerdown", () => this.onTargetTap(who, "monster", z));
      }
    }
  }

  private renderSpellRow(who: PlayerId): void {
    const b = boardOf(this.state, who);
    for (let z = 0; z < 5; z++) {
      const { x, y, w: cw, h: ch } = this.slotAt(who, "st", z);
      this.board.add(this.zoneSlot(x, y, cw, ch, 0x2a2350));
      const s = b.spellTraps[z];
      if (!s) continue;
      const card = s.faceUp ? makeCardFace(this, s.card, cw, ch) : makeCardBack(this, cw, ch);
      card.setPosition(x, y).setDepth(Math.round(y));
      this.board.add(card);
      const hit = () => card.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
      // The viewer may activate their own set cards during a Main Phase.
      if (who === this.viewer && !s.faceUp && this.mode === "idle" && this.state.turn === this.viewer) {
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

  private renderHand(): void {
    const b = boardOf(this.state, this.viewer);
    const hw = this.cardW() * 1.2, hh = hw * 1.42;
    const n = b.hand.length;
    const maxSpan = this.W - 24;
    const spacing = Math.min(hw * 1.05, n > 0 ? maxSpan / n : hw);
    const totalW = spacing * (n - 1);
    const startX = this.W / 2 - totalW / 2;
    const y = this.H - hh / 2 - 16;
    // Fan the hand on a gentle arc, like cards held in front of you.
    const mid = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const card = b.hand[i]!;
      const off = i - mid;
      const x = startX + i * spacing;
      const arc = Math.abs(off) * Math.abs(off) * 1.1;   // dip at the edges
      const baseY = y + arc;
      const face = makeCardFace(this, card, hw, hh);
      face.setPosition(x, baseY).setAngle(off * 2.4).setDepth(900 + i);
      this.board.add(face);
      const myTurn = this.state.turn === this.viewer && this.mode === "idle";
      if (myTurn) {
        face.setInteractive(new Phaser.Geom.Rectangle(-hw / 2, -hh / 2, hw, hh), Phaser.Geom.Rectangle.Contains);
        face.on("pointerover", () => { face.setY(baseY - 18).setDepth(980).setScale(1.06); });
        face.on("pointerout", () => { face.setY(baseY).setDepth(900 + i).setScale(1); });
        face.on("pointerdown", () => this.onHandTap(i));
      } else {
        face.setAlpha(0.92);
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
    this.lpPanels[this.viewer]?.setName(boardOf(this.state, this.viewer).name);
    this.lpPanels[this.foe]?.setName(boardOf(this.state, this.foe).name);
    this.lpPanels[this.viewer]?.set(boardOf(this.state, this.viewer).lp);
    this.lpPanels[this.foe]?.set(boardOf(this.state, this.foe).lp);
    const yourTurn = this.state.turn === this.viewer;
    const whose = this.pvp ? `${boardOf(this.state, this.state.turn).name}'s` : (yourTurn ? "Your" : "Foe's");
    this.phaseText.setText(`${whose} turn · ${phaseName(this.state.phase)}`);
    // Light the current phase pill.
    for (const p of this.phasePills) {
      const on = p.key === this.state.phase;
      p.bg.setFillStyle(on ? 0x2b57b8 : 0x1b2340).setStrokeStyle(1, on ? 0x8fb0ff : 0x3a4a80);
      p.tx.setColor(on ? "#ffffff" : "#7d8bb8");
    }
  }

  private refreshControls(): void {
    const myTurn = this.state.turn === this.viewer && !this.state.winner;
    this.setButtonEnabled(this.endBtn, myTurn && this.mode === "idle");
    this.setButtonEnabled(this.primaryBtn, myTurn && this.mode === "idle");
    if (this.state.phase === "MAIN1") this.setButtonLabel(this.primaryBtn, "To Battle");
    else if (this.state.phase === "BATTLE") this.setButtonLabel(this.primaryBtn, "End Battle");
    else this.setButtonLabel(this.primaryBtn, "Next Phase");
  }

  // ── Player input ─────────────────────────────────────────────────────────────
  private onPrimary(): void {
    if (this.state.turn !== this.viewer || this.mode !== "idle") return;
    this.applyPlayer(nextPhase(this.state));
  }
  private onEndTurn(): void {
    if (this.state.turn !== this.viewer || this.mode !== "idle") return;
    this.applyPlayer(endTurn(this.state), true);
  }

  private onHandTap(i: number): void {
    const card = boardOf(this.state, this.viewer).hand[i];
    if (!card) return;
    if (card.kind === "monster") {
      const chk = canNormalSummon(this.state, this.viewer, i);
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
          const chk = canActivateFromHand(this.state, this.viewer, i);
          if (!chk.ok) { this.flash(chk.reason ?? "Can't activate."); return; }
          if (spec) this.beginSpellTarget(i, null, card.effect!, spec);
          else this.applyPlayer(activateSpellFromHand(this.state, this.viewer, i));
        }]);
      }
      opts.push([card.kind === "trap" ? "Set Trap" : "Set", () => this.applyPlayer(setSpellTrap(this.state, this.viewer, i))]);
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
    if (spec.side === "own") return [this.viewer];
    if (spec.side === "opp") return [this.foe];
    return [this.viewer, this.foe];
  }

  private onTargetTap(side: PlayerId, area: "monster" | "spellTrap", zone: number): void {
    const ctx = this.spellCtx; if (!ctx) return;
    const ref: TargetRef = { side, kind: area, zone } as TargetRef;
    // Toggle selection so multi-target effects (Fusion) can pick two.
    const at = ctx.picked.findIndex((p) => p.kind === area && p.side === side && "zone" in p && p.zone === zone);
    if (at >= 0) ctx.picked.splice(at, 1);
    else ctx.picked.push(ref);
    if (ctx.picked.length >= ctx.spec.count) { this.finishSpell(ctx); return; }
    this.flash(`Select ${ctx.spec.count - ctx.picked.length} more target(s).`);
    this.renderBoard();
  }

  private finishSpell(ctx: NonNullable<DuelScene["spellCtx"]>): void {
    this.mode = "idle"; this.spellCtx = null;
    if (ctx.setZone != null) this.applyPlayer(activateSetCard(this.state, this.viewer, ctx.setZone, ctx.picked));
    else this.applyPlayer(activateSpellFromHand(this.state, this.viewer, ctx.handIndex, ctx.picked));
  }

  private pickGraveTarget(handIndex: number, setZone: number | null, effect: DuelEffect, spec: TargetSpec): void {
    const sides = this.legalTargetSides(spec);
    const choices: Array<[string, () => void]> = [];
    for (const side of sides) {
      boardOf(this.state, side).graveyard.forEach((c, idx) => {
        if (c.kind !== "monster") return;
        choices.push([`${side === this.viewer ? "Your" : "Foe"} GY: ${c.name} (${c.atk})`, () => {
          const picked: TargetRef[] = [{ side, kind: "grave", index: idx }];
          if (setZone != null) this.applyPlayer(activateSetCard(this.state, this.viewer, setZone, picked));
          else this.applyPlayer(activateSpellFromHand(this.state, this.viewer, handIndex, picked));
        }]);
      });
    }
    if (!choices.length) { this.flash("No valid monster in the Graveyard."); return; }
    void effect;
    this.actionMenu("Choose a monster to Special Summon", choices.slice(0, 6));
  }

  private onOwnSpellTrapTap(zone: number): void {
    if (this.mode !== "idle") return;
    if (this.state.turn !== this.viewer || (this.state.phase !== "MAIN1" && this.state.phase !== "MAIN2")) return;
    const st = boardOf(this.state, this.viewer).spellTraps[zone];
    if (!st || st.faceUp) return;
    const eff = st.card.effect;
    const canPlay = eff && (st.card.kind === "spell" || trapIsMainPhase(eff));
    if (!canPlay) { this.flash("That Trap can only respond to an attack or summon."); return; }
    this.actionMenu(`${st.card.name}\n${st.card.desc}`, [["Activate", () => {
      const spec = targetSpecFor(eff);
      if (spec) this.beginSpellTarget(-1, zone, eff!, spec);
      else this.applyPlayer(activateSetCard(this.state, this.viewer, zone, []));
    }]]);
  }

  private beginSummon(handIndex: number, position: MonsterPosition, need: number): void {
    if (need === 0) {
      this.applyPlayer(summonMonster(this.state, this.viewer, handIndex, position, []));
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
      this.applyPlayer(summonMonster(this.state, this.viewer, handIndex, position, picks));
    } else {
      this.renderBoard();
    }
  }

  private onOwnMonsterTap(z: number): void {
    if (this.mode !== "idle") return;
    const m = boardOf(this.state, this.viewer).monsters[z]; if (!m) return;
    if (this.state.phase === "BATTLE") {
      if (!m.faceUp || m.position !== "attack") { this.flash("Only face-up ATK monsters attack."); return; }
      const maxA = m.card.effect?.kind === "doubleAttack" ? 2 : 1;
      if (m.hasAttacked >= maxA) { this.flash("Already attacked."); return; }
      this.attacker = z;
      // Direct attack allowed only if the foe has no monsters.
      const canDirect = !boardOf(this.state, this.foe).monsters.some((x) => x !== null);
      this.mode = "attackTarget";
      this.flash(canDirect ? "Tap a foe monster, or the foe's field to attack directly." : "Tap a foe monster to attack.");
      this.renderBoard();
      if (canDirect) this.showDirectTarget();
    } else if (this.state.phase === "MAIN1" || this.state.phase === "MAIN2") {
      this.applyPlayer(changePosition(this.state, this.viewer, z));
    }
  }

  /** Highlight the foe's half of the mat as a direct-attack target. */
  private showDirectTarget(): void {
    const f = this.field;
    const zST = this.rowDepth(this.foe, "st");
    const zMon = this.rowDepth(this.foe, "mon");
    const far = f.cardSize(zST), near = f.cardSize(zMon);
    const a = f.project(-0.03, zST), b = f.project(1.03, zST);
    const c = f.project(1.05, zMon), d = f.project(-0.05, zMon);
    const pts = [
      new Phaser.Math.Vector2(a.x, a.y - far.h / 2), new Phaser.Math.Vector2(b.x, b.y - far.h / 2),
      new Phaser.Math.Vector2(c.x, c.y + near.h / 2), new Phaser.Math.Vector2(d.x, d.y + near.h / 2),
    ];
    const g = this.add.graphics().setDepth(60);
    g.fillStyle(0xff5a6a, 0.12); g.fillPoints(pts, true);
    g.lineStyle(2, 0xff5a6a, 0.85); g.strokePoints(pts, true, true);
    this.board.add(g);
    const label = this.add.text(f.cx, (a.y + c.y) / 2, "DIRECT ATTACK", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#ffd3da", fontStyle: "bold",
    }).setOrigin(0.5).setDepth(61);
    this.board.add(label);
    const zone = new Phaser.GameObjects.Zone(this, f.cx, (a.y + c.y) / 2, this.W, Math.abs(c.y - a.y) + near.h);
    this.add.existing(zone);
    zone.setInteractive();
    zone.on("pointerdown", () => this.resolvePlayerAttack("direct"));
    this.board.add(zone);
  }

  private resolvePlayerAttack(target: number | "direct"): void {
    if (this.attacker == null) return;
    const from = this.attacker;
    this.attacker = null; this.mode = "idle";
    this.applyPlayer(declareAttack(this.state, this.viewer, from, target));
  }

  // ── Applying engine results ──────────────────────────────────────────────────
  private applyPlayer(events: DuelEvent[], endedTurn = false): void {
    this.mode = "busy";
    this.playEvents(events)
      .then(() => this.resolveWindows())
      .then(() => {
        this.renderBoard();
        if (this.state.winner) { this.onWin(); return; }
        // Hot-seat: the turn passed to the other human → device-pass gate.
        if (this.pvp && this.state.turn !== this.controlledTurn) { this.passDeviceGate(); return; }
        this.mode = "idle";
        this.refreshControls();
        if (!this.pvp && (endedTurn || this.state.turn === "opponent")) this.runAiTurn();
      });
  }

  /** Drive any open response window to completion. In vs-AI the AI answers its
   *  own windows; the human is prompted for theirs. In hot-seat both are human. */
  private async resolveWindows(): Promise<void> {
    let guard = 0;
    while (this.state.awaiting && !this.state.winner && guard++ < 12) {
      const responder = this.state.awaiting.responder;
      let events: DuelEvent[];
      if (!this.pvp && responder === "opponent") {
        const r = planResponse(this.state);
        events = r ? respondToWindow(this.state, r.zone, r.targets) : passWindow(this.state);
      } else {
        const who = boardOf(this.state, responder).name;
        const choice = await this.promptResponse(who);
        events = choice != null ? respondToWindow(this.state, choice, []) : passWindow(this.state);
      }
      await this.playEvents(events);
      this.renderBoard();
    }
  }

  /** Full-screen "pass the device to <name>" gate between hot-seat turns. */
  private passDeviceGate(): void {
    this.mode = "busy";
    this.setViewer();
    this.renderBoard();
    const name = boardOf(this.state, this.state.turn).name;
    const overlay = this.add.container(0, 0).setDepth(3200);
    overlay.add(this.add.rectangle(0, 0, this.W, this.H, 0x05070f, 0.92).setOrigin(0).setInteractive());
    overlay.add(this.add.text(this.W / 2, this.H / 2 - 40, "🔄 Pass the device", {
      fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#9db2ff", fontStyle: "bold",
    }).setOrigin(0.5));
    overlay.add(this.add.text(this.W / 2, this.H / 2, `${name}'s turn`, {
      fontFamily: "system-ui, sans-serif", fontSize: "30px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0.5));
    const btn = this.add.text(this.W / 2, this.H / 2 + 56, "Ready ▶", {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#fff", fontStyle: "bold",
      backgroundColor: "#2b57b8", padding: { x: 22, y: 10 },
    }).setOrigin(0.5).setInteractive();
    overlay.add(btn);
    btn.once("pointerdown", () => {
      overlay.destroy(true);
      this.mode = "idle";
      this.showTurnBanner(`${name}'s Turn`);
      this.refreshControls();
      this.renderBoard();
    });
  }

  /** Ask a human whether to activate one of their set cards in response. */
  private promptResponse(name?: string): Promise<number | null> {
    const opts = responseOptions(this.state);
    if (opts.length === 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const choices: Array<[string, () => void]> = opts.map((o) => [
        `Activate ${o.card.name}`, () => resolve(o.zone),
      ]);
      this.actionMenu(name ? `${name} — respond?` : "Respond to the opponent?", choices, () => resolve(null));
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
        case "turn":
          if (!this.pvp) this.showTurnBanner(e.who === "player" ? "Your Turn" : `${this.state.opponent.name}'s Turn`);
          await this.wait(this.pvp ? 0 : 300); break;
        case "phase": this.phaseText.setText(`${e.who === "player" ? "Your" : "Foe"} turn · ${phaseName(e.phase)}`); break;
        case "draw": if (e.who === "player") this.flash(`Draw: ${e.card.name}`); await this.wait(90); break;
        case "summon": this.flash(`${who(e.who)} ${e.position === "set" ? "sets" : "summons"} ${e.card.name}`); await this.spawnAnim(e.who, e.zone, e.card, e.position); break;
        case "specialSummon": this.flash(`${who(e.who)} Special Summons ${e.card.name}`); await this.spawnAnim(e.who, e.zone, e.card, "attack"); break;
        case "fusion": await this.fusionAnim(e.who, e.zone, e.card, e.materials); break;
        case "search": this.flash(`Searched: ${e.card.name}`); await this.wait(240); break;
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
    const s = this.slotAt(who, "mon", Phaser.Math.Clamp(zone, 0, 4));
    return { x: s.x, y: s.y };
  }
  private async attackAnim(who: PlayerId, fromZone: number, to: number | "direct"): Promise<void> {
    const from = this.zonePos(who, fromZone);
    const foeRow = this.field.project(0.5, this.rowDepth(otherId(who), "mon"));
    const target = to === "direct"
      ? { x: foeRow.x, y: foeRow.y }
      : this.zonePos(otherId(who), to);
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
  /** Monster spawn flourish: a light column, shockwave ring, and the card
   *  slamming into its zone with a flash — the "monster appears" beat. */
  private async spawnAnim(who: PlayerId, zone: number, card: DuelCard, position: MonsterPosition): Promise<void> {
    const { x, y } = this.zonePos(who, zone);
    const cw = this.cardW(), ch = cw * 1.42;
    // Light column rising from the zone.
    const beam = this.add.rectangle(x, y, cw * 0.5, ch * 3, card.color, 0.35).setDepth(1450).setOrigin(0.5, 0.5);
    beam.setScale(1, 0);
    this.fx.add(beam);
    this.tweens.add({ targets: beam, scaleY: 1, alpha: 0, duration: 420, ease: "Cubic.Out", onComplete: () => beam.destroy() });
    // Card slams in from above, scaling down with a flash.
    const face = position === "set" ? makeCardBack(this, cw, ch) : makeCardFace(this, card, cw, ch);
    face.setPosition(x, y - 40).setScale(1.8).setAlpha(0).setDepth(1600);
    if (position !== "attack") face.setAngle(90);
    this.fx.add(face);
    const flash = this.add.circle(x, y, cw * 0.2, 0xffffff, 0.9).setDepth(1590);
    this.fx.add(flash);
    this.tweens.add({ targets: flash, radius: cw * 1.3, alpha: 0, duration: 380, ease: "Cubic.Out", onComplete: () => flash.destroy() });
    await new Promise<void>((res) => {
      this.tweens.add({
        targets: face, y, scale: position !== "attack" ? 1 : 1, alpha: 1, duration: 260, ease: "Back.Out",
        onComplete: () => res(),
      });
    });
    this.impact(x, y);
    this.cameras.main.shake(90, 0.004);
    await this.wait(150);
    face.destroy();
  }

  /** Fusion Summon: the materials spiral into a vortex that bursts into the
   *  new monster — the classic Polymerization beat. */
  private async fusionAnim(who: PlayerId, zone: number, card: DuelCard, materials: DuelCard[]): Promise<void> {
    const { x, y } = this.zonePos(who, zone);
    this.flash(`Fusion Summon! ${materials.map((m) => m.name).join(" + ")}`);
    // Swirling material motes.
    const motes: Phaser.GameObjects.Arc[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = this.cardW() * 1.6;
      const p = this.add.circle(x + Math.cos(a) * r, y + Math.sin(a) * r, 5, i % 2 ? 0x8a5cd0 : 0x5ad0c0, 0.95).setDepth(1500);
      motes.push(p); this.fx.add(p);
      this.tweens.add({ targets: p, x, y, duration: 620, delay: i * 18, ease: "Cubic.In" });
    }
    // Vortex ring.
    const ring = this.add.circle(x, y, 6, 0xffffff, 0).setStrokeStyle(3, 0xb08aff, 0.9).setDepth(1520);
    this.fx.add(ring);
    this.tweens.add({ targets: ring, radius: this.cardW() * 1.4, duration: 640, ease: "Cubic.Out" });
    await this.wait(680);
    motes.forEach((m) => m.destroy());
    ring.destroy();
    this.cameras.main.flash(180, 190, 150, 255);
    this.cameras.main.shake(180, 0.006);
    await this.spawnAnim(who, zone, card, "attack");
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
    const y = who === this.viewer ? this.H - 60 : 50;
    const t = this.add.text(this.W / 2, y, `-${amount}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "30px", color: "#ff6a7a", fontStyle: "bold", stroke: "#000", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(2000);
    this.fx.add(t);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, scale: 1.3, duration: 850, ease: "Cubic.Out", onComplete: () => t.destroy() });
  }
  private tweenLp(_who: PlayerId): void {
    // The LP panels animate their own counter + bar from the new state.
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
    const winnerName = boardOf(this.state, this.state.winner!).name;
    const overlay = this.add.container(0, 0).setDepth(3000);
    overlay.add(this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.7).setOrigin(0).setInteractive());
    overlay.add(this.add.text(this.W / 2, this.H / 2 - 30, this.pvp ? `🏆 ${winnerName} WINS` : (won ? "🏆 VICTORY" : "💀 DEFEAT"), {
      fontFamily: "system-ui, sans-serif", fontSize: this.pvp ? "34px" : "44px", color: (this.pvp || won) ? "#ffd75e" : "#ff6a7a", fontStyle: "bold", stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5));
    overlay.add(this.add.text(this.W / 2, this.H / 2 + 24, "Tap to continue", {
      fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#c9d4ff",
    }).setOrigin(0.5));
    this.input.once("pointerdown", () => this.exit());
  }

  private exit(): void {
    this.scene.start(this.returnTo, {
      duelWon: this.state?.winner === "player",
      npcId: this.npcId ?? undefined,
    });
  }
}

function phaseName(p: string): string {
  return { DRAW: "Draw Phase", STANDBY: "Standby", MAIN1: "Main Phase 1", BATTLE: "Battle Phase", MAIN2: "Main Phase 2", END: "End Phase" }[p] ?? p;
}
function who(id: PlayerId): string { return id === "player" ? "You" : "Foe"; }
