// Map Manager + door/spawn property extensions for BuilderUi.
// Kept as additive helpers so the main BuilderUi file stays reviewable.

import type {
  CreateMapRequest,
  CustomMapMeta,
  WorldDoor,
  WorldSpawn,
} from "../types";

export interface MapManagerCallbacks {
  onRefreshMaps: () => Promise<void>;
  onOpenMap: (key: string) => void;
  onCreateMap: (req: CreateMapRequest) => Promise<void>;
  onRenameMap: (key: string, name: string) => Promise<void>;
  onDuplicateMap: (key: string) => Promise<void>;
  onDeleteMap: (key: string) => Promise<void>;
}

export function mountMapManager(
  root: HTMLElement,
  opts: {
    currentKey: string;
    maps: CustomMapMeta[];
    cb: MapManagerCallbacks;
  },
): { open: (v: boolean) => void; setMaps: (m: CustomMapMeta[], currentKey: string) => void } {
  let panel = root.querySelector("[data-mm]") as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "wb-panel wb-am";
    panel.dataset.mm = "1";
    panel.innerHTML = `
      <div class="wb-am-head">
        <h2>Map Manager</h2>
        <button type="button" data-mm-close>Close</button>
      </div>
      <div class="wb-am-body">
        <div class="wb-summary" data-mm-current></div>
        <div class="wb-am-actions">
          <button type="button" data-mm-create>+ Create New Map</button>
          <button type="button" data-mm-refresh>Refresh</button>
        </div>
        <div class="wb-pack-list" data-mm-list></div>
        <div class="wb-summary" data-mm-form hidden></div>
      </div>
    `;
    root.appendChild(panel);
    // Reuse Asset Manager styles (.wb-am).
    const style = document.getElementById("wb-editor-style");
    if (style && !style.textContent?.includes(".wb-mm-row")) {
      style.textContent += `
        .wb-mm-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
        .wb-mm-row input,.wb-mm-row select{flex:1;min-width:80px;border-radius:8px;border:1px solid #334066;background:#0f1528;color:#e8eefc;padding:7px 8px;font:500 12px inherit}
        .wb-pack.current{border-color:#7eb0ff;box-shadow:0 0 0 1px #7eb0ff66}
        .wb-pack .wb-mm-actions{display:flex;flex-wrap:wrap;gap:4px}
      `;
    }
  }

  const listEl = panel.querySelector("[data-mm-list]") as HTMLDivElement;
  const currentEl = panel.querySelector("[data-mm-current]") as HTMLDivElement;
  const formEl = panel.querySelector("[data-mm-form]") as HTMLDivElement;
  let maps = opts.maps;
  let currentKey = opts.currentKey;

  const render = (): void => {
    const cur = maps.find((m) => m.key === currentKey);
    currentEl.textContent = `Editing: ${cur?.name ?? currentKey} (${currentKey})`;
    listEl.innerHTML = maps.map((m) => `
      <div class="wb-pack ${m.key === currentKey ? "current" : ""}">
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          <small>${m.source}${m.blank ? " · blank" : ""} · ${m.gridW || "?"}×${m.gridH || "?"} · ${m.hasEdits ? "has edits" : "clean"}</small>
        </div>
        <div class="wb-mm-actions">
          <button type="button" data-open="${m.key}">${m.key === currentKey ? "Current" : "Open"}</button>
          ${m.source === "custom" ? `
            <button type="button" data-rename="${m.key}">Rename</button>
            <button type="button" data-dup="${m.key}">Duplicate</button>
            <button type="button" class="wb-danger" data-del="${m.key}">Delete</button>
          ` : m.hasEdits ? `<button type="button" data-open="${m.key}">Edit overlay</button>` : ""}
        </div>
      </div>
    `).join("") || `<div class="wb-summary">No maps yet — create one.</div>`;

    listEl.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = (btn as HTMLElement).dataset.open!;
        if (key !== currentKey) opts.cb.onOpenMap(key);
      });
    });
    listEl.querySelectorAll("[data-rename]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = (btn as HTMLElement).dataset.rename!;
        const m = maps.find((x) => x.key === key);
        const name = prompt("Rename map", m?.name ?? key);
        if (name) await opts.cb.onRenameMap(key, name);
      });
    });
    listEl.querySelectorAll("[data-dup]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await opts.cb.onDuplicateMap((btn as HTMLElement).dataset.dup!);
      });
    });
    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = (btn as HTMLElement).dataset.del!;
        if (key === currentKey) {
          alert("Switch to another map before deleting the one you are editing.");
          return;
        }
        if (confirm(`Delete map “${key}”? This cannot be undone.`)) {
          await opts.cb.onDeleteMap(key);
        }
      });
    });
  };

  panel.querySelector("[data-mm-close]")!.addEventListener("click", () => {
    panel!.classList.remove("open");
  });
  panel.querySelector("[data-mm-refresh]")!.addEventListener("click", () => {
    void opts.cb.onRefreshMaps();
  });
  panel.querySelector("[data-mm-create]")!.addEventListener("click", () => {
    formEl.hidden = false;
    formEl.innerHTML = `
      <strong>Create New Map</strong>
      <div class="wb-mm-row" style="margin-top:8px">
        <input data-f-name placeholder="Map name (e.g. Cave)" />
      </div>
      <div class="wb-mm-row" style="margin-top:6px">
        <input data-f-w type="number" value="40" min="8" max="256" title="Width" />
        <input data-f-h type="number" value="30" min="8" max="256" title="Height" />
        <select data-f-tile>
          <option value="32">32×32</option>
          <option value="16">16×16</option>
          <option value="48">48×48 (MV)</option>
          <option value="20">20×20</option>
        </select>
        <select data-f-space>
          <option value="exterior">Exterior</option>
          <option value="interior">Interior</option>
          <option value="cave">Cave</option>
          <option value="roof">Roof</option>
          <option value="arena">Arena</option>
          <option value="hq">HQ</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="wb-am-actions">
        <button type="button" data-f-go>Create & Open</button>
        <button type="button" data-f-cancel>Cancel</button>
      </div>
    `;
    formEl.querySelector("[data-f-cancel]")!.addEventListener("click", () => {
      formEl.hidden = true;
    });
    formEl.querySelector("[data-f-go]")!.addEventListener("click", async () => {
      const name = (formEl.querySelector("[data-f-name]") as HTMLInputElement).value.trim();
      if (!name) { alert("Enter a map name."); return; }
      const req: CreateMapRequest = {
        name,
        width: Number((formEl.querySelector("[data-f-w]") as HTMLInputElement).value) || 40,
        height: Number((formEl.querySelector("[data-f-h]") as HTMLInputElement).value) || 30,
        tile: Number((formEl.querySelector("[data-f-tile]") as HTMLSelectElement).value) || 32,
        spaceKind: (formEl.querySelector("[data-f-space]") as HTMLSelectElement).value as CreateMapRequest["spaceKind"],
      };
      formEl.hidden = true;
      await opts.cb.onCreateMap(req);
    });
  });

  render();

  return {
    open: (v: boolean) => { panel!.classList.toggle("open", v); if (v) render(); },
    setMaps: (m, key) => { maps = m; currentKey = key; render(); },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Properties form for a selected door (destination map + named spawn). */
export function renderDoorProps(
  body: HTMLElement,
  door: WorldDoor,
  maps: CustomMapMeta[],
  destSpawns: Array<{ uid: string; name: string }>,
  onChange: (patch: Partial<WorldDoor>) => void,
): void {
  const mapOpts = maps.map((m) =>
    `<option value="${m.key}" ${door.targetMap === m.key ? "selected" : ""}>${escapeHtml(m.name)} (${m.key})</option>`).join("");
  const spawnOpts = [
    `<option value="">— Default spawn —</option>`,
    ...destSpawns.map((s) =>
      `<option value="${escapeHtml(s.name)}" ${door.targetSpawn === s.name || door.targetSpawn === s.uid ? "selected" : ""}>${escapeHtml(s.name)}</option>`),
  ].join("");
  body.innerHTML = `
    <label>Kind</label><input value="door / portal" disabled />
    <label>Label</label><input data-d="label" value="${escapeHtml(door.label ?? "")}" />
    <label>Destination Map</label>
    <select data-d="targetMap"><option value="">— none —</option>${mapOpts}</select>
    <label>Destination Spawn</label>
    <select data-d="targetSpawn">${spawnOpts}</select>
    <label>Locked</label>
    <select data-d="locked">
      <option value="0" ${!door.locked ? "selected" : ""}>Unlocked</option>
      <option value="1" ${door.locked ? "selected" : ""}>Locked</option>
    </select>
    <label>Transition</label>
    <select data-d="transition">
      <option value="fade" ${(door.transition ?? "fade") === "fade" ? "selected" : ""}>Fade</option>
      <option value="instant" ${door.transition === "instant" ? "selected" : ""}>Instant</option>
    </select>
    <label>Building ID</label><input data-d="buildingId" value="${escapeHtml(door.buildingId ?? "")}" />
    <label>Floor</label><input data-d="targetFloor" type="number" value="${door.targetFloor ?? 0}" />
  `;
  const apply = (): void => {
    const str = (sel: string) => (body.querySelector(sel) as HTMLInputElement | HTMLSelectElement)?.value ?? "";
    onChange({
      label: str("[data-d=label]") || undefined,
      targetMap: str("[data-d=targetMap]") || undefined,
      targetSpawn: str("[data-d=targetSpawn]") || undefined,
      locked: str("[data-d=locked]") === "1",
      transition: str("[data-d=transition]") as WorldDoor["transition"],
      buildingId: str("[data-d=buildingId]") || undefined,
      targetFloor: Number(str("[data-d=targetFloor]")) || 0,
    });
  };
  body.querySelectorAll("input,select").forEach((el) => el.addEventListener("change", apply));
}

export function renderSpawnProps(
  body: HTMLElement,
  spawn: WorldSpawn,
  onChange: (patch: Partial<WorldSpawn>) => void,
): void {
  body.innerHTML = `
    <label>Kind</label><input value="spawn" disabled />
    <label>Name</label><input data-s="name" value="${escapeHtml(spawn.name ?? "")}" placeholder="e.g. Cave Entrance" />
    <label>Default spawn</label>
    <select data-s="isDefault">
      <option value="0" ${!spawn.isDefault ? "selected" : ""}>No</option>
      <option value="1" ${spawn.isDefault ? "selected" : ""}>Yes</option>
    </select>
    <label>Facing</label>
    <select data-s="facing">
      ${["down", "left", "right", "up"].map((f) =>
        `<option value="${f}" ${(spawn.facing ?? "down") === f ? "selected" : ""}>${f}</option>`).join("")}
    </select>
    <label>X</label><input data-s="x" type="number" value="${Math.round(spawn.x)}" />
    <label>Y</label><input data-s="y" type="number" value="${Math.round(spawn.y)}" />
  `;
  const apply = (): void => {
    const str = (sel: string) => (body.querySelector(sel) as HTMLInputElement | HTMLSelectElement)?.value ?? "";
    onChange({
      name: str("[data-s=name]") || undefined,
      isDefault: str("[data-s=isDefault]") === "1",
      facing: str("[data-s=facing]") as WorldSpawn["facing"],
      x: Number(str("[data-s=x]")) || spawn.x,
      y: Number(str("[data-s=y]")) || spawn.y,
    });
  };
  body.querySelectorAll("input,select").forEach((el) => el.addEventListener("change", apply));
}
