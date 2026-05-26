import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// Display labels — Server 2 uses Mythic as the top tier; default global labels
// match the bot's RARITY_LABELS.
const RARITY_META: Record<Rarity, { label: string; emoji: string; color: string }> = {
  common:    { label: "Common",    emoji: "⚪", color: "#95a5a6" },
  uncommon:  { label: "Uncommon",  emoji: "🟢", color: "#2ecc71" },
  rare:      { label: "Rare",      emoji: "🔵", color: "#3498db" },
  epic:      { label: "Epic",      emoji: "🟣", color: "#9b59b6" },
  legendary: { label: "Legendary", emoji: "🟡", color: "#f39c12" },
  mythic:    { label: "Mythic",    emoji: "🟪", color: "#ff2d92" },
};

// Built-in card-data defaults — shown as placeholders so admins know what the
// fallback value would be if they clear an override. Mirrors RARITY_DEFAULTS
// in artifacts/api-server/src/bot/cards-data.ts.
const CARD_DEFAULTS: Record<Rarity, { worth: number; burn: number; weight: number }> = {
  common:    { worth: 10,   burn: 5,    weight: 60 },
  uncommon:  { worth: 75,   burn: 35,   weight: 25 },
  rare:      { worth: 250,  burn: 125,  weight: 10 },
  epic:      { worth: 750,  burn: 375,  weight: 4  },
  legendary: { worth: 2500, burn: 1250, weight: 1  },
  mythic:    { worth: 6000, burn: 3000, weight: 0  },
};

type ProfileRow = {
  rarity: Rarity;
  worthValue: number | null;
  burnValue: number | null;
  dropWeight: number | null;
};
type ProfilesResponse = { guildId: string; profiles: ProfileRow[] };
type Guild = { id: string; name: string; iconUrl: string | null; memberCount: number };
type GuildsResponse = { guilds: Guild[] };

export default function RaritiesPage() {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();

  const [guildId, setGuildIdState] = useState<string>(() => {
    try { return localStorage.getItem("dn:activeGuildId") ?? ""; } catch { return ""; }
  });
  const setGuildId = (next: string) => {
    setGuildIdState(next);
    try { localStorage.setItem("dn:activeGuildId", next); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!isLoading && !user) navigate("/login");
  }, [isLoading, user, navigate]);

  const guildsQ = useQuery({
    queryKey: ["embed-guilds"],
    queryFn: () => apiGet<GuildsResponse>("/api/embeds/guilds"),
    enabled: !!user,
  });

  useEffect(() => {
    const list = guildsQ.data?.guilds ?? [];
    if (list.length === 0) return;
    if (!guildId || !list.some(g => g.id === guildId)) {
      setGuildId(list[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildsQ.data]);

  const profilesQ = useQuery({
    queryKey: ["rarity-profiles", guildId],
    queryFn: () => apiGet<ProfilesResponse>(`/api/rarity-profiles/${guildId}`),
    enabled: !!guildId,
  });

  // Local edit buffer keyed by rarity. We hold string state so empty input ===
  // "use default" — committing converts to number-or-null.
  const [draft, setDraft] = useState<Record<Rarity, { worthValue: string; burnValue: string; dropWeight: string }>>({} as never);

  useEffect(() => {
    const next = {} as Record<Rarity, { worthValue: string; burnValue: string; dropWeight: string }>;
    const byRarity = new Map<Rarity, ProfileRow>();
    for (const p of profilesQ.data?.profiles ?? []) byRarity.set(p.rarity, p);
    for (const r of RARITIES) {
      const row = byRarity.get(r);
      next[r] = {
        worthValue: row?.worthValue != null ? String(row.worthValue) : "",
        burnValue: row?.burnValue != null ? String(row.burnValue) : "",
        dropWeight: row?.dropWeight != null ? String(row.dropWeight) : "",
      };
    }
    setDraft(next);
  }, [profilesQ.data]);

  const save = useMutation({
    mutationFn: ({ rarity, patch }: { rarity: Rarity; patch: { worthValue: number | null; burnValue: number | null; dropWeight: number | null } }) =>
      apiSend("PUT", `/api/rarity-profiles/${guildId}/${rarity}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rarity-profiles", guildId] }),
  });

  const reset = useMutation({
    mutationFn: (rarity: Rarity) =>
      apiSend("DELETE", `/api/rarity-profiles/${guildId}/${rarity}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rarity-profiles", guildId] }),
  });

  const resetAll = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/rarity-profiles/${guildId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rarity-profiles", guildId] }),
  });

  const guild = useMemo(
    () => guildsQ.data?.guilds.find(g => g.id === guildId) ?? null,
    [guildsQ.data, guildId],
  );

  function parseField(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
    return n;
  }

  function fieldError(s: string): string | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return "must be a number";
    if (!Number.isInteger(n) || n < 0) return "must be a whole number ≥ 0";
    return null;
  }

  function onSaveRow(r: Rarity) {
    const d = draft[r];
    const errs = [fieldError(d.worthValue), fieldError(d.burnValue), fieldError(d.dropWeight)].filter(Boolean);
    if (errs.length > 0) return;
    save.mutate({
      rarity: r,
      patch: {
        worthValue: parseField(d.worthValue),
        burnValue: parseField(d.burnValue),
        dropWeight: parseField(d.dropWeight),
      },
    });
  }

  if (isLoading || !user) {
    return <div className="container max-w-4xl py-10 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rarity Profiles</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Per-server overrides for <strong>worth</strong>, <strong>burn value</strong>, and
            <strong> drop weight</strong> by rarity. Leave a field blank to fall back to the
            card's own value. Affects spawns, packs, <code>/info</code>, <code>/burn</code>,
            leaderboard net worth, and trade fairness — without touching individual cards.
          </p>
        </div>
        {guild && (
          <div className="flex items-center gap-2 text-sm">
            {guild.iconUrl && <img src={guild.iconUrl} alt="" className="h-7 w-7 rounded-full" />}
            <span className="font-medium">{guild.name}</span>
            <Badge variant="outline" className="text-xs">{guild.memberCount} members</Badge>
          </div>
        )}
      </div>

      {/* Guild picker */}
      <div className="rounded-lg border bg-card p-4">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Server</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {(guildsQ.data?.guilds ?? []).map(g => (
            <button
              key={g.id}
              onClick={() => setGuildId(g.id)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                g.id === guildId
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-foreground/70 hover:bg-accent"
              }`}
            >
              {g.iconUrl && <img src={g.iconUrl} alt="" className="h-5 w-5 rounded-full" />}
              <span>{g.name}</span>
            </button>
          ))}
          {guildsQ.data?.guilds.length === 0 && (
            <span className="text-sm text-muted-foreground">Bot isn't in any servers yet.</span>
          )}
        </div>
      </div>

      {/* Table */}
      {guildId && profilesQ.data && Object.keys(draft).length === RARITIES.length && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-2 px-4 py-2.5 border-b bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <div>Rarity</div>
            <div>Worth (💠)</div>
            <div>Burn (💠)</div>
            <div>Drop weight</div>
            <div />
          </div>
          {RARITIES.map(r => {
            const meta = RARITY_META[r];
            const def = CARD_DEFAULTS[r];
            const d = draft[r];
            const anySet = d.worthValue !== "" || d.burnValue !== "" || d.dropWeight !== "";
            const wErr = fieldError(d.worthValue);
            const bErr = fieldError(d.burnValue);
            const dwErr = fieldError(d.dropWeight);
            const hasErr = !!(wErr || bErr || dwErr);
            return (
              <div key={r} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-2 px-4 py-3 border-b last:border-b-0 items-center">
                <div className="flex items-center gap-2">
                  <span className="text-lg" style={{ color: meta.color }}>{meta.emoji}</span>
                  <span className="font-medium">{meta.label}</span>
                  {anySet && <Badge variant="secondary" className="text-[10px]">overridden</Badge>}
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={String(def.worth)}
                    value={d.worthValue}
                    onChange={e => setDraft(s => ({ ...s, [r]: { ...s[r], worthValue: e.target.value } }))}
                    className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm ${wErr ? "border-destructive" : "border-input"}`}
                  />
                  {wErr && <div className="text-[10px] text-destructive mt-1">{wErr}</div>}
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={String(def.burn)}
                    value={d.burnValue}
                    onChange={e => setDraft(s => ({ ...s, [r]: { ...s[r], burnValue: e.target.value } }))}
                    className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm ${bErr ? "border-destructive" : "border-input"}`}
                  />
                  {bErr && <div className="text-[10px] text-destructive mt-1">{bErr}</div>}
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={String(def.weight)}
                    value={d.dropWeight}
                    onChange={e => setDraft(s => ({ ...s, [r]: { ...s[r], dropWeight: e.target.value } }))}
                    className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm ${dwErr ? "border-destructive" : "border-input"}`}
                  />
                  {dwErr && <div className="text-[10px] text-destructive mt-1">{dwErr}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => onSaveRow(r)}
                    disabled={hasErr || save.isPending}
                  >
                    Save
                  </Button>
                  {anySet && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => reset.mutate(r)}
                      disabled={reset.isPending}
                      title="Clear this rarity's override"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {guildId && profilesQ.data && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Placeholders show the bot's built-in defaults for each rarity. A blank field falls back
            to each card's own stored value.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm(`Reset ALL rarity overrides for ${guild?.name ?? "this server"}?`)) {
                resetAll.mutate();
              }
            }}
            disabled={resetAll.isPending}
          >
            Reset all to card defaults
          </Button>
        </div>
      )}

      {(save.isError || reset.isError || resetAll.isError) && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Save failed. Try again or refresh.
        </div>
      )}
    </div>
  );
}
