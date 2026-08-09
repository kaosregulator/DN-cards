// ─────────────────────────────────────────────────────────────────────────────
// Rive FX overlay (client / Activity).
//
// This is where Rive actually belongs: a real-time `.riv` state machine layered
// over the Phaser battle canvas for signature-move bursts and ultimate cut-ins.
// `@rive-app/canvas` needs the DOM + a canvas, which the Activity has and the
// headless server GIF pipeline does not — so the Discord-embed siege renders its
// battlefield with Konva sprites server-side, while THIS drives the same cues
// with Rive when the app is opened as a Discord Activity.
//
// It is deliberately a guarded scaffold: no `.riv` art ships yet, so the layer
// stays disabled and every `play()` is a no-op. Drop `.riv` files under the
// pack's `riv/` folder, point `enable()` at their base URL, and the FX light up
// with zero changes to BattleScene. Any Rive/load failure is swallowed — combat
// choreography must never depend on the overlay succeeding.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rive as RiveInstance } from "@rive-app/canvas";

export type RiveCue = "attack" | "crit" | "special" | "ultimate" | "ko";

interface RiveFxConfig {
  /** Base URL that holds `<cue>.riv` files, e.g. "/assets/hq/riv/". */
  baseUrl: string;
  /** State-machine name inside the `.riv` files (shared convention). */
  stateMachine?: string;
}

let _config: RiveFxConfig | null = null;

/**
 * Turn the overlay on by pointing it at a folder of `<cue>.riv` files. Call once
 * at boot (e.g. after asset discovery) when Rive art is present. Until then the
 * layer is dormant and costs nothing.
 */
export function enableRiveFx(config: RiveFxConfig): void {
  _config = config;
}

export function riveFxEnabled(): boolean {
  return _config !== null;
}

// The Rive module is loaded lazily the first time a cue actually fires, so the
// ~WASM payload never loads for players who don't trigger an FX (or when the
// layer is disabled entirely).
let _riveMod: Promise<typeof import("@rive-app/canvas") | null> | null = null;
function loadRive(): Promise<typeof import("@rive-app/canvas") | null> {
  if (!_riveMod) {
    _riveMod = import("@rive-app/canvas").catch((err) => {
      console.debug("riveOverlay: @rive-app/canvas unavailable", err);
      return null;
    });
  }
  return _riveMod;
}

/**
 * A transient full-screen Rive canvas layered over the game. One instance can be
 * reused for the whole battle; `play()` swaps in the cue's animation. When the
 * layer is disabled (no art), it never touches the DOM.
 */
export class RiveFxLayer {
  private canvas: HTMLCanvasElement | null = null;
  private rive: RiveInstance | null = null;
  private disposed = false;

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Play a cue's `.riv`; resolves when it has started (or immediately if off). */
  async play(cue: RiveCue): Promise<void> {
    if (!_config || this.disposed) return;
    const mod = await loadRive();
    if (!mod || this.disposed) return;
    try {
      this.ensureCanvas();
      // Tear down any in-flight animation before starting the next cue.
      this.rive?.cleanup();
      this.rive = new mod.Rive({
        src: `${_config.baseUrl.replace(/\/?$/, "/")}${cue}.riv`,
        canvas: this.canvas!,
        autoplay: true,
        stateMachines: _config.stateMachine ?? "State Machine 1",
        layout: new mod.Layout({ fit: mod.Fit.Contain, alignment: mod.Alignment.Center }),
        onLoad: () => this.rive?.resizeDrawingSurfaceToCanvas(),
      });
    } catch (err) {
      // A missing `.riv` (404) or a runtime hiccup must not interrupt the fight.
      console.debug("riveOverlay: cue failed", cue, err);
    }
  }

  private ensureCanvas(): void {
    if (this.canvas) return;
    const c = document.createElement("canvas");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50";
    this.host.appendChild(c);
    c.width = this.host.clientWidth || window.innerWidth;
    c.height = this.host.clientHeight || window.innerHeight;
    this.canvas = c;
  }

  destroy(): void {
    this.disposed = true;
    try { this.rive?.cleanup(); } catch { /* already gone */ }
    this.rive = null;
    this.canvas?.remove();
    this.canvas = null;
  }
}
