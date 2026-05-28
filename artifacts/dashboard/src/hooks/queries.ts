import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend, apiGet, apiSend } from "@/lib/api";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
export type CardType = string; // free-form label — any text the admin types

export interface CardDisplayOverride {
  cardId: number;
  displayName: string | null;
  displayImageUrl: string | null;
  displayDescription: string | null;
  flavorText: string | null;
  hiddenFromSite: boolean;
  featured: boolean;
  sortWeight: number;
  updatedBy: number | null;
  updatedAt: string;
}

export interface Card {
  id: number;
  name: string;
  description: string;
  rarity: Rarity;
  cardType: CardType;
  dropWeight: number;
  worthValue: number;
  burnValue: number;
  isLimitedEdition: boolean;
  isEventExclusive: boolean;
  maxCopies: number | null;
  totalMinted: number;
  imageUrl: string | null;
  flavor: string | null;
  droppable: boolean;
  inPacks: boolean;
  isArchived: boolean;
  sets: { id: number; name: string }[];
  podiumPlace: 1 | 2 | 3 | null;
  previewAnimation: "spin" | "bounce" | "flip" | "pulse" | "none" | null;
  previewBgColor: string | null;
  displayOrientation: "portrait" | "landscape" | null;
  createdAt: string;
  // Public dashboard /cards endpoint also adds these (post-merge):
  featured?: boolean;
  sortWeight?: number;
  // When HOME_GUILD_ID is set and a card has a custom rarity tier assigned,
  // these override `rarity` for display/grouping on the public website.
  effectiveRarity?: string;
  effectiveRarityLabel?: string;
}

export interface AdminCard extends Card {
  displayOverride: CardDisplayOverride | null;
}

export type DisplayOverridePatch = Partial<{
  displayName: string | null;
  displayImageUrl: string | null;
  displayDescription: string | null;
  flavorText: string | null;
  hiddenFromSite: boolean;
  featured: boolean;
  sortWeight: number;
}>;

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  uniqueCards: number;
  totalCards: number;
  shinyCards: number;
  netWorth: number;
}

export interface Profile {
  guildId: string;
  userId: string;
  stats: {
    uniqueCards: number;
    totalCards: number;
    shinyCards: number;
    netWorth: number;
    rank: { name: string; emoji: string; min: number };
    nextRank: { name: string; emoji: string; min: number; cardsNeeded: number } | null;
  };
  currency: { shards: number; totalEarned: number; packsOpened: number; cardsBurned: number };
  collection: Array<{
    cardId: number;
    name: string;
    rarity: Rarity;
    cardType: CardType;
    imageUrl: string | null;
    worthValue: number;
    burnValue: number;
    count: number;
    shinyCount: number;
    firstCaughtAt: string;
  }>;
  achievements: Array<{
    key: string;
    name: string;
    emoji: string;
    description: string;
    reward: number;
    unlocked: boolean;
    unlockedAt: string | null;
  }>;
}

export interface GuildSummary {
  guildId: string;
  collectors: number;
  cardsHeld: number;
  shinyCards: number;
  rosterSize: number;
  packsOpened: number;
  cardsBurned: number;
  totalShardsEarned: number;
}

// ── Public roster ────────────────────────────────────────────────────────────
export function useCards() {
  return useQuery({
    queryKey: ["cards"],
    queryFn: () => apiGet<{ cards: Card[] }>("/api/cards"),
  });
}

export function useLeaderboard(guildId: string) {
  return useQuery({
    queryKey: ["leaderboard", guildId],
    queryFn: () => apiGet<{ guildId: string; entries: LeaderboardEntry[] }>(`/api/guilds/${guildId}/leaderboard`),
    enabled: !!guildId,
  });
}

export function useProfile(guildId: string, userId: string) {
  return useQuery({
    queryKey: ["profile", guildId, userId],
    queryFn: () => apiGet<Profile>(`/api/guilds/${guildId}/users/${userId}`),
    enabled: !!guildId && !!userId,
  });
}

export function useGuildSummary(guildId: string) {
  return useQuery({
    queryKey: ["guildSummary", guildId],
    queryFn: () => apiGet<GuildSummary>(`/api/guilds/${guildId}/summary`),
    enabled: !!guildId,
  });
}

// ── Admin: card display overrides ────────────────────────────────────────────
// The admin "Card Manager" UI shows a read-only summary of each card's
// gameplay values (from `cards`) alongside its editable website-display
// override (from `card_display_overrides`). The website is the ONLY consumer
// of the override row — Discord ignores it entirely.
export function useAdminCards(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "cards"],
    queryFn: () => adminGet<{ cards: AdminCard[] }>("/api/admin/cards"),
    enabled,
    staleTime: 0,
  });
}

function invalidateCardLists(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["admin", "cards"] });
  qc.invalidateQueries({ queryKey: ["cards"] });
}

export function useUpdateCardDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: DisplayOverridePatch }) =>
      adminSend<{ override: CardDisplayOverride }>("PUT", `/api/admin/cards/${id}/display`, patch),
    onSuccess: () => invalidateCardLists(qc),
  });
}

export function useResetCardDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminSend<{ deleted: true; cardId: number }>("DELETE", `/api/admin/cards/${id}/display`),
    onSuccess: () => invalidateCardLists(qc),
  });
}

// ── News ────────────────────────────────────────────────────────────────────
export interface NewsPost {
  id: number;
  slug: string;
  title: string;
  bodyMd: string;
  imageUrl: string | null;
  pinned: boolean;
  publishedAt: string | null;
  authorUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export type NewsPostPatch = Partial<Omit<NewsPost, "id" | "createdAt" | "updatedAt" | "authorUserId">>;

export function useNews() {
  return useQuery({
    queryKey: ["news"],
    queryFn: () => apiGet<{ posts: NewsPost[] }>("/api/news"),
  });
}

export function useNewsPost(slug: string) {
  return useQuery({
    queryKey: ["news", slug],
    queryFn: () => apiGet<{ post: NewsPost }>(`/api/news/${slug}`),
    enabled: !!slug,
  });
}

export function useAdminNews(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "news"],
    queryFn: () => adminGet<{ posts: NewsPost[] }>("/api/admin/news"),
    enabled,
    staleTime: 0,
  });
}

function invalidateNews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["news"] });
  qc.invalidateQueries({ queryKey: ["admin", "news"] });
}

export function useCreateNews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewsPostPatch & { title: string; slug: string }) =>
      adminSend<{ post: NewsPost }>("POST", "/api/admin/news", body),
    onSuccess: () => invalidateNews(qc),
  });
}

export function useUpdateNews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: NewsPostPatch }) =>
      adminSend<{ post: NewsPost }>("PATCH", `/api/admin/news/${id}`, patch),
    onSuccess: () => invalidateNews(qc),
  });
}

export function useDeleteNews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminSend<{ deleted: true; id: number }>("DELETE", `/api/admin/news/${id}`),
    onSuccess: () => invalidateNews(qc),
  });
}

// ── Suggestions ─────────────────────────────────────────────────────────────
export type SuggestionCategory = "bug_report" | "card_correction" | "card_suggestion" | "event_suggestion" | "website_feedback";
export type SuggestionStatus = "new" | "in_review" | "planned" | "resolved" | "rejected" | "duplicate";

export interface Suggestion {
  id: number;
  category: SuggestionCategory;
  title: string;
  body: string;
  anonymous: boolean;
  submitterDiscordUsername: string | null;
  status: SuggestionStatus;
  adminNotes: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: number | null;
}

export interface SuggestionSubmit {
  category: SuggestionCategory;
  title: string;
  body: string;
  anonymous: boolean;
  submitterDiscordUsername?: string | null;
  website?: string; // honeypot — must be empty
}

export function useSubmitSuggestion() {
  return useMutation({
    mutationFn: (body: SuggestionSubmit) =>
      apiSend<{ ok: true; id: number }>("POST", "/api/suggestions", body),
  });
}

export function useAdminSuggestions(enabled: boolean, status?: SuggestionStatus) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["admin", "suggestions", status ?? "all"],
    queryFn: () => adminGet<{ suggestions: Suggestion[] }>(`/api/admin/suggestions${query}`),
    enabled,
    staleTime: 0,
  });
}

export function useUpdateSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { status?: SuggestionStatus; adminNotes?: string } }) =>
      adminSend<{ suggestion: Suggestion }>("PATCH", `/api/admin/suggestions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "suggestions"] }),
  });
}
