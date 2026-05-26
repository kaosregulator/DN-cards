import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type EmbedKey = "spawn" | "claimed" | "daily" | "pack" | "trade" | "welcome" | "rules" | "commands";
const EMBED_KEYS: EmbedKey[] = ["spawn", "claimed", "daily", "pack", "trade", "welcome", "rules", "commands"];
const EMBED_LABELS: Record<EmbedKey, string> = {
  spawn: "🎯 Spawn (card appears)",
  claimed: "✅ Claimed (after catch)",
  daily: "🎁 Daily reward",
  pack: "📦 Pack open",
  trade: "🔄 Trade proposal",
  welcome: "🃏 Welcome banner",
  rules: "📌 Rules banner",
  commands: "⚡ Commands cheat sheet",
};
type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const DEFAULT_RARITY_COLORS: Record<Rarity, number> = {
  common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf39c12, mythic: 0xff2d92,
};

type EmbedConfig = {
  enabled?: boolean;
  title?: string;
  footer?: string;
  descriptionPrefix?: string;
  color?: number;
  rarityColors?: Partial<Record<Rarity, number>>;
  imageMode?: "default" | "large" | "thumbnail" | "none";
  customImageUrl?: string;
  showWorth?: boolean;
  showDropChance?: boolean;
};
type Guild = { id: string; name: string; iconUrl: string | null; memberCount: number };
type GuildsResponse = { guilds: Guild[] };
type OverridesResponse = { guildId: string; overrides: Record<EmbedKey, EmbedConfig> };

// Convert hex int <-> "#rrggbb"
const intToHex = (n: number | undefined): string =>
  n === undefined ? "#5865f2" : "#" + n.toString(16).padStart(6, "0");
const hexToInt = (hex: string): number => parseInt(hex.replace("#", ""), 16);

// Mock context used to render the live preview.
const MOCK_CTX = {
  user: "@DarkRecruit", username: "DarkRecruit", card: "M1 Abrams",
  rarity: "Uncommon", worth: "75", chance: "12.5", streak: "3", tier: "Premium",
  amount: "750", balance: "1,420", guild: "Your Server", channel: "#spawn",
};
function substitute(template: string): string {
  return template
    .replace(/\{user\}/g, MOCK_CTX.user)
    .replace(/\{username\}/g, MOCK_CTX.username)
    .replace(/\{card\}/g, MOCK_CTX.card)
    .replace(/\{rarity\}/g, MOCK_CTX.rarity)
    .replace(/\{worth\}/g, MOCK_CTX.worth)
    .replace(/\{chance\}/g, MOCK_CTX.chance)
    .replace(/\{streak\}/g, MOCK_CTX.streak)
    .replace(/\{tier\}/g, MOCK_CTX.tier)
    .replace(/\{amount\}/g, MOCK_CTX.amount)
    .replace(/\{balance\}/g, MOCK_CTX.balance)
    .replace(/\{guild\}/g, MOCK_CTX.guild)
    .replace(/\{channel\}/g, MOCK_CTX.channel);
}

// Default values shown in the preview when no override is set.
function defaultPreview(key: EmbedKey): { title: string; description: string; color: number; footer?: string; image?: boolean } {
  switch (key) {
    case "spawn":
      return { title: "🟢 A DN Card has appeared!", description: "Type the card name exactly to catch it:\n```M1 Abrams```\n\n**M1 Abrams** — Uncommon · 💠 75 shards · ⏱️ 30s",
        color: DEFAULT_RARITY_COLORS.uncommon, footer: "American main battle tank.", image: true };
    case "claimed":
      return { title: "✅ CLAIMED — M1 Abrams", description: "# 🎉 CLAIMED BY @DarkRecruit\n\nRarity: 🟢 Uncommon · Worth: 💠 75 shards",
        color: 0x00b894, image: true };
    case "daily":
      return { title: "🎁 Daily Reward Claimed!", description: "You earned 💠 **70 shards**!\nBase: 50 · Streak bonus: +20\n\n🔥 Streak: **3 days**\nBalance: 💠 **1,420**",
        color: 0xf1c40f, footer: "Come back tomorrow to keep your streak alive!" };
    case "pack":
      return { title: "🥈 Premium Pack — 5 cards", description: "**1.** 🟢 M1 Abrams — Uncommon · 💠 75\n**2.** ⚪ M4 Sherman — Common · 💠 10\n**3.** 🔵 F-22 Raptor — Rare · 💠 250\n**4.** ⚪ Jeep Willys — Common · 💠 10\n**5.** 🟢 Bradley IFV — Uncommon · 💠 75\n\n**Total worth:** 💠 420\nSpent: 💠 750 · Balance: 💠 1,420",
        color: 0xc0c0c0, footer: "Cards added to your collection.", image: true };
    case "trade":
      return { title: "🔄 Trade Proposal", description: "@DarkRecruit → @Specter\n\n**Offering:** 🟢 **M1 Abrams** *(Uncommon)*\n**Requesting:** 🔵 **F-22 Raptor** *(Rare)*\n\n@Specter, hit a button below to respond.\n*Trade ID: `#42` · Expires in 24h*",
        color: 0x0984e3 };
    case "welcome":
      return { title: "🃏 Welcome to DN Cards", description: "DN Cards is DarkNight's collectible military trading card game…\n\n🚀 Quick Start\n• Step 1 — Watch the spawn channel and type the card name to catch.\n• Step 2 — Run /daily for shards.",
        color: 0xe63946, image: true };
    case "rules":
      return { title: "📌 Things to Know", description: "🎖️ Rarities · ✨ Shinies (0.5% mint rate at 2× worth) · 🎴 Pack Tiers · 🔄 Trading · 🎯 Events · 🏆 Net Worth & Rank · 🏅 Achievements.",
        color: 0xe63946, image: true };
    case "commands":
      return { title: "⚡ Commands Cheat Sheet", description: "📦 Collection & Progress · 💠 Economy · 🔄 Trading · 📌 Wishlist · ℹ️ Help",
        color: 0xe63946, footer: "Tip: most card-name fields autocomplete.", image: true };
  }
}

// Discord-style embed preview component.
function PreviewEmbed({ cfg, embedKey }: { cfg: EmbedConfig; embedKey: EmbedKey }) {
  const def = defaultPreview(embedKey);
  const effectiveRarity: Rarity = "uncommon"; // mock rarity for spawn/claimed
  const color = cfg.rarityColors?.[effectiveRarity] ?? cfg.color ?? def.color;
  const title = cfg.title ? substitute(cfg.title) : def.title;
  const baseDesc = def.description;
  const desc = cfg.descriptionPrefix
    ? substitute(cfg.descriptionPrefix) + "\n\n" + baseDesc
    : baseDesc;
  const footer = cfg.footer ? substitute(cfg.footer) : def.footer;
  const imageMode = cfg.imageMode ?? "default";
  const imageUrl = cfg.customImageUrl ||
    (def.image ? "https://placehold.co/600x300/1e1e1e/95a5a6?text=Card+Image" : "");
  const showImage = imageMode !== "none" && imageUrl;

  return (
    <div className="rounded-md bg-[#2b2d31] p-3 max-w-md text-sm font-sans">
      <div className="flex">
        <div className="w-1 rounded-l flex-shrink-0" style={{ background: intToHex(color) }} />
        <div className="ml-3 flex-1 min-w-0">
          <div className="font-semibold text-white mb-1 break-words">{title}</div>
          <div className="text-[#dbdee1] whitespace-pre-wrap break-words text-[0.92em] leading-snug">{desc}</div>
          {showImage && imageMode === "thumbnail" && (
            <img src={imageUrl} alt="" className="float-right ml-2 mt-1 w-20 h-20 rounded object-cover" />
          )}
          {showImage && (imageMode === "default" || imageMode === "large") && (
            <img src={imageUrl} alt="" className="mt-2 rounded max-w-full object-cover" style={{ maxHeight: imageMode === "large" ? 240 : 180 }} />
          )}
          {footer && <div className="mt-2 text-xs text-[#949ba4] break-words">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

const TOKEN_HELP = "Tokens: {user} {username} {card} {rarity} {worth} {chance} {streak} {tier} {amount} {balance} {guild} {channel}";

export default function EmbedsPage() {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const [guildId, setGuildId] = useState<string>("");
  const [embedKey, setEmbedKey] = useState<EmbedKey>("spawn");
  const [draft, setDraft] = useState<EmbedConfig>({});
  const [savedFlash, setSavedFlash] = useState<string>("");

  useEffect(() => { if (!user && !isLoading) navigate("/login"); }, [user, isLoading, navigate]);

  const guildsQ = useQuery<GuildsResponse>({
    queryKey: ["embeds", "guilds"],
    queryFn: () => apiGet<GuildsResponse>("/api/embeds/guilds"),
    enabled: !!user,
  });
  useEffect(() => {
    if (guildsQ.data?.guilds.length && !guildId) {
      setGuildId(guildsQ.data.guilds[0].id);
    }
  }, [guildsQ.data, guildId]);

  const overridesQ = useQuery<OverridesResponse>({
    queryKey: ["embeds", "overrides", guildId],
    queryFn: () => apiGet<OverridesResponse>(`/api/embeds/${guildId}`),
    enabled: !!user && !!guildId,
  });
  useEffect(() => {
    if (overridesQ.data) setDraft(overridesQ.data.overrides[embedKey] ?? {});
  }, [overridesQ.data, embedKey]);

  const save = useMutation({
    mutationFn: (cfg: EmbedConfig) => apiSend("PUT", `/api/embeds/${guildId}/${embedKey}`, cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["embeds", "overrides", guildId] });
      setSavedFlash("Saved ✓");
      setTimeout(() => setSavedFlash(""), 2000);
    },
  });
  const reset = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/embeds/${guildId}/${embedKey}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["embeds", "overrides", guildId] });
      setDraft({});
      setSavedFlash("Reset to defaults ✓");
      setTimeout(() => setSavedFlash(""), 2000);
    },
  });

  const supportsRarityColors = embedKey === "spawn" || embedKey === "claimed";
  const supportsImageOverride = ["spawn", "claimed", "pack", "welcome", "rules", "commands"].includes(embedKey);
  const supportsShowToggles = embedKey === "spawn" || embedKey === "claimed";

  if (isLoading) return <div className="container py-12 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return null;

  const guilds = guildsQ.data?.guilds ?? [];

  return (
    <div className="container py-6 md:py-10 max-w-screen-2xl">
      <h1 className="text-2xl md:text-3xl font-bold tracking-wider uppercase">Embed Customization</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Override the look of every bot message. Empty fields fall back to the built-in defaults.
        Changes apply within ~60 seconds.
      </p>

      {/* Guild + embed pickers */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1">Server</label>
          {guildsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading servers…</div>
          ) : guilds.length === 0 ? (
            <div className="text-sm text-amber-500">Bot isn't in any servers yet. Invite it first.</div>
          ) : (
            <select
              value={guildId}
              onChange={(e) => setGuildId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {guilds.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.memberCount.toLocaleString()} members)</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1">Embed</label>
          <select
            value={embedKey}
            onChange={(e) => setEmbedKey(e.target.value as EmbedKey)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {EMBED_KEYS.map((k) => <option key={k} value={k}>{EMBED_LABELS[k]}</option>)}
          </select>
        </div>
      </div>

      {/* Form + preview */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form column */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              <span>Use this customization{draft.enabled === false ? " (currently disabled)" : ""}</span>
            </label>
            {save.error instanceof ApiError && (
              <Badge variant="destructive">{save.error.message}</Badge>
            )}
          </div>

          <Field label="Title" hint={TOKEN_HELP}>
            <input type="text" maxLength={256}
              value={draft.title ?? ""}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={defaultPreview(embedKey).title}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </Field>

          <Field label="Description prefix (prepended above default)" hint={TOKEN_HELP}>
            <textarea maxLength={2000}
              value={draft.descriptionPrefix ?? ""}
              onChange={(e) => setDraft({ ...draft, descriptionPrefix: e.target.value })}
              placeholder="A note that appears before the default message…"
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono" />
          </Field>

          <Field label="Footer" hint={TOKEN_HELP}>
            <input type="text" maxLength={2048}
              value={draft.footer ?? ""}
              onChange={(e) => setDraft({ ...draft, footer: e.target.value })}
              placeholder={defaultPreview(embedKey).footer ?? "Optional footer text"}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </Field>

          {!supportsRarityColors && (
            <Field label="Color">
              <div className="flex items-center gap-2">
                <input type="color"
                  value={intToHex(draft.color ?? defaultPreview(embedKey).color)}
                  onChange={(e) => setDraft({ ...draft, color: hexToInt(e.target.value) })}
                  className="h-9 w-14 rounded border bg-background" />
                <button type="button" onClick={() => { const { color, ...rest } = draft; setDraft(rest); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline">
                  reset
                </button>
              </div>
            </Field>
          )}

          {supportsRarityColors && (
            <Field label="Per-rarity color">
              <div className="grid grid-cols-5 gap-2">
                {RARITIES.map((r) => (
                  <div key={r} className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{r}</div>
                    <input type="color"
                      value={intToHex(draft.rarityColors?.[r] ?? DEFAULT_RARITY_COLORS[r])}
                      onChange={(e) => setDraft({
                        ...draft,
                        rarityColors: { ...draft.rarityColors, [r]: hexToInt(e.target.value) },
                      })}
                      className="h-8 w-full rounded border bg-background" />
                  </div>
                ))}
              </div>
              <button type="button"
                onClick={() => { const { rarityColors, ...rest } = draft; setDraft(rest); }}
                className="mt-2 text-xs text-muted-foreground hover:text-foreground underline">
                reset all rarity colors
              </button>
            </Field>
          )}

          {supportsImageOverride && (
            <>
              <Field label="Image size">
                <div className="flex flex-wrap gap-2">
                  {(["default", "large", "thumbnail", "none"] as const).map((mode) => (
                    <button key={mode} type="button"
                      onClick={() => setDraft({ ...draft, imageMode: mode })}
                      className={`px-3 py-1.5 text-xs rounded border ${(draft.imageMode ?? "default") === mode ? "bg-foreground text-background" : "bg-background hover:bg-accent"}`}>
                      {mode}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Custom image URL (overrides card / banner image)">
                <input type="url" maxLength={2048}
                  value={draft.customImageUrl ?? ""}
                  onChange={(e) => setDraft({ ...draft, customImageUrl: e.target.value })}
                  placeholder="https://… or leave blank"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </Field>
            </>
          )}

          {supportsShowToggles && (
            <Field label="Show / hide fields">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.showWorth !== false}
                  onChange={(e) => setDraft({ ...draft, showWorth: e.target.checked })} />
                <span>Show worth (shard value)</span>
              </label>
              <label className="flex items-center gap-2 text-sm mt-1">
                <input type="checkbox" checked={draft.showDropChance !== false}
                  onChange={(e) => setDraft({ ...draft, showDropChance: e.target.checked })} />
                <span>Show drop chance (info embed)</span>
              </label>
              <p className="text-[11px] text-muted-foreground mt-1">
                Note: hiding fields takes effect on /info embed; spawn/claimed always show worth for fairness.
              </p>
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 sticky bottom-0 bg-background/95 pb-2">
            <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !guildId}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending || !guildId}>
              {reset.isPending ? "Resetting…" : "Reset to defaults"}
            </Button>
            {savedFlash && <span className="text-sm text-emerald-500">{savedFlash}</span>}
          </div>
        </div>

        {/* Preview column */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Live preview</div>
          <PreviewEmbed cfg={draft} embedKey={embedKey} />
          <p className="text-xs text-muted-foreground mt-2">
            Preview uses mock values. Real embeds substitute the actual user, card, streak, etc.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1 font-mono">{hint}</p>}
    </div>
  );
}
