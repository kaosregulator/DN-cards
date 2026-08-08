// Persistent scene navigation dock — the in-Discord "arcade" switcher. One small
// pill shared by every scene so the player can jump HQ ⇄ Battle ⇄ Raid ⇄ Packs
// without leaving the Activity. DOM overlay; each scene creates one and destroys
// it on shutdown.

export type SceneKey = "Hq" | "Battle" | "Raid" | "Pack";

const TABS: { key: SceneKey; label: string }[] = [
  { key: "Hq", label: "🏰 HQ" },
  { key: "Battle", label: "⚔ Battle" },
  { key: "Raid", label: "🐉 Raid" },
  { key: "Pack", label: "🎁 Packs" },
];

export class NavDock {
  readonly root: HTMLDivElement;

  constructor(current: SceneKey, onNavigate: (key: SceneKey) => void) {
    this.injectStyles();
    this.root = document.createElement("div");
    this.root.id = "nav-dock";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.className = "nav-tab" + (t.key === current ? " active" : "");
      b.textContent = t.label;
      if (t.key !== current) b.onclick = () => onNavigate(t.key);
      this.root.appendChild(b);
    }
    document.body.appendChild(this.root);
  }

  destroy(): void {
    this.root.remove();
  }

  private injectStyles(): void {
    if (document.getElementById("nav-dock-style")) return;
    const s = document.createElement("style");
    s.id = "nav-dock-style";
    s.textContent = `
      #nav-dock { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 4px; padding: 5px; z-index: 12; pointer-events: auto;
        background: rgba(12,17,32,.72); backdrop-filter: blur(8px);
        border: 1px solid #24305a; border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.35);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .nav-tab { font-size: 13px; font-weight: 600; color: #aeb9e0; background: transparent;
        border: none; border-radius: 999px; padding: 7px 14px; cursor: pointer; transition: .12s; }
      .nav-tab:hover { color: #fff; background: #263255; }
      .nav-tab.active { color: #fff; background: #3355ee; cursor: default; }
    `;
    document.head.appendChild(s);
  }
}
