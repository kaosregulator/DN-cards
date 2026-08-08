// DN Cards Activity — entry point.
//
// Order matters: hand-shake with Discord FIRST (so we hold an access token),
// then start the Phaser runtime with that session. Any failure before Phaser
// boots is shown in the plain HTML splash so the iframe never dies silently.

import { initDiscord } from "./discord/sdk";
import { startGame } from "./core/game";
import { initViewport } from "./core/viewport";
import { isDemo, startDemo } from "./demo/demo";

function fatal(message: string): void {
  const boot = document.getElementById("boot");
  if (boot) {
    boot.innerHTML = `<small style="color:#ff9db2;max-width:80%;text-align:center;line-height:1.5">${message}</small>`;
  }
}

async function main(): Promise<void> {
  try {
    initViewport();
    // Local viewport/QA harness (no Discord, no backend) — opt-in via `?demo`.
    if (isDemo()) {
      document.getElementById("boot")?.remove();
      startDemo();
      return;
    }
    const session = await initDiscord();
    startGame(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start DN Cards.";
    fatal(message);
    // eslint-disable-next-line no-console
    console.error("[DN Cards Activity] boot failed:", err);
  }
}

void main();
