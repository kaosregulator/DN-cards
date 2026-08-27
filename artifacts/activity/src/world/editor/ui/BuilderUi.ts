// World Builder DOM chrome — toolbar, palette, properties, asset manager.

import type {
  EditorTool,
  PackImportSummary,
  WorldAssetCategory,
  WorldAssetEntry,
  WorldAssetPack,
  WorldEditDocument,
  WorldObject,
  WorldNpcProps,
} from "../types";
import { CATEGORY_LABELS, CATEGORY_ORDER, tilePickerCell} from "../types";

export interface BuilderUiCallbacks {
  onTool: (tool: EditorTool) => void;
  onCategory: (cat: WorldAssetCategory | "all") => void;
  onSelectAsset: (asset: WorldAssetEntry | null) => void;
  onSave: () => void;
  onExit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenAssetManager: () => void;
  onOpenMapManager?: () => void;
  onPropertyChange: (uid: string, props: Partial<WorldObject>) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onImportZip: (file: File) => Promise<void>;
  onImportFolder: (files: FileList) => Promise<void>;
  onDeletePack: (packId: string) => Promise<void>;
  onRefreshCatalog: () => Promise<void>;
  resolveUrl: (url: string) => string;
}

const STYLE_ID = "wb-editor-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
  .wb-root{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;color:#e8eefc}
  .wb-root *{box-sizing:border-box}
  .wb-panel{pointer-events:auto;background:rgba(12,16,28,.92);border:1px solid #2a3558;backdrop-filter:blur(10px);box-shadow:0 12px 40px rgba(0,0,0,.45)}
  .wb-top{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;padding:8px 10px;border-radius:14px;max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center}
  .wb-top button,.wb-side button,.wb-props button,.wb-am button{border:1px solid #334066;background:#182038;color:#dce6ff;border-radius:10px;padding:7px 11px;font:600 12px/1.1 inherit;cursor:pointer}
  .wb-top button:hover,.wb-side button:hover{border-color:#5b6ea8;background:#1e2a4a}
  .wb-top button.active,.wb-cat.active,.wb-src.active{border-color:#6ea8ff;background:#243968;color:#fff;box-shadow:inset 0 0 0 1px #6ea8ff55}
  .wb-sources{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
  .wb-src{padding:5px 9px!important;font-size:11px!important;border-radius:999px!important;font-weight:600}
  .wb-src.imported{border-style:dashed}
  .wb-badge{font:700 11px/1 inherit;letter-spacing:.04em;text-transform:uppercase;color:#8eb6ff;padding:0 6px}
  .wb-status{font:500 11px/1.2 inherit;color:#9aa8c7;min-width:80px}
  .wb-side{position:absolute;left:10px;top:64px;bottom:12px;width:min(280px,42vw);border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
  .wb-cats{display:flex;flex-wrap:wrap;gap:4px;padding:10px;border-bottom:1px solid #243056}
  .wb-cat{padding:5px 8px!important;font-size:11px!important;border-radius:999px!important}
  .wb-search{margin:8px 10px 0;width:calc(100% - 20px);border-radius:10px;border:1px solid #334066;background:#0f1528;color:#e8eefc;padding:8px 10px;font:500 12px inherit}
  .wb-grid{flex:1;overflow:auto;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;align-content:start}
  .wb-card{border:1px solid #2c3a62;border-radius:12px;background:#121a30;padding:6px;cursor:pointer;display:flex;flex-direction:column;gap:4px;min-height:88px}
  .wb-card:hover{border-color:#5b7ad1}
  .wb-card.selected{border-color:#7eb0ff;box-shadow:0 0 0 1px #7eb0ff88}
  .wb-thumb{width:100%;aspect-ratio:1;object-fit:contain;image-rendering:pixelated;background:#0a1020;border-radius:8px}
  .wb-thumb-ph{width:100%;aspect-ratio:1;border-radius:8px;display:grid;place-items:center;background:linear-gradient(145deg,#1a2444,#0d1428);font-size:22px}
  .wb-tilepick{position:absolute;inset:0;background:#0b1122;display:flex;flex-direction:column;z-index:5}
  .wb-tilepick-bar{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid #223052}
  .wb-tilepick-bar strong{font-size:13px}
  .wb-tilepick-bar small{color:#8fa0c8}
  .wb-tilepick-grid{flex:1;overflow:auto;padding:10px;display:grid;gap:2px;align-content:start}
  .wb-tilecell{width:100%;aspect-ratio:1;image-rendering:pixelated;background-repeat:no-repeat;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:0}
  .wb-tilecell:hover{border-color:#4f7fff}
  .wb-tilecell.selected{border-color:#e8c15a;box-shadow:0 0 0 1px #e8c15a}
  .wb-card span{font:600 10px/1.2 inherit;color:#c5d0ea;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wb-props{position:absolute;right:10px;top:64px;width:min(260px,40vw);border-radius:16px;padding:12px;display:none;max-height:calc(100vh - 80px);overflow:auto}
  .wb-props.open{display:block}
  .wb-props h3{margin:0 0 8px;font:700 13px inherit}
  .wb-props label{display:block;font:600 10px inherit;color:#8ea0c4;margin:8px 0 3px;text-transform:uppercase;letter-spacing:.03em}
  .wb-props input,.wb-props select,.wb-props textarea{width:100%;border-radius:8px;border:1px solid #334066;background:#0f1528;color:#e8eefc;padding:7px 8px;font:500 12px inherit}
  .wb-props textarea{min-height:64px;resize:vertical}
  .wb-props .row{display:flex;gap:6px;margin-top:10px}
  .wb-props .row button{flex:1}
  .wb-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);pointer-events:none;background:rgba(10,14,26,.85);border:1px solid #2a3558;border-radius:999px;padding:8px 14px;font:500 12px inherit;color:#b8c6e6;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis}
  .wb-am{position:absolute;inset:8% 10%;border-radius:18px;display:none;flex-direction:column;overflow:hidden;z-index:5}
  .wb-am.open{display:flex}
  .wb-am-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #243056}
  .wb-am-head h2{margin:0;font:700 16px inherit}
  .wb-am-body{flex:1;overflow:auto;padding:16px;display:grid;gap:14px}
  .wb-drop{border:2px dashed #3d4f80;border-radius:14px;padding:28px;text-align:center;color:#9db0d8;background:#0d1426}
  .wb-drop.drag{border-color:#7eb0ff;background:#142038;color:#dce8ff}
  .wb-am-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px}
  .wb-pack-list{display:grid;gap:8px}
  .wb-pack{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid #2c3a62;background:#121a30}
  .wb-pack strong{display:block;font:700 13px inherit}
  .wb-pack small{color:#8ea0c4}
  .wb-summary{padding:12px;border-radius:12px;background:#142238;border:1px solid #2f4a78;font:500 12px/1.45 inherit;white-space:pre-wrap}
  .wb-danger{border-color:#7a3048!important;background:#3a1824!important;color:#ffd0da!important}
  @media (max-width:720px){
    .wb-side{width:min(100vw - 20px,320px);bottom:auto;max-height:42vh}
    .wb-props{top:auto;bottom:12px;width:min(100vw - 20px,320px);max-height:36vh}
    .wb-am{inset:4%}
  }
  `;
  document.head.appendChild(st);
}

export class BuilderUi {
  readonly root: HTMLDivElement;
  private grid!: HTMLDivElement;
  private propsEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private statusEl!: HTMLSpanElement;
  private amEl!: HTMLDivElement;
  private packList!: HTMLDivElement;
  private summaryEl!: HTMLDivElement;
  private assets: WorldAssetEntry[] = [];
  private tilePicker: HTMLElement | null = null;
  private packs: WorldAssetPack[] = [];
  private category: WorldAssetCategory | "all" = "all";
  private source: string | "all" = "all";
  private filter = "";
  private selectedAssetId: string | null = null;
  private tool: EditorTool = "select";
  private cb: BuilderUiCallbacks;

  constructor(cb: BuilderUiCallbacks) {
    ensureStyles();
    this.cb = cb;
    this.root = document.createElement("div");
    this.root.className = "wb-root";
    this.root.innerHTML = `
      <div class="wb-panel wb-top">
        <span class="wb-badge">World Builder</span>
        <button type="button" data-tool="select" class="active" title="Select (V)">Select</button>
        <button type="button" data-tool="paint" title="Paint tiles (B)">Paint</button>
        <button type="button" data-tool="place" title="Place objects (P)">Place</button>
        <button type="button" data-tool="erase" title="Erase (X)">Erase</button>
        <button type="button" data-tool="collision" title="Collision">Collide</button>
        <button type="button" data-tool="zone" title="Zones">Zone</button>
        <button type="button" data-tool="spawn" title="Spawns">Spawn</button>
        <button type="button" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" data-act="redo" title="Redo (Ctrl+Y)">Redo</button>
        <button type="button" data-act="maps">Maps</button>
        <button type="button" data-act="assets">Asset Manager</button>
        <button type="button" data-act="save">Save</button>
        <button type="button" data-act="exit">Playtest</button>
        <span class="wb-status" data-status>Ready</span>
      </div>
      <div class="wb-panel wb-side">
        <div class="wb-sources" data-sources></div>
        <div class="wb-cats" data-cats></div>
        <input class="wb-search" type="search" placeholder="Search assets…" data-search />
        <div class="wb-grid" data-grid></div>
      </div>
      <div class="wb-panel wb-props" data-props>
        <h3>Properties</h3>
        <div data-props-body>Select an object</div>
      </div>
      <div class="wb-hint" data-hint>F9 edit · click to place · Save · Playtest</div>
      <div class="wb-panel wb-am" data-am>
        <div class="wb-am-head">
          <h2>Asset Manager</h2>
          <button type="button" data-am-close>Close</button>
        </div>
        <div class="wb-am-body">
          <div class="wb-drop" data-drop>
            <div><strong>Drag & drop a ZIP</strong> or select a folder to import LimeZu / tileset packs.</div>
            <div class="wb-am-actions">
              <button type="button" data-zip>Choose ZIP…</button>
              <button type="button" data-folder>Choose Folder…</button>
              <input type="file" accept=".zip,application/zip" hidden data-zip-input />
              <input type="file" webkitdirectory multiple hidden data-folder-input />
            </div>
          </div>
          <div class="wb-pack-list" data-packs></div>
          <div class="wb-summary" data-summary hidden></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.grid = this.root.querySelector("[data-grid]")!;
    this.propsEl = this.root.querySelector("[data-props]")!;
    this.hintEl = this.root.querySelector("[data-hint]")!;
    this.statusEl = this.root.querySelector("[data-status]")!;
    this.amEl = this.root.querySelector("[data-am]")!;
    this.packList = this.root.querySelector("[data-packs]")!;
    this.summaryEl = this.root.querySelector("[data-summary]")!;
    this.bind();
    this.renderSources();
    this.renderCategories();
  }

  destroy(): void {
    this.root.remove();
  }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
  }

  setHint(msg: string): void {
    this.hintEl.textContent = msg;
  }

  setTool(tool: EditorTool): void {
    this.tool = tool;
    this.root.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("active", (b as HTMLElement).dataset.tool === tool);
    });
  }

  setCatalog(packs: WorldAssetPack[], assets: WorldAssetEntry[]): void {
    this.packs = packs;
    this.assets = assets;
    // Drop a stale source selection if that pack is gone (e.g. deleted import).
    if (this.source !== "all" && !packs.some((p) => p.id === this.source)) this.source = "all";
    this.renderSources();
    this.renderPacks();
    this.renderGrid();
  }

  /** Focus the palette on one source (a world/pack id) or "all". */
  setActiveSource(sourceId: string): void {
    this.source = this.packs.some((p) => p.id === sourceId) ? sourceId : "all";
    this.renderSources();
    this.renderGrid();
  }

  setSelectedAsset(id: string | null): void {
    this.selectedAssetId = id;
    this.renderGrid();
  }

  showProperties(obj: WorldObject | null): void {
    const body = this.propsEl.querySelector("[data-props-body]")!;
    if (!obj) {
      this.propsEl.classList.remove("open");
      body.innerHTML = "Select an object";
      return;
    }
    this.propsEl.classList.add("open");
    const p = (obj.properties ?? {}) as WorldNpcProps;
    const isNpc = obj.kind === "npc" || obj.kind === "enemy";
    body.innerHTML = `
      <label>Kind</label><input value="${obj.kind}" disabled />
      <label>Asset</label><input value="${obj.assetId}" disabled />
      <label>X</label><input data-f="x" type="number" value="${Math.round(obj.x)}" />
      <label>Y</label><input data-f="y" type="number" value="${Math.round(obj.y)}" />
      <label>Rotation°</label><input data-f="rotation" type="number" step="90" value="${obj.rotation ?? 0}" />
      <label>Scale</label><input data-f="scale" type="number" step="0.05" value="${obj.scale ?? 1}" />
      <label>Depth</label><input data-f="depth" type="number" value="${obj.depth ?? 450}" />
      <label>Collision</label>
      <select data-f="collide"><option value="0" ${!obj.collide ? "selected" : ""}>Off</option><option value="1" ${obj.collide ? "selected" : ""}>On</option></select>
      <label>Floor</label><input data-f="floor" type="number" value="${obj.floor ?? 0}" />
      <label>Building ID</label><input data-f="buildingId" value="${obj.buildingId ?? ""}" />
      <label>Space</label>
      <select data-f="spaceKind">
        ${["exterior", "interior", "roof", "transition"].map((k) =>
          `<option value="${k}" ${(obj.spaceKind ?? "exterior") === k ? "selected" : ""}>${k}</option>`).join("")}
      </select>
      ${isNpc ? `
        <label>Name</label><input data-p="name" value="${p.name ?? ""}" />
        <label>Character type</label><input data-p="characterType" value="${p.characterType ?? obj.kind}" />
        <label>Facing</label>
        <select data-p="facing">${["down", "left", "right", "up"].map((f) =>
          `<option value="${f}" ${(p.facing ?? "down") === f ? "selected" : ""}>${f}</option>`).join("")}</select>
        <label>Behavior</label>
        <select data-p="behavior">${["stand", "idle", "walk", "patrol"].map((b) =>
          `<option value="${b}" ${(p.behavior ?? "stand") === b ? "selected" : ""}>${b}</option>`).join("")}</select>
        <label>Dialogue (one line per row)</label>
        <textarea data-p="dialogue">${(p.dialogue ?? []).join("\n")}</textarea>
        <label>Interaction</label><input data-p="interaction" value="${p.interaction ?? ""}" />
      ` : ""}
      <div class="row">
        <button type="button" data-dup>Duplicate</button>
        <button type="button" class="wb-danger" data-del>Delete</button>
      </div>
    `;
    const apply = (): void => {
      const num = (sel: string): number => Number((body.querySelector(sel) as HTMLInputElement)?.value ?? 0);
      const str = (sel: string): string => (body.querySelector(sel) as HTMLInputElement)?.value ?? "";
      const props: WorldNpcProps = { ...(obj.properties ?? {}) };
      if (isNpc) {
        props.name = str("[data-p=name]");
        props.characterType = str("[data-p=characterType]");
        props.facing = str("[data-p=facing]") as WorldNpcProps["facing"];
        props.behavior = str("[data-p=behavior]") as WorldNpcProps["behavior"];
        props.dialogue = str("[data-p=dialogue]").split("\n").map((l) => l.trim()).filter(Boolean);
        props.interaction = str("[data-p=interaction]");
      }
      this.cb.onPropertyChange(obj.uid, {
        x: num("[data-f=x]"),
        y: num("[data-f=y]"),
        rotation: num("[data-f=rotation]"),
        scale: num("[data-f=scale]"),
        depth: num("[data-f=depth]"),
        collide: str("[data-f=collide]") === "1",
        floor: num("[data-f=floor]"),
        buildingId: str("[data-f=buildingId]") || undefined,
        spaceKind: str("[data-f=spaceKind]") as WorldObject["spaceKind"],
        properties: props as WorldObject["properties"],
      });
    };
    body.querySelectorAll("input,select,textarea").forEach((el) => {
      el.addEventListener("change", apply);
    });
    body.querySelector("[data-del]")?.addEventListener("click", () => this.cb.onDeleteSelected());
    body.querySelector("[data-dup]")?.addEventListener("click", () => this.cb.onDuplicateSelected());
  }

  showImportSummary(summary: PackImportSummary): void {
    this.summaryEl.hidden = false;
    this.summaryEl.textContent =
      `Imported “${summary.name}” (${summary.packId})\n` +
      `Assets: ${summary.imported} · Skipped: ${summary.skipped}\n` +
      `Categories: ${summary.categories.join(", ") || "—"}\n` +
      (summary.unsupported.length ? `Unsupported (sample): ${summary.unsupported.slice(0, 8).join(", ")}\n` : "") +
      (summary.warnings.length ? `Warnings: ${summary.warnings.join("; ")}` : "");
  }

  openAssetManager(open: boolean): void {
    this.amEl.classList.toggle("open", open);
  }

  private bind(): void {
    this.root.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = (btn as HTMLElement).dataset.tool as EditorTool;
        this.setTool(tool);
        this.cb.onTool(tool);
      });
    });
    this.root.querySelector("[data-act=save]")!.addEventListener("click", () => this.cb.onSave());
    this.root.querySelector("[data-act=exit]")!.addEventListener("click", () => this.cb.onExit());
    this.root.querySelector("[data-act=undo]")!.addEventListener("click", () => this.cb.onUndo());
    this.root.querySelector("[data-act=redo]")!.addEventListener("click", () => this.cb.onRedo());
    this.root.querySelector("[data-act=assets]")!.addEventListener("click", () => {
      this.openAssetManager(true);
      this.cb.onOpenAssetManager();
    });
    this.root.querySelector("[data-act=maps]")?.addEventListener("click", () => {
      this.cb.onOpenMapManager?.();
    });
    this.root.querySelector("[data-am-close]")!.addEventListener("click", () => this.openAssetManager(false));
    this.root.querySelector("[data-search]")!.addEventListener("input", (e) => {
      this.filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderGrid();
    });

    const zipInput = this.root.querySelector("[data-zip-input]") as HTMLInputElement;
    const folderInput = this.root.querySelector("[data-folder-input]") as HTMLInputElement;
    this.root.querySelector("[data-zip]")!.addEventListener("click", () => zipInput.click());
    this.root.querySelector("[data-folder]")!.addEventListener("click", () => folderInput.click());
    zipInput.addEventListener("change", async () => {
      const f = zipInput.files?.[0];
      if (f) await this.cb.onImportZip(f);
      zipInput.value = "";
    });
    folderInput.addEventListener("change", async () => {
      if (folderInput.files?.length) await this.cb.onImportFolder(folderInput.files);
      folderInput.value = "";
    });

    const drop = this.root.querySelector("[data-drop]") as HTMLDivElement;
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", async (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      const f = e.dataTransfer?.files?.[0];
      if (f && /\.zip$/i.test(f.name)) await this.cb.onImportZip(f);
    });
  }

  private renderSources(): void {
    const el = this.root.querySelector("[data-sources]");
    if (!el) return;
    // "All" + one chip per source (built-in worlds first, then imported packs).
    const chips = [
      `<button type="button" class="wb-src ${this.source === "all" ? "active" : ""}" data-src="all">All Sources</button>`,
      ...this.packs.map((p) => {
        const imported = p.source === "imported";
        const label = imported ? `📦 ${p.name}` : p.name;
        return `<button type="button" class="wb-src ${imported ? "imported " : ""}${this.source === p.id ? "active" : ""}" data-src="${p.id}" title="${p.description ?? ""}">${label}</button>`;
      }),
    ];
    el.innerHTML = chips.join("");
    el.querySelectorAll("[data-src]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.source = (btn as HTMLElement).dataset.src as string;
        this.renderSources();
        this.renderGrid();
      });
    });
  }

  private renderCategories(): void {
    const el = this.root.querySelector("[data-cats]")!;
    const cats: Array<WorldAssetCategory | "all"> = ["all", ...CATEGORY_ORDER];
    el.innerHTML = cats.map((c) =>
      `<button type="button" class="wb-cat ${this.category === c ? "active" : ""}" data-cat="${c}">${
        c === "all" ? "All" : CATEGORY_LABELS[c]
      }</button>`).join("");
    el.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.category = (btn as HTMLElement).dataset.cat as WorldAssetCategory | "all";
        this.renderCategories();
        this.cb.onCategory(this.category);
        this.renderGrid();
      });
    });
  }

  private renderGrid(): void {
    const list = this.assets.filter((a) => {
      if (this.source !== "all" && a.packId !== this.source) return false;
      if (this.category !== "all" && a.category !== this.category) return false;
      if (!this.filter) return true;
      const hay = `${a.name} ${a.id} ${(a.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(this.filter);
    });
    this.grid.innerHTML = "";
    for (const a of list.slice(0, 240)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `wb-card${this.selectedAssetId === a.id ? " selected" : ""}`;
      const thumbUrl = a.thumb || a.url;
      if (thumbUrl) {
        card.innerHTML = `<img class="wb-thumb" alt="" src="${this.cb.resolveUrl(thumbUrl)}" /><span title="${a.name}">${a.name}</span>`;
      } else {
        const glyph = a.kind === "collision" ? "🧱" : a.kind === "spawn" ? "🚩" : a.kind === "zone" ? "▢" : "◆";
        card.innerHTML = `<div class="wb-thumb-ph">${glyph}</div><span title="${a.name}">${a.name}</span>`;
      }
      card.addEventListener("click", () => {
        // A multi-tile sheet (RPG Maker MV 48×48, LimeZu tilesets, …) opens a
        // tile picker so an INDIVIDUAL cell can be painted — not the whole PNG.
        if (a.tile?.sheet && (a.tile.count ?? 0) > 1) {
          this.selectedAssetId = a.id;
          this.renderGrid();
          this.openTilePicker(a);
          return;
        }
        this.selectedAssetId = a.id;
        this.renderGrid();
        this.cb.onSelectAsset(a);
        if (a.kind === "collision") this.cb.onTool("collision");
        else if (a.kind === "spawn") this.cb.onTool("spawn");
        else if (a.kind === "zone") this.cb.onTool("zone");
        else if (a.tile && (a.category === "floors" || a.category === "terrain" || a.category === "roads" || a.category === "walls")) {
          this.cb.onTool("paint");
        } else {
          this.cb.onTool("place");
        }
      });
      this.grid.appendChild(card);
    }
  }

  /** Open a grid picker that slices a multi-tile sheet into individual tiles. */
  private openTilePicker(asset: WorldAssetEntry): void {
    const t = asset.tile;
    if (!t) return;
    const columns = Math.max(1, t.columns);
    const rows = Math.max(1, t.rows ?? Math.ceil((t.count ?? columns) / columns));
    const count = t.count ?? columns * rows;
    const cell = 34;                                  // on-screen tile size (px)
    const sheetUrl = this.cb.resolveUrl(asset.url);

    this.closeTilePicker();
    const wrap = document.createElement("div");
    wrap.className = "wb-tilepick";
    wrap.innerHTML = `
      <div class="wb-tilepick-bar">
        <button type="button" class="wb-btn" data-back>← Back</button>
        <strong>${asset.name}</strong>
        <small>${columns}×${rows} · ${count} tiles · ${t.tileWidth}px</small>
      </div>
      <div class="wb-tilepick-grid" data-cells></div>`;
    const gridEl = wrap.querySelector<HTMLElement>("[data-cells]")!;
    gridEl.style.gridTemplateColumns = `repeat(${columns}, ${cell}px)`;
    for (let id = 0; id < count; id++) {
      const rect = tilePickerCell(t, id, cell);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wb-tilecell";
      b.title = `Tile ${id}`;
      b.style.backgroundImage = `url("${sheetUrl}")`;
      b.style.backgroundSize = `${rect.bgW}px ${rect.bgH}px`;
      b.style.backgroundPosition = `${rect.bgX}px ${rect.bgY}px`;
      b.addEventListener("click", () => {
        gridEl.querySelectorAll(".wb-tilecell.selected").forEach((n) => n.classList.remove("selected"));
        b.classList.add("selected");
        // Paint exactly this cell: clone with the chosen localId (the existing
        // resolvePaintGid maps firstgid + localId to a real tile).
        const picked: WorldAssetEntry = { ...asset, tile: { ...t, localId: id } };
        this.cb.onSelectAsset(picked);
        this.cb.onTool("paint");
      });
      gridEl.appendChild(b);
    }
    wrap.querySelector("[data-back]")!.addEventListener("click", () => this.closeTilePicker());
    // Mount over the palette grid's positioned parent.
    (this.grid.parentElement ?? this.grid).appendChild(wrap);
    this.tilePicker = wrap;
  }

  private closeTilePicker(): void {
    this.tilePicker?.remove();
    this.tilePicker = null;
  }

  private renderPacks(): void {
    this.packList.innerHTML = this.packs.map((p) => `
      <div class="wb-pack">
        <div>
          <strong>${p.name}</strong>
          <small>${p.source} · ${p.assetCount} assets · ${(p.categories ?? []).slice(0, 6).join(", ")}</small>
        </div>
        ${p.source === "imported"
          ? `<button type="button" class="wb-danger" data-del-pack="${p.id}">Delete</button>`
          : `<small>built-in</small>`}
      </div>
    `).join("");
    this.packList.querySelectorAll("[data-del-pack]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.delPack!;
        await this.cb.onDeletePack(id);
        await this.cb.onRefreshCatalog();
      });
    });
  }

  /** Keep unused WorldEditDocument import type-check quiet via public helper. */
  describeDoc(doc: WorldEditDocument): string {
    return `${doc.mapKey} r${doc.revision} · ${doc.objects.length} objects · ${doc.tiles.length} tiles`;
  }
}
