// ─────────────────────────────────────────────────────────────────────────────
// MakeEmoji discovery manifest.
//
// This file is the reason nothing in this integration is guessed. We do not know
// MakeEmoji's endpoints, its DOM, or the values its controls accept — and we are
// not allowed to invent them. So everything the provider needs to know about the
// site lives in a manifest that is PRODUCED BY DISCOVERY against the live site,
// and the code reads it rather than hardcoding it.
//
// The manifest ships unverified and empty. Until discovery has been run from an
// environment that can reach makeemoji.com, the provider reports itself
// unavailable with an explanation, instead of failing against made-up selectors.
//
// See discovery/discover.ts and the README for how to populate it.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

/** How a control is operated in the page. */
export const ControlKind = z.enum([
  "select",   // <select> — set by option value
  "radio",    // grouped inputs — click the one whose value matches
  "button",   // a clickable chip/tile carrying the value in an attribute
  "range",    // <input type=range> — set numerically
  "text",     // free-text or number input
  "checkbox", // toggle
]);
export type ControlKind = z.infer<typeof ControlKind>;

/** One selectable value offered by a control. */
export const OptionValue = z.object({
  /** The value submitted to MakeEmoji. */
  value: z.string(),
  /** What the site shows the user. Used for fuzzy matching and the picker UI. */
  label: z.string().optional(),
});
export type OptionValue = z.infer<typeof OptionValue>;

/** A control in MakeEmoji's editor, plus the values it accepts. */
export const ControlSpec = z.object({
  /** CSS selector locating the control. */
  selector: z.string(),
  kind: ControlKind,
  /** Attribute the value is read from, for `button`-style controls. */
  valueAttribute: z.string().optional(),
  /** Values discovery observed. Empty means "not discovered yet". */
  values: z.array(OptionValue).default([]),
});
export type ControlSpec = z.infer<typeof ControlSpec>;

/**
 * A generation endpoint observed in real browser traffic.
 *
 * Only ever written by discovery, from a request that was actually seen — never
 * hand-authored. `fieldMap` records which request field carried which of our
 * options, so the direct-HTTP provider can rebuild an equivalent request.
 */
export const ApiSpec = z.object({
  url: z.string().url(),
  method: z.string(),
  /** How the body was encoded. */
  kind: z.enum(["multipart", "json", "form"]),
  /** Body field the image bytes were sent in. */
  imageField: z.string().optional(),
  /** Our option name → the request's field name. */
  fieldMap: z.record(z.string(), z.string()).default({}),
  /** Fields sent with a constant value. */
  staticFields: z.record(z.string(), z.string()).default({}),
  /** Non-sensitive headers required by the endpoint. */
  headers: z.record(z.string(), z.string()).default({}),
  /**
   * Dotted path to the result URL inside a JSON response. Null means the
   * response body IS the image bytes.
   */
  resultPath: z.string().nullable().default(null),
  /**
   * Whether the endpoint needed a cookie or token the browser had established.
   * When true the direct path is skipped — we will not fabricate credentials.
   */
  requiresBrowserSession: z.boolean().default(false),
});
export type ApiSpec = z.infer<typeof ApiSpec>;

/** Selectors the browser provider needs to drive the editor. */
export const BrowserSpec = z.object({
  /** Appears once the editor is interactive. */
  readySelector: z.string().nullable().default(null),
  /** <input type=file> that accepts the source image. */
  fileInputSelector: z.string().nullable().default(null),
  /** Control that starts generation, when it isn't automatic. */
  generateSelector: z.string().nullable().default(null),
  /** The generated preview — an <img>, <video> or <canvas>. */
  resultSelector: z.string().nullable().default(null),
  /** Download control, preferred over scraping the preview when present. */
  downloadSelector: z.string().nullable().default(null),
  /** Anything to dismiss first: cookie banners, interstitials. */
  dismissSelectors: z.array(z.string()).default([]),
});
export type BrowserSpec = z.infer<typeof BrowserSpec>;

/** Our option names, as the provider interface uses them. */
export const OPTION_KEYS = [
  "animation", "speed", "direction", "size", "color", "format", "quality", "platform",
] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const Manifest = z.object({
  /**
   * True only when discovery ran successfully against the live site AND at least
   * a file input and an animation vocabulary were found. The provider refuses to
   * run against an unverified manifest.
   */
  verified: z.boolean().default(false),
  /** ISO timestamp of the discovery run that produced this. */
  discoveredAt: z.string().nullable().default(null),
  /** The editor URL discovery drove. */
  siteUrl: z.string().url().default("https://makeemoji.com/"),
  /** Free-text notes from the discovery run — what worked, what didn't. */
  notes: z.string().default(""),
  /**
   * Per-option control specs, keyed by OptionKey. A missing key means discovery
   * did not find that control — the provider then leaves the setting alone
   * rather than guessing at how to drive it.
   */
  controls: z.record(z.string(), ControlSpec).default({}),
  browser: BrowserSpec.default({}),
  /** Direct endpoint, when discovery proved one exists. Null otherwise. */
  api: ApiSpec.nullable().default(null),
});
type RawManifest = z.infer<typeof Manifest>;

/** A validated manifest, with `controls` narrowed to our option keys. */
export type Manifest = Omit<RawManifest, "controls"> & {
  controls: Partial<Record<OptionKey, ControlSpec>>;
};
