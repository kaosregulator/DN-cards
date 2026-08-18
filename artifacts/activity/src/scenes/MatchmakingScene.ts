import Phaser from "phaser";
import { getContext } from "../core/context";
import { DuelSocket, type MatchInfo } from "../net/duelSocket";

// ─────────────────────────────────────────────────────────────────────────────
// MatchmakingScene — the "finding an opponent" screen for online PvP.
//
// Connects to the duel relay, joins the room for this Activity instance (so
// everyone who launched the same Activity is in one pool) and waits. When the
// server pairs us it hands the live socket straight to the DuelScene, which
// takes over the connection for the rest of the match.
// ─────────────────────────────────────────────────────────────────────────────

export class MatchmakingScene extends Phaser.Scene {
  private socket: DuelSocket | null = null;
  private status!: Phaser.GameObjects.Text;
  private detail!: Phaser.GameObjects.Text;
  private dots = 0;
  private handedOff = false;

  constructor() { super("Matchmaking"); }

  create(): void {
    document.getElementById("boot")?.remove();
    this.cameras.main.setBackgroundColor("#0a0d16");
    this.cameras.main.fadeIn(240, 0, 0, 0);
    this.build();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Only tear the socket down if we didn't hand it to the duel.
      if (!this.handedOff) this.socket?.close();
    });
    this.connect();

    // Animated ellipsis so the wait doesn't look frozen.
    this.time.addEvent({
      delay: 420, loop: true,
      callback: () => {
        if (this.handedOff) return;
        this.dots = (this.dots + 1) % 4;
        this.status.setText(`Searching for a duelist${".".repeat(this.dots)}`);
      },
    });
  }

  private build(): void {
    const W = this.scale.width, H = this.scale.height;
    const g = this.add.graphics();
    g.fillGradientStyle(0x1a1440, 0x14203f, 0x080b14, 0x080b14, 1);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      this.add.circle(Math.random() * W, Math.random() * H, Math.random() * 1.5 + 0.4, 0xbcd0ff, Math.random() * 0.5 + 0.15);
    }

    this.add.text(W / 2, H * 0.30, "⚔  ONLINE DUEL", {
      fontFamily: "system-ui, sans-serif", fontSize: `${Math.min(34, W / 12)}px`,
      color: "#ffe9b0", fontStyle: "bold", stroke: "#000", strokeThickness: 5,
    }).setOrigin(0.5);

    this.status = this.add.text(W / 2, H * 0.46, "Connecting…", {
      fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#c9d4ff",
    }).setOrigin(0.5);

    this.detail = this.add.text(W / 2, H * 0.54, "Anyone else who opens this Activity will be matched with you.", {
      fontFamily: "system-ui, sans-serif", fontSize: "12.5px", color: "#7d8bb8",
      align: "center", wordWrap: { width: Math.min(420, W - 48) },
    }).setOrigin(0.5);

    // Spinner.
    const ring = this.add.circle(W / 2, H * 0.66, 16).setStrokeStyle(3, 0x5a7ad0, 0.9);
    this.tweens.add({ targets: ring, scale: 1.25, alpha: 0.4, duration: 700, yoyo: true, repeat: -1, ease: "Sine.InOut" });

    const cancel = this.add.text(W / 2, H * 0.80, "Cancel", {
      fontFamily: "system-ui, sans-serif", fontSize: "15px", color: "#fff", fontStyle: "bold",
      backgroundColor: "#8a3550", padding: { x: 20, y: 8 },
    }).setOrigin(0.5).setInteractive();
    cancel.on("pointerdown", () => this.leave());
  }

  private connect(): void {
    const ctx = getContext(this);
    const token = ctx.session.accessToken;
    if (!token) { this.fail("Online duels need a Discord sign-in."); return; }

    const snap = ctx.playerState.get();
    const name = snap?.user.username ?? "Duelist";
    // Everyone in the same Activity instance shares a matchmaking room.
    const room = ctx.session.instanceId ?? "lobby";

    this.socket = new DuelSocket({
      onWaiting: () => {
        this.status.setText("Searching for a duelist");
        this.detail.setText("Waiting for another player to open the Activity…");
      },
      onMatch: (m) => this.startDuel(m),
      onError: (msg) => this.fail(msg),
      onClose: () => { if (!this.handedOff) this.fail("Connection closed."); },
    });
    this.socket.connect(token, room, name);
  }

  private startDuel(match: MatchInfo): void {
    if (this.handedOff || !this.socket) return;
    this.handedOff = true;
    this.status.setText(`Matched with ${match.opponentName}!`);
    this.detail.setText("Starting the duel…");
    const socket = this.socket;
    this.cameras.main.flash(220, 255, 255, 255);
    this.time.delayedCall(700, () => {
      this.scene.start("Duel", { returnTo: "Menu", online: { socket, match } });
    });
  }

  private fail(message: string): void {
    this.status.setText("Couldn't find a match");
    this.detail.setText(`${message}\n\nTap Cancel to go back.`);
  }

  private leave(): void {
    this.socket?.close();
    this.socket = null;
    this.scene.start("Menu");
  }
}
