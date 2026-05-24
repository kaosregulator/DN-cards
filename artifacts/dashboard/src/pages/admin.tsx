import { useMemo, useState } from "react";
import {
  useAdminCards,
  useUpdateCard,
  useDuplicateCard,
  useDeleteCard,
  type Card,
  type CardPatch,
  type Rarity,
} from "@/hooks/queries";
import { getAdminToken, setAdminToken, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Pencil, Copy, Archive, ArchiveRestore, Trash2, Power, PowerOff, Search, LogOut,
} from "lucide-react";

const RARITIES: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
const RARITY_COLOR: Record<Rarity, string> = {
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
        <div>
          <h1 className="font-mono uppercase tracking-widest text-lg">Admin Console</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paste your admin token to manage cards. It's stored only in this browser.
          </p>
        </div>
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
          <Button type="submit" className="w-full" data-testid="button-admin-auth">
            Authenticate
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────
function EditDialog({
  card, open, onOpenChange,
}: { card: Card | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const update = useUpdateCard();
  const [form, setForm] = useState<CardPatch>({});

  // reset when a different card opens
  const [trackedId, setTrackedId] = useState<number | null>(null);
  if (card && card.id !== trackedId) {
    setTrackedId(card.id);
    setForm({
      name: card.name,
      rarity: card.rarity,
      burnValue: card.burnValue,
      worthValue: card.worthValue,
      dropWeight: card.dropWeight,
      imageUrl: card.imageUrl,
      description: card.description,
      maxCopies: card.maxCopies,
      isEventExclusive: card.isEventExclusive,
      isLimitedEdition: card.isLimitedEdition,
      inPacks: card.inPacks,
    });
  }

  if (!card) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: card.id, patch: form });
      toast({ title: "Card updated", description: card.name });
      onOpenChange(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const num = (v: string) => v === "" ? undefined : Number(v);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">Edit Card #{card.id}</DialogTitle>
          <DialogDescription>Changes apply immediately to the dashboard, roster, packs, and future pulls.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="f-name">Name</Label>
            <Input id="f-name" value={form.name ?? ""} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} data-testid="input-edit-name" />
          </div>

          <div>
            <Label htmlFor="f-rarity">Rarity</Label>
            <Select value={form.rarity} onValueChange={v => setForm(s => ({ ...s, rarity: v as Rarity }))}>
              <SelectTrigger id="f-rarity" data-testid="select-edit-rarity"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RARITIES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="f-pull">Pull Rate (drop weight)</Label>
            <Input id="f-pull" type="number" step="0.1" min={0} value={form.dropWeight ?? ""} onChange={e => setForm(s => ({ ...s, dropWeight: num(e.target.value) }))} data-testid="input-edit-pullrate" />
          </div>

          <div>
            <Label htmlFor="f-worth">Worth</Label>
            <Input id="f-worth" type="number" min={0} value={form.worthValue ?? ""} onChange={e => setForm(s => ({ ...s, worthValue: num(e.target.value) }))} data-testid="input-edit-worth" />
          </div>

          <div>
            <Label htmlFor="f-burn">Burn Value</Label>
            <Input id="f-burn" type="number" min={0} value={form.burnValue ?? ""} onChange={e => setForm(s => ({ ...s, burnValue: num(e.target.value) }))} data-testid="input-edit-burn" />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="f-image">Image URL</Label>
            <Input id="f-image" value={form.imageUrl ?? ""} onChange={e => setForm(s => ({ ...s, imageUrl: e.target.value || null }))} placeholder="https://..." data-testid="input-edit-image" />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="f-desc">Description</Label>
            <Textarea id="f-desc" rows={3} value={form.description ?? ""} onChange={e => setForm(s => ({ ...s, description: e.target.value }))} data-testid="input-edit-desc" />
          </div>

          <div>
            <Label htmlFor="f-qty">Quantity (max copies)</Label>
            <Input
              id="f-qty"
              type="number"
              min={1}
              placeholder="unlimited"
              value={form.maxCopies ?? ""}
              onChange={e => setForm(s => ({ ...s, maxCopies: e.target.value === "" ? null : Number(e.target.value) }))}
              data-testid="input-edit-qty"
            />
            <p className="text-xs text-muted-foreground mt-1">Leave blank for unlimited. Currently minted: {card.totalMinted}.</p>
          </div>

          <div className="space-y-3 border border-border/40 rounded-md p-3">
            <ToggleRow label="Event Exclusive" checked={!!form.isEventExclusive} onChange={v => setForm(s => ({ ...s, isEventExclusive: v }))} testid="toggle-edit-event" />
            <ToggleRow label="Limited Edition" checked={!!form.isLimitedEdition} onChange={v => setForm(s => ({ ...s, isLimitedEdition: v }))} testid="toggle-edit-limited" />
            <ToggleRow label="Available in Packs" checked={form.inPacks !== false} onChange={v => setForm(s => ({ ...s, inPacks: v }))} testid="toggle-edit-packs" />
          </div>

          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={update.isPending} data-testid="button-edit-save">
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, checked, onChange, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="font-normal cursor-pointer">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testid} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Admin() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState<Rarity | "all">("all");
  const [editing, setEditing] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState<Card | null>(null);
  const { toast } = useToast();

  const query = useAdminCards(authed);
  const update = useUpdateCard();
  const duplicate = useDuplicateCard();
  const del = useDeleteCard();

  // 401 → token is bad, drop it and re-show gate
  if (authed && query.error instanceof ApiError && query.error.status === 401) {
    setAdminToken(null);
    setAuthed(false);
  }

  const cards = query.data?.cards ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(c =>
      (rarityFilter === "all" || c.rarity === rarityFilter) &&
      (!q || c.name.toLowerCase().includes(q)),
    );
  }, [cards, search, rarityFilter]);

  if (!authed) return <TokenGate onAuthed={() => setAuthed(true)} />;

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); toast({ title: label }); }
    catch (err) {
      toast({
        variant: "destructive",
        title: `${label} failed`,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const logout = () => { setAdminToken(null); setAuthed(false); };

  return (
    <div className="container max-w-screen-2xl py-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono uppercase tracking-widest">Admin · Card Manager</h1>
          <p className="text-sm text-muted-foreground font-mono uppercase tracking-wide mt-1">
            {cards.length} cards · {cards.filter(c => c.isArchived).length} archived · {cards.filter(c => !c.droppable && !c.isArchived).length} deactivated
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={logout} data-testid="button-admin-logout">
          <LogOut className="h-4 w-4 mr-1" /> Sign out
        </Button>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center bg-card/50 p-4 rounded-xl border border-border/50">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 font-mono text-sm"
            data-testid="input-admin-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono uppercase text-muted-foreground mr-1">Rarity:</span>
          {(["all", ...RARITIES] as const).map((r) => {
            const active = rarityFilter === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={active}
                onClick={() => setRarityFilter(r)}
                className={`px-3 py-1 rounded-md border text-xs font-mono uppercase tracking-widest transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                }`}
                data-testid={`filter-admin-${r}`}
              >
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
                  <th className="text-left p-3">Card</th>
                  <th className="text-left p-3">Rarity</th>
                  <th className="text-right p-3">Worth</th>
                  <th className="text-right p-3">Burn</th>
                  <th className="text-right p-3">Pull</th>
                  <th className="text-right p-3">Minted</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20" data-testid={`row-card-${c.id}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-md bg-muted/50 border border-border/40 overflow-hidden flex-shrink-0">
                          {c.imageUrl
                            ? <img src={c.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            : null}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">#{c.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={`uppercase font-mono text-xs ${RARITY_COLOR[c.rarity]}`}>{c.rarity}</Badge>
                    </td>
                    <td className="p-3 text-right font-mono">{c.worthValue.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{c.burnValue.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{c.dropWeight}</td>
                    <td className="p-3 text-right font-mono text-muted-foreground">
                      {c.totalMinted}{c.maxCopies != null ? `/${c.maxCopies}` : ""}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {c.isArchived && <Badge variant="outline" className="text-xs">archived</Badge>}
                        {!c.droppable && !c.isArchived && <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/40">paused</Badge>}
                        {c.isEventExclusive && <Badge variant="outline" className="text-xs text-pink-400 border-pink-500/40">event</Badge>}
                        {c.isLimitedEdition && <Badge variant="outline" className="text-xs text-cyan-400 border-cyan-500/40">limited</Badge>}
                        {!c.inPacks && !c.isArchived && <Badge variant="outline" className="text-xs text-muted-foreground">no-packs</Badge>}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn title="Edit" onClick={() => setEditing(c)} testid={`btn-edit-${c.id}`}><Pencil className="h-4 w-4" /></IconBtn>
                        <IconBtn title="Duplicate" onClick={() => runAction(`Duplicated "${c.name}"`, () => duplicate.mutateAsync(c.id))} disabled={duplicate.isPending} testid={`btn-dup-${c.id}`}>
                          <Copy className="h-4 w-4" />
                        </IconBtn>
                        {c.droppable
                          ? <IconBtn title="Deactivate (pause spawns/packs)" onClick={() => runAction(`Deactivated "${c.name}"`, () => update.mutateAsync({ id: c.id, patch: { droppable: false } }))} testid={`btn-deact-${c.id}`}><PowerOff className="h-4 w-4" /></IconBtn>
                          : <IconBtn title="Activate" onClick={() => runAction(`Activated "${c.name}"`, () => update.mutateAsync({ id: c.id, patch: { droppable: true } }))} testid={`btn-act-${c.id}`}><Power className="h-4 w-4" /></IconBtn>
                        }
                        {c.isArchived
                          ? <IconBtn title="Unarchive" onClick={() => runAction(`Restored "${c.name}"`, () => update.mutateAsync({ id: c.id, patch: { isArchived: false } }))} testid={`btn-unarch-${c.id}`}><ArchiveRestore className="h-4 w-4" /></IconBtn>
                          : <IconBtn title="Archive" onClick={() => runAction(`Archived "${c.name}"`, () => update.mutateAsync({ id: c.id, patch: { isArchived: true } }))} testid={`btn-arch-${c.id}`}><Archive className="h-4 w-4" /></IconBtn>
                        }
                        <IconBtn title="Delete" danger onClick={() => setDeleting(c)} testid={`btn-del-${c.id}`}><Trash2 className="h-4 w-4" /></IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EditDialog card={editing} open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Hard-deletes the card from the database. If it has ever been minted, the server will refuse — archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
              onClick={async () => {
                if (!deleting) return;
                const name = deleting.name;
                setDeleting(null);
                await runAction(`Deleted "${name}"`, () => del.mutateAsync(deleting.id));
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger, testid }: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`p-2 rounded-md border border-border/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${
        danger ? "text-destructive hover:bg-destructive/10 hover:border-destructive/40" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
