import { useMemo } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Gamepad2, Trophy, Newspaper, Sparkles, Crown, Medal } from "lucide-react";
import { useCards, useNews, useLeaderboard, useGuildSummary, useSiteConfig } from "@/hooks/queries";
import { resolvePresentation, type PresentationConfig } from "@/features/site/defaults";
import { AmbientMedia } from "@/features/media/AmbientMedia";
import { SmartImage } from "@/features/media/SmartImage";
import { VaultCard } from "@/features/vault/VaultCard";
import { SplashScreen } from "@/features/splash/SplashScreen";
import { useSplashGate } from "@/features/splash/useSplashGate";
import { rarityLabelOf } from "@/features/vault/rarity";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  const { data: cardsData } = useCards();
  const { data: siteConfig } = useSiteConfig();
  const { data: news } = useNews();

  const homeGuildId = siteConfig?.homeGuildId ?? "";
  const { data: leaderboard } = useLeaderboard(homeGuildId);
  const { data: summary } = useGuildSummary(homeGuildId);

  const presentation = useMemo<PresentationConfig>(
    () => resolvePresentation(siteConfig?.presentation as Partial<PresentationConfig> | null),
    [siteConfig],
  );

  const cards = cardsData?.cards ?? [];
  const { seen, markSeen } = useSplashGate();
  const showSplash = presentation.splash.enabled && !seen && cards.length > 0;

  // Featured spotlights: admin-featured cards, else top-worth cards with art.
  const spotlights = useMemo(() => {
    const featured = cards.filter((c) => c.featured && c.imageUrl);
    if (featured.length >= 4) return featured.slice(0, 6);
    const rest = [...cards]
      .filter((c) => c.imageUrl && !c.featured)
      .sort((a, b) => b.worthValue - a.worthValue);
    return [...featured, ...rest].slice(0, 6);
  }, [cards]);

  const latestNews = useMemo(() => {
    const posts = (news?.posts ?? []).filter((p) => p.publishedAt);
    return [...posts]
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime())
      .slice(0, 3);
  }, [news]);

  const topCollectors = (leaderboard?.entries ?? []).slice(0, 5);

  return (
    <div className="min-h-screen">
      {showSplash && (
        <SplashScreen
          cards={cards}
          rarityOrder={cardsData?.rarityOrder}
          tierDurationMs={presentation.splash.tierDurationMs}
          onDone={markSeen}
        />
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[78vh] items-center overflow-hidden border-b border-border/40">
        <div className="absolute inset-0">
          {presentation.hero.backgroundSrc ? (
            <AmbientMedia
              src={presentation.hero.backgroundSrc}
              poster={presentation.hero.backgroundPoster}
              alt=""
              fit="cover"
              overlay={0.55}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-background via-background to-primary/10" />
          )}
          <div className="bg-tactical-pattern absolute inset-0 opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        </div>

        <div className="container relative z-10 max-w-screen-2xl px-4 py-20 md:px-8">
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 font-mono text-sm uppercase tracking-[0.4em] text-primary"
          >
            {presentation.hero.eyebrow}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="max-w-3xl text-5xl font-bold uppercase leading-[0.95] tracking-tight md:text-7xl"
          >
            {presentation.hero.title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground"
          >
            {presentation.hero.subtitle}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-10 flex flex-wrap gap-4"
          >
            <Link
              href={presentation.hero.ctaHref}
              className="group flex items-center gap-2 rounded-lg bg-primary px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:scale-[1.03]"
            >
              {presentation.hero.ctaLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href={presentation.hero.secondaryCtaHref}
              className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-widest backdrop-blur transition-colors hover:bg-muted"
            >
              <Gamepad2 className="h-4 w-4" />
              {presentation.hero.secondaryCtaLabel}
            </Link>
          </motion.div>

          {summary && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="mt-14 flex flex-wrap gap-8"
            >
              <HeroStat value={summary.rosterSize} label="Cards in Dex" />
              <HeroStat value={summary.collectors} label="Collectors" />
              <HeroStat value={summary.cardsHeld} label="Cards Held" />
              <HeroStat value={summary.shinyCards} label="Shinies Minted" />
            </motion.div>
          )}
        </div>
      </section>

      <div className="container max-w-screen-2xl space-y-20 px-4 py-20 md:px-8">
        {/* ── Featured spotlights ─────────────────────────────────────────── */}
        {spotlights.length > 0 && (
          <section>
            <SectionHeader icon={<Sparkles className="h-5 w-5" />} title="Featured Cards" subtitle="Spotlight from across the Dex" href="/vault" cta="Open Card Vault" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {spotlights.map((card) => (
                <VaultCard key={card.id} card={card} pool={cards} />
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-12 lg:grid-cols-3">
          {/* ── News ──────────────────────────────────────────────────────── */}
          <section className="lg:col-span-2">
            <SectionHeader icon={<Newspaper className="h-5 w-5" />} title="Intel & Updates" subtitle="Latest from command" href="/news" cta="All News" />
            {latestNews.length === 0 ? (
              <EmptyPanel>No news published yet.</EmptyPanel>
            ) : (
              <div className="space-y-4">
                {latestNews.map((post) => (
                  <Link
                    key={post.id}
                    href={`/news/${post.slug}`}
                    className="group flex gap-4 overflow-hidden rounded-xl border border-border/50 bg-card/50 p-4 transition-colors hover:border-primary/50"
                  >
                    {post.imageUrl && (
                      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg">
                        <SmartImage src={post.imageUrl} alt={post.title} fit="cover" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        {post.pinned && <Badge variant="outline" className="border-primary/40 font-mono text-[9px] uppercase text-primary">Pinned</Badge>}
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : ""}
                        </span>
                      </div>
                      <h3 className="truncate font-bold uppercase tracking-wide transition-colors group-hover:text-primary">{post.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.bodyMd.replace(/[#*_>`]/g, "").slice(0, 160)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ── Community leaderboard ─────────────────────────────────────── */}
          <section>
            <SectionHeader icon={<Trophy className="h-5 w-5" />} title="Top Collectors" subtitle="By net worth" href="/leaderboard" cta="Full Board" />
            {topCollectors.length === 0 ? (
              <EmptyPanel>Leaderboard warming up.</EmptyPanel>
            ) : (
              <div className="space-y-2">
                {topCollectors.map((entry) => (
                  <div key={entry.userId} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 p-3">
                    <div className="flex h-8 w-8 items-center justify-center">
                      {entry.rank === 1 ? <Crown className="h-5 w-5 text-[hsl(var(--rarity-legendary))]" /> : entry.rank <= 3 ? <Medal className="h-5 w-5 text-muted-foreground" /> : <span className="font-mono font-bold text-muted-foreground">{entry.rank}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{entry.username ?? entry.userId}</div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{entry.uniqueCards} unique</div>
                    </div>
                    <div className="font-mono text-sm font-bold text-primary">{entry.netWorth.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-3xl font-bold text-foreground">{value.toLocaleString()}</div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, href, cta }: { icon: React.ReactNode; title: string; subtitle: string; href: string; cta: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-border/40 pb-3">
      <div className="flex items-center gap-3">
        <span className="text-primary">{icon}</span>
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-wider">{title}</h2>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <Link href={href} className="hidden shrink-0 items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground sm:flex">
        {cta} <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/50 bg-card/30 py-12 text-center font-mono text-sm uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}
