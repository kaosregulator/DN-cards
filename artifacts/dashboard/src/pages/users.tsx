import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DashUser = { id: number; username: string; isOwner: boolean; createdAt: string; lastLoginAt: string | null };
type ListResponse = { users: DashUser[] };
type InviteResponse = { token: string; setupPath: string; expiresAt: string };

export default function UsersPage() {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const [linkResult, setLinkResult] = useState<{ url: string; label: string } | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);

  const list = useQuery<ListResponse>({
    queryKey: ["dashboard", "users"],
    queryFn: () => apiGet<ListResponse>("/api/dashboard/users"),
    enabled: !!user,
  });

  const invite = useMutation({
    mutationFn: () => apiSend<InviteResponse>("POST", "/api/dashboard/users", {}),
    onSuccess: (r) => setLinkResult({ url: window.location.origin + r.setupPath, label: "Invite link (1 use, 24h)" }),
  });

  const reset = useMutation({
    mutationFn: (id: number) => apiSend<InviteResponse & { username: string }>("POST", `/api/dashboard/users/${id}/reset`),
    onSuccess: (r: any) => setLinkResult({ url: window.location.origin + r.setupPath, label: `Reset link for ${r.username} (1 use, 24h)` }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiSend("DELETE", `/api/dashboard/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard", "users"] }),
  });

  const promote = useMutation({
    mutationFn: (vars: { id: number; isOwner: boolean }) =>
      apiSend("POST", `/api/dashboard/users/${vars.id}/promote`, { isOwner: vars.isOwner }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard", "users"] }),
  });

  if (isLoading) return <div className="container py-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) {
    return (
      <div className="container max-w-md py-12 px-4 text-center">
        <p className="mb-4">You need to sign in to manage dashboard users.</p>
        <Button onClick={() => navigate("/login")}>Sign in</Button>
      </div>
    );
  }
  if (!user.isOwner) {
    return (
      <div className="container max-w-md py-12 px-4">
        <div className="rounded-lg border bg-card p-6">
          <h1 className="text-lg font-bold mb-2">Owners only</h1>
          <p className="text-sm text-muted-foreground">Only dashboard owners can manage users. Ask an existing owner to promote your account.</p>
        </div>
      </div>
    );
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("Copied!");
      setTimeout(() => setCopyState(null), 1500);
    } catch {
      setCopyState("Copy failed — select & copy manually");
    }
  }

  return (
    <div className="container max-w-3xl py-8 px-4 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard Users</h1>
          <p className="text-sm text-muted-foreground">Manage who can sign in to the web dashboard.</p>
        </div>
        <Button onClick={() => invite.mutate()} disabled={invite.isPending}>
          {invite.isPending ? "Generating…" : "+ Invite new admin"}
        </Button>
      </div>

      {linkResult && (
        <div className="rounded-md border bg-muted/30 p-4 space-y-2">
          <p className="text-sm font-medium">{linkResult.label}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input className="flex-1 rounded border bg-background px-2 py-1 text-xs font-mono" readOnly value={linkResult.url} onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="secondary" onClick={() => copy(linkResult.url)}>{copyState ?? "Copy"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Send this to the person — they open it once to set their password.</p>
        </div>
      )}

      <div className="rounded-md border bg-card overflow-hidden">
        {list.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading users…</p>}
        {list.error && <p className="p-4 text-sm text-destructive">{(list.error as ApiError).message}</p>}
        {list.data?.users.map((u) => (
          <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b last:border-b-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{u.username}</span>
                {u.isOwner && <Badge>Owner</Badge>}
                {u.id === user.id && <Badge variant="secondary">You</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Joined {new Date(u.createdAt).toLocaleDateString()} ·{" "}
                {u.lastLoginAt ? `last seen ${new Date(u.lastLoginAt).toLocaleDateString()}` : "never signed in"}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => reset.mutate(u.id)} disabled={reset.isPending}>Reset password</Button>
              {u.id !== user.id && (
                <Button size="sm" variant="outline" onClick={() => promote.mutate({ id: u.id, isOwner: !u.isOwner })} disabled={promote.isPending}>
                  {u.isOwner ? "Demote" : "Promote"}
                </Button>
              )}
              {u.id !== user.id && (
                <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Remove ${u.username}?`)) remove.mutate(u.id); }} disabled={remove.isPending}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
