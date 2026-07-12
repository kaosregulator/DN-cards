import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Card } from "@/hooks/queries";

interface ViewerState {
  /** The card currently shown full-screen, or null when closed. */
  card: Card | null;
  /** The full pool of cards, so the viewer can surface related cards in-set. */
  pool: Card[];
  open: (card: Card, pool?: Card[]) => void;
  close: () => void;
}

const ViewerCtx = createContext<ViewerState | null>(null);

export function CardViewerProvider({ children }: { children: React.ReactNode }) {
  const [card, setCard] = useState<Card | null>(null);
  const [pool, setPool] = useState<Card[]>([]);

  const open = useCallback((next: Card, nextPool?: Card[]) => {
    setCard(next);
    if (nextPool) setPool(nextPool);
  }, []);
  const close = useCallback(() => setCard(null), []);

  const value = useMemo<ViewerState>(() => ({ card, pool, open, close }), [card, pool, open, close]);
  return <ViewerCtx.Provider value={value}>{children}</ViewerCtx.Provider>;
}

export function useCardViewer(): ViewerState {
  const ctx = useContext(ViewerCtx);
  if (!ctx) throw new Error("useCardViewer must be used within a CardViewerProvider");
  return ctx;
}
