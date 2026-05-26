import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type CustomRarity = {
  guildId: string;
  slug: string;
  name: string;
  emoji: string;
  color: number;
  position: number;
  worthValue: number;
  burnValue: number;
  dropWeight: number;
  inPacks: boolean;
  droppable: boolean;
};
type CustomRaritiesResponse = { guildId: string; customRarities: CustomRarity[] };

type CardRarityOverride = {
  cardId: number;
  customRaritySlug: string;
  cardName: string;
  cardRarity: string;
};
type OverridesResponse = { guildId: string; overrides: CardRarityOverride[] };

type AdminCard = { id: number; name: string; rarity: string };
type AdminCardsResponse = { cards: AdminCard[] };

type Guild = { id: string; name: string; iconUrl: string | null; memberCount: number };
type GuildsResponse = { guilds: Guild[] };

// Built-in tier positions, surfaced so admins can pick a position that
// slots a custom tier between two built-ins (e.g. 4.5 = between Epic and
// Legendary). Mirrors BUILTIN_POSITIONS in artifacts/api-server/src/bot/db.ts.
const BUILTIN_TIERS: Array<{ key: string; label: string; position: number }> = [
  { key: "common",    label: "Common",    position: 1 },
  { key: "uncommon",  label: "Uncommon",  position: 2 },
  { key: "rare",      label: "Rare",      position: 3 },
  { key: "epic",      label: "Epic",      position: 4 },
  { key: "legendary", label: "Legendary", position: 5 },
  { key: "mythic",    label: "Mythic",    position: 6 },
];

function colorToHex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}
function hexToColor(s: string): number | null {
  const m = s.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

type Draft = {
  slug: string;
  name: string;
  emoji: string;
  colorHex: string;
  position: string;
  worthValue: string;
  burnValue: string;
  dropWeight: string;
  inPacks: boolean;
  droppable: boolean;
};

function emptyDraft(): Draft {
  return {
    slug: "",
    name: "",
    emoji: "✨",
    colorHex: "#a78bfa",
    position: "5.5",
    worthValue: "3000",
    burnValue: "1500",
    dropWeight: "0",
    inPacks: false,
    droppable: true,
  };
}

function draftFromRow(r: CustomRarity): Draft {
  return {
    slug: r.slug,
    name: r.name,
    emoji: r.emoji,
    colorHex: colorToHex(r.color),
    position: String(r.position),
    worthValue: String(r.worthValue),
    burnValue: String(r.burnValue),
    dropWeight: String(r.dropWeight),
    inPacks: r.inPacks,
    droppable: r.droppable,
  };
}

export default function CustomRaritiesPage() {
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

  const tiersQ = useQuery({
    queryKey: ["custom-rarities", guildId],
    queryFn: () => apiGet<CustomRaritiesResponse>(`/api/custom-rarities/${guildId}`),
    enabled: !!guildId,
  });
  const overridesQ = useQuery({
    queryKey: ["card-rarity-overrides", guildId],
    queryFn: () => apiGet<OverridesResponse>(`/api/card-rarity-overrides/${guildId}`),
    enabled: !!guildId,
  });
  const cardsQ = useQuery({
    queryKey: ["admin-cards"],
    queryFn: () => apiGet<AdminCardsResponse>("/api/admin/cards"),
    enabled: !!user,
  });

  const guild = useMemo(
    () => guildsQ.data?.guilds.find(g => g.id === guildId) ?? null,
    [guildsQ.data, guildId],
  );

  // ── Tier editor ────────────────────────────────────────────────────────────
  // editingSlug=null + showCreate=true → new-tier form. Otherwise pick the
  // existing tier matching editingSlug.
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  function startCreate() {
    setEditingSlug(null);
    setShowCreate(true);
    setDraft(emptyDraft());
  }
  function startEdit(row: CustomRarity) {
    setEditingSlug(row.slug);
    setShowCreate(false);
    setDraft(draftFromRow(row));
  }
  function cancelEdit() {
    setEditingSlug(null);
    setShowCreate(false);
    setDraft(emptyDraft());
  }

  const saveTier = useMutation({
    mutationFn: () => {
      const color = hexToColor(draft.colorHex);
      const position = Number(draft.position);
      const worthValue = Number(draft.worthValue);
      const burnValue = Number(draft.burnValue);
      const dropWeight = Number(draft.dropWeight);
      if (color === null) throw new Error("Color must be #RRGGBB");
      if (!Number.isFinite(position)) throw new Error("Position must be a number");
      return apiSend("PUT", `/api/custom-rarities/${guildId}/${draft.slug}`, {
        name: draft.name,
        emoji: draft.emoji,
        color,
        position,
        worthValue,
        burnValue,
        dropWeight,
        inPacks: draft.inPacks,
        droppable: draft.droppable,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-rarities", guildId] });
      cancelEdit();
    },
  });

  const deleteTier = useMutation({
    mutationFn: (slug: string) =>
      apiSend("DELETE", `/api/custom-rarities/${guildId}/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-rarities", guildId] });
      qc.invalidateQueries({ queryKey: ["card-rarity-overrides", guildId] });
    },
  });

  // ── Card assignment ────────────────────────────────────────────────────────
  const [assignSlug, setAssignSlug] = useState<string>("");
  const [cardSearch, setCardSearch] = useState("");

  const filteredCards = useMemo(() => {
    const q = cardSearch.trim().toLowerCase();
    const all = cardsQ.data?.cards ?? [];
    if (!q) return all.slice(0, 50);
    return all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [cardsQ.data, cardSearch]);

  const assignCard = useMutation({
    mutationFn: ({ cardId, slug }: { cardId: number; slug: string }) =>
      apiSend("PUT", `/api/card-rarity-overrides/${guildId}/${cardId}`, {
        customRaritySlug: slug,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["card-rarity-overrides", guildId] }),
  });
  const unassignCard = useMutation({
    mutationFn: (cardId: number) =>
      apiSend("DELETE", `/api/card-rarity-overrides/${guildId}/${cardId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["card-rarity-overrides", guildId] }),
  });

  const overridesBySlug = useMemo(() => {
    const m = new Map<string, CardRarityOverride[]>();
    for (const o of overridesQ.data?.overrides ?? []) {
      const arr = m.get(o.customRaritySlug) ?? [];
      arr.push(o);
      m.set(o.customRaritySlug, arr);
    }
    return m;
  }, [overridesQ.data]);

  const overrideByCardId = useMemo(() => {
    const m = new Map<number, CardRarityOverride>();
    for (const o of overridesQ.data?.overrides ?? []) m.set(o.cardId, o);
    return m;
  }, [overridesQ.data]);

  if (isLoading || !user) {
    return <div className="container max-w-4xl py-10 text-sm text-muted-foreground">Loading…</div>;
  }

  const tiers = tiersQ.data?.customRarities ?? [];
  const showForm = showCreate || editingSlug !== null;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Custom Rarity Tiers</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Per-server custom tiers <strong>beyond</strong> the six built-in rarities. Define a
            name/emoji/color, set its <strong>position</strong> on the ladder, and assign any
            existing card to it. Custom-tier values <strong>fully replace</strong> the card's
            own worth/burn/drop weight. By default custom tiers are excluded from packs; flip
            "in packs" to include them.
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
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Built-in tier positions: {BUILTIN_TIERS.map(t => `${t.label} ${t.position}`).join(" · ")}.
          Use a value between two of them (e.g. <code>4.5</code>) to slot a custom tier.
        </p>
      </div>

      {/* Existing tiers */}
      {guildId && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
            <h2 className="text-sm font-semibold">Custom tiers</h2>
            <Button size="sm" onClick={startCreate}>+ New tier</Button>
          </div>
          {tiers.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No custom tiers yet. Click "New tier" to create one.
            </div>
          ) : (
            <div>
              {tiers.map(t => {
                const assigned = overridesBySlug.get(t.slug) ?? [];
                return (
                  <div key={t.slug} className="border-b last:border-b-0 px-4 py-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xl" style={{ color: colorToHex(t.color) }}>{t.emoji}</span>
                      <span className="font-semibold">{t.name}</span>
                      <Badge variant="outline" className="text-[10px]">slug: {t.slug}</Badge>
                      <Badge variant="outline" className="text-[10px]">pos {t.position}</Badge>
                      <Badge variant="outline" className="text-[10px]">worth {t.worthValue.toLocaleString()}</Badge>
                      <Badge variant="outline" className="text-[10px]">burn {t.burnValue.toLocaleString()}</Badge>
                      <Badge variant="outline" className="text-[10px]">weight {t.dropWeight}</Badge>
                      {!t.droppable && <Badge variant="secondary" className="text-[10px]">no random drops</Badge>}
                      {t.inPacks && <Badge variant="secondary" className="text-[10px]">in packs</Badge>}
                      <div className="ml-auto flex gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => startEdit(t)}>Edit</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete tier "${t.name}"? Cards assigned to it will revert to their built-in rarity.`)) {
                              deleteTier.mutate(t.slug);
                            }
                          }}
                          disabled={deleteTier.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {assigned.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {assigned.map(o => (
                          <span
                            key={o.cardId}
                            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs"
                          >
                            <span>{o.cardName}</span>
                            <span className="text-muted-foreground">({o.cardRarity})</span>
                            <button
                              className="ml-1 text-muted-foreground hover:text-destructive"
                              onClick={() => unassignCard.mutate(o.cardId)}
                              title="Remove from tier"
                            >✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create / edit form */}
      {guildId && showForm && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">
            {editingSlug ? `Edit "${draft.name || draft.slug}"` : "New custom tier"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Slug (URL-safe id, lowercase)">
              <input
                value={draft.slug}
                onChange={e => setDraft(d => ({ ...d, slug: e.target.value.toLowerCase() }))}
                placeholder="prismatic"
                disabled={!!editingSlug}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Display name">
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="Prismatic"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Emoji">
              <input
                value={draft.emoji}
                onChange={e => setDraft(d => ({ ...d, emoji: e.target.value }))}
                placeholder="🔮"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Color (hex)">
              <input
                type="color"
                value={draft.colorHex}
                onChange={e => setDraft(d => ({ ...d, colorHex: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-1"
              />
            </Field>
            <Field label="Position on ladder">
              <input
                type="number"
                step="0.1"
                value={draft.position}
                onChange={e => setDraft(d => ({ ...d, position: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Drop weight (0 = admin-only)">
              <input
                type="number"
                min={0}
                value={draft.dropWeight}
                onChange={e => setDraft(d => ({ ...d, dropWeight: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Worth (💠)">
              <input
                type="number"
                min={0}
                value={draft.worthValue}
                onChange={e => setDraft(d => ({ ...d, worthValue: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Burn (💠)">
              <input
                type="number"
                min={0}
                value={draft.burnValue}
                onChange={e => setDraft(d => ({ ...d, burnValue: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.droppable}
                onChange={e => setDraft(d => ({ ...d, droppable: e.target.checked }))}
              />
              Eligible for random spawns
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.inPacks}
                onChange={e => setDraft(d => ({ ...d, inPacks: e.target.checked }))}
              />
              Include in pack pools
            </label>
          </div>
          {saveTier.isError && (
            <div className="text-xs text-destructive">
              {(saveTier.error as Error).message ?? "Save failed."}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => saveTier.mutate()}
              disabled={saveTier.isPending || !draft.slug || !draft.name || !draft.emoji}
            >
              {editingSlug ? "Save changes" : "Create tier"}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Card assignment */}
      {guildId && tiers.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Assign cards to a tier</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={assignSlug}
              onChange={e => setAssignSlug(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Pick a tier —</option>
              {tiers.map(t => (
                <option key={t.slug} value={t.slug}>{t.emoji} {t.name}</option>
              ))}
            </select>
            <input
              value={cardSearch}
              onChange={e => setCardSearch(e.target.value)}
              placeholder="Search cards by name…"
              className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="rounded-md border max-h-72 overflow-y-auto">
            {filteredCards.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">No matching cards.</div>
            ) : filteredCards.map(c => {
              const ov = overrideByCardId.get(c.id);
              return (
                <div key={c.id} className="flex items-center gap-3 px-3 py-1.5 border-b last:border-b-0 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="outline" className="text-[10px]">{c.rarity}</Badge>
                  {ov && (
                    <Badge variant="secondary" className="text-[10px]">→ {ov.customRaritySlug}</Badge>
                  )}
                  <div className="ml-auto flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!assignSlug || assignCard.isPending}
                      onClick={() => assignCard.mutate({ cardId: c.id, slug: assignSlug })}
                    >
                      Assign
                    </Button>
                    {ov && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={unassignCard.isPending}
                        onClick={() => unassignCard.mutate(c.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Showing up to 50 results. Type to narrow down.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs space-y-1 block">
      <span className="text-muted-foreground uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}
