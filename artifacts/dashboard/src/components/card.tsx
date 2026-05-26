import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card as CardType } from "@/hooks/queries";
import { resolveImageUrl } from "@/lib/api";
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
  mythic: "bg-pink-500/10 text-pink-400 border-pink-500/30",
};

const rarityBorders = {
  common: "border-border",
  uncommon: "border-[hsl(var(--rarity-uncommon)_/_0.5)]",
  rare: "border-[hsl(var(--rarity-rare)_/_0.5)]",
  epic: "border-[hsl(var(--rarity-epic)_/_0.5)]",
  legendary: "border-[hsl(var(--rarity-legendary))] rarity-glow-legendary",
  mythic: "border-pink-500 rarity-glow-legendary",
};

// Holo glow tints used as the default dialog stage background (when admin
// hasn't set a custom previewBgColor). Matches the rarity colors above.
const RARITY_STAGE_BG: Record<string, string> = {
  mythic:    "radial-gradient(ellipse at top, rgba(255,45,146,0.28), rgba(0,0,0,0) 60%)",
  legendary: "radial-gradient(ellipse at top, rgba(234,179,8,0.25), rgba(0,0,0,0) 60%)",
  epic:      "radial-gradient(ellipse at top, rgba(168,85,247,0.25), rgba(0,0,0,0) 60%)",
  rare:      "radial-gradient(ellipse at top, rgba(59,130,246,0.22), rgba(0,0,0,0) 60%)",
  uncommon:  "radial-gradient(ellipse at top, rgba(34,197,94,0.18), rgba(0,0,0,0) 60%)",
  common:    "radial-gradient(ellipse at top, rgba(148,163,184,0.15), rgba(0,0,0,0) 60%)",
};

type PreviewAnim = "spin" | "bounce" | "flip" | "pulse" | "none";

// Framer-motion variants per animation. Mirror the values used in
// pages/events.tsx so behavior is identical wherever a card is opened.
const PREVIEW_ANIMS: Record<PreviewAnim, { initial: any; animate: any; transition: any }> = {
  spin:   { initial: { rotateY: -180, opacity: 0, y: -10 }, animate: { rotateY: 0, opacity: 1, y: 0 }, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } },
  flip:   { initial: { rotateX: -90, opacity: 0 },          animate: { rotateX: 0, opacity: 1 },       transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
  bounce: { initial: { y: -120, opacity: 0 },               animate: { y: 0, opacity: 1 },             transition: { type: "spring", stiffness: 320, damping: 14 } },
  pulse:  { initial: { scale: 0.7, opacity: 0 },            animate: { scale: [0.7, 1.08, 1], opacity: 1 }, transition: { duration: 0.7, times: [0, 0.6, 1] } },
  none:   { initial: { opacity: 0 },                        animate: { opacity: 1 },                    transition: { duration: 0.25 } },
};

export function CardComponent({ card, relativeDropChance, count, shinyCount = 0 }: CardComponentProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Resolve once — `/objects/...` paths need `/api/storage` prefix, absolute
  // URLs pass through. Both <img> tags use the same resolved URL.
  const resolvedImageUrl = resolveImageUrl(card.imageUrl);
  const [imageError, setImageError] = useState(!resolvedImageUrl);

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
          {!imageError && resolvedImageUrl ? (
            <img
              src={resolvedImageUrl}
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
          {(() => {
            // Per-card preview customization (admin-set in /admin) — animation
            // + background tint. Defaults to "spin" + the rarity holo gradient.
            const anim = PREVIEW_ANIMS[card.previewAnimation as PreviewAnim] ?? PREVIEW_ANIMS.spin;
            const stageStyle: React.CSSProperties = card.previewBgColor
              ? { background: card.previewBgColor }
              : { backgroundImage: RARITY_STAGE_BG[card.rarity] ?? RARITY_STAGE_BG.common };
            return (
              <div className="flex flex-col md:flex-row">
                {/* Left: animated image stage. Landscape cards (e.g. Boss Sea
                    Tank) get a 4:3 frame + object-contain so the full image is
                    visible without sideways cropping. */}
                {(() => {
                  // Landscape gets a wider 4:3 stage; portrait stays 3:4.
                  // Both use object-contain so the full artwork is always
                  // visible (no cropping), letterboxed against the stage bg.
                  const isLandscape = card.displayOrientation === "landscape";
                  const stageAspect = isLandscape ? "aspect-[4/3]" : "aspect-[3/4]";
                  return (
                <div
                  className={`relative w-full md:w-1/2 ${stageAspect} overflow-hidden flex items-center justify-center [perspective:1000px] p-4`}
                  style={stageStyle}
                >
                  <motion.div
                    key={card.id /* re-trigger when card changes */}
                    initial={anim.initial}
                    animate={anim.animate}
                    transition={anim.transition}
                    className="relative w-full h-full flex items-center justify-center [transform-style:preserve-3d]"
                  >
                    {!imageError && resolvedImageUrl ? (
                      <img
                        src={resolvedImageUrl}
                        alt={card.name}
                        className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
                      />
                    ) : (
                      <div className={`flex h-full w-full flex-col items-center justify-center p-6 text-center ${rarityColors[card.rarity]}`}>
                        <ImageIcon className="mb-4 h-16 w-16 opacity-50" />
                        <span className="text-xl font-bold tracking-widest opacity-80 uppercase">{card.name}</span>
                      </div>
                    )}
                    {card.isLimitedEdition && (
                      <div className="absolute top-3 left-3">
                        <Badge className="bg-background/90 text-primary border-primary font-mono px-2 py-0.5 text-[10px]">
                          LE • {card.totalMinted}{card.maxCopies ? `/${card.maxCopies}` : ""}
                        </Badge>
                      </div>
                    )}
                  </motion.div>
                </div>
                  );
                })()}

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
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
