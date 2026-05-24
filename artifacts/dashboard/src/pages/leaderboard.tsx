import { useState, useEffect } from "react";
import { useLeaderboard } from "@/hooks/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Trophy, Medal, Crown } from "lucide-react";

export default function Leaderboard() {
  const [guildIdInput, setGuildIdInput] = useState("");
  const [activeGuildId, setActiveGuildId] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("dn_guildId");
    if (saved) {
      setGuildIdInput(saved);
      setActiveGuildId(saved);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (guildIdInput.trim()) {
      localStorage.setItem("dn_guildId", guildIdInput.trim());
      setActiveGuildId(guildIdInput.trim());
    }
  };

  const { data, isLoading, error } = useLeaderboard(activeGuildId);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <Crown className="h-5 w-5 text-[hsl(var(--rarity-legendary))]" />;
      case 2: return <Medal className="h-5 w-5 text-gray-400" />;
      case 3: return <Medal className="h-5 w-5 text-amber-700" />;
      default: return <span className="font-mono text-muted-foreground font-bold">{rank}</span>;
    }
  };

  return (
    <div className="container max-w-screen-xl py-8 px-4 md:px-8 bg-tactical-pattern min-h-[calc(100vh-100px)]">
      <div className="mb-12 text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight uppercase text-foreground mb-2 flex items-center justify-center gap-3">
          <Trophy className="h-8 w-8 text-primary" />
          Leaderboard
        </h1>
        <p className="text-muted-foreground font-mono uppercase tracking-widest text-sm mb-8">
          Top collectors ranked by net worth
        </p>

        <form onSubmit={handleSearch} className="flex gap-2 w-full">
          <Input
            type="text"
            placeholder="Enter Discord Server (Guild) ID..."
            value={guildIdInput}
            onChange={(e) => setGuildIdInput(e.target.value)}
            className="font-mono bg-card/50 text-center text-lg h-12"
            data-testid="input-guild-id"
          />
          <Button type="submit" size="lg" className="px-8 font-mono tracking-widest uppercase">
            Load
          </Button>
        </form>
      </div>

      {!activeGuildId ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border/50 rounded-xl bg-card/30">
          <TargetIcon className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="font-mono uppercase tracking-widest text-muted-foreground">Awaiting coordinates</p>
          <p className="text-sm text-muted-foreground mt-2">Enter a Guild ID above to view standings.</p>
        </div>
      ) : isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex h-64 flex-col items-center justify-center text-center">
           <p className="text-destructive font-mono uppercase tracking-widest mb-2">Failed to retrieve data</p>
           <p className="text-muted-foreground text-sm">Server not found or data is restricted.</p>
        </div>
      ) : data?.entries && data.entries.length > 0 ? (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 font-mono tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 w-20 text-center">Rank</th>
                  <th className="px-6 py-4">Collector ID</th>
                  <th className="px-6 py-4 text-right">Unique</th>
                  <th className="px-6 py-4 text-right">Total</th>
                  <th className="px-6 py-4 text-right">Net Worth</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.userId} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 text-center">
                       <div className="flex justify-center items-center h-full">
                         {getRankIcon(entry.rank)}
                       </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-medium text-foreground">
                      {entry.userId}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                      {entry.uniqueCards.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                      {entry.totalCards.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-primary">
                      {entry.netWorth.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border/50 rounded-xl bg-card/30">
          <p className="font-mono uppercase tracking-widest text-muted-foreground">No data found</p>
          <p className="text-sm text-muted-foreground mt-2">No collectors found in this guild.</p>
        </div>
      )}
    </div>
  );
}

function TargetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}
