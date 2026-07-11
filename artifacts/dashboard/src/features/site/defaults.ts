/**
 * Hardcoded presentation defaults — the fail-safe fallback layer.
 *
 * Every cosmetic asset on the site (hero copy, background media, splash media,
 * theme accents) resolves through these defaults. When the admin CMS (Phase 5)
 * supplies an override we use it; when an override is missing, deleted, or its
 * asset fails to load, the UI falls back here so it can never render a blank
 * screen or a broken-image link.
 *
 * These defaults intentionally reference NO external media — they lean on CSS
 * gradients and the game's own card art (served by the API) so the homepage is
 * always presentable out of the box.
 */
export interface PresentationConfig {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    /** Optional ambient background media (mp4/webm/gif/image). null = gradient only. */
    backgroundSrc: string | null;
    /** Static poster/frame for reduced-motion + GIF freeze. */
    backgroundPoster: string | null;
    ctaLabel: string;
    ctaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
  };
  splash: {
    enabled: boolean;
    /** ms each rarity tier is shown before cycling up. */
    tierDurationMs: number;
  };
  /** Invite link used by CTAs (mini-game funnel, etc.). Overridable by the CMS. */
  discordInviteUrl: string;
}

export const DEFAULT_PRESENTATION: PresentationConfig = {
  hero: {
    eyebrow: "Dex N Cards Official",
    title: "Collect the Frontline",
    subtitle:
      "A gritty military sci-fi trading card game. Chase every rarity, build your collection, and prove your rank inside our Discord.",
    backgroundSrc: null,
    backgroundPoster: null,
    ctaLabel: "Enter the Card Vault",
    ctaHref: "/vault",
    secondaryCtaLabel: "Play Demo",
    secondaryCtaHref: "/play",
  },
  splash: {
    enabled: true,
    tierDurationMs: 2600,
  },
  // Placeholder — replace with your real invite (or set it via the CMS later).
  discordInviteUrl: "https://discord.gg/",
};

/** Merge a partial override from the API over the hardcoded defaults. */
export function resolvePresentation(override: Partial<PresentationConfig> | null | undefined): PresentationConfig {
  if (!override) return DEFAULT_PRESENTATION;
  return {
    hero: { ...DEFAULT_PRESENTATION.hero, ...(override.hero ?? {}) },
    splash: { ...DEFAULT_PRESENTATION.splash, ...(override.splash ?? {}) },
    discordInviteUrl: override.discordInviteUrl ?? DEFAULT_PRESENTATION.discordInviteUrl,
  };
}
