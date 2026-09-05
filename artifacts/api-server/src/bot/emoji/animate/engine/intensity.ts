// ─────────────────────────────────────────────────────────────────────────────
// Intensity — one dial over the whole recipe.
//
// Subtle → Normal → Dramatic → INSANE. The SAME motion library drives every
// level; only the amplitude (deviation from rest) and the timing are scaled, and
// the planner layers extra supporting motion at the harder levels. So 🥺 cry is:
//   subtle  tiny tears        (amp 0.5)
//   normal  tears rolling     (amp 1.0)
//   dramatic shaking + tears  (amp 1.5, planner adds a global shake)
//   insane  ugly crying       (amp 2.1, planner adds shake + more tears + wobble)
//
// Amplitude scaling happens here (applied by the compositor to every sampled
// channel); the "add more motion" part happens in the planner, which reads
// `escalate` off the gesture preset.
// ─────────────────────────────────────────────────────────────────────────────

import type { Channel, Intensity } from "../types.js";
import { REST } from "./sampler.js";

interface Level {
  /** Multiplier on every channel's deviation from rest. */
  amp: number;
  /** Multiplier on loop duration (lower = faster/snappier). */
  timing: number;
  /** Extra effect-overlay particle density multiplier. */
  effectGain: number;
}

export const LEVELS: Record<Intensity, Level> = {
  subtle: { amp: 0.5, timing: 1.15, effectGain: 0.5 },
  normal: { amp: 1.0, timing: 1.0, effectGain: 1.0 },
  dramatic: { amp: 1.55, timing: 0.85, effectGain: 1.6 },
  insane: { amp: 2.2, timing: 0.7, effectGain: 2.4 },
};

/**
 * Scale one sampled channel value about its rest point by the level's amplitude.
 * Rotation and translation scale linearly; multiplicative channels (scale,
 * squash) scale their ratio so amp<1 eases toward 1 and amp>1 exaggerates.
 */
export function applyAmp(channel: Channel, value: number, amp: number): number {
  const rest = REST[channel];
  if (channel === "scaleX" || channel === "scaleY" || channel === "squashY") {
    return rest * Math.pow(value / rest, amp);
  }
  return rest + (value - rest) * amp;
}

export function levelFor(intensity: Intensity): Level {
  return LEVELS[intensity];
}
