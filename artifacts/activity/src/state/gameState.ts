// ─────────────────────────────────────────────────────────────────────────────
// Adventure progress — which duelists you've beaten and where you were standing.
// Kept in-memory for the session and mirrored to localStorage so closing the
// Activity and coming back doesn't reset your run. Purely cosmetic progress:
// the authoritative economy still lives in the bot.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "dncards.adventure.v1";

interface Saved {
  defeated: string[];
  lastMap: string;
  lastX: number;
  lastY: number;
  lastFace: string;
}

class GameState {
  private defeated = new Set<string>();
  lastMap = "city";
  lastX = 12;
  lastY = 9;
  lastFace = "down";

  constructor() { this.load(); }

  defeat(npcId: string): void { this.defeated.add(npcId); this.save(); }
  isDefeated(npcId: string): boolean { return this.defeated.has(npcId); }
  defeatedCount(): number { return this.defeated.size; }
  reset(): void {
    this.defeated.clear();
    this.lastMap = "city"; this.lastX = 12; this.lastY = 9; this.lastFace = "down";
    this.save();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Saved>;
      if (Array.isArray(s.defeated)) this.defeated = new Set(s.defeated);
      if (typeof s.lastMap === "string") this.lastMap = s.lastMap;
      if (typeof s.lastX === "number") this.lastX = s.lastX;
      if (typeof s.lastY === "number") this.lastY = s.lastY;
      if (typeof s.lastFace === "string") this.lastFace = s.lastFace;
    } catch { /* storage blocked in the iframe — run in-memory */ }
  }
  private save(): void {
    try {
      const s: Saved = {
        defeated: [...this.defeated], lastMap: this.lastMap,
        lastX: this.lastX, lastY: this.lastY, lastFace: this.lastFace,
      };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch { /* ignore */ }
  }
}

export const gameState = new GameState();
