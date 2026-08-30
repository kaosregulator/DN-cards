// ─────────────────────────────────────────────────────────────────────────────
// Minimal DOM shapes for page-evaluated code.
//
// This project compiles without the DOM lib (see tsconfig.base.json), which is
// the right default for a Node service — it stops server code from reaching for
// browser globals by accident. But the discovery functions below genuinely do
// run in a browser, inside `page.evaluate`.
//
// Rather than pull `lib.dom` into the whole program — which would make
// `document` typecheck everywhere, including in server code where it would
// crash — the handful of shapes those functions touch are declared here as
// ORDINARY EXPORTED INTERFACES. They are types, not ambient globals, so they
// stay scoped to this module and still give real checking inside the callbacks.
// ─────────────────────────────────────────────────────────────────────────────

export interface DomElement {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: DomElement | null;
  readonly children: ArrayLike<DomElement>;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  closest(selector: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}

export interface DomOption extends DomElement {
  value: string;
}

export interface DomSelect extends DomElement {
  readonly options: ArrayLike<DomOption>;
}

export interface DomInput extends DomElement {
  readonly type: string;
  readonly name: string;
  readonly value: string;
  readonly min: string;
  readonly max: string;
}

export interface DomMedia extends DomElement {
  readonly src: string;
}

export interface DomDocument {
  readonly title: string;
  readonly body: DomElement;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}

/** A blob-reading callback shaped like the browser's FileReader. */
export interface DomFileReader {
  result: unknown;
  onloadend: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL(blob: unknown): void;
}

/** The browser globals the evaluated functions use. */
export interface BrowserWindow {
  readonly document: DomDocument;
  readonly CSS: { escape(value: string): string };
  readonly OffscreenCanvas?: unknown;
  readonly WebAssembly?: unknown;
  fetch(input: string): Promise<{ blob(): Promise<unknown> }>;
  FileReader: new () => DomFileReader;
}

/** Reach the browser globals from inside an evaluated callback. */
export function browserWindow(): BrowserWindow {
  return globalThis as unknown as BrowserWindow;
}
