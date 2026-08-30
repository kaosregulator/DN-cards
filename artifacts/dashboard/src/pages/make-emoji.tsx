import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { adminGet } from "@/lib/api";
import { Loader2 } from "lucide-react";

interface EmojiOfflineStatus {
  primary: {
    id: string;
    name: string;
    status: { available: boolean; reason?: string };
    verified: boolean;
    discoveredAt: string | null;
    liveStyleCount: number;
  };
  offline: {
    id: string;
    name: string;
    status: { available: boolean; reason?: string };
    enabled: boolean;
    packageRoot: string | null;
    version: string | null;
    offlineReady: boolean;
    discoveredAt: string | null;
    styleCount: number;
    implementedStyleCount: number;
    implementedStyles: string[];
    envFlag: string;
  };
  message: string;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="container flex min-h-[50vh] items-center justify-center py-16">{children}</div>;
}

export default function MakeEmoji() {
  const { user, isLoading } = useAuth();
  const query = useQuery({
    queryKey: ["admin", "emoji-offline"],
    queryFn: () => adminGet<EmojiOfflineStatus>("/api/admin/emoji/offline"),
    enabled: !!user,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;
  }
  if (!user) {
    return (
      <Centered>
        <div className="text-center">
          <p className="mb-3 font-mono uppercase tracking-widest text-muted-foreground">Admin sign-in required</p>
          <Link href="/login" className="text-primary underline">Go to admin login</Link>
        </div>
      </Centered>
    );
  }

  const data = query.data;

  return (
    <div className="container max-w-3xl py-10 space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">Admin · Emoji</p>
        <h1 className="text-3xl font-bold font-mono uppercase tracking-widest">Make Emoji</h1>
        <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
          Discord <code className="font-mono">/emoji</code> generates through MakeEmoji.com.
          This page shows live provider health and the offline backup archive we keep for a
          future independent engine.
        </p>
      </div>

      {query.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading status…
        </div>
      )}
      {query.isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          Could not load emoji status. {(query.error as Error).message}
        </div>
      )}

      {data && (
        <>
          <section className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-3">
            <h2 className="font-mono uppercase tracking-widest text-sm">Primary — MakeEmoji.com</h2>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Provider</dt><dd className="font-mono">{data.primary.name}</dd></div>
              <div><dt className="text-muted-foreground">Status</dt>
                <dd className="font-mono">{data.primary.status.available ? "available" : data.primary.status.reason}</dd>
              </div>
              <div><dt className="text-muted-foreground">Manifest</dt>
                <dd className="font-mono">{data.primary.verified ? "verified" : "unverified"}</dd>
              </div>
              <div><dt className="text-muted-foreground">Live styles</dt>
                <dd className="font-mono">{data.primary.liveStyleCount}</dd>
              </div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Discovered</dt>
                <dd className="font-mono text-xs">{data.primary.discoveredAt ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-3">
            <h2 className="font-mono uppercase tracking-widest text-sm">Offline backup</h2>
            <p className="text-sm text-muted-foreground">{data.message}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Archived styles</dt>
                <dd className="font-mono text-lg">{data.offline.styleCount}</dd>
              </div>
              <div><dt className="text-muted-foreground">Offline-ready</dt>
                <dd className="font-mono">{data.offline.offlineReady ? "yes" : "no (partial only)"}</dd>
              </div>
              <div><dt className="text-muted-foreground">Implemented subset</dt>
                <dd className="font-mono">{data.offline.implementedStyleCount}</dd>
              </div>
              <div><dt className="text-muted-foreground">Fallback enabled</dt>
                <dd className="font-mono">{data.offline.enabled ? "yes" : `no — set ${data.offline.envFlag}=1`}</dd>
              </div>
              <div><dt className="text-muted-foreground">Package version</dt>
                <dd className="font-mono">{data.offline.version ?? "—"}</dd>
              </div>
              <div><dt className="text-muted-foreground">Provider status</dt>
                <dd className="font-mono text-xs">{data.offline.status.available ? "available" : data.offline.status.reason}</dd>
              </div>
            </dl>
            {data.offline.implementedStyles.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Partial offline styles</p>
                <div className="flex flex-wrap gap-2">
                  {data.offline.implementedStyles.map((id) => (
                    <span key={id} className="rounded-md border border-border/60 px-2 py-0.5 font-mono text-xs">{id}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
