// ─────────────────────────────────────────────────────────────────────────────
// Quote card styles — Classic / Discord Capture / Caught in 4K / Cinematic
// from the design sheet, plus a MakeItAQuote half-fade and a few extras.
// ─────────────────────────────────────────────────────────────────────────────

/** Which specialized painter the renderer should use. */
export type QuoteLayout =
  | "classic"      // circular B&W avatar left, serif quote, tagline
  | "fade-left"    // MakeItAQuote half-photo fade (original example)
  | "fade-right"
  | "discord"      // Discord message capture UI
  | "caught4k"     // camcorder / CCTV
  | "cinematic"    // scenic backdrop + centered serif quote
  | "portrait"     // full-bleed fade-down
  | "impact"       // huge type + corner avatar
  | "custom";

export type AvatarLayout = "left" | "right" | "portrait" | "corner" | "none" | "circle-left";

export interface QuoteTheme {
  id: string;
  label: string;
  emoji: string;
  description: string;
  width: number;
  height: number;
  layout: QuoteLayout;
  background: string;
  backgroundGradient?: { x0: number; y0: number; x1: number; y1: number; stops: [string, number][] };
  textColor: string;
  attributionColor: string;
  handleColor: string;
  watermarkColor: string;
  accentColor?: string;
  /** Used by fade / portrait / impact / custom painters. */
  avatarLayout: AvatarLayout;
  grayscale: boolean;
  avatarShare: number;
  fadeShare: number;
  quoteMarks: boolean;
  letterbox?: boolean;
  fontTone: "clean" | "display" | "impact" | "serif" | "mono";
  /** Optional footer tagline (Classic / Cinematic). */
  tagline?: string;
  uppercaseQuote?: boolean;
}

/** Built-in presets — Discord select menus allow ≤25 options. */
export const QUOTE_STYLES: QuoteTheme[] = [
  {
    id: "classic",
    label: "Classic",
    emoji: "🖤",
    description: "Circular B&W avatar fade · serif quote · tagline",
    width: 1200,
    height: 675,
    layout: "classic",
    background: "#000000",
    textColor: "#FFFFFF",
    attributionColor: "#D8D8D8",
    handleColor: "#9A9A9A",
    watermarkColor: "#555555",
    avatarLayout: "circle-left",
    grayscale: true,
    avatarShare: 0.42,
    fadeShare: 0.35,
    quoteMarks: true,
    fontTone: "serif",
    tagline: "SOME PEOPLE JUST SAY WHAT WE'RE ALL THINKING.",
    uppercaseQuote: true,
  },
  {
    id: "discord",
    label: "Discord Capture",
    emoji: "💬",
    description: "Looks like a real Discord message with reactions",
    width: 900,
    height: 420,
    layout: "discord",
    background: "#1E1F22",
    textColor: "#DBDEE1",
    attributionColor: "#F2F3F5",
    handleColor: "#B5BAC1",
    watermarkColor: "#4E5058",
    accentColor: "#5865F2",
    avatarLayout: "none",
    grayscale: false,
    avatarShare: 0,
    fadeShare: 0,
    quoteMarks: false,
    fontTone: "clean",
  },
  {
    id: "caught4k",
    label: "Caught in 4K",
    emoji: "📼",
    description: "Grainy camcorder REC overlay — they said it",
    width: 1280,
    height: 720,
    layout: "caught4k",
    background: "#050505",
    textColor: "#F0F0F0",
    attributionColor: "#E8E8E8",
    handleColor: "#B0B0B0",
    watermarkColor: "#888888",
    accentColor: "#FF2A2A",
    avatarLayout: "none",
    grayscale: true,
    avatarShare: 0.2,
    fadeShare: 0,
    quoteMarks: false,
    fontTone: "mono",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    emoji: "🎥",
    description: "Sunset landscape · centered serif quote",
    width: 1280,
    height: 720,
    layout: "cinematic",
    background: "#0A0A12",
    textColor: "#FFFFFF",
    attributionColor: "#F0F0F0",
    handleColor: "#C8C8D0",
    watermarkColor: "#FFFFFF88",
    accentColor: "#FFB347",
    avatarLayout: "none",
    grayscale: false,
    avatarShare: 0,
    fadeShare: 0,
    quoteMarks: true,
    fontTone: "serif",
    tagline: "SOME MESSAGES HIT DIFFERENT.",
    uppercaseQuote: true,
  },
  {
    id: "miq",
    label: "MakeItAQuote",
    emoji: "📷",
    description: "Half-photo B&W fade → black (the viral look)",
    width: 1200,
    height: 630,
    layout: "fade-left",
    background: "#000000",
    textColor: "#FFFFFF",
    attributionColor: "#E8E8E8",
    handleColor: "#9A9A9A",
    watermarkColor: "#3A3A3A",
    avatarLayout: "left",
    grayscale: true,
    avatarShare: 0.44,
    fadeShare: 0.42,
    quoteMarks: false,
    fontTone: "clean",
  },
  {
    id: "paper",
    label: "Paper Light",
    emoji: "📄",
    description: "White card with soft gray avatar fade",
    width: 1200,
    height: 630,
    layout: "fade-left",
    background: "#F5F5F2",
    textColor: "#141414",
    attributionColor: "#2A2A2A",
    handleColor: "#6B6B6B",
    watermarkColor: "#B0B0B0",
    avatarLayout: "left",
    grayscale: true,
    avatarShare: 0.44,
    fadeShare: 0.42,
    quoteMarks: false,
    fontTone: "clean",
  },
  {
    id: "vivid",
    label: "Vivid Color",
    emoji: "🎨",
    description: "Color avatar half-fade, punchy white type",
    width: 1200,
    height: 630,
    layout: "fade-left",
    background: "#0A0A0C",
    textColor: "#FFFFFF",
    attributionColor: "#D8D8E0",
    handleColor: "#8888A0",
    watermarkColor: "#3A3A48",
    avatarLayout: "left",
    grayscale: false,
    avatarShare: 0.48,
    fadeShare: 0.5,
    quoteMarks: false,
    fontTone: "clean",
  },
  {
    id: "impact",
    label: "Impact",
    emoji: "💥",
    description: "Huge bold type, corner avatar — meme energy",
    width: 1200,
    height: 630,
    layout: "impact",
    background: "#000000",
    textColor: "#FFFFFF",
    attributionColor: "#FFDD00",
    handleColor: "#AAAAAA",
    watermarkColor: "#333333",
    accentColor: "#FFDD00",
    avatarLayout: "corner",
    grayscale: true,
    avatarShare: 0.18,
    fadeShare: 0,
    quoteMarks: false,
    fontTone: "impact",
  },
];

export const CUSTOM_STYLE_ID = "custom";

export function getStyle(id: string): QuoteTheme {
  return QUOTE_STYLES.find(s => s.id === id) ?? QUOTE_STYLES[0]!;
}

export function styleChoices() {
  return [
    ...QUOTE_STYLES.map(s => ({
      name: `${s.emoji} ${s.label}`.slice(0, 100),
      value: s.id,
    })),
    { name: "✨ Make Your Own", value: CUSTOM_STYLE_ID },
  ];
}

export const BG_SWATCHES: { id: string; label: string; color: string }[] = [
  { id: "black", label: "Black", color: "#000000" },
  { id: "charcoal", label: "Charcoal", color: "#141418" },
  { id: "navy", label: "Navy", color: "#0B1624" },
  { id: "forest", label: "Forest", color: "#0E1A12" },
  { id: "ember", label: "Ember", color: "#1A0E0A" },
  { id: "white", label: "White", color: "#F5F5F2" },
  { id: "cream", label: "Cream", color: "#F3EDE3" },
  { id: "blush", label: "Blush", color: "#F4E4E8" },
];

export const TEXT_SWATCHES: { id: string; label: string; color: string }[] = [
  { id: "white", label: "White", color: "#FFFFFF" },
  { id: "soft", label: "Soft White", color: "#F0F0F0" },
  { id: "cream", label: "Cream", color: "#FFE8D6" },
  { id: "ice", label: "Ice", color: "#E8F4FF" },
  { id: "gold", label: "Gold", color: "#FFDD00" },
  { id: "black", label: "Black", color: "#141414" },
  { id: "ink", label: "Ink", color: "#1A1A1A" },
];

export function customFrom(baseId = "classic"): QuoteTheme {
  const base = getStyle(baseId);
  return {
    ...base,
    id: CUSTOM_STYLE_ID,
    label: "Make Your Own",
    emoji: "✨",
    description: "Your colors, layout, and vibe",
    // Keep base.layout so Classic / Discord / 4K / Cinematic painters still run.
  };
}
