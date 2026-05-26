import { useState } from "react";
import { getAdminToken, setAdminToken, ApiError } from "@/lib/api";
import {
  useAdminSuggestions, useUpdateSuggestion,
  type Suggestion, type SuggestionStatus,
} from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { LogOut, ChevronDown, ChevronRight } from "lucide-react";

const STATUSES: SuggestionStatus[] = ["new", "in_review", "planned", "resolved", "rejected", "duplicate"];
const STATUS_BADGE: Record<SuggestionStatus, string> = {
  new: "border-sky-500/40 text-sky-400",
  in_review: "border-amber-500/40 text-amber-400",
  planned: "border-violet-500/40 text-violet-400",
  resolved: "border-emerald-500/40 text-emerald-400",
  rejected: "border-rose-500/40 text-rose-400",
  duplicate: "border-zinc-500/40 text-zinc-400",
};
const CATEGORY_LABEL: Record<string, string> = {
  bug_report: "Bug",
  card_correction: "Card fix",
  card_suggestion: "Card idea",
  event_suggestion: "Event idea",
  website_feedback: "Site feedback",
};

function TokenGate({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="container max-w-md py-16">
      <div className="border border-border/50 bg-card/50 rounded-xl p-6 space-y-4">
        <h1 className="font-mono uppercase tracking-widest text-lg">Suggestions Admin</h1>
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) { setAdminToken(value.trim()); onAuthed(); } }} className="space-y-3">
          <Input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="ADMIN_TOKEN" className="font-mono" />
          <Button type="submit" className="w-full">Authenticate</Button>
        </form>
      </div>
    </div>
  );
}

function Row({ s }: { s: Suggestion }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(s.adminNotes);
  const [status, setStatus] = useState<SuggestionStatus>(s.status);
  const update = useUpdateSuggestion();
  const { toast } = useToast();

  return (
    <li className="border-t border-border/40">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left p-3 hover:bg-muted/20 flex items-center gap-3">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Badge variant="outline" className={`text-xs ${STATUS_BADGE[s.status]}`}>{s.status}</Badge>
        <Badge variant="outline" className="text-xs">{CATEGORY_LABEL[s.category] ?? s.category}</Badge>
        <span className="font-medium truncate flex-1">{s.title}</span>
        <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
          {new Date(s.createdAt).toLocaleDateString()}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-11 space-y-3">
          <div className="text-xs text-muted-foreground font-mono">
            {s.anonymous ? "Anonymous" : (s.submitterDiscordUsername ?? "—")} · #{s.id} · {new Date(s.createdAt).toLocaleString()}
          </div>
          <div className="text-sm whitespace-pre-wrap bg-muted/20 p-3 rounded-md border border-border/40">{s.body}</div>
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3">
            <div>
              <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as SuggestionStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Admin notes</label>
              <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" disabled={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({ id: s.id, patch: { status, adminNotes: notes } });
                  toast({ title: "Updated" });
                } catch (err) {
                  toast({ variant: "destructive", title: "Update failed", description: err instanceof Error ? err.message : "Unknown error" });
                }
              }}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function SuggestionsAdmin() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | "all">("all");
  const { toast } = useToast();
  const query = useAdminSuggestions(authed, statusFilter === "all" ? undefined : statusFilter);

  if (authed && query.error instanceof ApiError && query.error.status === 401) {
    setAdminToken(null);
    setAuthed(false);
    toast({ variant: "destructive", title: "Token rejected" });
  }
  if (!authed) return <TokenGate onAuthed={() => setAuthed(true)} />;

  const items = query.data?.suggestions ?? [];

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono uppercase tracking-widest">Suggestions Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">{items.length} item{items.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SuggestionStatus | "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => { setAdminToken(null); setAuthed(false); }}>
            <LogOut className="h-4 w-4 mr-1" /> Sign out
          </Button>
        </div>
      </div>

      {query.isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}
      {!query.isLoading && items.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No submissions{statusFilter === "all" ? " yet" : ` with status "${statusFilter}"`}.</div>
      )}

      {items.length > 0 && (
        <ul className="rounded-xl border border-border/50 overflow-hidden bg-card/40">
          {items.map(s => <Row key={s.id} s={s} />)}
        </ul>
      )}
    </div>
  );
}
