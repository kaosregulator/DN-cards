// ─────────────────────────────────────────────────────────────────────────────
// Sanctuary modes — Quiet / Vacation / LOA / Step Away (renameable per guild).
// Same isolation engine; different label, role, channel, and room copy.
// ─────────────────────────────────────────────────────────────────────────────

export interface SanctuaryMode {
  /** Stable key — never rename this in DB; servers rename `label` / names. */
  key: string;
  /** Display name (slash help, embeds) — servers may rename. */
  label: string;
  /** Discord role name to create/ensure. */
  roleName: string;
  /** Discord channel name to create/ensure. */
  channelName: string;
  topic: string;
  /** Lead-in lines for the room embed (before the quote). */
  intro: string;
  enabled: boolean;
  roleId: string | null;
  channelId: string | null;
}

export const DEFAULT_SANCTUARY_MODES: SanctuaryMode[] = [
  {
    key: "quiet",
    label: "Quiet Room",
    roleName: "Quiet",
    channelName: "quiet-room",
    topic: "Silent corner. One channel. No chat — just rest, then I'm Ready.",
    intro:
      "This is the only channel you can see.\n\n" +
      "No chatting. No reacting. Nothing to add.\n" +
      "Just stillness — until you're ready.\n\n" +
      "You don't need to explain anything.",
    enabled: true,
    roleId: null,
    channelId: null,
  },
  {
    key: "vacation",
    label: "Vacation",
    roleName: "Vacation",
    channelName: "vacation",
    topic: "You're on vacation from the noise. Rest here — return when you're ready.",
    intro:
      "The server can wait.\n\n" +
      "You're on vacation from the scroll, the pings, the pressure.\n" +
      "One quiet channel. No obligations.\n\n" +
      "Come back when the trip is over — no explanation needed.",
    enabled: true,
    roleId: null,
    channelId: null,
  },
  {
    key: "loa",
    label: "Leave of Absence",
    roleName: "Leave of Absence",
    channelName: "leave-of-absence",
    topic: "Leave of absence — still part of the server, just not in the noise.",
    intro:
      "You're on leave — not gone.\n\n" +
      "This room is your placeholder while life needs you elsewhere.\n" +
      "No chats to keep up with. No guilt.\n\n" +
      "When you're ready to return, press I'm Ready.",
    enabled: true,
    roleId: null,
    channelId: null,
  },
  {
    key: "step_away",
    label: "Temporary Step Away",
    roleName: "Stepping Away",
    channelName: "stepping-away",
    topic: "Temporarily stepped away. Soft landing — not a goodbye.",
    intro:
      "You stepped away for a bit.\n\n" +
      "Not removed. Not forgotten. Just… elsewhere for now.\n" +
      "This is a soft landing until you want the server again.\n\n" +
      "Take the time you need.",
    enabled: true,
    roleId: null,
    channelId: null,
  },
];

export function mergeSanctuaryModes(stored: unknown): SanctuaryMode[] {
  const byKey = new Map(DEFAULT_SANCTUARY_MODES.map(m => [m.key, { ...m }]));
  if (Array.isArray(stored)) {
    for (const raw of stored) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Partial<SanctuaryMode>;
      if (!r.key || typeof r.key !== "string") continue;
      const base = byKey.get(r.key) ?? {
        key: r.key,
        label: r.label ?? r.key,
        roleName: r.roleName ?? r.label ?? r.key,
        channelName: r.channelName ?? r.key.replace(/_/g, "-").toLowerCase(),
        topic: r.topic ?? "A soft place to land.",
        intro: r.intro ?? "Take your time.",
        enabled: true,
        roleId: null,
        channelId: null,
      };
      byKey.set(r.key, {
        ...base,
        label: typeof r.label === "string" && r.label.trim() ? r.label.trim() : base.label,
        roleName: typeof r.roleName === "string" && r.roleName.trim() ? r.roleName.trim() : base.roleName,
        channelName: typeof r.channelName === "string" && r.channelName.trim()
          ? r.channelName.trim().toLowerCase().replace(/\s+/g, "-")
          : base.channelName,
        topic: typeof r.topic === "string" && r.topic.trim() ? r.topic.trim() : base.topic,
        intro: typeof r.intro === "string" && r.intro.trim() ? r.intro.trim() : base.intro,
        enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
        roleId: typeof r.roleId === "string" ? r.roleId : base.roleId,
        channelId: typeof r.channelId === "string" ? r.channelId : base.channelId,
      });
    }
  }
  return [...byKey.values()];
}

export function getModeOrDefault(modes: SanctuaryMode[], key: string | null | undefined): SanctuaryMode {
  const k = (key ?? "quiet").toLowerCase();
  return modes.find(m => m.key === k && m.enabled) ?? modes.find(m => m.key === "quiet") ?? DEFAULT_SANCTUARY_MODES[0];
}

export function patchMode(
  modes: SanctuaryMode[],
  key: string,
  patch: Partial<Pick<SanctuaryMode, "label" | "roleName" | "channelName" | "topic" | "intro" | "enabled" | "roleId" | "channelId">>,
): SanctuaryMode[] {
  return modes.map(m => (m.key === key ? { ...m, ...patch } : m));
}
