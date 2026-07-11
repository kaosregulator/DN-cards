import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useAdminPresentation, useSavePresentation, type PresentationConfigDraft, type HeroBannerCfg } from "@/hooks/queries";
import { uploadImageFile, resolveImageUrl } from "@/lib/api";
import { DEFAULT_PRESENTATION } from "@/features/site/defaults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Plus, Trash2, Save, Image as ImageIcon } from "lucide-react";

const THEME_PRESETS: { name: string; value: string }[] = [
  { name: "Tactical Amber", value: "25 100% 55%" },
  { name: "Blood Red", value: "0 84% 60%" },
  { name: "Signal Green", value: "142 71% 45%" },
  { name: "Recon Blue", value: "217 91% 60%" },
  { name: "Exotic Purple", value: "283 60% 60%" },
];

export default function SiteAdmin() {
  const { user, isLoading } = useAuth();
  const { data, isLoading: loadingCfg } = useAdminPresentation(!!user);
  const save = useSavePresentation();
  const { toast } = useToast();
  const [draft, setDraft] = useState<PresentationConfigDraft | null>(null);

  // Initialize the editable draft once the config loads.
  useEffect(() => {
    if (data && !draft) setDraft(structuredClone(data.config ?? {}));
  }, [data, draft]);

  if (isLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;
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
  if (loadingCfg || !draft) return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;

  const d = DEFAULT_PRESENTATION;
  const setHero = (patch: Partial<PresentationConfigDraft["hero"]>) =>
    setDraft((s) => ({ ...s!, hero: { ...(s!.hero ?? {}), ...patch } }));
  const setSplash = (patch: Partial<PresentationConfigDraft["splash"]>) =>
    setDraft((s) => ({ ...s!, splash: { ...(s!.splash ?? {}), ...patch } }));

  const onSave = async () => {
    try {
      await save.mutateAsync(draft);
      toast({ title: "Appearance saved", description: "The live site updates on next load." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message ?? "Please try again." });
    }
  };

  const banners = draft.heroBanners ?? [];
  const setBanners = (next: HeroBannerCfg[]) => setDraft((s) => ({ ...s!, heroBanners: next }));

  return (
    <div className="container max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold uppercase tracking-tight">Appearance</h1>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Presentation only · never touches cards, stats, or bot config
          </p>
        </div>
        <Button onClick={onSave} disabled={save.isPending} className="gap-2">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </Button>
      </header>

      <div className="space-y-8">
        {/* Hero copy */}
        <Section title="Hero" desc="Headline and calls-to-action on the homepage.">
          <Field label="Eyebrow" value={draft.hero?.eyebrow ?? ""} placeholder={d.hero.eyebrow} onChange={(v) => setHero({ eyebrow: v })} />
          <Field label="Title" value={draft.hero?.title ?? ""} placeholder={d.hero.title} onChange={(v) => setHero({ title: v })} />
          <div>
            <Label>Subtitle</Label>
            <Textarea rows={3} value={draft.hero?.subtitle ?? ""} placeholder={d.hero.subtitle} onChange={(e) => setHero({ subtitle: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary CTA label" value={draft.hero?.ctaLabel ?? ""} placeholder={d.hero.ctaLabel} onChange={(v) => setHero({ ctaLabel: v })} />
            <Field label="Primary CTA link" value={draft.hero?.ctaHref ?? ""} placeholder={d.hero.ctaHref} onChange={(v) => setHero({ ctaHref: v })} />
            <Field label="Secondary CTA label" value={draft.hero?.secondaryCtaLabel ?? ""} placeholder={d.hero.secondaryCtaLabel} onChange={(v) => setHero({ secondaryCtaLabel: v })} />
            <Field label="Secondary CTA link" value={draft.hero?.secondaryCtaHref ?? ""} placeholder={d.hero.secondaryCtaHref} onChange={(v) => setHero({ secondaryCtaHref: v })} />
          </div>
        </Section>

        {/* Hero banners (scheduled background media) */}
        <Section title="Hero Background Banners" desc="Upload JPG/PNG/WEBP/GIF/MP4. The newest enabled banner within its schedule shows behind the hero. If none is active, the site falls back to a gradient — never blank.">
          <div className="space-y-4">
            {banners.map((b, i) => (
              <BannerRow key={b.id} banner={b} onChange={(nb) => setBanners(banners.map((x, j) => (j === i ? nb : x)))} onRemove={() => setBanners(banners.filter((_, j) => j !== i))} />
            ))}
            <Button
              variant="outline"
              onClick={() => setBanners([...banners, { id: `b${Date.now()}`, label: "", imageSrc: "", poster: null, enabled: true, startAt: null, endAt: null }])}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Add banner
            </Button>
          </div>
        </Section>

        {/* Theme */}
        <Section title="Theme Accent" desc="Primary accent color used across the UI.">
          <div className="flex flex-wrap gap-2">
            {THEME_PRESETS.map((p) => {
              const active = (draft.theme?.primary ?? d.theme.primary) === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() => setDraft((s) => ({ ...s!, theme: { primary: p.value } }))}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs uppercase tracking-widest ${active ? "border-primary" : "border-border hover:bg-muted"}`}
                >
                  <span className="h-4 w-4 rounded-full" style={{ background: `hsl(${p.value})` }} />
                  {p.name}
                </button>
              );
            })}
          </div>
          <Field
            label="Custom (HSL triplet, e.g. 25 100% 55%)"
            value={draft.theme?.primary ?? ""}
            placeholder={d.theme.primary}
            onChange={(v) => setDraft((s) => ({ ...s!, theme: { primary: v } }))}
          />
        </Section>

        {/* Splash */}
        <Section title="Intro Splash" desc="The cinematic rarity-ladder intro shown once per session.">
          <ToggleRow label="Enable splash intro" checked={draft.splash?.enabled ?? d.splash.enabled} onChange={(v) => setSplash({ enabled: v })} />
          <Field
            label="Seconds per tier"
            type="number"
            value={String(((draft.splash?.tierDurationMs ?? d.splash.tierDurationMs) / 1000))}
            onChange={(v) => setSplash({ tierDurationMs: Math.round((Number(v) || 2.6) * 1000) })}
          />
        </Section>

        {/* Discord invite */}
        <Section title="Discord Invite" desc="Used by the Demo Mode 'Claim your starter deck' CTA and elsewhere.">
          <Field label="Invite URL" value={draft.discordInviteUrl ?? ""} placeholder={d.discordInviteUrl} onChange={(v) => setDraft((s) => ({ ...s!, discordInviteUrl: v }))} />
        </Section>
      </div>

      <div className="mt-8 flex justify-end">
        <Button onClick={onSave} disabled={save.isPending} className="gap-2">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
        </Button>
      </div>
    </div>
  );
}

function BannerRow({ banner, onChange, onRemove }: { banner: HeroBannerCfg; onChange: (b: HeroBannerCfg) => void; onRemove: () => void }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState<null | "img" | "poster">(null);
  const resolved = resolveImageUrl(banner.imageSrc);
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(banner.imageSrc);

  const upload = async (file: File, which: "img" | "poster") => {
    setUploading(which);
    try {
      const path = await uploadImageFile(file);
      onChange(which === "img" ? { ...banner, imageSrc: path } : { ...banner, poster: path });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message ?? "Try a smaller file." });
    } finally {
      setUploading(null);
    }
  };

  const toLocal = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
  const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-4">
      <div className="flex gap-4">
        <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-muted/40">
          {resolved ? (
            isVideo ? <video src={resolved} className="h-full w-full object-cover" muted /> : <img src={resolved} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageIcon className="h-6 w-6 opacity-40" /></div>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <Input value={banner.label ?? ""} placeholder="Label (internal)" onChange={(e) => onChange({ ...banner, label: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest hover:bg-muted">
              {uploading === "img" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Media
              <input type="file" accept="image/*,video/mp4,video/webm" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "img")} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest hover:bg-muted">
              {uploading === "poster" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Poster
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "poster")} />
            </label>
            <label className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Switch checked={banner.enabled ?? true} onCheckedChange={(v) => onChange({ ...banner, enabled: v })} /> Enabled
            </label>
            <button onClick={onRemove} className="ml-auto inline-flex items-center gap-1 text-xs uppercase tracking-widest text-destructive hover:opacity-80">
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Starts</Label>
              <Input type="datetime-local" value={toLocal(banner.startAt)} onChange={(e) => onChange({ ...banner, startAt: fromLocal(e.target.value) })} />
            </div>
            <div>
              <Label className="text-[10px]">Ends</Label>
              <Input type="datetime-local" value={toLocal(banner.endAt)} onChange={(e) => onChange({ ...banner, endAt: fromLocal(e.target.value) })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card/30 p-5">
      <h2 className="text-lg font-bold uppercase tracking-wide">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{desc}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, value, placeholder, onChange, type }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type ?? "text"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/40 p-3">
      <Label className="cursor-pointer font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[60vh] items-center justify-center">{children}</div>;
}
