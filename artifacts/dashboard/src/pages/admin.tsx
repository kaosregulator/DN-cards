import { useMemo, useState } from "react";
import {
  useAdminCards,
  useCreateCard,
  useUpdateCard,
  useDuplicateCard,
  useDeleteCard,
  type Card,
  type CardPatch,
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Pencil, Copy, Archive, ArchiveRestore, Trash2, Power, PowerOff, Search, LogOut, Plus,
  Upload, Loader2,
} from "lucide-react";

const RARITIES: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
const RARITY_COLOR: Record<Rarity, string> = {
  legendary: "text-yellow-400 border-yellow-500/40",
  epic: "text-violet-400 border-violet-500/40",
  rare: "text-blue-400 border-blue-500/40",
  uncommon: "text-emerald-400 border-emerald-500/40",
  common: "text-zinc-400 border-zinc-500/40",
};

// Mirrors RARITY_COLORS in bot/cards-data.ts so the preview matches Discord embeds.
const RARITY_EMBED_HEX: Record<Rarity, string> = {
  legendary: "#f1c40f",
  epic: "#9b59b6",
  rare: "#3498db",
  uncommon: "#2ecc71",
  common: "#95a5a6",
};
const RARITY_EMOJI: Record<Rarity, string> = {
  legendary: "🟡", epic: "🟣", rare: "🔵", uncommon: "🟢", common: "⚪",
};

// ── Upload field (shared by Edit and Create dialogs) ─────────────────────────
function ImageUploadField({
  id, value, onChange, testidPrefix,
}: { id: string; value: string | null; onChange: (next: string | null) => void; testidPrefix: string }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const preview = resolveImageUrl(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Image</Label>
      <div className="flex gap-3 items-start">
        <div className="h-20 w-20 rounded-md bg-muted/50 border border-border/40 overflow-hidden flex-shrink-0 flex items-center justify-center">
          {preview
            ? <img src={preview} alt="" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            : <span className="text-[10px] text-muted-foreground font-mono">no image</span>}
        </div>
        <div className="flex-1 space-y-2">
          <Input
            id={id}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="https://... or upload below"
            data-testid={`${testidPrefix}-url`}
          />
          <div className="flex items-center gap-2">
            <label className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border/60 cursor-pointer hover:bg-muted transition-colors ${uploading ? "opacity-60 cursor-wait" : ""}`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploading}
                data-testid={`${testidPrefix}-file`}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  try {
                    const path = await uploadImageFile(file);
                    onChange(path);
                    toast({ title: "Image uploaded" });
                  } catch (err) {
                    toast({ variant: "destructive", title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error" });
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
            {value && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => onChange(null)} data-testid={`${testidPrefix}-clear`}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Discord-style card preview ────────────────────────────────────────────────
function CardPreview({
  name, rarity, description, imageUrl, worthValue, burnValue, dropWeight,
  isLimitedEdition, isEventExclusive, maxCopies,
}: {
  name?: string; rarity?: Rarity; description?: string; imageUrl?: string | null;
  worthValue?: number; burnValue?: number; dropWeight?: number;
  isLimitedEdition?: boolean; isEventExclusive?: boolean; maxCopies?: number | null;
}) {
  const r: Rarity = rarity ?? "common";
  const hex = RARITY_EMBED_HEX[r];
  const preview = resolveImageUrl(imageUrl);
  return (
    <div className="rounded-md overflow-hidden border border-border/40 bg-[#2b2d31] text-[#dbdee1] text-sm" style={{ borderLeftColor: hex, borderLeftWidth: 4 }}>
      <div className="p-3 space-y-2">
        <div className="text-xs text-[#b5bac1] font-mono uppercase tracking-wider">DN Cards Bot</div>
        <div className="text-base font-semibold text-white flex items-center gap-2">
          <span>{RARITY_EMOJI[r]}</span>
          <span>{name?.trim() || "Untitled card"}</span>
          <span className="text-xs font-mono uppercase px-1.5 py-0.5 rounded border border-white/10 text-[#b5bac1]">{r}</span>
        </div>
        {description?.trim() && <div className="text-sm text-[#dbdee1] whitespace-pre-wrap">{description.trim()}</div>}
        {(isLimitedEdition || isEventExclusive) && (
          <div className="flex flex-wrap gap-1">
            {isEventExclusive && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-300 border border-pink-500/30">Event Exclusive</span>}
            {isLimitedEdition && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">Limited {maxCopies ? `· max ${maxCopies}` : ""}</span>}
          </div>
        )}
        {preview && (
          <div className="rounded overflow-hidden bg-black/30">
            <img src={preview} alt="" className="w-full max-h-72 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <PreviewStat label="Worth" value={`💠 ${(worthValue ?? 0).toLocaleString()}`} />
          <PreviewStat label="Burn" value={`💠 ${(burnValue ?? 0).toLocaleString()}`} />
          <PreviewStat label="Pull Weight" value={`${dropWeight ?? 0}`} />
        </div>
        <div className="text-[10px] text-[#949ba4] pt-1">Type the card's name to catch it</div>
      </div>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/20 rounded px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-[#949ba4]">{label}</div>
      <div className="text-sm font-mono text-white">{value}</div>
    </div>
  );
}

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
      cardType: card.cardType,
      burnValue: card.burnValue,
      worthValue: card.worthValue,
      dropWeight: card.dropWeight,
      imageUrl: card.imageUrl,
      description: card.description,
      maxCopies: card.maxCopies,
      isEventExclusive: card.isEventExclusive,
      isLimitedEdition: card.isLimitedEdition,
      inPacks: card.inPacks,
      flavor: card.flavor,
      podiumPlace: card.podiumPlace,
      previewAnimation: card.previewAnimation,
      previewBgColor: card.previewBgColor,
      displayOrientation: card.displayOrientation,
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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">Edit Card #{card.id}</DialogTitle>
          <DialogDescription>Changes apply immediately to the dashboard, roster, packs, and future pulls.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
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
            <Label htmlFor="f-ctype">Type label</Label>
            <Input id="f-ctype" value={form.cardType ?? card.cardType} onChange={e => setForm(s => ({ ...s, cardType: e.target.value }))} data-testid="input-edit-cardtype" />
            <p className="text-xs text-muted-foreground mt-1">Free text — e.g. vehicle, aircraft, boss, car, mech...</p>
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
            <ImageUploadField
              id="f-image"
              value={form.imageUrl ?? null}
              onChange={(v) => setForm(s => ({ ...s, imageUrl: v }))}
              testidPrefix="edit-image"
            />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="f-desc">Description</Label>
            <Textarea id="f-desc" rows={3} value={form.description ?? ""} onChange={e => setForm(s => ({ ...s, description: e.target.value }))} data-testid="input-edit-desc" />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="f-flavor">Flavor text <span className="text-xs text-muted-foreground font-mono ml-1">(shown in italics on the Events page)</span></Label>
            <Textarea id="f-flavor" rows={2} placeholder='e.g. "Awarded during DN Anniversary, May 2026"' value={form.flavor ?? ""} onChange={e => setForm(s => ({ ...s, flavor: e.target.value || null }))} data-testid="input-edit-flavor" />
          </div>

          <div className="md:col-span-2 rounded-lg border border-border/60 bg-card/40 p-4 space-y-4">
            <div className="flex items-center gap-2 -mb-1">
              <span className="text-xs font-mono uppercase tracking-widest text-purple-400">Card preview customization</span>
              <span className="text-[10px] text-muted-foreground">Plays when this card is opened anywhere in the dashboard.</span>
            </div>

            {form.isEventExclusive && (
              <div>
                <Label htmlFor="f-podium">Podium placement <span className="text-[10px] text-muted-foreground">(events page only)</span></Label>
                <Select
                  value={form.podiumPlace == null ? "none" : String(form.podiumPlace)}
                  onValueChange={v => setForm(s => ({ ...s, podiumPlace: v === "none" ? null : Number(v) as 1 | 2 | 3 }))}
                >
                  <SelectTrigger id="f-podium" data-testid="select-edit-podium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">In the grid (default)</SelectItem>
                    <SelectItem value="1">🥇 1st place podium</SelectItem>
                    <SelectItem value="2">🥈 2nd place podium</SelectItem>
                    <SelectItem value="3">🥉 3rd place podium</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Only one card per slot — assigning here frees it from any other card.</p>
              </div>
            )}

            <div>
                  <Label htmlFor="f-anim">Preview animation</Label>
                  <Select
                    value={form.previewAnimation ?? "spin"}
                    onValueChange={v => setForm(s => ({ ...s, previewAnimation: v as "spin" | "bounce" | "flip" | "pulse" | "none" }))}
                  >
                    <SelectTrigger id="f-anim" data-testid="select-edit-preview-anim"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="spin">🔄 Spin (default)</SelectItem>
                      <SelectItem value="flip">🔃 Flip</SelectItem>
                      <SelectItem value="bounce">⤵️ Bounce in</SelectItem>
                      <SelectItem value="pulse">💥 Pulse</SelectItem>
                      <SelectItem value="none">— None (fade only)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Plays when this card's detail dialog opens anywhere in the dashboard.</p>
                </div>

                <div>
                  <Label htmlFor="f-bg">Preview background color</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="f-bg"
                      type="color"
                      className="h-10 w-14 p-1 cursor-pointer"
                      value={(form.previewBgColor && /^#[0-9a-fA-F]{6}$/.test(form.previewBgColor)) ? form.previewBgColor : "#1a1a1a"}
                      onChange={e => setForm(s => ({ ...s, previewBgColor: e.target.value }))}
                      data-testid="input-edit-preview-bg-color"
                    />
                    <Input
                      placeholder="#1a1a1a or leave blank for rarity tint"
                      value={form.previewBgColor ?? ""}
                      onChange={e => setForm(s => ({ ...s, previewBgColor: e.target.value || null }))}
                      data-testid="input-edit-preview-bg-text"
                    />
                    {form.previewBgColor && (
                      <button
                        type="button"
                        className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground px-2"
                        onClick={() => setForm(s => ({ ...s, previewBgColor: null }))}
                      >
                        clear
                      </button>
                    )}
                  </div>
              <p className="text-xs text-muted-foreground mt-1">Blank uses the card's rarity-tinted glow.</p>
            </div>

            <div>
              <Label htmlFor="f-orient">Image orientation</Label>
              <Select
                value={form.displayOrientation ?? "portrait"}
                onValueChange={v => setForm(s => ({ ...s, displayOrientation: v as "portrait" | "landscape" }))}
              >
                <SelectTrigger id="f-orient" data-testid="select-edit-orientation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">📱 Portrait (default — taller than wide)</SelectItem>
                  <SelectItem value="landscape">🖼️ Landscape (wider than tall — e.g. Boss Sea Tank)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Landscape switches the detail dialog to a 4:3 frame and shows the full image without cropping.</p>
            </div>
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
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Live preview</div>
          <CardPreview
            name={form.name ?? card.name}
            rarity={form.rarity ?? card.rarity}
            description={form.description ?? card.description}
            imageUrl={form.imageUrl ?? card.imageUrl}
            worthValue={form.worthValue ?? card.worthValue}
            burnValue={form.burnValue ?? card.burnValue}
            dropWeight={form.dropWeight ?? card.dropWeight}
            isLimitedEdition={form.isLimitedEdition ?? card.isLimitedEdition}
            isEventExclusive={form.isEventExclusive ?? card.isEventExclusive}
            maxCopies={form.maxCopies ?? card.maxCopies}
          />
        </div>
        </div>
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
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const query = useAdminCards(authed);
  const update = useUpdateCard();
  const duplicate = useDuplicateCard();
  const del = useDeleteCard();

  // 401 → token is bad, drop it and re-show gate
  if (authed && query.error instanceof ApiError && query.error.status === 401) {
    setAdminToken(null);
    setAuthed(false);
    toast({
      variant: "destructive",
      title: "Admin token rejected",
      description: "Re-paste your token. Make sure there are no extra spaces, line breaks, or quotes around it.",
    });
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
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreating(true)} data-testid="button-new-card">
            <Plus className="h-4 w-4 mr-1" /> New card
          </Button>
          <Button variant="outline" size="sm" onClick={logout} data-testid="button-admin-logout">
            <LogOut className="h-4 w-4 mr-1" /> Sign out
          </Button>
        </div>
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
                          {(() => {
                            const src = resolveImageUrl(c.imageUrl);
                            return src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null;
                          })()}
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
      <CreateDialog open={creating} onOpenChange={setCreating} />

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

// ── Create dialog ─────────────────────────────────────────────────────────────
function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateCard();
  const blank = {
    name: "",
    rarity: "common" as Rarity,
    cardType: "vehicle",
    description: "",
    dropWeight: 60,
    worthValue: 10,
    burnValue: 5,
    imageUrl: "",
    maxCopies: null as number | null,
    isEventExclusive: false,
    isLimitedEdition: false,
    inPacks: true,
  };
  const [form, setForm] = useState(blank);
  const [openTracked, setOpenTracked] = useState(false);
  if (open !== openTracked) { setOpenTracked(open); if (open) setForm(blank); }

  const num = (v: string) => v === "" ? 0 : Number(v);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        rarity: form.rarity,
        cardType: (form.cardType || "vehicle").trim(),
        description: form.description,
        dropWeight: form.dropWeight,
        worthValue: form.worthValue,
        burnValue: form.burnValue,
        imageUrl: form.imageUrl.trim() || null,
        maxCopies: form.isLimitedEdition ? form.maxCopies : null,
        isEventExclusive: form.isEventExclusive,
        isLimitedEdition: form.isLimitedEdition,
        inPacks: form.inPacks,
      });
      toast({ title: "Card created", description: form.name.trim() });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Create failed", description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">New Card</DialogTitle>
          <DialogDescription>Once saved it joins the roster immediately and becomes catchable.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="n-name">Name</Label>
            <Input id="n-name" autoFocus value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} data-testid="input-new-name" />
          </div>

          <div>
            <Label htmlFor="n-rarity">Rarity</Label>
            <Select value={form.rarity} onValueChange={v => setForm(s => ({ ...s, rarity: v as Rarity }))}>
              <SelectTrigger id="n-rarity" data-testid="select-new-rarity"><SelectValue /></SelectTrigger>
              <SelectContent>{RARITIES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="n-ctype">Type label</Label>
            <Input id="n-ctype" value={form.cardType ?? "vehicle"} onChange={e => setForm(s => ({ ...s, cardType: e.target.value }))} data-testid="input-new-cardtype" />
            <p className="text-xs text-muted-foreground mt-1">Free text — e.g. vehicle, aircraft, boss, car, mech...</p>
          </div>

          <div>
            <Label htmlFor="n-pull">Pull Rate</Label>
            <Input id="n-pull" type="number" step="0.1" min={0} value={form.dropWeight} onChange={e => setForm(s => ({ ...s, dropWeight: num(e.target.value) }))} data-testid="input-new-pullrate" />
          </div>

          <div>
            <Label htmlFor="n-worth">Worth</Label>
            <Input id="n-worth" type="number" min={0} value={form.worthValue} onChange={e => setForm(s => ({ ...s, worthValue: num(e.target.value) }))} data-testid="input-new-worth" />
          </div>

          <div>
            <Label htmlFor="n-burn">Burn Value</Label>
            <Input id="n-burn" type="number" min={0} value={form.burnValue} onChange={e => setForm(s => ({ ...s, burnValue: num(e.target.value) }))} data-testid="input-new-burn" />
          </div>

          <div className="md:col-span-2">
            <ImageUploadField
              id="n-image"
              value={form.imageUrl || null}
              onChange={(v) => setForm(s => ({ ...s, imageUrl: v ?? "" }))}
              testidPrefix="new-image"
            />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="n-desc">Description</Label>
            <Textarea id="n-desc" rows={3} value={form.description} onChange={e => setForm(s => ({ ...s, description: e.target.value }))} data-testid="input-new-desc" />
          </div>

          {form.isLimitedEdition && (
            <div>
              <Label htmlFor="n-qty">Max copies</Label>
              <Input
                id="n-qty"
                type="number"
                min={1}
                placeholder="e.g. 100"
                value={form.maxCopies ?? ""}
                onChange={e => setForm(s => ({ ...s, maxCopies: e.target.value === "" ? null : Number(e.target.value) }))}
                data-testid="input-new-qty"
              />
            </div>
          )}

          <div className={`space-y-3 border border-border/40 rounded-md p-3 ${form.isLimitedEdition ? "" : "md:col-span-2"}`}>
            <ToggleRow label="Event Exclusive" checked={form.isEventExclusive} onChange={v => setForm(s => ({ ...s, isEventExclusive: v }))} testid="toggle-new-event" />
            <ToggleRow label="Limited Edition" checked={form.isLimitedEdition} onChange={v => setForm(s => ({ ...s, isLimitedEdition: v, maxCopies: v ? (s.maxCopies ?? 100) : null }))} testid="toggle-new-limited" />
            <ToggleRow label="Available in Packs" checked={form.inPacks} onChange={v => setForm(s => ({ ...s, inPacks: v }))} testid="toggle-new-packs" />
          </div>

          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending} data-testid="button-new-save">
              {create.isPending ? "Creating…" : "Create card"}
            </Button>
          </DialogFooter>
        </form>
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Live preview</div>
          <CardPreview
            name={form.name}
            rarity={form.rarity}
            description={form.description}
            imageUrl={form.imageUrl || null}
            worthValue={form.worthValue}
            burnValue={form.burnValue}
            dropWeight={form.dropWeight}
            isLimitedEdition={form.isLimitedEdition}
            isEventExclusive={form.isEventExclusive}
            maxCopies={form.maxCopies}
          />
        </div>
        </div>
      </DialogContent>
    </Dialog>
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
