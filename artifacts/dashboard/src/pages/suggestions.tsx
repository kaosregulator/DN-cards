import { useState } from "react";
import { useSubmitSuggestion, type SuggestionCategory } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquarePlus, CheckCircle2 } from "lucide-react";

const CATEGORIES: { value: SuggestionCategory; label: string; hint: string }[] = [
  { value: "bug_report",        label: "Bug report",        hint: "Something broken or unexpected on the site or the bot." },
  { value: "card_correction",   label: "Card correction",   hint: "Typo, wrong image, wrong stats on an existing card." },
  { value: "card_suggestion",   label: "New card idea",     hint: "Suggest a new card for the collection." },
  { value: "event_suggestion",  label: "Event idea",        hint: "Suggest a community event or limited-time drop." },
  { value: "website_feedback",  label: "Website feedback",  hint: "UX, navigation, missing features." },
];

export default function Suggestions() {
  const submit = useSubmitSuggestion();
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    category: "bug_report" as SuggestionCategory,
    title: "",
    body: "",
    anonymous: true,
    submitterDiscordUsername: "",
    website: "", // honeypot
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.website) return; // bot
    if (form.title.trim().length < 4) { toast({ variant: "destructive", title: "Title too short" }); return; }
    if (form.body.trim().length < 20) { toast({ variant: "destructive", title: "Please describe with at least 20 characters" }); return; }
    try {
      await submit.mutateAsync({
        category: form.category,
        title: form.title.trim(),
        body: form.body.trim(),
        anonymous: form.anonymous,
        submitterDiscordUsername: form.anonymous ? null : (form.submitterDiscordUsername.trim() || null),
        website: form.website,
      });
      setDone(true);
    } catch (err) {
      toast({ variant: "destructive", title: "Submit failed", description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  if (done) {
    return (
      <div className="container max-w-xl py-20 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
        <h1 className="text-3xl font-bold uppercase tracking-tight">Thanks!</h1>
        <p className="text-muted-foreground">Your submission has been queued for the team.</p>
        <Button variant="outline" onClick={() => { setDone(false); setForm({ ...form, title: "", body: "" }); }}>Submit another</Button>
      </div>
    );
  }

  const category = CATEGORIES.find(c => c.value === form.category)!;

  return (
    <div className="container max-w-2xl py-12 px-4">
      <div className="flex items-center gap-3 mb-2">
        <MessageSquarePlus className="h-7 w-7 text-primary" />
        <h1 className="text-4xl font-black uppercase tracking-tight">Suggestions & Bugs</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Tell us what's broken, what's wrong on a card, or what you'd like to see. Submissions are queued for admin review.
      </p>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label htmlFor="s-cat">Category</Label>
          <Select value={form.category} onValueChange={v => setForm(s => ({ ...s, category: v as SuggestionCategory }))}>
            <SelectTrigger id="s-cat"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">{category.hint}</p>
        </div>

        <div>
          <Label htmlFor="s-title">Title</Label>
          <Input id="s-title" value={form.title} maxLength={160}
            onChange={e => setForm(s => ({ ...s, title: e.target.value }))} placeholder="Short, descriptive" />
        </div>

        <div>
          <Label htmlFor="s-body">Details</Label>
          <Textarea id="s-body" rows={8} value={form.body} maxLength={4000}
            onChange={e => setForm(s => ({ ...s, body: e.target.value }))} placeholder="What happened, what you expected, steps to reproduce…" />
          <p className="text-xs text-muted-foreground mt-1">{form.body.length}/4000 · up to 3 links allowed.</p>
        </div>

        <div className="space-y-3 border border-border/40 rounded-md p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="font-medium">Submit anonymously</div>
              <p className="text-xs text-muted-foreground mt-1">If on, admins won't see any identifying info. Default on.</p>
            </div>
            <Switch checked={form.anonymous} onCheckedChange={v => setForm(s => ({ ...s, anonymous: v }))} />
          </label>
          {!form.anonymous && (
            <div>
              <Label htmlFor="s-user">Discord username (optional)</Label>
              <Input id="s-user" value={form.submitterDiscordUsername} maxLength={64}
                onChange={e => setForm(s => ({ ...s, submitterDiscordUsername: e.target.value }))} placeholder="username (no ID needed)" />
              <p className="text-xs text-muted-foreground mt-1">Admins will see this so they can follow up if needed.</p>
            </div>
          )}
        </div>

        {/* honeypot — visually hidden, bots fill it */}
        <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
          value={form.website} onChange={e => setForm(s => ({ ...s, website: e.target.value }))}
          style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", opacity: 0 }} />

        <Button type="submit" disabled={submit.isPending} className="w-full">
          {submit.isPending ? "Submitting…" : "Submit"}
        </Button>
      </form>
    </div>
  );
}
