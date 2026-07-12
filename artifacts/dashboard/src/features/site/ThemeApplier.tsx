import { useEffect, useMemo } from "react";
import { useSiteConfig } from "@/hooks/queries";
import { resolvePresentation, type PresentationConfig } from "./defaults";

/** Validate an "H S% L%" triplet before writing it to the CSS var. Rejects
 *  anything that isn't three space-separated numeric/percent tokens so a bad
 *  admin value can't corrupt the theme (falls back to the default). */
function isValidHslTriplet(v: string): boolean {
  return /^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/.test(v.trim());
}

/**
 * Applies the admin-configured theme accent to the document by overriding the
 * `--primary` / `--ring` CSS variables. Falls back to the hardcoded default
 * when no override exists or the value is malformed — the theme can never break.
 */
export function ThemeApplier() {
  const { data } = useSiteConfig();
  const presentation = useMemo<PresentationConfig>(
    () => resolvePresentation(data?.presentation as Partial<PresentationConfig> | null),
    [data],
  );

  useEffect(() => {
    const primary = presentation.theme.primary;
    const root = document.documentElement;
    if (primary && isValidHslTriplet(primary)) {
      root.style.setProperty("--primary", primary);
      root.style.setProperty("--ring", primary);
    } else {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--ring");
    }
  }, [presentation.theme.primary]);

  return null;
}
