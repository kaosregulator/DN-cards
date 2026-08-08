import Phaser from "phaser";
import { getContext } from "../core/context";

interface HandshakeData {
  ok?: boolean;
  error?: string;
}

// HandshakeScene — the Phase 1 "test scene". It is intentionally simple: it
// draws the REAL player snapshot the backend returned, proving every link in
// the chain is live. No game art, no HQ world yet — those are later phases.
//
// It also demonstrates the interactivity seam (a clickable Refresh that
// re-pulls authoritative state) that the HQ/Battle/Raid/Pack scenes will build on.
export class HandshakeScene extends Phaser.Scene {
  private payload!: HandshakeData;

  constructor() {
    super("Handshake");
  }

  init(data: HandshakeData): void {
    this.payload = data ?? {};
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor("#0b0f1a");

    // Title
    this.add
      .text(width / 2, 56, "DN CARDS — LIVE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: "#e6ecff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 86, "Activity foundation · Phase 1", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#5f6b96",
      })
      .setOrigin(0.5);

    if (this.payload.error) {
      this.renderError(this.payload.error);
    } else {
      this.renderSnapshot();
    }

    this.buildRefreshButton();
  }

  private renderError(message: string): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, `⚠  ${message}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#ff9db2",
        align: "center",
        wordWrap: { width: Math.min(560, width - 48) },
      })
      .setOrigin(0.5);
  }

  private renderSnapshot(): void {
    const { width } = this.scale;
    const ctx = getContext(this);
    const snap = ctx.playerState.get();
    if (!snap) {
      this.renderError("No player data loaded.");
      return;
    }

    const lines: [string, string][] = [
      ["Signed in as", `@${snap.user.username} (${snap.user.id})`],
      ["Guild", snap.guildId],
      ["Account level", `${snap.player.level}  ·  ${snap.player.xp} XP`],
      ["Shards", `${snap.player.shards.toLocaleString()}`],
      ["Collection", `${snap.player.collection.unique} unique / ${snap.player.collection.total} total`],
      ["Battles", `${snap.player.battles.wins}W · ${snap.player.battles.losses}L (Lv ${snap.player.battles.level})`],
      ["Achievements", `${snap.player.achievements} unlocked`],
      ["HQ", `Lv ${snap.hq.level} · theme "${snap.hq.themeId}" · room "${snap.hq.activeRoomId}"`],
    ];

    const cardX = Math.max(24, width / 2 - 280);
    const cardW = Math.min(560, width - 48);
    let y = 130;

    const panel = this.add.graphics();
    panel.fillStyle(0x141a2e, 1);
    panel.fillRoundedRect(cardX, y, cardW, lines.length * 34 + 28, 14);
    panel.lineStyle(1, 0x2a3358, 1);
    panel.strokeRoundedRect(cardX, y, cardW, lines.length * 34 + 28, 14);

    y += 22;
    for (const [label, value] of lines) {
      this.add.text(cardX + 20, y, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#5f6b96",
      });
      this.add.text(cardX + 20, y + 14, value, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#e6ecff",
      });
      y += 34;
    }

    this.add
      .text(width / 2, y + 34, "✔  Discord → Activity → Phaser → API → real data", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#7ee0a0",
      })
      .setOrigin(0.5);
  }

  private buildRefreshButton(): void {
    const { width, height } = this.scale;
    const ctx = getContext(this);
    if (!ctx.session.inDiscord) return; // nothing to refresh in dev bypass

    const btn = this.add
      .text(width / 2, height - 48, "↻  Refresh", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#c8d4ff",
        backgroundColor: "#222c4d",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on("pointerdown", async () => {
      btn.disableInteractive().setText("↻  Refreshing…");
      try {
        const snapshot = await ctx.api.me(ctx.session.accessToken);
        ctx.playerState.set(snapshot);
        this.scene.restart({ ok: true });
      } catch {
        this.scene.restart({ error: "Refresh failed — try again." });
      }
    });
  }
}
