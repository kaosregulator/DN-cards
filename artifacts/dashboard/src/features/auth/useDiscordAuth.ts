import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";

export interface DiscordUser {
  id: string;
  username: string | null;
  avatar: string | null;
  inHomeGuild: boolean;
}

interface StatusResponse {
  configured: boolean;
  homeGuildId: string | null;
}

/**
 * Website visitor auth via Discord OAuth. Reads /api/oauth/status to know
 * whether the flow is wired up (dormant until env creds are set) and
 * /api/oauth/me for the current identity. Login is a full redirect; logout
 * clears the session cookie.
 */
export function useDiscordAuth() {
  const qc = useQueryClient();

  const status = useQuery<StatusResponse>({
    queryKey: ["oauth", "status"],
    queryFn: () => apiGet<StatusResponse>("/api/oauth/status"),
    staleTime: 1000 * 60 * 30,
  });

  const me = useQuery<{ user: DiscordUser | null }>({
    queryKey: ["oauth", "me"],
    queryFn: () => apiGet<{ user: DiscordUser | null }>("/api/oauth/me"),
    enabled: status.data?.configured ?? false,
    retry: false,
  });

  const logout = useMutation({
    mutationFn: () => apiSend<{ ok: true }>("POST", "/api/oauth/logout"),
    onSuccess: () => {
      qc.setQueryData(["oauth", "me"], { user: null });
      qc.invalidateQueries({ queryKey: ["oauth", "collection"] });
    },
  });

  const login = () => {
    window.location.href = "/api/oauth/discord/login";
  };

  return {
    configured: status.data?.configured ?? false,
    homeGuildId: status.data?.homeGuildId ?? null,
    user: me.data?.user ?? null,
    isLoggedIn: !!me.data?.user,
    isLoading: status.isLoading || me.isLoading,
    login,
    logout,
  };
}

/** The logged-in visitor's owned card ids (read-only). Empty when logged out. */
export function useOwnedCards(enabled: boolean) {
  const q = useQuery<{ ownedCardIds: number[]; holdings: { cardId: number; count: number; shinyCount: number }[] }>({
    queryKey: ["oauth", "collection"],
    queryFn: () => apiGet("/api/oauth/collection"),
    enabled,
    retry: false,
  });

  return useMemo(() => {
    const ownedSet = new Set(q.data?.ownedCardIds ?? []);
    const holdings = new Map((q.data?.holdings ?? []).map((h) => [h.cardId, h]));
    return { ownedSet, holdings, isLoading: q.isLoading, isReady: q.isSuccess };
  }, [q.data, q.isLoading, q.isSuccess]);
}
