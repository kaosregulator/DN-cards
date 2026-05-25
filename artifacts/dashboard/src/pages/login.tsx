import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, ApiError } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const status = useQuery<{ hasUsers: boolean }>({
    queryKey: ["auth", "status"],
    queryFn: () => apiGet<{ hasUsers: boolean }>("/api/auth/status"),
  });

  useEffect(() => {
    if (user) navigate("/admin");
  }, [user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username: username.trim(), password });
      navigate("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  return (
    <div className="container max-w-md py-12 px-4">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Login</h1>
        <p className="text-sm text-muted-foreground mt-1 mb-6">
          Sign in with the username + password you set during dashboard setup.
        </p>

        {status.data && !status.data.hasUsers && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <strong className="block mb-1">No dashboard users yet.</strong>
            In Discord, run <code className="font-mono">/dashboard</code> in your server (admins only) to get a one-time setup link.
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" autoCapitalize="none" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          Forgot your password? Ask an owner to run <strong>Reset password</strong> from the Users page,
          or use the master <code>ADMIN_TOKEN</code> on the legacy login flow.
        </p>
      </div>
    </div>
  );
}
