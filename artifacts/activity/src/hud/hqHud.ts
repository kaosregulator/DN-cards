// ─────────────────────────────────────────────────────────────────────────────
// HQ HUD — a DOM overlay on top of the Phaser canvas. DOM (not in-canvas) keeps
// the UI crisp, accessible, and easy to lay out, while the canvas owns the world.
//
// It renders: the top status bar (name / level / shards / shield), the mode
// toggle (View ⇄ Build), and in Build mode the object palette + edit tools
// (rotate / duplicate / delete / undo / redo / save). Everything is driven by
// callbacks the scene supplies; the HUD holds no game state of its own.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogAsset, HqWorld } from "../net/api";

export interface HqHudCallbacks {
  onToggleEdit: (editing: boolean) => void;
  onPickAsset: (assetId: string | null) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  spriteUrl: (key: string) => string | null;
}

const CATEGORY_ORDER = [
  "structure", "door", "furniture", "table", "seating", "storage", "rug",
  "nature", "banner", "trophy", "npc", "light", "building", "floor",
];

export class HqHud {
  readonly root: HTMLDivElement;
  private editing = false;
  private selectedAsset: string | null = null;
  private hasSelection = false;
  private dirty = false;
  private canUndo = false;
  private canRedo = false;

  constructor(
    private readonly world: HqWorld,
    private readonly cb: HqHudCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.id = "hq-hud";
    this.injectStyles();
    document.body.appendChild(this.root);
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  setSelection(has: boolean): void {
    this.hasSelection = has;
    this.render();
  }

  setHistory(canUndo: boolean, canRedo: boolean, dirty: boolean): void {
    this.canUndo = canUndo;
    this.canRedo = canRedo;
    this.dirty = dirty;
    this.render();
  }

  flashSave(text: string, ok: boolean): void {
    const el = this.root.querySelector<HTMLButtonElement>(".hud-save");
    if (!el) return;
    const prev = el.textContent;
    el.textContent = text;
    el.classList.toggle("ok", ok);
    el.classList.toggle("err", !ok);
    window.setTimeout(() => {
      el.textContent = prev;
      el.classList.remove("ok", "err");
      this.render();
    }, 1600);
  }

  // ── render ──────────────────────────────────────────────────────────────────
  private render(): void {
    this.root.innerHTML = "";
    this.root.appendChild(this.topBar());
    this.root.appendChild(this.modeToggle());
    if (this.editing) {
      this.root.appendChild(this.tools());
      this.root.appendChild(this.palette());
    }
  }

  private topBar(): HTMLElement {
    const bar = el("div", "hud-top");
    bar.innerHTML = `
      <span class="hud-title">🏰 ${escapeHtml(this.world.user.username)}'s HQ</span>
      <span class="hud-chip">Lv ${this.world.hq.level}</span>
      <span class="hud-chip">💠 ${this.world.hq.shards.toLocaleString()}</span>
      <span class="hud-chip shield">🛡 ${this.world.shield.strength}%</span>
    `;
    return bar;
  }

  private modeToggle(): HTMLElement {
    const wrap = el("div", "hud-mode");
    const btn = document.createElement("button");
    btn.className = "hud-btn primary";
    btn.textContent = this.editing ? "✓  Done" : "🔨  Build";
    btn.onclick = () => {
      this.editing = !this.editing;
      if (!this.editing) this.selectAsset(null);
      this.cb.onToggleEdit(this.editing);
      this.render();
    };
    wrap.appendChild(btn);
    return wrap;
  }

  private tools(): HTMLElement {
    const wrap = el("div", "hud-tools");
    const mk = (label: string, cls: string, enabled: boolean, fn: () => void) => {
      const b = document.createElement("button");
      b.className = `hud-btn ${cls}`;
      b.textContent = label;
      b.disabled = !enabled;
      b.onclick = fn;
      return b;
    };
    wrap.appendChild(mk("⟳ Rotate", "", this.hasSelection, this.cb.onRotate));
    wrap.appendChild(mk("⧉ Copy", "", this.hasSelection, this.cb.onDuplicate));
    wrap.appendChild(mk("🗑 Delete", "danger", this.hasSelection, this.cb.onDelete));
    wrap.appendChild(mk("↶ Undo", "", this.canUndo, this.cb.onUndo));
    wrap.appendChild(mk("↷ Redo", "", this.canRedo, this.cb.onRedo));
    const save = mk(this.dirty ? "💾 Save*" : "💾 Save", "hud-save primary", this.dirty, this.cb.onSave);
    wrap.appendChild(save);
    return wrap;
  }

  private palette(): HTMLElement {
    const wrap = el("div", "hud-palette");
    const owned = this.world.catalog.filter((a) => a.owned);
    const byCat = new Map<string, CatalogAsset[]>();
    for (const a of owned) {
      const list = byCat.get(a.category) ?? [];
      list.push(a);
      byCat.set(a.category, list);
    }
    const cats = [...byCat.keys()].sort(
      (x, y) => (CATEGORY_ORDER.indexOf(x) + 99) - (CATEGORY_ORDER.indexOf(y) + 99),
    );
    for (const cat of cats) {
      const group = el("div", "hud-pal-group");
      const head = el("div", "hud-pal-head");
      head.textContent = cat;
      group.appendChild(head);
      const row = el("div", "hud-pal-row");
      for (const a of byCat.get(cat) ?? []) {
        row.appendChild(this.paletteItem(a));
      }
      group.appendChild(row);
      wrap.appendChild(group);
    }
    if (owned.length === 0) {
      const empty = el("div", "hud-pal-empty");
      empty.textContent = "Earn decorations by playing — they appear here.";
      wrap.appendChild(empty);
    }
    return wrap;
  }

  private paletteItem(a: CatalogAsset): HTMLElement {
    const item = document.createElement("button");
    item.className = "hud-pal-item" + (this.selectedAsset === a.id ? " active" : "");
    item.title = a.name;
    const url = this.cb.spriteUrl(a.sprite);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = a.name;
      img.loading = "lazy";
      item.appendChild(img);
    } else {
      item.textContent = a.name.slice(0, 2);
    }
    item.onclick = () => this.selectAsset(this.selectedAsset === a.id ? null : a.id);
    return item;
  }

  private selectAsset(id: string | null): void {
    this.selectedAsset = id;
    this.cb.onPickAsset(id);
    this.render();
  }

  // ── styles ──────────────────────────────────────────────────────────────────
  private injectStyles(): void {
    if (document.getElementById("hq-hud-style")) return;
    const s = document.createElement("style");
    s.id = "hq-hud-style";
    s.textContent = `
      #hq-hud { position: fixed; inset: 0; pointer-events: none;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e6ecff; z-index: 10; }
      #hq-hud button { pointer-events: auto; }
      .hud-top { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; align-items: center;
        background: rgba(12,17,32,.72); backdrop-filter: blur(8px); border: 1px solid #24305a;
        border-radius: 12px; padding: 8px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
      .hud-title { font-weight: 700; font-size: 14px; }
      .hud-chip { font-size: 12px; background: #182240; border: 1px solid #26335f;
        padding: 3px 8px; border-radius: 20px; }
      .hud-chip.shield { color: #7fd0ff; border-color: #2b6a94; }
      .hud-mode { position: absolute; top: 12px; right: 12px; }
      .hud-btn { font-size: 13px; font-weight: 600; color: #dbe4ff; background: #222c4d;
        border: 1px solid #33406f; border-radius: 10px; padding: 9px 14px; cursor: pointer; transition: .12s; }
      .hud-btn:hover:not(:disabled) { background: #2c3966; transform: translateY(-1px); }
      .hud-btn:disabled { opacity: .38; cursor: default; }
      .hud-btn.primary { background: #3355ee; border-color: #4a6bff; color: #fff; }
      .hud-btn.primary:hover:not(:disabled) { background: #4361ff; }
      .hud-btn.danger { background: #4d2230; border-color: #7a3348; color: #ffc2d0; }
      .hud-btn.ok { background: #1f6d43 !important; border-color: #2ea06a !important; }
      .hud-btn.err { background: #6d1f2f !important; border-color: #a02e44 !important; }
      .hud-tools { position: absolute; top: 62px; right: 12px; display: flex; gap: 6px; flex-wrap: wrap;
        justify-content: flex-end; max-width: 60vw; }
      .hud-palette { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 14px;
        overflow-x: auto; padding: 10px 12px 14px; background: linear-gradient(0deg, rgba(9,13,26,.94), rgba(9,13,26,.5) 70%, transparent);
        pointer-events: auto; }
      .hud-pal-group { display: flex; flex-direction: column; gap: 6px; }
      .hud-pal-head { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #6b78a8; padding-left: 2px; }
      .hud-pal-row { display: flex; gap: 6px; }
      .hud-pal-item { width: 60px; height: 60px; background: rgba(28,36,64,.85); border: 1px solid #2c3a68;
        border-radius: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer;
        padding: 4px; overflow: hidden; }
      .hud-pal-item:hover { border-color: #4a6bff; }
      .hud-pal-item.active { border-color: #6df; box-shadow: 0 0 0 2px rgba(102,221,255,.4); background: #223; }
      .hud-pal-item img { max-width: 100%; max-height: 100%; image-rendering: auto;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
      .hud-pal-empty { color: #7a86b0; font-size: 13px; align-self: center; padding: 20px; }
    `;
    document.head.appendChild(s);
  }
}

function el(tag: string, cls: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.className = cls;
  return d;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
