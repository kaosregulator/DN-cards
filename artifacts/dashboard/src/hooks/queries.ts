import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

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
  setName: string | null;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  uniqueCards: number;
  totalCards: number;
  netWorth: number;
}

export interface Profile {
  guildId: string;
  userId: string;
  stats: {
    uniqueCards: number;
    totalCards: number;
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
    count: number;
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
