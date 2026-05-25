import { useState, useEffect } from "react";
import { useProfile } from "@/hooks/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardComponent } from "@/components/card";
import { Loader2, Zap, PackageOpen, Flame, Lock, Unlock, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function Profile() {
  const [guildIdInput, setGuildIdInput] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  
  const [activeParams, setActiveParams] = useState<{guildId: string, userId: string} | null>(null);

  useEffect(() => {
    const savedGuild = localStorage.getItem("dn_guildId");
    const savedUser = localStorage.getItem("dn_userId");
    
    if (savedGuild) setGuildIdInput(savedGuild);
    if (savedUser) setUserIdInput(savedUser);
    
    if (savedGuild && savedUser) {
      setActiveParams({ guildId: savedGuild, userId: savedUser });
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (guildIdInput.trim() && userIdInput.trim()) {
      localStorage.setItem("dn_guildId", guildIdInput.trim());
      localStorage.setItem("dn_userId", userIdInput.trim());
      setActiveParams({ guildId: guildIdInput.trim(), userId: userIdInput.trim() });
    }
  };

  const { data, isLoading, error } = useProfile(activeParams?.guildId || "", activeParams?.userId || "");

  return (
    <div className="container max-w-screen-2xl py-8 px-4 md:px-8 bg-tactical-pattern min-h-[calc(100vh-100px)]">
      <div className="mb-8 border-b border-border pb-8">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4 max-w-3xl mx-auto bg-card p-4 rounded-xl border border-border/50 shadow-md">
          <Input
            type="text"
            placeholder="Guild ID"
            value={guildIdInput}
            onChange={(e) => setGuildIdInput(e.target.value)}
            className="font-mono bg-background"
            data-testid="input-guild-id"
          />
          <Input
            type="text"
            placeholder="User ID"
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            className="font-mono bg-background"
            data-testid="input-user-id"
          />
          <Button type="submit" className="font-mono uppercase tracking-widest min-w-32">
            Inspect
          </Button>
        </form>
      </div>

      {!activeParams ? (
        <div className="flex flex-col items-center justify-center py-32 text-center text-muted-foreground">
          <p className="font-mono uppercase tracking-widest">Awaiting Parameters</p>
          <p className="text-sm mt-2">Enter Guild ID and User ID to view profile.</p>
        </div>
      ) : isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex h-64 flex-col items-center justify-center text-center">
           <p className="text-destructive font-mono uppercase tracking-widest mb-2">Access Denied</p>
           <p className="text-muted-foreground text-sm">Failed to retrieve profile data.</p>
        </div>
      ) : data ? (
        <div className="space-y-12">
          
          {/* Header Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             {/* Rank Card */}
             <div className="col-span-1 md:col-span-2 bg-card rounded-xl border border-border p-6 relative overflow-hidden flex flex-col justify-center">
                <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
                <div className="flex items-center gap-6 relative z-10">
                   <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-background border-4 border-primary/20 text-5xl shadow-[0_0_30px_rgba(255,100,0,0.15)]">
                      {data.stats.rank.emoji}
                   </div>
                   <div className="flex-1">
                      <h2 className="text-3xl font-bold uppercase tracking-wider text-foreground mb-1">
                        {data.stats.rank.name}
                      </h2>
                      <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground mb-4 flex-wrap">
                        <span>{data.stats.uniqueCards} / {data.stats.totalCards} CARDS</span>
                        {data.stats.shinyCards > 0 && (
                          <span className="flex items-center gap-1 text-pink-300" title="Shiny copies owned (count at 2× value)">
                            <Sparkles className="h-3 w-3" /> {data.stats.shinyCards} SHINY
                          </span>
                        )}
                        <span className="text-primary font-bold">{data.stats.netWorth.toLocaleString()} NET WORTH</span>
                      </div>
                      
                      {data.stats.nextRank && (
                        <div className="space-y-2">
                           <div className="flex justify-between text-xs font-mono uppercase tracking-widest">
                              <span className="text-muted-foreground">Progression</span>
                              <span className="text-primary">{data.stats.nextRank.cardsNeeded} more to {data.stats.nextRank.name}</span>
                           </div>
                           <Progress 
                              value={(data.stats.uniqueCards / data.stats.nextRank.min) * 100} 
                              className="h-2"
                           />
                        </div>
                      )}
                   </div>
                </div>
             </div>

             {/* Currency Card */}
             <div className="bg-card rounded-xl border border-border p-6 grid grid-cols-2 gap-4">
                <div className="flex flex-col justify-center bg-background/50 p-4 rounded-lg border border-border/50">
                  <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2 flex items-center gap-2"><Zap className="w-3 h-3 text-primary"/> Shards</span>
                  <span className="text-2xl font-mono font-bold text-foreground">{data.currency.shards.toLocaleString()}</span>
                </div>
                <div className="flex flex-col justify-center bg-background/50 p-4 rounded-lg border border-border/50">
                  <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2 flex items-center gap-2"><Zap className="w-3 h-3"/> Total Earned</span>
                  <span className="text-xl font-mono font-medium text-foreground/80">{data.currency.totalEarned.toLocaleString()}</span>
                </div>
                <div className="flex flex-col justify-center bg-background/50 p-4 rounded-lg border border-border/50">
                  <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2 flex items-center gap-2"><PackageOpen className="w-3 h-3 text-blue-400"/> Packs</span>
                  <span className="text-xl font-mono font-medium text-foreground/80">{data.currency.packsOpened.toLocaleString()}</span>
                </div>
                <div className="flex flex-col justify-center bg-background/50 p-4 rounded-lg border border-border/50">
                  <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2 flex items-center gap-2"><Flame className="w-3 h-3 text-destructive"/> Burned</span>
                  <span className="text-xl font-mono font-medium text-foreground/80">{data.currency.cardsBurned.toLocaleString()}</span>
                </div>
             </div>
          </div>

          {/* Achievements */}
          <div>
            <h3 className="text-xl font-bold uppercase tracking-wider mb-6 border-b border-border/40 pb-2">Service Record</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
               {data.achievements.map((ach) => (
                 <div 
                   key={ach.key}
                   className={`relative overflow-hidden rounded-xl border p-4 flex flex-col items-center text-center transition-all ${
                     ach.unlocked 
                       ? "bg-card border-primary/30 shadow-[0_0_15px_rgba(255,100,0,0.05)]" 
                       : "bg-muted/20 border-border/50 opacity-60 grayscale hover:opacity-80"
                   }`}
                 >
                   <div className="text-4xl mb-3 mt-2 drop-shadow-md">{ach.emoji}</div>
                   <h4 className={`font-bold uppercase tracking-wide text-sm mb-1 ${ach.unlocked ? "text-primary" : "text-foreground"}`}>
                     {ach.name}
                   </h4>
                   <p className="text-[10px] text-muted-foreground font-mono leading-relaxed mb-4 flex-1">
                     {ach.description}
                   </p>
                   {ach.unlocked ? (
                     <Badge variant="outline" className="text-[9px] uppercase font-mono border-primary/20 text-primary">
                       <Unlock className="w-3 h-3 mr-1 inline-block" /> Unlocked
                     </Badge>
                   ) : (
                     <div className="text-[9px] uppercase font-mono text-muted-foreground flex items-center">
                       <Lock className="w-3 h-3 mr-1" /> Locked
                     </div>
                   )}
                 </div>
               ))}
            </div>
          </div>

          {/* Collection Grid */}
          <div>
            <div className="flex items-center justify-between mb-6 border-b border-border/40 pb-2">
               <h3 className="text-xl font-bold uppercase tracking-wider">Asset Collection</h3>
               <Badge variant="secondary" className="font-mono">
                 {data.collection.length} UNIQUE
               </Badge>
            </div>
            
            {data.collection.length === 0 ? (
               <div className="text-center py-16 border border-dashed border-border rounded-xl">
                 <p className="font-mono uppercase tracking-widest text-muted-foreground">No assets acquired</p>
               </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {data.collection.map((item) => (
                   <CardComponent
                      key={item.cardId}
                      card={{
                        id: item.cardId,
                        name: item.name,
                        rarity: item.rarity,
                        cardType: item.cardType,
                        imageUrl: item.imageUrl,
                        worthValue: item.worthValue,
                        burnValue: item.burnValue,
                        // Provide defaults for missing fields needed by CardComponent
                        description: "",
                        dropWeight: 0,
                        isLimitedEdition: false,
                        isEventExclusive: false,
                        maxCopies: null,
                        totalMinted: 0,
                        flavor: null,
                        droppable: true,
                        inPacks: true,
                        isArchived: false,
                        setName: null,
                        createdAt: item.firstCaughtAt
                      }}
                      count={item.count}
                      shinyCount={item.shinyCount}
                   />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
