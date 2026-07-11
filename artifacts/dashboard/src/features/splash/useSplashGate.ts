import { useCallback, useState } from "react";

const SPLASH_SEEN_KEY = "dnc_splash_seen";

/**
 * Session-scoped gate for the intro splash. We store a flag in sessionStorage
 * (cleared when the browser session ends) so a visitor sees the cinematic once
 * per session — clicking "Home" again during the same session skips straight
 * to the homepage instead of replaying it.
 */
export function useSplashGate() {
  const [seen, setSeen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.sessionStorage.getItem(SPLASH_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  });

  const markSeen = useCallback(() => {
    try {
      window.sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {
      /* private mode / storage disabled — just skip persistence */
    }
    setSeen(true);
  }, []);

  const replay = useCallback(() => {
    try {
      window.sessionStorage.removeItem(SPLASH_SEEN_KEY);
    } catch {
      /* ignore */
    }
    setSeen(false);
  }, []);

  return { seen, markSeen, replay };
}
