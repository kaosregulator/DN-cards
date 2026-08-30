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

/** Shown when discovery hasn't run — it names the fix rather than failing silently. */
const NOT_DISCOVERED: Choice = {
  name: "⚠️ Not set up yet — an admin needs to run MakeEmoji discovery",
  value: "",
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
    return typed
      ? [{ name: `${typed}${hint}`.slice(0, 100), value: typed.slice(0, 100) }]
      : [{ name: `Type a value${hint}`.slice(0, 100), value: "" }];
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
 * The animation to use when the user didn't name one.
 *
 * Taken from the manifest's own first value rather than a hardcoded favourite —
 * we have no way of knowing which animations MakeEmoji offers until discovery
 * has run.
 */
export function defaultAnimation(): string | null {
  return valuesFor(getManifest().manifest, "animation")[0] ?? null;
}

export { OPTION_KEYS };
