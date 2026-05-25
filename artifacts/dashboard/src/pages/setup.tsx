import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CheckResponse = { valid: boolean; isReset?: boolean; presetUsername?: string | null; error?: string };

export default function SetupPage() {
  const [, params] = useRoute("/setup/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const check = useQuery<CheckResponse>({
    queryKey: ["auth", "setup", token],
    queryFn: () => apiGet<CheckResponse>(`/api/auth/setup/${token}/check`),
    enabled: !!token,
    retry: false,
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (check.data?.presetUsername) setUsername(check.data.presetUsername);
  }, [check.data?.presetUsername]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setSubmitting(true);
    try {
      const body = check.data?.isReset ? { password } : { username: username.trim(), password };
      const res = await apiSend<{ user: any }>("POST", `/api/auth/setup/${token}`, body);
      qc.setQueryData(["auth", "me"], res);
      navigate("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return <div className="container py-12">Missing setup token.</div>;

  if (check.isLoading) {
    return <div className="container py-12 text-center text-muted-foreground">Checking link…</div>;
  }

  if (check.error || !check.data?.valid) {
    return (
      <div className="container max-w-md py-12 px-4">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm">
          <h1 className="text-lg font-bold mb-2">Setup link invalid</h1>
          <p>This setup link is expired, already used, or unknown. Run <code>/dashboard</code> in Discord to get a fresh one.</p>
        </div>
      </div>
    );
  }

  const isReset = check.data.isReset;

  return (
    <div className="container max-w-md py-12 px-4">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">
          {isReset ? "Reset password" : "Set up your dashboard login"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 mb-6">
          {isReset
            ? `Choose a new password for ${check.data.presetUsername ?? "your account"}.`
            : "Pick a username and password — you'll use these to sign in to the dashboard."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" autoCapitalize="none" value={username} disabled={!!isReset} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} />
            {!isReset && <p className="text-xs text-muted-foreground mt-1">3–32 chars · letters, numbers, _ - .</p>}
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <p className="text-xs text-muted-foreground mt-1">At least 8 characters.</p>
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Saving…" : isReset ? "Update password" : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
