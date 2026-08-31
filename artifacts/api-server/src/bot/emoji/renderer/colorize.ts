// ─────────────────────────────────────────────────────────────────────────────
// Luminance-preserving colourisation.
//
// Recolours pixels toward a target hue while keeping each pixel's brightness, so
// shading, highlights and detail survive. Applied only where alpha > 0, which
// keeps transparent backgrounds transparent.
//
// The expensive parts of the HSL conversion (the hue sector and its ramp factor)
// depend only on the hue, which is constant for a whole frame — so they are
// computed once per frame and the per-pixel loop stays a handful of multiplies.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-frame constants derived from the target hue. */
export interface HuePlan {
  /** Which 60° sector of the wheel the hue falls in, 0–5. */
  sector: number;
  /** Ramp factor for the secondary channel, 0–1. */
  k: number;
  /** Blend amount toward the target colour, 0–1. */
  strength: number;
}

export function planHue(hue: number, strength: number): HuePlan {
  const h = ((hue % 360) + 360) % 360;
  const sextant = h / 60;
  return {
    sector: Math.floor(sextant) % 6,
    k: 1 - Math.abs((sextant % 2) - 1),
    strength: strength < 0 ? 0 : strength > 1 ? 1 : strength,
  };
}

/**
 * Colourise `data` (RGBA, in place) toward the planned hue.
 * Fully transparent pixels are skipped so the alpha mask is untouched.
 */
export function colorize(data: Uint8ClampedArray, plan: HuePlan): void {
  const { sector, k, strength } = plan;
  if (strength <= 0) return;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) continue;

    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    // Rec. 709 luma — matches how the eye weights the channels, so a colourised
    // image keeps the same perceived brightness as the original.
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    // HSL → RGB at full saturation for this lightness.
    const c = 1 - Math.abs(2 * l - 1);
    const x = c * k;
    const m = l - c / 2;

    let tr: number, tg: number, tb: number;
    switch (sector) {
      case 0: tr = c; tg = x; tb = 0; break;
      case 1: tr = x; tg = c; tb = 0; break;
      case 2: tr = 0; tg = c; tb = x; break;
      case 3: tr = 0; tg = x; tb = c; break;
      case 4: tr = x; tg = 0; tb = c; break;
      default: tr = c; tg = 0; tb = x; break;
    }

    data[i] = (r + ((tr + m) * 255 - r) * strength);
    data[i + 1] = (g + ((tg + m) * 255 - g) * strength);
    data[i + 2] = (b + ((tb + m) * 255 - b) * strength);
  }
}
