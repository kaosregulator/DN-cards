// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote (fuse 2 messages) styles — separate from single-quote presets so
// the Discord select menus stay under the 25-option cap.
// ─────────────────────────────────────────────────────────────────────────────

export type DualQuoteLayout =
  | "duo-chat"     // Discord chat screenshot — two stacked messages
  | "duo-versus"   // Split face-off: A left · B right
  | "duo-thread"   // “X said… then Y said…” stacked literary thread
  | "duo-ayoo"     // Tiny setup · huge punchline (ayoo energy)
  | "duo-receipts"; // 4K receipt board with two busted lines

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
  accentColor?: string;
}

export const DUAL_QUOTE_STYLES: DualQuoteTheme[] = [
  {
    id: "duo-chat",
    label: "Discord Chat",
    emoji: "💬",
    description: "Looks like a real Discord screenshot of the two msgs",
    width: 920,
    height: 520,
    layout: "duo-chat",
    background: "#313338",
    textColor: "#DBDEE1",
    mutedColor: "#949BA4",
    accentColor: "#5865F2",
  },
  {
    id: "duo-versus",
    label: "Versus",
    emoji: "⚔️",
    description: "Split card — their line vs the reply that cooked them",
    width: 1200,
    height: 675,
    layout: "duo-versus",
    background: "#050505",
    textColor: "#FFFFFF",
    mutedColor: "#A0A0A0",
    accentColor: "#FF4D6D",
  },
  {
    id: "duo-thread",
    label: "Thread Quote",
    emoji: "🧵",
    description: "So-and-so said this… yeah but then so-and-so said this",
    width: 1100,
    height: 720,
    layout: "duo-thread",
    background: "#0A0A0C",
    textColor: "#F5F5F5",
    mutedColor: "#9A9A9A",
    accentColor: "#E8C547",
  },
  {
    id: "duo-ayoo",
    label: "Ayoo Punchline",
    emoji: "😭",
    description: "Quiet setup up top · huge reply that ends them",
    width: 1200,
    height: 700,
    layout: "duo-ayoo",
    background: "#000000",
    textColor: "#FFFFFF",
    mutedColor: "#888888",
    accentColor: "#FEE75C",
  },
  {
    id: "duo-receipts",
    label: "Double Receipts",
    emoji: "🧾",
    description: "Caught-in-4K board with both lines as evidence",
    width: 1280,
    height: 760,
    layout: "duo-receipts",
    background: "#050505",
    textColor: "#F0F0F0",
    mutedColor: "#B0B0B0",
    accentColor: "#FF2A2A",
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
