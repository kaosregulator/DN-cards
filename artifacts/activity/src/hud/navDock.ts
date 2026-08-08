// Persistent scene navigation dock — the in-Discord "arcade" switcher. One small
// pill shared by every scene so the player can jump HQ ⇄ Battle ⇄ Raid ⇄ Packs
// without leaving the Activity. DOM overlay; each scene creates one and destroys
// it on shutdown.

export type SceneKey = "Hq" | "Battle" | "Raid" | "Pack";

const TABS: { key: SceneKey; icon: string; label: string }[] = [
  { key: "Hq", icon: "🏰", label: "HQ" },
  { key: "Battle", icon: "⚔️", label: "Battle" },
  { key: "Raid", icon: "🐉", label: "Raid" },
  { key: "Pack", icon: "🎁", label: "Packs" },
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
      b.setAttribute("aria-label", t.label);
      b.innerHTML = `<span class="nav-ico">${t.icon}</span><span class="nav-txt">${t.label}</span>`;
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
      #nav-dock { position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 4px; padding: 5px; z-index: 12; pointer-events: auto;
        background: rgba(12,17,32,.72); backdrop-filter: blur(8px);
        border: 1px solid #24305a; border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.35);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .nav-tab { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;
        color: #aeb9e0; background: transparent; border: none; border-radius: 999px;
        padding: 8px 14px; cursor: pointer; transition: .12s; min-height: 40px; }
      .nav-tab:hover { color: #fff; background: #263255; }
      .nav-tab.active { color: #fff; background: #3355ee; cursor: default; }
      .nav-ico { font-size: 16px; line-height: 1; }

      /* On a phone the dock becomes a compact icon bar pinned to the bottom —
         thumb-reachable, and it never collides with the top status bar. */
      body.is-small #nav-dock { top: auto; bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        gap: 2px; padding: 6px; }
      body.is-small .nav-tab { padding: 10px 14px; min-width: 52px; min-height: 48px; justify-content: center; }
      body.is-small .nav-txt { display: none; }
      body.is-small .nav-ico { font-size: 20px; }
      /* When the build palette is open on mobile, lift the dock above it. */
      body.is-small.editing-hq #nav-dock { display: none; }
    `;
    document.head.appendChild(s);
  }
}
