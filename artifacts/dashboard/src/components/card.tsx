import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card as CardType } from "@/hooks/queries";
import { AlertCircle, Target, Zap, Shield, Image as ImageIcon, Sparkles } from "lucide-react";

// Must match SHINY_MULTIPLIER / SHINY_RATE in api-server/src/bot/cards-data.ts.
const SHINY_MULTIPLIER = 2;

interface CardComponentProps {
  card: CardType;
  relativeDropChance?: number; // percentage
  count?: number;
  shinyCount?: number;
}

const rarityColors = {
  common: "bg-muted text-muted-foreground border-muted-foreground/30",
  uncommon: "bg-[hsl(var(--rarity-uncommon)_/_0.1)] text-[hsl(var(--rarity-uncommon))] border-[hsl(var(--rarity-uncommon)_/_0.3)]",
  rare: "bg-[hsl(var(--rarity-rare)_/_0.1)] text-[hsl(var(--rarity-rare))] border-[hsl(var(--rarity-rare)_/_0.3)]",
  epic: "bg-[hsl(var(--rarity-epic)_/_0.1)] text-[hsl(var(--rarity-epic))] border-[hsl(var(--rarity-epic)_/_0.3)]",
  legendary: "bg-[hsl(var(--rarity-legendary)_/_0.1)] text-[hsl(var(--rarity-legendary))] border-[hsl(var(--rarity-legendary)_/_0.3)]",
};

const rarityBorders = {
  common: "border-border",
  uncommon: "border-[hsl(var(--rarity-uncommon)_/_0.5)]",
  rare: "border-[hsl(var(--rarity-rare)_/_0.5)]",
  epic: "border-[hsl(var(--rarity-epic)_/_0.5)]",
  legendary: "border-[hsl(var(--rarity-legendary))] rarity-glow-legendary",
};

export function CardComponent({ card, relativeDropChance, count, shinyCount = 0 }: CardComponentProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [imageError, setImageError] = useState(!card.imageUrl);

  const isLegendary = card.rarity === "legendary";

  return (
    <>
      <motion.div
        layoutId={`card-${card.id}`}
        onClick={() => setIsOpen(true)}
        className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-card-foreground transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${rarityBorders[card.rarity]}`}
        data-testid={`card-item-${card.id}`}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Count Badge — totals both piles so users see their full holdings at a glance. */}
        {count !== undefined && (count + shinyCount) > 1 && (
          <div className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-lg">
            x{count + shinyCount}
          </div>
        )}

        {/* Shiny badge — own at least one shiny of this card. */}
        {shinyCount > 0 && (
          <div
            className="absolute -left-2 -top-2 z-10 flex items-center gap-1 rounded-full bg-gradient-to-r from-pink-500 to-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg"
            title={`${shinyCount} shiny copies (counts at ${SHINY_MULTIPLIER}× value)`}
          >
            <Sparkles className="h-3 w-3" />
            ×{shinyCount}
          </div>
        )}

        {/* Image Area */}
        <div className="relative aspect-[3/4] w-full bg-muted/50 overflow-hidden flex items-center justify-center">
          {!imageError ? (
            <img
              src={card.imageUrl!}
              alt={card.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className={`flex h-full w-full flex-col items-center justify-center p-6 text-center ${rarityColors[card.rarity]} border-0`}>
               <ImageIcon className="mb-4 h-12 w-12 opacity-50" />
               <span className="font-bold tracking-widest opacity-80 uppercase">{card.name}</span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-80" />

          {/* Top Tags */}
          <div className="absolute left-2 top-2 flex flex-col gap-1">
            {card.isLimitedEdition && (
              <Badge variant="outline" className="bg-background/80 text-[10px] uppercase border-primary/50 text-primary font-mono tracking-wider backdrop-blur-sm">
                LTD {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""}
              </Badge>
            )}
            {card.isEventExclusive && (
              <Badge variant="outline" className="bg-background/80 text-[10px] uppercase border-destructive/50 text-destructive font-mono tracking-wider backdrop-blur-sm">
                Event
              </Badge>
            )}
            {!card.droppable && !card.isEventExclusive && !card.isLimitedEdition && (
              <Badge variant="outline" className="bg-background/80 text-[10px] uppercase border-muted-foreground/50 text-muted-foreground font-mono tracking-wider backdrop-blur-sm">
                Non-drop
              </Badge>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="relative flex flex-1 flex-col p-4 z-10 -mt-12">
           <div className="mb-2 flex items-center justify-between">
            <Badge variant="outline" className={`text-[10px] uppercase font-mono tracking-widest ${rarityColors[card.rarity]}`}>
              {card.rarity}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground uppercase">{card.cardType}</span>
          </div>

          <h3 className="mb-1 font-bold leading-tight tracking-wide text-foreground line-clamp-2">
            {card.name}
          </h3>
          
          <div className="mt-auto pt-4 flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span className="flex items-center gap-1" title="Worth Value">
               <Zap className="h-3 w-3 text-primary" /> {card.worthValue}
            </span>
            {relativeDropChance !== undefined && (
              <span className="flex items-center gap-1" title="Drop Chance">
                <Target className="h-3 w-3" /> {relativeDropChance.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* Detail Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl overflow-hidden p-0 bg-card/95 backdrop-blur-md border-border/50">
          <div className="flex flex-col md:flex-row">
            {/* Left: Image */}
            <div className="relative w-full md:w-1/2 aspect-[3/4] bg-muted">
               {!imageError ? (
                  <img
                    src={card.imageUrl!}
                    alt={card.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className={`flex h-full w-full flex-col items-center justify-center p-6 text-center ${rarityColors[card.rarity]}`}>
                    <ImageIcon className="mb-4 h-16 w-16 opacity-50" />
                    <span className="text-xl font-bold tracking-widest opacity-80 uppercase">{card.name}</span>
                  </div>
                )}
                 {card.isLimitedEdition && (
                  <div className="absolute top-4 left-4">
                     <Badge className="bg-background/90 text-primary border-primary font-mono px-3 py-1 text-xs">
                        LIMITED EDITION • {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""} MINTED
                     </Badge>
                  </div>
                 )}
            </div>

            {/* Right: Info */}
            <div className="flex w-full md:w-1/2 flex-col p-6 md:p-8">
               <DialogHeader className="mb-6 text-left">
                  <div className="mb-3 flex items-center gap-2">
                    <Badge className={`text-xs uppercase font-mono tracking-widest ${rarityColors[card.rarity]}`}>
                      {card.rarity}
                    </Badge>
                    <Badge variant="outline" className="text-xs uppercase font-mono tracking-widest">
                      {card.cardType}
                    </Badge>
                  </div>
                  <DialogTitle className="text-2xl font-bold tracking-wider">{card.name}</DialogTitle>
                  {card.setName && (
                    <p className="text-sm font-mono text-primary tracking-widest uppercase mt-1">{card.setName}</p>
                  )}
               </DialogHeader>

               <div className="flex-1 space-y-6">
                 <div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
                 </div>

                 {card.flavor && (
                    <div className="border-l-2 border-primary/50 pl-4 py-1">
                      <p className="text-sm italic text-foreground/80 font-serif leading-relaxed">"{card.flavor}"</p>
                    </div>
                 )}

                  <div className="grid grid-cols-2 gap-4 rounded-lg bg-background/50 p-4 border border-border/30">
                     <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Worth</span>
                        <span className="flex items-center gap-2 font-mono text-lg font-medium">
                           <Zap className="h-4 w-4 text-primary" />
                           {card.worthValue}
                        </span>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Burn Value</span>
                        <span className="flex items-center gap-2 font-mono text-lg font-medium text-destructive">
                           <AlertCircle className="h-4 w-4" />
                           {card.burnValue}
                        </span>
                     </div>

                     {/* Shiny variant payout — same card at SHINY_MULTIPLIER. */}
                     <div className="col-span-2 flex items-center justify-between gap-3 rounded-md border border-pink-500/30 bg-gradient-to-r from-pink-500/5 via-transparent to-amber-400/5 p-3">
                       <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-pink-300 font-mono">
                         <Sparkles className="h-3 w-3" /> Shiny variant <span className="opacity-60">(0.5% roll)</span>
                       </span>
                       <span className="flex items-center gap-4 font-mono text-sm">
                         <span title="Shiny worth" className="flex items-center gap-1"><Zap className="h-3 w-3 text-pink-300" /> {(card.worthValue * SHINY_MULTIPLIER).toLocaleString()}</span>
                         <span title="Shiny burn" className="flex items-center gap-1 text-destructive/80"><AlertCircle className="h-3 w-3" /> {(card.burnValue * SHINY_MULTIPLIER).toLocaleString()}</span>
                       </span>
                     </div>
                     {relativeDropChance !== undefined && card.droppable && (
                       <div className="flex flex-col">
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Drop Chance</span>
                          <span className="flex items-center gap-2 font-mono font-medium">
                             <Target className="h-4 w-4 text-muted-foreground" />
                             ~{relativeDropChance.toFixed(2)}%
                          </span>
                       </div>
                     )}
                  </div>
               </div>
               
               <div className="mt-8 pt-6 border-t border-border/30 text-[10px] font-mono text-muted-foreground uppercase tracking-widest flex justify-between">
                  <span>ID: {card.id.toString().padStart(4, '0')}</span>
                  <span>{new Date(card.createdAt).toLocaleDateString()}</span>
               </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
