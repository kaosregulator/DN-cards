// Settings dropdown — opened from the world's top-left button. A true dropdown
// (not an instant jump to the menu) with:
//   • Brightness (dim ↔ bright)
//   • Music: volume, play/pause, prev / next, now-playing + creator credit
//   • Return to Main Menu, Invite a Friend, Quit
//
// Brightness + music are global (see brightness.ts / audio/music.ts), so the
// panel just drives them and reflects their state.

import { getBrightness, setBrightness } from "./brightness";
import { music } from "../audio/music";
import { getSdk } from "../discord/sdk";
import { isInDiscord } from "../discord/env";

export interface SettingsPanelOpts {
  /** Return to the title screen (scene-specific). */
  onReturnMenu: () => void;
}

export class SettingsPanel {
  private readonly root: HTMLDivElement;
  private nowPlaying!: HTMLDivElement;
  private playBtn!: HTMLButtonElement;
  private open = false;
  private unbindMusic: () => void = () => {};
  private readonly onDocClick: (e: MouseEvent) => void;

  constructor(opts: SettingsPanelOpts) {
    this.injectStyles();
    this.root = document.createElement("div");
    this.root.id = "dn-settings";
    this.root.style.display = "none";
    this.buildBody(opts);
    document.body.appendChild(this.root);

    this.unbindMusic = music.onChange(() => this.syncMusic());
    this.syncMusic();

    // Close when clicking outside the panel (but not on the ☰ toggle button).
    this.onDocClick = (e) => {
      if (!this.open) return;
      const t = e.target as HTMLElement;
      if (this.root.contains(t) || t.closest(".wh-menu")) return;
      this.setOpen(false);
    };
    document.addEventListener("pointerdown", this.onDocClick, true);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(v: boolean): void {
    this.open = v;
    this.root.style.display = v ? "block" : "none";
    if (v) this.syncMusic();
  }

  destroy(): void {
    this.unbindMusic();
    document.removeEventListener("pointerdown", this.onDocClick, true);
    this.root.remove();
  }

  private buildBody(opts: SettingsPanelOpts): void {
    const bright = getBrightness();
    const vol = music.getVolume();

    this.root.innerHTML = `
      <div class="dn-s-head">⚙️ Settings</div>

      <div class="dn-s-row">
        <label class="dn-s-label">🔆 Brightness <span class="dn-s-hint">dim → bright</span></label>
        <input class="dn-s-range" id="dn-bright" type="range" min="0" max="1" step="0.01" value="${bright}">
      </div>

      <div class="dn-s-row">
        <label class="dn-s-label">🎵 Music Volume</label>
        <input class="dn-s-range" id="dn-vol" type="range" min="0" max="1" step="0.01" value="${vol}">
        <div class="dn-now" id="dn-now"></div>
        <div class="dn-s-controls">
          <button class="dn-s-mini" id="dn-prev" aria-label="Previous">⏮</button>
          <button class="dn-s-mini dn-s-play" id="dn-play" aria-label="Play/Pause">⏸</button>
          <button class="dn-s-mini" id="dn-next" aria-label="Next">⏭</button>
        </div>
      </div>

      <div class="dn-s-sep"></div>

      <button class="dn-s-btn" id="dn-menu">🏠 Main Menu</button>
      <button class="dn-s-btn" id="dn-invite">✉️ Invite a Friend</button>
      <button class="dn-s-btn dn-s-quit" id="dn-quit">⏻ Quit</button>
    `;

    this.nowPlaying = this.root.querySelector("#dn-now") as HTMLDivElement;
    this.playBtn = this.root.querySelector("#dn-play") as HTMLButtonElement;

    const brightEl = this.root.querySelector("#dn-bright") as HTMLInputElement;
    brightEl.addEventListener("input", () => setBrightness(Number(brightEl.value)));

    const volEl = this.root.querySelector("#dn-vol") as HTMLInputElement;
    volEl.addEventListener("input", () => music.setVolume(Number(volEl.value)));

    (this.root.querySelector("#dn-prev") as HTMLButtonElement).onclick = () => music.prev();
    (this.root.querySelector("#dn-next") as HTMLButtonElement).onclick = () => music.next();
    this.playBtn.onclick = () => music.toggle();

    (this.root.querySelector("#dn-menu") as HTMLButtonElement).onclick = () => {
      this.setOpen(false);
      opts.onReturnMenu();
    };
    (this.root.querySelector("#dn-invite") as HTMLButtonElement).onclick = () => this.invite();
    (this.root.querySelector("#dn-quit") as HTMLButtonElement).onclick = () => this.quit();
  }

  private syncMusic(): void {
    const t = music.current();
    this.nowPlaying.innerHTML =
      `<span class="dn-now-t">${esc(t.title)}</span> <span class="dn-now-a">· ${esc(t.artist)}</span>`;
    this.playBtn.textContent = music.isPlaying ? "⏸" : "▶";
  }

  private async invite(): Promise<void> {
    const sdk = getSdk();
    if (!sdk) return;
    try {
      await sdk.commands.openInviteDialog();
    } catch {
      /* dialog unavailable (older host / not in a channel) — silently ignore */
    }
  }

  private quit(): void {
    music.pause();
    const sdk = getSdk();
    if (sdk && isInDiscord()) {
      try {
        // 1000 = RPCCloseCodes.CLOSE_NORMAL — closes the Activity in Discord.
        sdk.close(1000 as unknown as Parameters<typeof sdk.close>[0], "Player quit");
        return;
      } catch { /* fall through */ }
    }
    // Outside Discord (local/demo): just reload to the entry.
    window.location.reload();
  }

  private injectStyles(): void {
    if (document.getElementById("dn-settings-style")) return;
    const s = document.createElement("style");
    s.id = "dn-settings-style";
    s.textContent = `
      #dn-settings { position: fixed; top: 100px; left: 12px; width: 250px; z-index: 60;
        background: rgba(14,19,34,.94); backdrop-filter: blur(10px);
        border: 1px solid #2a3568; border-radius: 14px; padding: 12px;
        box-shadow: 0 16px 40px rgba(0,0,0,.5); color: #e6ecff;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        animation: dnpop .12s ease; }
      @keyframes dnpop { from { transform: translateY(-6px); opacity: 0 } to { opacity: 1 } }
      .dn-s-head { font-size: 14px; font-weight: 700; margin: 2px 2px 10px; }
      .dn-s-row { margin-bottom: 12px; }
      .dn-s-label { display: block; font-size: 12px; font-weight: 600; color: #c9d4ff; margin-bottom: 6px; }
      .dn-s-hint { color: #7a86b4; font-weight: 400; font-size: 10px; }
      .dn-s-range { width: 100%; accent-color: #5573ff; cursor: pointer; }
      .dn-now { font-size: 11px; color: #aeb9e0; margin-top: 6px; }
      .dn-now-t { color: #eaf0ff; font-weight: 600; }
      .dn-now-a { color: #8b97c4; }
      .dn-s-controls { display: flex; gap: 8px; margin-top: 8px; }
      .dn-s-mini { flex: 1; padding: 7px 0; font-size: 15px; cursor: pointer; color: #dbe4ff;
        background: #212b4d; border: 1px solid #2f3b66; border-radius: 9px; }
      .dn-s-mini:hover { background: #2b3765; }
      .dn-s-play { background: #33408a; }
      .dn-s-sep { height: 1px; background: #26315a; margin: 4px 0 10px; }
      .dn-s-btn { display: block; width: 100%; text-align: left; padding: 9px 11px; margin-bottom: 7px;
        font-size: 13px; font-weight: 600; color: #e6ecff; cursor: pointer;
        background: #202a4c; border: 1px solid #2c3760; border-radius: 10px; font-family: inherit; }
      .dn-s-btn:hover { background: #2a3663; }
      .dn-s-quit { color: #ffc0cb; border-color: #5a2b3a; background: #3a2030; }
      .dn-s-quit:hover { background: #4a2740; }
    `;
    document.head.appendChild(s);
  }
}

function esc(x: string): string {
  return x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
