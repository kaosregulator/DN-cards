// ─────────────────────────────────────────────────────────────────────────────
// Quote card styles — presets inspired by MakeItAQuote (dark/light/color/
// portrait) plus a few extra looks tuned for Discord meme energy.
// ─────────────────────────────────────────────────────────────────────────────

export type AvatarLayout = "left" | "right" | "portrait" | "corner" | "none";

export interface QuoteTheme {
  id: string;
  label: string;
  emoji: string;
  description: string;
  /** Canvas size — landscape 16:9-ish matches the classic MakeItAQuote look. */
  width: number;
  height: number;
  background: string;
  /** Optional linear gradient stops over the flat background. */
  backgroundGradient?: { x0: number; y0: number; x1: number; y1: number; stops: [string, number][] };
  textColor: string;
  attributionColor: string;
  handleColor: string;
  watermarkColor: string;
  accentColor?: string;
  avatarLayout: AvatarLayout;
  grayscale: boolean;
  /** How much of the canvas the avatar claims before fading (split layouts). */
  avatarShare: number;
  /** Soft fade length as a fraction of the avatar region. */
  fadeShare: number;
  quoteMarks: boolean;
  letterbox?: boolean;
  /** Font stack hint — we resolve to a registered/bundled face at render time. */
  fontTone: "clean" | "display" | "impact" | "serif";
}

/** Built-in presets a user can flip between. `custom` is the editable slot. */
export const QUOTE_STYLES: QuoteTheme[] = [
  {
    id: "classic",
    label: "Classic Fade",
    emoji: "🖤",
    description: "B&W avatar left → black, white quote — the original look",
    width: 1200,
    height: 630,
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
    id: "classic-flip",
    label: "Classic Flip",
    emoji: "🤍",
    description: "Same B&W fade, avatar on the right",
    width: 1200,
    height: 630,
    background: "#000000",
    textColor: "#FFFFFF",
    attributionColor: "#E8E8E8",
    handleColor: "#9A9A9A",
    watermarkColor: "#3A3A3A",
    avatarLayout: "right",
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
    description: "Clean white card with soft gray avatar fade",
    width: 1200,
    height: 630,
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
    description: "Keeps avatar color — dark fade, punchy white type",
    width: 1200,
    height: 630,
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
    id: "spotlight",
    label: "Spotlight",
    emoji: "🔦",
    description: "Full-bleed avatar fades down; quote sits over the bottom",
    width: 1080,
    height: 1350,
    background: "#000000",
    textColor: "#FFFFFF",
    attributionColor: "#E0E0E0",
    handleColor: "#A0A0A0",
    watermarkColor: "#505050",
    avatarLayout: "portrait",
    grayscale: true,
    avatarShare: 1,
    fadeShare: 0.55,
    quoteMarks: true,
    fontTone: "display",
  },
  {
    id: "ember",
    label: "Ember Night",
    emoji: "🔥",
    description: "Warm charcoal gradient, color avatar, cream type",
    width: 1200,
    height: 630,
    background: "#1A0E0A",
    backgroundGradient: {
      x0: 0, y0: 0, x1: 1, y1: 1,
      stops: [["#2A1210", 0], ["#120806", 1]],
    },
    textColor: "#FFE8D6",
    attributionColor: "#E8B89A",
    handleColor: "#A87860",
    watermarkColor: "#5A3028",
    accentColor: "#E85D04",
    avatarLayout: "left",
    grayscale: false,
    avatarShare: 0.45,
    fadeShare: 0.5,
    quoteMarks: false,
    fontTone: "clean",
  },
  {
    id: "ice",
    label: "Ice Out",
    emoji: "❄️",
    description: "Cold slate fade with icy type — looks serious, quotes chaos",
    width: 1200,
    height: 630,
    background: "#0B1218",
    backgroundGradient: {
      x0: 0, y0: 0, x1: 1, y1: 0,
      stops: [["#0B1218", 0], ["#102030", 1]],
    },
    textColor: "#E8F4FF",
    attributionColor: "#A8C8E0",
    handleColor: "#6A88A0",
    watermarkColor: "#304858",
    accentColor: "#4CC9F0",
    avatarLayout: "left",
    grayscale: true,
    avatarShare: 0.44,
    fadeShare: 0.42,
    quoteMarks: false,
    fontTone: "clean",
  },
  {
    id: "impact",
    label: "Impact",
    emoji: "💥",
    description: "Huge bold type, tiny corner avatar — meme energy",
    width: 1200,
    height: 630,
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
  {
    id: "film",
    label: "Film Still",
    emoji: "🎬",
    description: "Cinematic letterbox bars + B&W fade",
    width: 1280,
    height: 720,
    background: "#050505",
    textColor: "#F2F2F2",
    attributionColor: "#D0D0D0",
    handleColor: "#888888",
    watermarkColor: "#444444",
    avatarLayout: "left",
    grayscale: true,
    avatarShare: 0.5,
    fadeShare: 0.45,
    quoteMarks: false,
    letterbox: true,
    fontTone: "serif",
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

/** Background swatches for the Make Your Own panel. */
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

/** Seed a custom theme from a preset (defaults to classic). */
export function customFrom(baseId = "classic"): QuoteTheme {
  const base = getStyle(baseId);
  return {
    ...base,
    id: CUSTOM_STYLE_ID,
    label: "Make Your Own",
    emoji: "✨",
    description: "Your colors, layout, and vibe",
  };
}
