// Player profile choices (avatar + pet), persisted locally. Chosen on the Main
// Menu, read by the World scene. Kept tiny + framework-free so any scene can use
// it without wiring through the registry.

const AV_KEY = "dn.avatar";
const PET_KEY = "dn.pet";

/** Default avatar id — the built-in duelist. */
export const DEFAULT_AVATAR = "duelist";

export function getAvatarId(): string {
  try { return localStorage.getItem(AV_KEY) || DEFAULT_AVATAR; } catch { return DEFAULT_AVATAR; }
}
export function setAvatarId(id: string): void {
  try { localStorage.setItem(AV_KEY, id); } catch { /* private mode */ }
}

/** Pet id, or null for "no pet". */
export function getPetId(): string | null {
  try { return localStorage.getItem(PET_KEY); } catch { return null; }
}
export function setPetId(id: string | null): void {
  try {
    if (id) localStorage.setItem(PET_KEY, id);
    else localStorage.removeItem(PET_KEY);
  } catch { /* private mode */ }
}

// ── Harvest Moon foraging bag (item id → count), persisted locally ──
const BAG_KEY = "dn.hm.bag";

export function getBag(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BAG_KEY) || "{}") as Record<string, number>; }
  catch { return {}; }
}

/** Add one of an item to the bag; returns the new count for that item. */
export function addForaged(id: string): number {
  const bag = getBag();
  bag[id] = (bag[id] ?? 0) + 1;
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* private mode */ }
  return bag[id]!;
}
