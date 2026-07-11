import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/api";
import { SmartImage } from "./SmartImage";
import { useShouldPlayMedia } from "./hooks";

type MediaKind = "video" | "gif" | "image";

function kindFromSrc(src: string): MediaKind {
  const clean = src.split("?")[0].toLowerCase();
  if (clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".mov")) return "video";
  if (clean.endsWith(".gif")) return "gif";
  return "image";
}

interface AmbientMediaProps {
  /** mp4/webm, animated gif, or static image (jpg/png/webp). */
  src: string | null | undefined;
  /** Static frame used as the reduced-motion fallback AND the frozen frame
   *  for GIFs when they scroll off-screen (GIFs can't be paused natively). */
  poster?: string | null;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
  /** Dim overlay opacity 0–1 for legibility over the media. */
  overlay?: number;
}

/**
 * Ambient background media that is performance- and battery-friendly:
 *  - <video> is paused when it scrolls off-screen or the tab is hidden.
 *  - GIFs swap to a static `poster` frame when off-screen/hidden.
 *  - `prefers-reduced-motion` renders the static poster and never animates.
 *  - Static images just render through SmartImage (lazy + LQIP).
 */
export function AmbientMedia({ src, poster, alt = "", className, fit = "cover", overlay = 0 }: AmbientMediaProps) {
  const { ref, shouldPlay, reducedMotion } = useShouldPlayMedia<HTMLDivElement>("300px");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resolved = resolveImageUrl(src);
  const resolvedPoster = resolveImageUrl(poster);
  const kind = resolved ? kindFromSrc(resolved) : "image";

  // Drive <video> play/pause from the derived shouldPlay signal.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || kind !== "video") return;
    if (shouldPlay) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => { /* autoplay blocked — poster stays */ });
    } else {
      v.pause();
    }
  }, [shouldPlay, kind]);

  const overlayEl =
    overlay > 0 ? <div aria-hidden className="absolute inset-0 bg-background" style={{ opacity: overlay }} /> : null;

  if (!resolved) {
    return (
      <div ref={ref} className={cn("relative h-full w-full", className)}>
        <SmartImage src={poster} alt={alt} fit={fit} />
        {overlayEl}
      </div>
    );
  }

  // Static image OR reduced-motion → render the poster/frame, never animate.
  if (kind === "image" || reducedMotion) {
    const staticSrc = reducedMotion && resolvedPoster ? poster : (kind === "image" ? src : poster ?? src);
    return (
      <div ref={ref} className={cn("relative h-full w-full", className)}>
        <SmartImage src={staticSrc} alt={alt} fit={fit} />
        {overlayEl}
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div ref={ref} className={cn("relative h-full w-full overflow-hidden", className)}>
        <video
          ref={videoRef}
          className={cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain")}
          src={resolved}
          poster={resolvedPoster ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
        />
        {overlayEl}
      </div>
    );
  }

  // GIF: play the gif while on-screen; freeze to the static poster otherwise.
  return (
    <div ref={ref} className={cn("relative h-full w-full overflow-hidden", className)}>
      {shouldPlay || !resolvedPoster ? (
        <SmartImage src={src} alt={alt} fit={fit} />
      ) : (
        <SmartImage src={poster} alt={alt} fit={fit} />
      )}
      {overlayEl}
    </div>
  );
}
