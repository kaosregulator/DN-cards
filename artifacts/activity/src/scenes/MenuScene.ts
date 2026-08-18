import Phaser from "phaser";
import { getContext } from "../core/context";
import { gameState } from "../state/gameState";
import { TOTAL_DUELISTS } from "../world/maps";

// ─────────────────────────────────────────────────────────────────────────────
// MenuScene — the game's TITLE SCREEN and hub. Animated starfield + drifting
// card silhouettes behind a stack of mode buttons:
//   ▶ Adventure   — the open world (continues where you left off)
//   ⚔ Quick Duel  — straight into a duel vs the AI
//   👥 Local PvP   — pass-and-play on one device
//   🌐 3D World    — the Babylon plaza
// ─────────────────────────────────────────────────────────────────────────────

export class MenuScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;
  private stars: Phaser.GameObjects.Arc[] = [];
  private motes: Phaser.GameObjects.Rectangle[] = [];

  constructor() { super("Menu"); }

  create(): void {
    document.getElementById("boot")?.remove();
    this.cameras.main.setBackgroundColor("#080b14");
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.bg = this.add.container(0, 0).setDepth(0);
    this.ui = this.add.container(0, 0).setDepth(10);
    this.build();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.build, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.build, this));
  }

  private build = (): void => {
    this.bg.removeAll(true);
    this.ui.removeAll(true);
    this.stars = []; this.motes = [];
    const W = this.scale.width, H = this.scale.height;
    const narrow = W < 560;

    // ── Backdrop: gradient, stars, drifting card silhouettes ──
    const g = this.add.graphics();
    g.fillGradientStyle(0x1a1440, 0x14203f, 0x080b14, 0x080b14, 1);
    g.fillRect(0, 0, W, H);
    this.bg.add(g);
    for (let i = 0; i < 60; i++) {
      const s = this.add.circle(Math.random() * W, Math.random() * H, Math.random() * 1.5 + 0.4, 0xbcd0ff, Math.random() * 0.6 + 0.15);
      this.stars.push(s); this.bg.add(s);
    }
    for (let i = 0; i < 7; i++) {
      const cw = 34 + Math.random() * 26;
      const m = this.add.rectangle(Math.random() * W, Math.random() * H, cw, cw * 1.42, 0x6a7ad0, 0.07)
        .setStrokeStyle(1, 0x8fa4ff, 0.10).setAngle(Math.random() * 40 - 20);
      this.motes.push(m); this.bg.add(m);
    }

    // ── Title ──
    const titleY = H * (narrow ? 0.13 : 0.15);
    const title = this.add.text(W / 2, titleY, "DN CARDS", {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.min(56, W / 8.2)}px`,
      color: "#ffe9b0", fontStyle: "bold", stroke: "#2a1c4a", strokeThickness: 8,
    }).setOrigin(0.5);
    const sub = this.add.text(W / 2, titleY + Math.min(42, W / 11), "D U E L   A D V E N T U R E", {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.min(16, W / 26)}px`,
      color: "#9db2ff", fontStyle: "bold",
    }).setOrigin(0.5);
    this.ui.add([title, sub]);
    this.tweens.add({ targets: title, y: titleY - 5, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.InOut" });

    // Player greeting + adventure progress.
    const snap = getContext(this).playerState.get();
    const beaten = gameState.defeatedCount();
    const line = snap
      ? `${snap.user.username}  ·  Lv ${snap.player.level}  ·  ${snap.player.shards} 💠`
      : "Duelist";
    this.ui.add(this.add.text(W / 2, titleY + Math.min(70, W / 7.5), line, {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#c9d4ff",
    }).setOrigin(0.5));

    // ── Buttons ──
    const btnW = Math.min(330, W - 44);
    const bh = narrow ? 48 : 54;
    const gap = bh + 11;
    const firstY = H * (narrow ? 0.38 : 0.40);
    const hasRun = beaten > 0 || gameState.lastMap !== "city";

    this.button(W / 2, firstY, btnW, bh,
      hasRun ? "▶  Continue Adventure" : "▶  Start Adventure",
      hasRun ? `${gameState.lastMap === "city" ? "Battle City" : gameState.lastMap} · ${beaten}/${TOTAL_DUELISTS} duelists beaten` : "Explore the world, duel everyone",
      0x2f8f5a, () => this.go("City"));

    this.button(W / 2, firstY + gap, btnW, bh, "⚔  Quick Duel",
      "Jump straight into a duel vs the AI", 0x2b57b8,
      () => this.go("Duel", { returnTo: "Menu" }));

    this.button(W / 2, firstY + gap * 2, btnW, bh, "🌐  Online Duel",
      "Match against another player in this Activity", 0xa8324f,
      () => this.go("Matchmaking"));

    this.button(W / 2, firstY + gap * 3, btnW, bh, "👥  Local PvP",
      "Pass & play — two duelists, one device", 0xb8792b, () => this.launchPvp());

    this.button(W / 2, firstY + gap * 4, btnW, bh, "🧭  3D Battle City",
      "Walk a 3D plaza and challenge duelists", 0x8a5cd0, () => this.launch3d());

    this.ui.add(this.add.text(W / 2, H - 14, "Your cards · your art · true Yu-Gi-Oh rules", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#5f6b96",
    }).setOrigin(0.5, 1));
  };

  update(_t: number, delta: number): void {
    // Gentle parallax drift so the title screen breathes.
    const H = this.scale.height, W = this.scale.width;
    for (const s of this.stars) {
      s.y += (delta / 1000) * 6;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
    }
    for (const m of this.motes) {
      m.y -= (delta / 1000) * 10;
      m.angle += (delta / 1000) * 4;
      if (m.y < -60) { m.y = H + 60; m.x = Math.random() * W; }
    }
  }

  private go(scene: string, data?: object): void {
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(scene, data));
  }

  /** Local hot-seat PvP: fetch a deck, name the two duelists, pass-and-play. */
  private launchPvp(): void {
    const api = getContext(this).api;
    (async () => {
      let setup;
      try {
        setup = await api.duel();
        setup = {
          ...setup,
          player: { ...setup.player, name: "Player 1" },
          opponent: { ...setup.opponent, name: "Player 2" },
        };
      } catch { setup = undefined; }
      this.go("Duel", { setup, returnTo: "Menu", pvp: true });
    })();
  }

  /** Launch the Babylon 3D world (lazy-loaded). Hides the Phaser canvas while
   *  the 3D world runs, and hands off to the duel or back to the menu. */
  private launch3d(): void {
    const canvas = this.game.canvas as HTMLCanvasElement;
    const prevVis = canvas.style.visibility;
    canvas.style.visibility = "hidden";
    this.scene.pause();
    const restore = () => { canvas.style.visibility = prevVis; this.scene.resume(); };
    const api = getContext(this).api;
    import("../world3d/babylonWorld")
      .then(({ startBabylonWorld }) => {
        const world = startBabylonWorld({
          onExit: () => { world.dispose(); restore(); this.scene.start("Menu"); },
          onDuel: async (name) => {
            let setup;
            try {
              setup = await api.duel();
              setup = { ...setup, opponent: { ...setup.opponent, name } };
            } catch { setup = undefined; }
            world.dispose();
            restore();
            this.scene.start("Duel", { setup, returnTo: "Menu" });
          },
        });
      })
      .catch(() => { restore(); this.flash3dError(); });
  }

  private flash3dError(): void {
    const { width: W, height: H } = this.scale;
    this.ui.add(this.add.text(W / 2, H - 34, "Couldn't load the 3D world.", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ff9db2",
    }).setOrigin(0.5));
  }

  private button(x: number, y: number, w: number, h: number, title: string, sub: string, color: number, onClick: () => void): void {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(-w / 2 + 3, -h / 2 + 4, w, h, 14);
    g.fillStyle(color, 0.94); g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    g.lineStyle(2, 0xffffff, 0.24); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    c.add(g);
    c.add(this.add.text(0, -10, title, {
      fontFamily: "system-ui, sans-serif", fontSize: "19px", color: "#fff", fontStyle: "bold",
    }).setOrigin(0.5));
    c.add(this.add.text(0, 13, sub, {
      fontFamily: "system-ui, sans-serif", fontSize: "11.5px", color: "#eef2ff",
    }).setOrigin(0.5).setAlpha(0.86));
    c.setSize(w, h).setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    c.on("pointerover", () => c.setScale(1.035));
    c.on("pointerout", () => c.setScale(1));
    c.on("pointerdown", () => { c.setScale(0.97); onClick(); });
    this.ui.add(c);
  }
}
