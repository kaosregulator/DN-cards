// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote styles — Classic set (5) + vibe set (9) from design sheets.
// Discord select cap is 25; we ship 14.
// ─────────────────────────────────────────────────────────────────────────────

export type DualQuoteLayout =
  // Sheet 1 — clean frames
  | "duo-classic"
  | "duo-reaction"
  | "duo-thread"
  | "duo-evidence"
  | "duo-notepad"
  // Sheet 2 — vibe layouts
  | "duo-bubble"
  | "duo-terminal"
  | "duo-polaroid"
  | "duo-sticky"
  | "duo-imessage"
  | "duo-newspaper"
  | "duo-receipt"
  | "duo-chatlog"
  | "duo-comic";

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

const W = 920;
const H = 520;

export const DUAL_QUOTE_STYLES: DualQuoteTheme[] = [
  // ── Sheet 1 ───────────────────────────────────────────────────────────────
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
  // ── Sheet 2 ───────────────────────────────────────────────────────────────
  {
    id: "duo-bubble",
    label: "Chat Bubble",
    emoji: "💬",
    description: "Glassy bubbles with neon accents.",
    width: W,
    height: H,
    layout: "duo-bubble",
    background: "#0B0D12",
    textColor: "#FFFFFF",
    mutedColor: "#A0A8B8",
    nameColor: "#8BB8FF",
    accentColor: "#4DA3FF",
  },
  {
    id: "duo-terminal",
    label: "Terminal",
    emoji: "💻",
    description: "Green phosphor CLI vibes.",
    width: W,
    height: H,
    layout: "duo-terminal",
    background: "#050805",
    textColor: "#33FF66",
    mutedColor: "#1FA84A",
    nameColor: "#66FF99",
    accentColor: "#33FF66",
  },
  {
    id: "duo-polaroid",
    label: "Polaroid",
    emoji: "📷",
    description: "Pinned photos on wood.",
    width: 1000,
    height: 560,
    layout: "duo-polaroid",
    background: "#3A2618",
    textColor: "#1A1A1A",
    mutedColor: "#666666",
    nameColor: "#1E6BB8",
    accentColor: "#3B82F6",
  },
  {
    id: "duo-sticky",
    label: "Sticky Note",
    emoji: "📌",
    description: "Yellow + pink on corkboard.",
    width: 1000,
    height: 560,
    layout: "duo-sticky",
    background: "#8B6B45",
    textColor: "#2B2B2B",
    mutedColor: "#6B6B6B",
    nameColor: "#1A1A1A",
    accentColor: "#F5D76E",
  },
  {
    id: "duo-imessage",
    label: "Text Message",
    emoji: "📱",
    description: "iOS-style blue + grey bubbles.",
    width: 440,
    height: 760,
    layout: "duo-imessage",
    background: "#F2F2F7",
    textColor: "#FFFFFF",
    mutedColor: "#8E8E93",
    nameColor: "#007AFF",
    accentColor: "#007AFF",
  },
  {
    id: "duo-newspaper",
    label: "Newspaper",
    emoji: "📰",
    description: "THE DISCORD TIMES — two columns.",
    width: 960,
    height: 580,
    layout: "duo-newspaper",
    background: "#E8DCC8",
    textColor: "#1A1A1A",
    mutedColor: "#555555",
    nameColor: "#111111",
    accentColor: "#1A1A1A",
  },
  {
    id: "duo-receipt",
    label: "Receipt",
    emoji: "🧾",
    description: "Thermal paper. Thank you for chatting!",
    width: 480,
    height: 820,
    layout: "duo-receipt",
    background: "#1A2330",
    textColor: "#1A1A1A",
    mutedColor: "#555555",
    nameColor: "#111111",
    accentColor: "#FFFFFF",
  },
  {
    id: "duo-chatlog",
    label: "Chat Log",
    emoji: "🎮",
    description: "Streamer overlay · #general",
    width: W,
    height: H,
    layout: "duo-chatlog",
    background: "#0A1220",
    textColor: "#FFFFFF",
    mutedColor: "#8A9BB0",
    nameColor: "#C084FC",
    accentColor: "#60A5FA",
  },
  {
    id: "duo-comic",
    label: "Comic",
    emoji: "💥",
    description: "Halftone panels + speech bubbles.",
    width: 920,
    height: 640,
    layout: "duo-comic",
    background: "#111111",
    textColor: "#111111",
    mutedColor: "#555555",
    nameColor: "#111111",
    accentColor: "#FF2D2D",
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
