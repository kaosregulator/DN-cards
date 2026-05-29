import { useMemo, useState } from "react";
import {
  useAdminCards,
  useUpdateCardDisplay,
  useResetCardDisplay,
  type AdminCard,
  type DisplayOverridePatch,
  type Rarity,
} from "@/hooks/queries";
import { getAdminToken, setAdminToken, ApiError, uploadImageFile, resolveImageUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Search, LogOut, Upload, Loader2, RotateCcw, Eye, EyeOff, Star } from "lucide-react";

const RARITIES: Rarity[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];
const RARITY_COLOR: Record<Rarity, string> = {
  mythic: "text-pink-400 border-pink-500/40",
  legendary: "text-yellow-400 border-yellow-500/40",
  epic: "text-violet-400 border-violet-500/40",
  rare: "text-blue-400 border-blue-500/40",
  uncommon: "text-emerald-400 border-emerald-500/40",
  common: "text-zinc-400 border-zinc-500/40",
};

// ── Token gate ────────────────────────────────────────────────────────────────
function TokenGate({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="container max-w-md py-16">
      <div className="border border-border/50 bg-card/50 rounded-xl p-6 space-y-4">
        <h1 className="font-mono uppercase tracking-widest text-lg">Admin Console</h1>
        <p className="text-sm text-muted-foreground">
          Paste your admin token. Stored only in this browser.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); if (value.trim()) { setAdminToken(value.trim()); onAuthed(); } }}
          className="space-y-3"
        >
          <Input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="font-mono"
            data-testid="input-admin-token"
          />
          <Button type="submit" className="w-full" data-testid="button-admin-auth">Authenticate</Button>
        </form>
      </div>
    </div>
  );
}

// ── Image upload field (display image override only) ─────────────────────────
function ImageUploadField({
  id, value, onChange, placeholder,
}: { id: string; value: string | null; onChange: (next: string | null) => void; placeholder?: string }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const preview = resolveImageUrl(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Display image/GIF (website only)</Label>
      <div className="flex gap-3 items-start">
        <div className="h-20 w-20 rounded-md bg-muted/50 border border-border/40 overflow-hidden flex-shrink-0 flex items-center justify-center">
          {preview
            ? <img src={preview} alt="" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            : <span className="text-[10px] text-muted-foreground font-mono">no override</span>}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <label className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border/60 cursor-pointer hover:bg-muted transition-colors ${uploading ? "opacity-60 cursor-wait" : ""}`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload image/GIF"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                className="sr-only"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  try {
                    const path = await uploadImageFile(file);
                    onChange(path);
                    toast({ title: "Upload saved" });
                  } catch (err) {
                    toast({ variant: "destructive", title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error" });
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
            {value && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => onChange(null)}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit dialog (display overrides ONLY) ─────────────────────────────────────
function EditDialog({
  card, open, onOpenChange,
}: { card: AdminCard | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const update = useUpdateCardDisplay();
  const reset = useResetCardDisplay();
  const [form, setForm] = useState<DisplayOverridePatch>({});
  const [trackedId, setTrackedId] = useState<number | null>(null);

  if (card && card.id !== trackedId) {
    setTrackedId(card.id);
    const o = card.displayOverride;
    setForm({
      displayName: o?.displayName ?? null,
      displayImageUrl: o?.displayImageUrl ?? null,
      displayDescription: o?.displayDescription ?? null,
      flavorText: o?.flavorText ?? null,
      displayCategory: o?.displayCategory ?? null,
      hiddenFromSite: o?.hiddenFromSite ?? false,
      featured: o?.featured ?? false,
      sortWeight: o?.sortWeight ?? 0,
    });
  }

  if (!card) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: card.id, patch: form });
      toast({ title: "Display override saved", description: card.name });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const onReset = async () => {
    try {
      await reset.mutateAsync(card.id);
      toast({ title: "Override cleared", description: "Website now shows the Discord values for this card." });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Reset failed", description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">Edit Website Display · #{card.id}</DialogTitle>
          <DialogDescription>
            Changes apply to the website only. Discord uses the values shown in the right-hand "Discord (read-only)" panel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="d-name">Display name</Label>
              <Input id="d-name" value={form.displayName ?? ""} placeholder={card.name}
                onChange={e => setForm(s => ({ ...s, displayName: e.target.value || null }))} />
              <p className="text-xs text-muted-foreground mt-1">Blank = use Discord name "{card.name}".</p>
            </div>

            <ImageUploadField
              id="d-image"
              value={form.displayImageUrl ?? null}
              onChange={(v) => setForm(s => ({ ...s, displayImageUrl: v }))}
            />

            <div>
              <Label htmlFor="d-desc">Display description</Label>
              <Textarea id="d-desc" rows={3} value={form.displayDescription ?? ""} placeholder={card.description || "(none)"}
                onChange={e => setForm(s => ({ ...s, displayDescription: e.target.value || null }))} />
            </div>

            <div>
              <Label htmlFor="d-flavor">Flavor text (italic line on roster/events page)</Label>
              <Textarea id="d-flavor" rows={2} value={form.flavorText ?? ""} placeholder={card.flavor ?? "(none)"}
                onChange={e => setForm(s => ({ ...s, flavorText: e.target.value || null }))} />
            </div>

            <div>
              <Label htmlFor="d-category">Website category</Label>
              <Input
                id="d-category"
                value={form.displayCategory ?? ""}
                placeholder={card.effectiveRarityLabel ?? card.rarity}
                onChange={e => setForm(s => ({ ...s, displayCategory: e.target.value || null }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Website-only grouping/filter label. Does not change Discord rarity, drops, or inventory.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between border border-border/40 rounded-md p-3">
                <div>
                  <Label className="font-normal cursor-pointer">Hide from website</Label>
                  <p className="text-xs text-muted-foreground mt-1">Card stays catchable in Discord.</p>
                </div>
                <Switch checked={!!form.hiddenFromSite} onCheckedChange={v => setForm(s => ({ ...s, hiddenFromSite: v }))} />
              </div>
              <div className="flex items-center justify-between border border-border/40 rounded-md p-3">
                <div>
                  <Label className="font-normal cursor-pointer">Feature on roster</Label>
                  <p className="text-xs text-muted-foreground mt-1">Floats this card to the top.</p>
                </div>
                <Switch checked={!!form.featured} onCheckedChange={v => setForm(s => ({ ...s, featured: v }))} />
              </div>
            </div>

            <div>
              <Label htmlFor="d-sort">Sort weight</Label>
              <Input id="d-sort" type="number" value={form.sortWeight ?? 0}
                onChange={e => setForm(s => ({ ...s, sortWeight: Number(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground mt-1">Higher = appears earlier in the roster. Featured cards always come first.</p>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={onReset} disabled={reset.isPending}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Clear override
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>

          <aside className="space-y-3 text-xs">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="font-mono uppercase tracking-widest text-amber-400 mb-2">Discord (read-only)</div>
              <p className="text-muted-foreground mb-2">Change these in Discord with admin commands. The website cannot edit them.</p>
              <dl className="space-y-1 font-mono">
                <Row k="Name" v={card.name} />
                <Row k="Rarity" v={card.rarity} />
                <Row k="Type" v={card.cardType} />
                <Row k="Worth" v={`${card.worthValue.toLocaleString()} 💠`} />
                <Row k="Burn" v={`${card.burnValue.toLocaleString()} 💠`} />
                <Row k="In packs" v={card.inPacks ? "yes" : "no"} />
                <Row k="Droppable" v={card.droppable ? "yes" : "no"} />
                <Row k="Limited" v={card.isLimitedEdition ? `yes (${card.totalMinted}/${card.maxCopies ?? "∞"})` : "no"} />
                <Row k="Event" v={card.isEventExclusive ? "yes" : "no"} />
                <Row k="Archived" v={card.isArchived ? "yes" : "no"} />
              </dl>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Admin() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState<Rarity | "all">("all");
  const [editing, setEditing] = useState<AdminCard | null>(null);
  const { toast } = useToast();

  const query = useAdminCards(authed);

  if (authed && query.error instanceof ApiError && query.error.status === 401) {
    setAdminToken(null);
    setAuthed(false);
    toast({ variant: "destructive", title: "Admin token rejected", description: "Re-paste your token." });
  }

  const cards: AdminCard[] = query.data?.cards ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(c =>
      (rarityFilter === "all" || c.rarity === rarityFilter) &&
      (!q || c.name.toLowerCase().includes(q) || (c.displayOverride?.displayName ?? "").toLowerCase().includes(q)),
    );
  }, [cards, search, rarityFilter]);

  if (!authed) return <TokenGate onAuthed={() => setAuthed(true)} />;

  const logout = () => { setAdminToken(null); setAuthed(false); };
  const overrideCount = cards.filter(c => c.displayOverride).length;
  const hiddenCount = cards.filter(c => c.displayOverride?.hiddenFromSite).length;

  return (
    <div className="container max-w-screen-2xl py-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono uppercase tracking-widest">Admin · Website Display</h1>
          <p className="text-sm text-muted-foreground font-mono uppercase tracking-wide mt-1">
            {cards.length} cards · {overrideCount} with overrides · {hiddenCount} hidden from site
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4 mr-1" /> Sign out
        </Button>
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <strong className="text-amber-400 font-mono uppercase tracking-widest text-xs">Presentation-only</strong>
        <p className="text-muted-foreground mt-1">
          This page edits website display: name, image, description, flavor, visibility, ordering.
          To change gameplay values (rarity, worth, burn, spawn percentage source, pack availability, etc.) use the Discord admin commands.
          The website never modifies gameplay data.
        </p>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center bg-card/50 p-4 rounded-xl border border-border/50">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="text" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 font-mono text-sm" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono uppercase text-muted-foreground mr-1">Rarity:</span>
          {(["all", ...RARITIES] as const).map((r) => {
            const active = rarityFilter === r;
            return (
              <button key={r} type="button" aria-pressed={active} onClick={() => setRarityFilter(r)}
                className={`px-3 py-1 rounded-md border text-xs font-mono uppercase tracking-widest transition-all ${
                  active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                }`}>
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {query.isLoading && <div className="text-center py-12 text-muted-foreground">Loading cards…</div>}
      {query.error && !(query.error instanceof ApiError && query.error.status === 401) && (
        <div className="text-center py-12 text-destructive">
          Failed to load: {query.error instanceof Error ? query.error.message : "Unknown error"}
        </div>
      )}
      {!query.isLoading && !query.error && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No cards match.</div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden bg-card/40">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase font-mono tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Card (Discord name)</th>
                  <th className="text-left p-3">Display name (website)</th>
                  <th className="text-left p-3">Rarity</th>
                  <th className="text-left p-3">Website status</th>
                  <th className="text-right p-3">Sort</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const o = c.displayOverride;
                  const displayName = o?.displayName ?? c.name;
                  const hasOverride = !!o && (o.displayName || o.displayImageUrl || o.displayDescription || o.flavorText || o.hiddenFromSite || o.featured || o.sortWeight !== 0);
                  const overrideImg = o?.displayImageUrl ?? null;
                  const srcImg = resolveImageUrl(overrideImg ?? c.imageUrl);
                  return (
                    <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20">
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-md bg-muted/50 border border-border/40 overflow-hidden flex-shrink-0">
                            {srcImg && <img src={srcImg} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                          </div>
                          <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">#{c.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        {o?.displayName ? <span className="font-medium">{displayName}</span> : <span className="text-muted-foreground italic">— (uses Discord name)</span>}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`uppercase font-mono text-xs ${RARITY_COLOR[c.rarity]}`}>{c.rarity}</Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {o?.hiddenFromSite && <Badge variant="outline" className="text-xs text-rose-400 border-rose-500/40"><EyeOff className="h-3 w-3 mr-1" />hidden</Badge>}
                          {o?.featured && <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-500/40"><Star className="h-3 w-3 mr-1" />featured</Badge>}
                          {!hasOverride && <span className="text-xs text-muted-foreground"><Eye className="h-3 w-3 inline mr-1" />default</span>}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono">{o?.sortWeight ?? 0}</td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          <Pencil className="h-4 w-4 mr-1" /> Edit display
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EditDialog card={editing} open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} />
    </div>
  );
}
