// Moveset Engine — military-themed signature moves.
//
// Every card's "Special" move is driven by a MOVESET chosen from this registry.
// A moveset is the card's signature military ability: vehicles fire main guns
// and lay smoke, aircraft strafe and go stealth, infantry throw frags and lay
// down suppressing fire, and support movesets (repair/overwatch/adrenaline) are
// available to ALL types. Bosses get the Nuke.
//
// A card's moveset is auto-assigned from its card type (deterministic), and an
// admin can override it per-card in the battle editor (battle_card_config.moveset)
// WITHOUT ever touching the core card. Effects reuse the shared special-effects
// registry where possible; "stealth" and "weaken" are handled by the combat
// engine directly.

export type MovesetKind = "strike" | "effect";

export interface Moveset {
  key: string;
  name: string;
  emoji: string;
  description: string;
  /** Card types this move is offered to by default, or "all" for support moves. */
  allowedTypes: string[] | "all";
  /** Energy spent to use it (mirrors the old flat specialCost when omitted). */
  energyCost: number;
  kind: MovesetKind;
  /** strike: % of attack as damage. */
  powerPct?: number;
  /** strike: optional second hit as % of attack (double-tap moves). */
  followUpPct?: number;
  /** effect: a special-effect key (heal/shield/burn/nuke/…) OR "stealth"/"weaken". */
  effect?: string;
}

export const MOVESETS: Record<string, Moveset> = {
  // ── Fallback (any type) ─────────────────────────────────────────────────────
  standard_special: {
    key: "standard_special", name: "Special Attack", emoji: "⚔️",
    description: "A focused heavy strike.", allowedTypes: "all",
    energyCost: 40, kind: "strike", powerPct: 160,
  },

  // ── Support (all types) ─────────────────────────────────────────────────────
  repair: {
    key: "repair", name: "Field Repair", emoji: "💚",
    description: "Patch up and restore HP.", allowedTypes: "all",
    energyCost: 40, kind: "effect", effect: "heal",
  },
  overwatch: {
    key: "overwatch", name: "Overwatch", emoji: "🪞",
    description: "Set a reflective posture that bounces damage back.", allowedTypes: "all",
    energyCost: 35, kind: "effect", effect: "reflect",
  },
  adrenaline: {
    key: "adrenaline", name: "Adrenaline Surge", emoji: "🔋",
    description: "Instantly recharge energy and ultimate.", allowedTypes: "all",
    energyCost: 20, kind: "effect", effect: "energy_boost",
  },

  // ── Vehicle / Armor ─────────────────────────────────────────────────────────
  main_gun: {
    key: "main_gun", name: "Main Gun Barrage", emoji: "💥",
    description: "A devastating cannon volley.", allowedTypes: ["tank", "ship", "vehicle", "boss"],
    energyCost: 45, kind: "strike", powerPct: 185,
  },
  smoke_screen: {
    key: "smoke_screen", name: "Smoke Screen", emoji: "🌫️",
    description: "Raise cover, gaining a protective shield.", allowedTypes: ["tank", "ship", "vehicle"],
    energyCost: 40, kind: "effect", effect: "shield",
  },
  ram: {
    key: "ram", name: "Ramming Speed", emoji: "🛞",
    description: "Charge in for a brutal two-part collision.", allowedTypes: ["tank", "vehicle"],
    energyCost: 45, kind: "strike", powerPct: 115, followUpPct: 90,
  },

  // ── Aircraft ────────────────────────────────────────────────────────────────
  strafing_run: {
    key: "strafing_run", name: "Strafing Run", emoji: "✈️",
    description: "A fast twin-pass gun run.", allowedTypes: ["aircraft"],
    energyCost: 45, kind: "strike", powerPct: 135, followUpPct: 75,
  },
  afterburner: {
    key: "afterburner", name: "Afterburner", emoji: "🔥",
    description: "Kick the throttle — recharge and reposition.", allowedTypes: ["aircraft"],
    energyCost: 15, kind: "effect", effect: "energy_boost",
  },
  stealth_mode: {
    key: "stealth_mode", name: "Stealth Mode", emoji: "🫥",
    description: "Vanish — the enemy's next attack misses entirely.", allowedTypes: ["aircraft"],
    energyCost: 40, kind: "effect", effect: "stealth",
  },

  // ── Infantry ────────────────────────────────────────────────────────────────
  frag_grenade: {
    key: "frag_grenade", name: "Frag Grenade", emoji: "💣",
    description: "Lob a grenade that burns over time.", allowedTypes: ["infantry"],
    energyCost: 40, kind: "effect", effect: "burn",
  },
  suppressing_fire: {
    key: "suppressing_fire", name: "Suppressing Fire", emoji: "🔻",
    description: "Pin the enemy down, weakening their attacks.", allowedTypes: ["infantry"],
    energyCost: 35, kind: "effect", effect: "weaken",
  },
  med_kit: {
    key: "med_kit", name: "Combat Medic", emoji: "⛑️",
    description: "Field-treat wounds to recover HP.", allowedTypes: ["infantry"],
    energyCost: 40, kind: "effect", effect: "heal",
  },

  // ── Signature ───────────────────────────────────────────────────────────────
  nuke: {
    key: "nuke", name: "Tactical Nuke", emoji: "☢️",
    description: "Call in a massive, unavoidable strike.", allowedTypes: ["boss"],
    energyCost: 60, kind: "effect", effect: "nuke",
  },
  reflect_armor: {
    key: "reflect_armor", name: "Reactive Armor", emoji: "🛡️",
    description: "Plating that reflects incoming fire.", allowedTypes: ["community", "achievement", "event", "limited"],
    energyCost: 40, kind: "effect", effect: "reflect",
  },
};

export const MOVESET_KEYS = Object.keys(MOVESETS);

const REGISTRY = new Map<string, Moveset>(Object.entries(MOVESETS));

// ── Per-guild overlay (admin-authored / overridden movesets) ─────────────────
// The Move Library admin tool writes moveset definitions into battle_content
// (kind "move"). We merge those over the code defaults into a per-guild cache;
// combat + prep read it synchronously after `loadGuildMovesets` populates it
// (called at prep + battle start, exactly like Battle Items).
const _guildMovesets = new Map<string, { map: Map<string, Moveset>; expiresAt: number }>();
const GUILD_MOVESETS_TTL_MS = 60_000;

// Coerce an admin-authored record into a valid Moveset, filling missing fields
// from the same-key default or a safe fallback.
export function coerceMoveset(key: string, data: Record<string, unknown>, base?: Moveset): Moveset {
  const d = data as Partial<Moveset>;
  const b = base ?? REGISTRY.get(key);
  const num = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const str = (v: unknown, f: string) => (typeof v === "string" && v ? v : f);
  let allowed: string[] | "all" = b?.allowedTypes ?? "all";
  if (d.allowedTypes === "all" || (Array.isArray(d.allowedTypes))) allowed = d.allowedTypes;
  const m: Moveset = {
    key,
    name: str(d.name, b?.name ?? key),
    emoji: str(d.emoji, b?.emoji ?? "⚔️"),
    description: str(d.description, b?.description ?? ""),
    allowedTypes: allowed,
    energyCost: num(d.energyCost, b?.energyCost ?? 40),
    kind: (str(d.kind, b?.kind ?? "strike") as MovesetKind),
    powerPct: num(d.powerPct, b?.powerPct ?? 0) || undefined,
    followUpPct: num(d.followUpPct, b?.followUpPct ?? 0) || undefined,
    effect: (d.effect as string | undefined) ?? b?.effect,
  };
  return m;
}

export async function loadGuildMovesets(guildId: string): Promise<void> {
  const cached = _guildMovesets.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return;
  try {
    const { listBattleContent } = await import("./db.js");
    const rows = await listBattleContent(guildId, "move");
    const map = new Map<string, Moveset>(REGISTRY);
    for (const row of rows) {
      if (row.enabled === false) { map.delete(row.contentId); continue; }
      map.set(row.contentId, coerceMoveset(row.contentId, row.data, REGISTRY.get(row.contentId)));
    }
    _guildMovesets.set(guildId, { map, expiresAt: Date.now() + GUILD_MOVESETS_TTL_MS });
  } catch {
    _guildMovesets.set(guildId, { map: new Map(REGISTRY), expiresAt: Date.now() + GUILD_MOVESETS_TTL_MS });
  }
}

export function invalidateGuildMovesets(guildId: string): void {
  _guildMovesets.delete(guildId);
}

function registryFor(guildId?: string | null): Map<string, Moveset> {
  if (guildId) {
    const c = _guildMovesets.get(guildId);
    if (c) return c.map;
  }
  return REGISTRY;
}

export function getMoveset(key: string | null | undefined, guildId?: string | null): Moveset | null {
  if (!key) return null;
  return registryFor(guildId).get(key) ?? null;
}

/** The effective movesets for a guild (defaults + custom). */
export function listAllMovesets(guildId?: string | null): Moveset[] {
  return [...registryFor(guildId).values()];
}
export function listDefaultMovesets(): Moveset[] {
  return [...REGISTRY.values()];
}

/** All movesets a card of `type` may use: its type-specific ones + all support moves. */
export function movesetsForType(cardType: string, guildId?: string | null): Moveset[] {
  const t = (cardType ?? "").toLowerCase();
  return [...registryFor(guildId).values()].filter(
    (m) => m.allowedTypes === "all" || m.allowedTypes.includes(t),
  );
}

/** Deterministic default moveset for a card that has no admin override. */
export function inferMoveset(cardType: string, rarity: string): string {
  const t = (cardType ?? "").toLowerCase();
  const r = (rarity ?? "").toLowerCase();
  if (t === "tank" || t === "ship" || t === "vehicle") return "main_gun";
  if (t === "aircraft") return r === "legendary" || r === "mythic" ? "stealth_mode" : "strafing_run";
  if (t === "infantry") return "frag_grenade";
  if (t === "boss") return "nuke";
  if (t === "community" || t === "achievement" || t === "event" || t === "limited") return "reflect_armor";
  return "standard_special";
}
