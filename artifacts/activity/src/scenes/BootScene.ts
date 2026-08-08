import Phaser from "phaser";
import { getContext } from "../core/context";
import { ApiError } from "../net/api";

// BootScene — loads the AUTHORITATIVE player snapshot from the backend, then
// hands off to HandshakeScene. This is the moment Phase 1 proves the pipeline:
//   Discord → Activity → Phaser → API → real player data.
//
// It loads no art yet (asset packs arrive with the HQ renderer in later phases);
// keeping boot lean is the performance contract from the brief.
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  async create(): Promise<void> {
    // Remove the pre-Phaser HTML splash now that the canvas owns the frame.
    document.getElementById("boot")?.remove();

    const ctx = getContext(this);
    this.renderStatus("Loading your DN Cards…");

    // Local-dev bypass: no Discord frame → no token. Say so plainly instead of
    // faking a login. Inside Discord this branch never runs.
    if (!ctx.session.inDiscord || !ctx.session.accessToken) {
      this.scene.start("Handshake", {
        error:
          "Open this from Discord to load your account. (Running outside Discord — no token.)",
      });
      return;
    }

    try {
      const snapshot = await ctx.api.me(ctx.session.accessToken);
      ctx.playerState.set(snapshot);
      ctx.events.emit("player:loaded", snapshot);
      this.scene.start("Handshake", { ok: true });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not reach the DN Cards backend.";
      this.scene.start("Handshake", { error: message });
    }
  }

  private renderStatus(text: string): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#9db2ff",
      })
      .setOrigin(0.5);
  }
}
