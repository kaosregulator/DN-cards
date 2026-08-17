import Phaser from "phaser";
import { getContext } from "../core/context";

// MenuScene — the Activity home. Choose the true Yu-Gi-Oh duel ("Battle Phaser")
// or step into the open world to explore Battle City and challenge duelists.
export class MenuScene extends Phaser.Scene {
  constructor() { super("Menu"); }

  create(): void {
    document.getElementById("boot")?.remove();
    this.cameras.main.setBackgroundColor("#0a0d16");
    this.build();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.build, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.build, this));
  }

  private build = (): void => {
    this.children.removeAll(true);
    const { width: W, height: H } = this.scale;

    // Backdrop wash.
    const g = this.add.graphics();
    g.fillGradientStyle(0x141d3a, 0x141d3a, 0x0a0d16, 0x0a0d16, 1);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      this.add.circle(Math.random() * W, Math.random() * H * 0.6, Math.random() * 1.6 + 0.4, 0x9db2ff, Math.random() * 0.5 + 0.1);
    }

    const snap = getContext(this).playerState.get();
    const uname = snap?.user.username ?? "Duelist";

    this.add.text(W / 2, H * 0.16, "DN CARDS", {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.min(52, W / 8)}px`, color: "#ffe9b0", fontStyle: "bold", stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.16 + Math.min(40, W / 11), "L I V E   D U E L", {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.min(18, W / 22)}px`, color: "#9db2ff", fontStyle: "bold",
    }).setOrigin(0.5).setAlpha(0.9);

    if (snap) {
      this.add.text(W / 2, H * 0.30, `Welcome, ${uname}  ·  Lv ${snap.player.level}  ·  ${snap.player.shards} 💠`, {
        fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#c9d4ff",
      }).setOrigin(0.5);
    }

    const btnW = Math.min(340, W - 48);
    const bh = 62;
    this.bigButton(W / 2, H * 0.375, btnW, bh, "⚔  Duel the AI", "A true Yu-Gi-Oh duel — your cards vs the AI", 0x2b57b8, () => this.scene.start("Duel", { returnTo: "Menu" }));
    this.bigButton(W / 2, H * 0.515, btnW, bh, "👥  Local PvP", "Pass & play — two duelists, one device", 0xb8792b, () => this.launchPvp());
    this.bigButton(W / 2, H * 0.655, btnW, bh, "🗺  Explore Battle City", "Top-down world — Card Shop, Route 1, rivals", 0x2f8f5a, () => this.scene.start("World"));
    this.bigButton(W / 2, H * 0.795, btnW, bh, "🌐  Battle City 3D", "Walk a 3D plaza, challenge duelists (Beta)", 0x8a5cd0, () => this.launch3d());

    this.add.text(W / 2, H - 16, "Your cards · your art · true Yu-Gi-Oh rules", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#5f6b96",
    }).setOrigin(0.5);
  };

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
    this.add.text(W / 2, H * 0.86, "Couldn't load the 3D world.", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#ff9db2",
    }).setOrigin(0.5);
  }

  /** Local hot-seat PvP: fetch a deck, name the two duelists, start pass-and-play. */
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
      this.scene.start("Duel", { setup, returnTo: "Menu", pvp: true });
    })();
  }

  private bigButton(x: number, y: number, w: number, h: number, title: string, sub: string, color: number, onClick: () => void): void {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(color, 0.92); g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    g.lineStyle(2, 0xffffff, 0.22); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    c.add(g);
    c.add(this.add.text(0, -11, title, { fontFamily: "system-ui, sans-serif", fontSize: "20px", color: "#fff", fontStyle: "bold" }).setOrigin(0.5));
    c.add(this.add.text(0, 14, sub, { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#e6ecff" }).setOrigin(0.5).setAlpha(0.85));
    c.setSize(w, h).setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    c.on("pointerover", () => c.setScale(1.03));
    c.on("pointerout", () => c.setScale(1));
    c.on("pointerdown", () => { c.setScale(0.98); onClick(); });
  }
}
