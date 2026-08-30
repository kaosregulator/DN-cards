// ─────────────────────────────────────────────────────────────────────────────
// Page inspection.
//
// Everything here runs against the LIVE page and reports what is actually there.
// No selector or option value in this system is written by hand — they all come
// out of this inventory, which is why the manifest can be trusted to describe
// MakeEmoji rather than our assumptions about it.
//
// The mapping from a discovered control to one of our option keys is a heuristic
// over the control's own label/name/id text. It can be wrong, so the report
// prints the full inventory alongside the mapping: an operator can correct the
// manifest by hand without re-running anything.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page } from "playwright";
import type { ControlKind, OptionKey } from "../types.js";
import type {
  BrowserWindow, DomDocument, DomElement, DomInput, DomSelect,
} from "./dom-types.js";

/** A control found in the page, before it is mapped to one of our options. */
export interface DiscoveredControl {
  selector: string;
  kind: ControlKind;
  /** name/id/aria-label/nearby text — whatever identified it. */
  label: string;
  valueAttribute?: string;
  values: { value: string; label?: string }[];
}

/** What a page scan found. */
export interface PageInventory {
  title: string;
  fileInputs: string[];
  controls: DiscoveredControl[];
  /** Buttons whose text suggests they start generation or a download. */
  actionButtons: { selector: string; text: string }[];
  /** <script src> URLs the page loaded. */
  scripts: string[];
  /** Signals that generation might be happening in the browser. */
  clientSide: {
    canvasCount: number;
    hasOffscreenCanvas: boolean;
    hasWebAssembly: boolean;
    workerScripts: string[];
  };
}

/**
 * Keywords mapping a control's label to one of our option keys.
 *
 * Ordered most-specific first: "animation" must beat "size" for a control
 * labelled "Animation size", and `format` must be tested before `platform`
 * because a "Platform format" control is really about format.
 */
const OPTION_KEYWORDS: [OptionKey, RegExp][] = [
  ["animation", /\b(animation|animate|effect|motion|style)\b/i],
  ["speed",     /\b(speed|duration|fps|frame\s*rate|tempo)\b/i],
  ["direction", /\b(direction|orientation|axis|rotate|clockwise)\b/i],
  ["quality",   /\b(quality|compression|optimi[sz]e)\b/i],
  ["format",    /\b(format|file\s*type|output|extension|gif|webp|png)\b/i],
  ["platform",  /\b(platform|preset|discord|slack|telegram|twitch)\b/i],
  ["color",     /\b(colou?r|background|tint|palette|hue)\b/i],
  ["size",      /\b(size|dimension|width|height|px|resolution|scale)\b/i],
];

/** Best-guess option key for a control, or null when nothing matches. */
export function mapControlToOption(label: string): OptionKey | null {
  for (const [key, pattern] of OPTION_KEYWORDS) {
    if (pattern.test(label)) return key;
  }
  return null;
}

/**
 * Inventory every interactive control on the page.
 *
 * The callback runs inside the browser, so it can only use browser globals and
 * cannot close over anything from this module — the DOM types are erased at
 * compile time, and the globals are reached through a cast at the top.
 *
 * Selectors are built to be re-findable later: an id when there is one, then a
 * name, then a positional path as a last resort.
 */
export async function inspectPage(page: Page): Promise<PageInventory> {
  return page.evaluate(() => {
    const w = globalThis as unknown as BrowserWindow;
    const doc = w.document;
    const esc = (value: string) => w.CSS.escape(value);
    const all = (selector: string, root: DomDocument | DomElement = doc): DomElement[] =>
      Array.from(root.querySelectorAll(selector) as ArrayLike<DomElement>);

    const selectorFor = (el: DomElement): string => {
      if (el.id) return `#${esc(el.id)}`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${esc(name)}"]`;

      const parts: string[] = [];
      let node: DomElement | null = el;
      while (node && node !== doc.body && parts.length < 6) {
        const parent: DomElement | null = node.parentElement;
        if (!parent) break;
        const tag = node.tagName.toLowerCase();
        const siblings = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
        parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
        node = parent;
      }
      return parts.join(" > ");
    };

    /** Whatever text identifies this control to a human. */
    const labelFor = (el: DomElement): string => {
      const parts: string[] = [];
      for (const attr of ["aria-label", "name", "id", "data-name", "title", "placeholder"]) {
        const value = el.getAttribute(attr);
        if (value) parts.push(value);
      }
      if (el.id) {
        const label = doc.querySelector(`label[for="${esc(el.id)}"]`);
        if (label?.textContent) parts.push(label.textContent.trim());
      }
      const wrapping = el.closest("label");
      if (wrapping?.textContent) parts.push(wrapping.textContent.trim());

      // A control is often labelled only by a heading in its own group.
      const group = el.closest("fieldset, section, div[class*='control'], div[class*='option']");
      const legend = group?.querySelector("legend, h1, h2, h3, h4, h5, h6, label");
      if (legend?.textContent) parts.push(legend.textContent.trim());

      return parts.join(" | ").slice(0, 300);
    };

    const controls: DiscoveredControl[] = [];

    // <select> — the easiest case: the values are right there.
    for (const el of all("select")) {
      const select = el as DomSelect;
      controls.push({
        selector: selectorFor(el),
        kind: "select",
        label: labelFor(el),
        values: Array.from(select.options).map(o => ({
          value: o.value,
          label: o.textContent?.trim() || undefined,
        })),
      });
    }

    // Radio groups — collapse each `name` into a single control.
    const radioGroups = new Map<string, DomInput[]>();
    for (const el of all("input[type=radio]")) {
      const input = el as DomInput;
      const key = input.name || selectorFor(el);
      const group = radioGroups.get(key);
      if (group) group.push(input);
      else radioGroups.set(key, [input]);
    }
    for (const [name, inputs] of radioGroups) {
      const first = inputs[0]!;
      controls.push({
        selector: first.name ? `input[type=radio][name="${esc(first.name)}"]` : selectorFor(first),
        kind: "radio",
        label: `${name} | ${labelFor(first)}`,
        values: inputs.map(i => ({ value: i.value, label: labelFor(i).split(" | ")[0] })),
      });
    }

    // Ranges, colour pickers, checkboxes and text/number inputs.
    for (const el of all("input")) {
      const input = el as DomInput;
      const type = (input.type || "text").toLowerCase();
      if (type === "radio" || type === "file") continue;
      const kind: ControlKind =
        type === "range" ? "range" : type === "checkbox" ? "checkbox" : "text";
      controls.push({
        selector: selectorFor(el),
        kind,
        label: `${type} | ${labelFor(el)}`,
        // A range has no enumerable values, so record its bounds instead —
        // enough for a caller to clamp into, without inventing steps.
        values: type === "range"
          ? [{ value: input.min || "0", label: "min" }, { value: input.max || "100", label: "max" }]
          : [],
      });
    }

    // Clickable chips/tiles carrying a value in a data attribute — how most
    // modern editors present an animation picker.
    const VALUE_ATTRS = ["data-value", "data-animation", "data-effect", "data-id", "data-option", "value"];
    const chipGroups = new Map<string, { value: string; label: string }[]>();
    for (const el of all("button, [role=button], li[data-value], a[data-value]")) {
      const attr = VALUE_ATTRS.find(a => el.hasAttribute(a));
      if (!attr) continue;
      const value = el.getAttribute(attr) ?? "";
      if (!value) continue;
      const parent = el.parentElement;
      const groupKey = `${attr}::${parent ? selectorFor(parent) : "?"}`;
      const entry = { value, label: (el.textContent ?? "").trim().slice(0, 80) };
      const group = chipGroups.get(groupKey);
      if (group) group.push(entry);
      else chipGroups.set(groupKey, [entry]);
    }
    for (const [groupKey, entries] of chipGroups) {
      const attr = groupKey.split("::")[0]!;
      controls.push({
        selector: `[${attr}]`,
        kind: "button",
        valueAttribute: attr,
        label: `${attr} | ${entries.map(e => e.label).filter(Boolean).slice(0, 6).join(", ")}`,
        values: entries.map(e => ({ value: e.value, label: e.label || undefined })),
      });
    }

    const ACTION_TEXT = /(generate|create|make|export|download|save|render|convert|apply)/i;
    const actionButtons = all("button, a, [role=button], input[type=submit]")
      .map(el => ({ selector: selectorFor(el), text: (el.textContent ?? "").trim().slice(0, 80) }))
      .filter(b => ACTION_TEXT.test(b.text))
      .slice(0, 40);

    return {
      title: doc.title,
      fileInputs: all("input[type=file]").map(selectorFor),
      controls,
      actionButtons,
      scripts: all("script[src]")
        .map(s => s.getAttribute("src") ?? "")
        .filter(Boolean),
      clientSide: {
        canvasCount: all("canvas").length,
        hasOffscreenCanvas: typeof w.OffscreenCanvas !== "undefined",
        hasWebAssembly: typeof w.WebAssembly !== "undefined",
        workerScripts: [],
      },
    };
  });
}
