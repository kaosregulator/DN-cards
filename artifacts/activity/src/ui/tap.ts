import Phaser from "phaser";
import { getViewport } from "../core/viewport";

// ─────────────────────────────────────────────────────────────────────────────
// Reliable tap binding for mouse + touch.
//
// Phaser's pointerover/out hover path fights fingers; bare pointerdown fires on
// scrolls/drags and orphaned mid-rebuild. Prefer: press → release on the same
// object within a short window, with optional hit-pad growth on touch devices.
// ─────────────────────────────────────────────────────────────────────────────

const TAP_MS = 650;
const TAP_SLOP = 28; // px of finger drift allowed before it's a drag

export function isTouchUi(): boolean {
  return getViewport().touch || getViewport().small;
}

/** Grow a hit rectangle on touch so fat fingers still connect. */
export function padHit(
  x: number, y: number, w: number, h: number, pad = 10,
): Phaser.Geom.Rectangle {
  const p = isTouchUi() ? pad : Math.max(4, Math.floor(pad * 0.4));
  return new Phaser.Geom.Rectangle(x - p, y - p, w + p * 2, h + p * 2);
}

type InteractiveObj = Phaser.GameObjects.GameObject & {
  setInteractive(
    hitArea?: unknown,
    callback?: Phaser.Types.Input.HitAreaCallback,
    dropZone?: boolean,
  ): InteractiveObj;
  on(event: string, fn: (...args: never[]) => void): InteractiveObj;
};

/**
 * Make `obj` tappable. Uses pointerup confirmation so a press-and-drag off the
 * target (or a rebuild mid-gesture) does not fire a false click.
 */
export function onTap(
  obj: Phaser.GameObjects.GameObject,
  hit: Phaser.Geom.Rectangle,
  fn: () => void,
  opts?: { hoverScale?: number },
): void {
  const target = obj as InteractiveObj;
  target.setInteractive(hit, Phaser.Geom.Rectangle.Contains);

  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let pointerId: number | null = null;

  const onDown = (pointer: Phaser.Input.Pointer) => {
    downAt = performance.now();
    downX = pointer.worldX;
    downY = pointer.worldY;
    pointerId = pointer.id;
    if (opts?.hoverScale && !isTouchUi() && "setScale" in obj) {
      (obj as Phaser.GameObjects.Container).setScale(opts.hoverScale * 0.97);
    }
  };
  const onUp = (pointer: Phaser.Input.Pointer) => {
    if (pointerId !== pointer.id) return;
    const dt = performance.now() - downAt;
    const dist = Math.hypot(pointer.worldX - downX, pointer.worldY - downY);
    pointerId = null;
    if (opts?.hoverScale && !isTouchUi() && "setScale" in obj) {
      (obj as Phaser.GameObjects.Container).setScale(1);
    }
    if (dt <= TAP_MS && dist <= TAP_SLOP) fn();
  };
  const onOut = () => {
    pointerId = null;
    if (opts?.hoverScale && !isTouchUi() && "setScale" in obj) {
      (obj as Phaser.GameObjects.Container).setScale(1);
    }
  };

  target.on("pointerdown", onDown as (...args: never[]) => void);
  target.on("pointerup", onUp as (...args: never[]) => void);
  target.on("pointerout", onOut as (...args: never[]) => void);
  target.on("pointerupoutside", onOut as (...args: never[]) => void);

  if (opts?.hoverScale && !isTouchUi()) {
    const over = () => {
      if ("setScale" in obj) (obj as Phaser.GameObjects.Container).setScale(opts.hoverScale!);
    };
    target.on("pointerover", over as (...args: never[]) => void);
  }
}
