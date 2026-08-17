import Phaser from "phaser";
import { getContext } from "../core/context";
import { ApiError } from "../net/api";

// BootScene — loads the AUTHORITATIVE player snapshot (identity + economy) so the
// Menu can greet the real player, then hands off to the Menu. Art and duel decks
// load lazily inside the Duel scene. Outside Discord (local dev) there's no
// token, so we go straight to the Menu with whatever we have.
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  async create(): Promise<void> {
    document.getElementById("boot")?.remove();
    const ctx = getContext(this);
    this.renderStatus("Loading your DN Cards…");

    if (!ctx.session.inDiscord || !ctx.session.accessToken) {
      // No Discord frame → no token. Still let the player into the Menu (the
      // Duel scene will surface a friendly message if the backend isn't reachable).
      this.scene.start("Menu");
      return;
    }

    try {
      ctx.api.setToken(ctx.session.accessToken);
      const snapshot = await ctx.api.me(ctx.session.accessToken);
      ctx.playerState.set(snapshot);
      ctx.events.emit("player:loaded", snapshot);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not reach the DN Cards backend.";
      this.renderStatus(message + "\nStarting anyway…");
    }
    this.scene.start("Menu");
  }

  private renderStatus(text: string): void {
    const { width, height } = this.scale;
    this.children.removeAll(true);
    this.add
      .text(width / 2, height / 2, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#9db2ff",
        align: "center",
      })
      .setOrigin(0.5);
  }
}
