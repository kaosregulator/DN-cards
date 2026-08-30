// ─────────────────────────────────────────────────────────────────────────────
// Command-facing option vocabulary.
//
// Everything the /emoji command offers a user comes from the discovery manifest,
// so the menu shows what MakeEmoji actually supports and nothing else. When no
// manifest has been discovered yet, the pickers say so instead of listing
// plausible-sounding values that would fail on submission.
//
// This is why the MakeEmoji options are autocomplete rather than fixed choices:
// fixed choices are baked in at command-registration time, which would mean
// hardcoding a vocabulary we are not allowed to invent.
// ─────────────────────────────────────────────────────────────────────────────

import { getManifest, valuesFor } from "../providers/makeemoji/manifest.js";
import { OPTION_KEYS, type OptionKey } from "../providers/makeemoji/types.js";

/** Discord's cap on autocomplete suggestions. */
export const MAX_CHOICES = 25;

/** Options driven by the manifest, in the order they appear on the command. */
export const MANIFEST_OPTIONS: readonly OptionKey[] = [
  "animation", "speed", "direction", "size", "color", "quality", "platform",
];

export interface Choice { name: string; value: string }

/**
 * Sentinel returned when there is nothing real to offer.
 *
 * Discord requires a choice value of 1–100 characters and rejects the whole
 * autocomplete response if any value is empty — which meant the "not set up"
 * hint never actually rendered. A non-empty sentinel keeps the response valid,
 * and `isPlaceholder` lets the command recognise and reject it rather than
 * passing it upstream as a real option value.
 */
export const PLACEHOLDER_VALUE = "__not_configured__";

export function isPlaceholder(value: string | undefined): boolean {
  return value === PLACEHOLDER_VALUE;
}

/** Shown when discovery hasn't run — it names the fix rather than failing silently. */
const NOT_DISCOVERED: Choice = {
  name: "⚠️ Not set up yet — an admin needs to run MakeEmoji discovery",
  value: PLACEHOLDER_VALUE,
};

/**
 * Suggestions for one option, filtered by what the user has typed.
 *
 * Free-text controls (a colour hex, a pixel size) have no enumerable values, so
 * whatever the user typed is offered straight back rather than being blocked.
 */
export function suggestFor(key: OptionKey, query: string): Choice[] {
  const { manifest } = getManifest();
  const control = manifest?.controls[key];

  if (!control) return [NOT_DISCOVERED];

  if (control.values.length === 0 || control.kind === "text" || control.kind === "range") {
    const typed = query.trim();
    const hint = control.kind === "range" && control.values.length >= 2
      ? ` (${control.values[0]!.value}–${control.values[1]!.value})`
      : "";
    // With nothing typed there is no value to offer back, and an empty one would
    // invalidate the whole response — so prompt with the sentinel instead.
    return typed
      ? [{ name: `${typed}${hint}`.slice(0, 100), value: typed.slice(0, 100) }]
      : [{ name: `Type a value${hint}`.slice(0, 100), value: PLACEHOLDER_VALUE }];
  }

  const needle = query.trim().toLowerCase();
  return control.values
    .filter(v => !needle
      || v.value.toLowerCase().includes(needle)
      || (v.label?.toLowerCase().includes(needle) ?? false))
    .slice(0, MAX_CHOICES)
    .map(v => ({
      name: (v.label && v.label !== v.value ? `${v.label} (${v.value})` : v.value).slice(0, 100),
      value: v.value.slice(0, 100),
    }));
}

/** True when this option name is one the manifest drives. */
export function isManifestOption(name: string): name is OptionKey {
  return (MANIFEST_OPTIONS as readonly string[]).includes(name);
}

/**
 * Animations that do nothing to the image.
 *
 * MakeEmoji's list opens with a "none" entry — it is the editor's way of
 * clearing the current style. Taking the first value blindly made a bare
 * `/emoji` return the user's image completely unchanged.
 */
const NO_OP_ANIMATION = /^(gen_btn_)?none$/i;

/**
 * Preferred defaults, in order, tried against whatever the manifest actually
 * contains. These are not invented: they are ordinary animation ids present in
 * the discovered vocabulary, chosen because they read well on any image rather
 * than assuming a face or a character. If a future manifest has none of them,
 * the first non-no-op animation is used instead.
 */
const PREFERRED_DEFAULTS = ["shake", "bounce", "spin", "party", "pet"];

/**
 * The animation to use when the user didn't name one.
 *
 * Returns null when no manifest has been discovered, so the command can say the
 * generator isn't set up rather than sending an empty request.
 */
export function defaultAnimation(): string | null {
  const { manifest } = getManifest();
  const control = manifest?.controls.animation;
  if (!control) return null;

  const usable = control.values.filter(
    v => !NO_OP_ANIMATION.test(v.value) && !NO_OP_ANIMATION.test(v.label ?? ""),
  );
  if (usable.length === 0) return null;

  for (const wanted of PREFERRED_DEFAULTS) {
    const hit = usable.find(
      v => v.label?.toLowerCase() === wanted || v.value.toLowerCase() === `gen_btn_${wanted}`,
    );
    if (hit) return hit.value;
  }

  return usable[0]!.value;
}

export { OPTION_KEYS };
