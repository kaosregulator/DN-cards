// Character picker — a Main-Menu modal to choose your avatar (and, later, a pet).
// Previews are drawn to a canvas by cropping the idle-down frame out of each
// character sheet, so it works for both the built-in duelist and the NPC sheets
// without extra art.

import { AVATARS, type AvatarDef } from "../world/avatars";
import { PETS, petPreviewUrl } from "../world/pets";
import { getAvatarId, setAvatarId, getPetId, setPetId } from "../state/profile";

function assetUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}${rel}`;
}

export interface CharacterPickerOpts {
  onClose?: () => void;
}

export class CharacterPicker {
  private readonly root: HTMLDivElement;
  private filter: "all" | "female" | "male" = "all";
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(private opts: CharacterPickerOpts = {}) {
    this.injectStyles();
    this.root = document.createElement("div");
    this.root.className = "cp-overlay";
    this.root.innerHTML = `
      <div class="cp-panel" role="dialog" aria-label="Choose your character">
        <div class="cp-head">
          <div class="cp-title">🧍 Choose Your Character</div>
          <button type="button" class="cp-close" aria-label="Close">✕</button>
        </div>
        <div class="cp-tabs">
          <button type="button" data-f="all" class="cp-tab on">All</button>
          <button type="button" data-f="female" class="cp-tab">Female</button>
          <button type="button" data-f="male" class="cp-tab">Male</button>
        </div>
        <div class="cp-grid"></div>
        <div class="cp-section">🐾 Pet Companion</div>
        <div class="cp-pets"></div>
        <div class="cp-foot"><button type="button" class="cp-done">Done</button></div>
      </div>`;
    this.root.addEventListener("click", (e) => { if (e.target === this.root) this.close(); });
    this.root.querySelector(".cp-close")!.addEventListener("click", () => this.close());
    this.root.querySelector(".cp-done")!.addEventListener("click", () => this.close());
    for (const t of Array.from(this.root.querySelectorAll(".cp-tab"))) {
      t.addEventListener("click", () => {
        this.filter = (t as HTMLElement).dataset.f as typeof this.filter;
        for (const o of Array.from(this.root.querySelectorAll(".cp-tab"))) o.classList.remove("on");
        t.classList.add("on");
        this.renderGrid();
      });
    }
    document.body.appendChild(this.root);
    this.renderGrid();
    this.renderPets();
  }

  private close(): void {
    this.root.remove();
    this.opts.onClose?.();
  }

  private renderGrid(): void {
    const grid = this.root.querySelector(".cp-grid") as HTMLElement;
    grid.innerHTML = "";
    const selected = getAvatarId();
    const list = AVATARS.filter((a) => this.filter === "all" || a.gender === this.filter || a.gender === "neutral");
    for (const def of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "cp-card" + (def.id === selected ? " sel" : "");
      const canvas = document.createElement("canvas");
      canvas.width = 48; canvas.height = 72;
      card.appendChild(canvas);
      const name = document.createElement("div");
      name.className = "cp-name";
      name.textContent = def.name;
      card.appendChild(name);
      card.addEventListener("click", () => {
        setAvatarId(def.id);
        for (const c of Array.from(grid.querySelectorAll(".cp-card"))) c.classList.remove("sel");
        card.classList.add("sel");
      });
      grid.appendChild(card);
      this.drawPreview(canvas, def);
    }
  }

  private drawPreview(canvas: HTMLCanvasElement, def: AvatarDef): void {
    const draw = (img: HTMLImageElement) => {
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // idle-down frame: duelist = col 1 row 0; npc3 = col 0, row charIndex*3.
      const col = def.layout === "duelist" ? 1 : 0;
      const row = def.layout === "duelist" ? 0 : def.charIndex * 3;
      ctx.drawImage(img, col * def.fw, row * def.fh, def.fw, def.fh, 0, 0, canvas.width, canvas.height);
    };
    const cached = this.images.get(def.url);
    if (cached?.complete && cached.naturalWidth) { draw(cached); return; }
    const img = cached ?? new Image();
    if (!cached) {
      img.src = assetUrl(def.url);
      this.images.set(def.url, img);
    }
    img.addEventListener("load", () => draw(img), { once: true });
  }

  private renderPets(): void {
    const grid = this.root.querySelector(".cp-pets") as HTMLElement;
    grid.innerHTML = "";
    const selected = getPetId();
    const entries: { id: string | null; name: string }[] = [
      { id: null, name: "No Pet" },
      ...PETS.map((p) => ({ id: p.id as string | null, name: p.name })),
    ];
    for (const { id, name } of entries) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "cp-card" + (id === selected ? " sel" : "");
      if (id === null) {
        const none = document.createElement("div");
        none.className = "cp-none";
        none.textContent = "🚫";
        card.appendChild(none);
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = 60; canvas.height = 60;
        card.appendChild(canvas);
        this.drawPetPreview(canvas, id);
      }
      const label = document.createElement("div");
      label.className = "cp-name";
      label.textContent = name;
      card.appendChild(label);
      card.addEventListener("click", () => {
        setPetId(id);
        for (const c of Array.from(grid.querySelectorAll(".cp-card"))) c.classList.remove("sel");
        card.classList.add("sel");
      });
      grid.appendChild(card);
    }
  }

  private drawPetPreview(canvas: HTMLCanvasElement, breed: string): void {
    const url = petPreviewUrl(breed);
    const draw = (img: HTMLImageElement) => {
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // idle strip: first 100×100 frame.
      ctx.drawImage(img, 0, 0, 100, 100, 0, 0, canvas.width, canvas.height);
    };
    const cached = this.images.get(url);
    if (cached?.complete && cached.naturalWidth) { draw(cached); return; }
    const img = cached ?? new Image();
    if (!cached) { img.src = url; this.images.set(url, img); }
    img.addEventListener("load", () => draw(img), { once: true });
  }

  private injectStyles(): void {
    if (document.getElementById("cp-style")) return;
    const s = document.createElement("style");
    s.id = "cp-style";
    s.textContent = `
      .cp-overlay { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center;
        justify-content: center; background: rgba(4,7,16,.72); backdrop-filter: blur(4px);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .cp-panel { width: min(560px, 94vw); max-height: 88vh; display: flex; flex-direction: column;
        background: #10152a; border: 1px solid #2a3568; border-radius: 16px; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,.6); color: #e6ecff; }
      .cp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
        border-bottom: 1px solid #232e57; }
      .cp-title { font-size: 16px; font-weight: 700; }
      .cp-close { background: #212b4d; border: 1px solid #2f3b66; color: #dbe4ff; width: 30px; height: 30px;
        border-radius: 8px; cursor: pointer; font-size: 14px; }
      .cp-tabs { display: flex; gap: 8px; padding: 12px 16px 4px; }
      .cp-tab { padding: 7px 16px; border-radius: 999px; cursor: pointer; font-size: 13px; font-weight: 600;
        color: #aeb9e0; background: #1a2240; border: 1px solid #2a3568; font-family: inherit; }
      .cp-tab.on { color: #fff; background: #3355ee; border-color: #3355ee; }
      .cp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px;
        padding: 14px 16px; overflow-y: auto; }
      .cp-section { padding: 6px 16px 2px; font-size: 13px; font-weight: 700; color: #aeb9e0;
        border-top: 1px solid #232e57; margin-top: 2px; }
      .cp-pets { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px;
        padding: 10px 16px 4px; overflow-y: auto; }
      .cp-pets canvas { image-rendering: pixelated; width: 60px; height: 60px; }
      .cp-none { width: 60px; height: 60px; display: flex; align-items: center; justify-content: center;
        font-size: 26px; opacity: .8; }
      .cp-card { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 4px;
        background: #171f3c; border: 2px solid #232e57; border-radius: 12px; cursor: pointer; }
      .cp-card:hover { border-color: #3b4a86; }
      .cp-card.sel { border-color: #5573ff; background: #1c2650; box-shadow: 0 0 0 2px rgba(85,115,255,.35); }
      .cp-card canvas { image-rendering: pixelated; width: 48px; height: 72px; }
      .cp-name { font-size: 10px; color: #c9d4ff; text-align: center; line-height: 1.1; }
      .cp-foot { padding: 12px 16px; border-top: 1px solid #232e57; text-align: right; }
      .cp-done { padding: 9px 22px; border-radius: 10px; border: none; cursor: pointer; font-weight: 700;
        color: #fff; background: #3355ee; font-family: inherit; font-size: 14px; }
    `;
    document.head.appendChild(s);
  }
}
