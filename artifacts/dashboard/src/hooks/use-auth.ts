import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";

export type DashboardSessionUser = {
  id: number;
  username: string;
  isOwner: boolean;
};

type MeResponse = { user: DashboardSessionUser | null };

export function useAuth() {
  const qc = useQueryClient();
  const q = useQuery<MeResponse>({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet<MeResponse>("/api/auth/me"),
    staleTime: 60 * 1000,
    retry: false,
  });

  const login = useMutation({
    mutationFn: (vars: { username: string; password: string }) =>
      apiSend<MeResponse>("POST", "/api/auth/login", vars),
    onSuccess: (data) => qc.setQueryData(["auth", "me"], data),
  });

  const logout = useMutation({
    mutationFn: () => apiSend<{ ok: true }>("POST", "/api/auth/logout"),
    onSuccess: () => qc.setQueryData(["auth", "me"], { user: null }),
  });

  return {
    user: q.data?.user ?? null,
    isLoading: q.isLoading,
    isLoggedIn: !!q.data?.user,
    isOwner: !!q.data?.user?.isOwner,
    refetch: q.refetch,
    login,
    logout,
  };
}
