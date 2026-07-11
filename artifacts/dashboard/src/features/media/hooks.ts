import { useEffect, useRef, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` setting reactively.
 * When true, callers should render a static frame instead of animating
 * video/GIF and skip decorative motion. Respects live OS changes.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Returns whether the browser tab is currently visible. Background media
 * should freeze while the tab is hidden to save battery/CPU.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

/**
 * Observes an element and reports whether it is at least partially on-screen.
 * Used to freeze off-screen background media. `rootMargin` lets callers keep
 * media warm slightly before it scrolls into view.
 */
export function useInViewport<T extends Element>(rootMargin = "0px"): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IO support — assume visible so media still plays.
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { rootMargin, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

/**
 * Combines viewport + tab visibility + reduced-motion into a single boolean:
 * "should this media be actively playing right now?".
 */
export function useShouldPlayMedia<T extends Element>(rootMargin = "200px"): {
  ref: React.RefObject<T | null>;
  shouldPlay: boolean;
  reducedMotion: boolean;
} {
  const { ref, inView } = useInViewport<T>(rootMargin);
  const pageVisible = usePageVisible();
  const reducedMotion = usePrefersReducedMotion();
  return { ref, shouldPlay: inView && pageVisible && !reducedMotion, reducedMotion };
}
