// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote styles — Classic / Reaction / Thread / Evidence / Notepad
// (from the DUAL QUOTE STYLES design sheet).
// ─────────────────────────────────────────────────────────────────────────────

export type DualQuoteLayout =
  | "duo-classic"   // Clean Discord dual with soft blue border
  | "duo-reaction"  // Neon blue→magenta glow + impact accents
  | "duo-thread"    // Emerald border + avatar thread connector
  | "duo-evidence"  // REC + viewfinder brackets + timestamp
  | "duo-notepad";  // Torn paper + tape + crown doodle

export interface DualQuoteTheme {
  id: string;
  label: string;
  emoji: string;
  description: string;
  width: number;
  height: number;
  layout: DualQuoteLayout;
  background: string;
  textColor: string;
  mutedColor: string;
  nameColor: string;
  accentColor?: string;
}

/** Shared canvas size — matches the design-sheet card proportions. */
const W = 920;
const H = 520;

export const DUAL_QUOTE_STYLES: DualQuoteTheme[] = [
  {
    id: "duo-classic",
    label: "Classic",
    emoji: "🖤",
    description: "Clean. Simple. Timeless.",
    width: W,
    height: H,
    layout: "duo-classic",
    background: "#1A1C22",
    textColor: "#DBDEE1",
    mutedColor: "#949BA4",
    nameColor: "#00A8FC",
    accentColor: "#7EB8FF",
  },
  {
    id: "duo-reaction",
    label: "Reaction",
    emoji: "⚡",
    description: "Subtle accents. Big moments.",
    width: W,
    height: H,
    layout: "duo-reaction",
    background: "#14151A",
    textColor: "#DBDEE1",
    mutedColor: "#949BA4",
    nameColor: "#00A8FC",
    accentColor: "#5B8CFF",
  },
  {
    id: "duo-thread",
    label: "Thread",
    emoji: "🧵",
    description: "A natural flow.",
    width: W,
    height: H,
    layout: "duo-thread",
    background: "#121814",
    textColor: "#DBDEE1",
    mutedColor: "#949BA4",
    nameColor: "#00A8FC",
    accentColor: "#3DDC84",
  },
  {
    id: "duo-evidence",
    label: "Evidence",
    emoji: "📹",
    description: "It's on record.",
    width: W,
    height: H,
    layout: "duo-evidence",
    background: "#0C0C0E",
    textColor: "#DBDEE1",
    mutedColor: "#949BA4",
    nameColor: "#00A8FC",
    accentColor: "#FF3B3B",
  },
  {
    id: "duo-notepad",
    label: "Notepad",
    emoji: "📝",
    description: "Same chat. New look.",
    width: W,
    height: H,
    layout: "duo-notepad",
    background: "#0A0B10",
    textColor: "#2B2D31",
    mutedColor: "#6B6E74",
    nameColor: "#1E6BB8",
    accentColor: "#3B82F6",
  },
];

export function getDualStyle(id: string): DualQuoteTheme {
  return DUAL_QUOTE_STYLES.find(s => s.id === id) ?? DUAL_QUOTE_STYLES[0]!;
}

export function dualStyleChoices() {
  return DUAL_QUOTE_STYLES.map(s => ({
    name: `${s.emoji} ${s.label}`.slice(0, 100),
    value: s.id,
  }));
}
