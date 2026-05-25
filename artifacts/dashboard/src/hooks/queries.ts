import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend, apiGet } from "@/lib/api";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type CardType = "tank" | "aircraft" | "ship" | "vehicle" | "infantry" | "boss" | "community" | "event" | "achievement" | "limited";

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
  setName: string | null;
  createdAt: string;
}

export type CardPatch = Partial<{
  name: string;
  description: string;
  rarity: Rarity;
  cardType: CardType;
  dropWeight: number;
  worthValue: number;
  burnValue: number;
  imageUrl: string | null;
  maxCopies: number | null;
  isLimitedEdition: boolean;
  isEventExclusive: boolean;
  inPacks: boolean;
  droppable: boolean;
  isArchived: boolean;
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

// ── Admin ────────────────────────────────────────────────────────────────────
export function useAdminCards(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "cards"],
    queryFn: () => adminGet<{ cards: Card[] }>("/api/admin/cards"),
    enabled,
    staleTime: 0,
  });
}

function invalidateCardLists(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["admin", "cards"] });
  qc.invalidateQueries({ queryKey: ["cards"] });
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CardPatch & { name: string; rarity: Rarity }) =>
      adminSend<{ card: Card }>("POST", "/api/admin/cards", body),
    onSuccess: () => invalidateCardLists(qc),
  });
}

export function useUpdateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: CardPatch }) =>
      adminSend<{ card: Card }>("PATCH", `/api/admin/cards/${id}`, patch),
    onSuccess: () => invalidateCardLists(qc),
  });
}

export function useDuplicateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminSend<{ card: Card }>("POST", `/api/admin/cards/${id}/duplicate`),
    onSuccess: () => invalidateCardLists(qc),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminSend<{ deleted: true; id: number }>("DELETE", `/api/admin/cards/${id}`),
    onSuccess: () => invalidateCardLists(qc),
  });
}
