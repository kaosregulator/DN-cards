// World HUD — DOM overlay for the top-down world: a location banner, the player
// chip, an interaction prompt, and touch controls (a thumb joystick + interact
// button) for phones inside Discord. Desktop uses WASD/arrows + Space/E, so the
// joystick only shows on coarse-pointer / small viewports (CSS-gated).

export interface WorldHudPlayer {
  name: string;
  level: number;
  shards: number;
}

export interface WorldHudOpts {
  title: string;
  subtitle: string;
  player: WorldHudPlayer | null;
  onDir: (x: number, y: number) => void;
  onInteract: () => void;
  onMenu: () => void;
}

export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private readonly onDir: (x: number, y: number) => void;
  private readonly joyEl: HTMLElement;

  private joyId: number | null = null;
  private joyCenter = { x: 0, y: 0 };
  private unbound: Array<() => void> = [];

  constructor(opts: WorldHudOpts) {
    this.onDir = opts.onDir;
    this.injectStyles();

    this.root = document.createElement("div");
    this.root.id = "world-hud";

    // Location banner (top-left, clear of the centre nav dock).
    const banner = document.createElement("div");
    banner.className = "wh-banner";
    banner.innerHTML =
      `<div class="wh-title">${esc(opts.title)}</div>` +
      `<div class="wh-sub">${esc(opts.subtitle)}</div>`;
    this.root.appendChild(banner);

    // Menu button (top-left, under the banner) — back to the title screen.
    const menu = document.createElement("button");
    menu.className = "wh-menu";
    menu.setAttribute("aria-label", "Menu");
    menu.innerHTML = "☰ Menu";
    menu.addEventListener("click", (e) => { e.preventDefault(); opts.onMenu(); });
    this.root.appendChild(menu);

    // Player chip sits under the banner (left) so the top-right is free for the
    // Phaser minimap compass.
    if (opts.player) {
      const chip = document.createElement("div");
      chip.className = "wh-chip";
      chip.innerHTML =
        `<span class="wh-av">🎴</span>` +
        `<span class="wh-name">${esc(opts.player.name)}</span>` +
        `<span class="wh-lvl">Lv ${opts.player.level}</span>` +
        `<span class="wh-shard">💎 ${opts.player.shards.toLocaleString()}</span>`;
      this.root.appendChild(chip);
    }

    // Interaction prompt (hidden until near a portal).
    this.promptEl = document.createElement("div");
    this.promptEl.className = "wh-prompt";
    this.promptEl.style.display = "none";
    this.root.appendChild(this.promptEl);

    // Interact button.
    const act = document.createElement("button");
    act.className = "wh-interact";
    act.setAttribute("aria-label", "Interact");
    act.innerHTML = "⚡";
    act.addEventListener("click", (e) => { e.preventDefault(); opts.onInteract(); });
    this.root.appendChild(act);

    // Thumb joystick (touch only, gated by CSS).
    this.joyEl = this.buildJoystick();
    this.root.appendChild(this.joyEl);

    document.body.appendChild(this.root);

    // Safety nets: if pointer capture is lost (Discord iframe blur, OS gesture,
    // tab switch) without a pointerup, the avatar used to keep running forever.
    const forceStop = () => this.resetJoy();
    window.addEventListener("blur", forceStop);
    document.addEventListener("visibilitychange", forceStop);
    this.unbound.push(
      () => window.removeEventListener("blur", forceStop),
      () => document.removeEventListener("visibilitychange", forceStop),
    );
  }

  setPrompt(text: string | null): void {
    if (!text) {
      this.promptEl.style.display = "none";
      return;
    }
    this.promptEl.textContent = text;
    this.promptEl.style.display = "block";
  }

  /** Hard-stop movement — call on scene leave / pause. */
  resetJoy(): void {
    const knob = this.joyEl?.querySelector(".wh-knob") as HTMLElement | null;
    if (knob) knob.style.transform = "translate(0px, 0px)";
    this.joyId = null;
    this.onDir(0, 0);
  }

  destroy(): void {
    this.resetJoy();
    for (const off of this.unbound) off();
    this.unbound = [];
    this.root.remove();
  }

  private buildJoystick(): HTMLElement {
    const base = document.createElement("div");
    base.className = "wh-joy";
    const knob = document.createElement("div");
    knob.className = "wh-knob";
    base.appendChild(knob);

    const R = 46; // travel radius
    const setFromPointer = (clientX: number, clientY: number) => {
      const dx = clientX - this.joyCenter.x;
      const dy = clientY - this.joyCenter.y;
      const d = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(d, R);
      const nx = (dx / d) * clamped;
      const ny = (dy / d) * clamped;
      knob.style.transform = `translate(${nx}px, ${ny}px)`;
      // dead-zone so a light rest doesn't drift the avatar
      const out = clamped < 8 ? { x: 0, y: 0 } : { x: nx / R, y: ny / R };
      this.onDir(out.x, out.y);
    };
    const reset = () => {
      knob.style.transform = "translate(0px, 0px)";
      this.onDir(0, 0);
      this.joyId = null;
    };

    base.addEventListener("pointerdown", (e) => {
      const rect = base.getBoundingClientRect();
      this.joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.joyId = e.pointerId;
      try { base.setPointerCapture(e.pointerId); } catch { /* older WebViews */ }
      setFromPointer(e.clientX, e.clientY);
      e.preventDefault();
    });
    base.addEventListener("pointermove", (e) => {
      if (this.joyId !== e.pointerId) return;
      setFromPointer(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => { if (this.joyId === e.pointerId) reset(); };
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
    // Capture lost without up/cancel (common on iOS/Android in iframes).
    base.addEventListener("lostpointercapture", () => { if (this.joyId != null) reset(); });
    // Window-level safety: finger released outside the pad / off the iframe.
    const winUp = (e: PointerEvent) => { if (this.joyId === e.pointerId) reset(); };
    window.addEventListener("pointerup", winUp);
    window.addEventListener("pointercancel", winUp);
    this.unbound.push(
      () => window.removeEventListener("pointerup", winUp),
      () => window.removeEventListener("pointercancel", winUp),
    );
    return base;
  }

  private injectStyles(): void {
    if (document.getElementById("world-hud-style")) return;
    const s = document.createElement("style");
    s.id = "world-hud-style";
    s.textContent = `
      #world-hud { position: fixed; inset: 0; pointer-events: none; z-index: 11;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      #world-hud > * { pointer-events: auto; }

      .wh-banner { position: fixed; top: 10px; left: 12px; padding: 8px 12px;
        background: rgba(12,17,32,.72); backdrop-filter: blur(8px);
        border: 1px solid #24305a; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
      .wh-title { font-size: 15px; font-weight: 700; color: #eaf0ff; letter-spacing: .3px; }
      .wh-sub { font-size: 11px; color: #8b97c4; margin-top: 1px; }

      .wh-menu { position: fixed; top: 62px; left: 12px; padding: 8px 14px; cursor: pointer;
        background: rgba(12,17,32,.72); backdrop-filter: blur(8px); color: #dbe4ff;
        border: 1px solid #24305a; border-radius: 999px; font-size: 12px; font-weight: 600;
        font-family: inherit; box-shadow: 0 6px 24px rgba(0,0,0,.35);
        touch-action: manipulation; -webkit-tap-highlight-color: transparent; min-height: 36px; }
      .wh-menu:hover { color: #fff; background: #263255; }

      /* Left column under the menu — keeps top-right clear for the minimap. */
      .wh-chip { position: fixed; top: 104px; left: 12px; display: flex; align-items: center; gap: 8px;
        padding: 6px 10px; background: rgba(12,17,32,.72); backdrop-filter: blur(8px);
        border: 1px solid #24305a; border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.35);
        color: #dbe4ff; font-size: 12px; font-weight: 600; max-width: min(240px, 42vw); }
      body.is-small .wh-chip .wh-name { max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wh-av { font-size: 15px; }
      .wh-lvl { color: #9fd8ff; }
      .wh-shard { color: #ffd98a; }

      .wh-prompt { position: fixed; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom,0px));
        transform: translateX(-50%); padding: 8px 16px; border-radius: 999px;
        background: rgba(51,85,238,.92); color: #fff; font-size: 13px; font-weight: 700;
        box-shadow: 0 8px 28px rgba(0,0,0,.4); animation: whpop .16s ease; }
      @keyframes whpop { from { transform: translateX(-50%) scale(.9); opacity: 0 } to { opacity: 1 } }

      .wh-interact { position: fixed; right: calc(18px + env(safe-area-inset-right,0px));
        bottom: calc(20px + env(safe-area-inset-bottom,0px)); width: 62px; height: 62px;
        border-radius: 50%; border: none; cursor: pointer; font-size: 26px; color: #fff;
        background: radial-gradient(circle at 35% 30%, #5573ff, #2b3fd0);
        box-shadow: 0 8px 24px rgba(43,63,208,.5); transition: transform .08s;
        touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      .wh-interact:active { transform: scale(.92); }

      .wh-joy { position: fixed; left: calc(20px + env(safe-area-inset-left,0px));
        bottom: calc(20px + env(safe-area-inset-bottom,0px)); width: 116px; height: 116px;
        border-radius: 50%; background: rgba(20,26,46,.5); border: 1px solid #2a3568;
        backdrop-filter: blur(6px); display: none; touch-action: none; }
      .wh-knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px;
        border-radius: 50%; background: radial-gradient(circle at 35% 30%, #7f92ff, #3a4bcf);
        box-shadow: 0 4px 14px rgba(0,0,0,.4); }

      /* Touch / small screens get the joystick; the interact button grows a touch. */
      body.is-touch .wh-joy, body.is-small .wh-joy { display: block; }
      body.is-small .wh-interact { width: 70px; height: 70px; font-size: 30px; }
    `;
    document.head.appendChild(s);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
