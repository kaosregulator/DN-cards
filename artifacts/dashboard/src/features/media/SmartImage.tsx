import { useState } from "react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/api";
import { Image as ImageIcon } from "lucide-react";

interface SmartImageProps {
  /** Raw imageUrl (absolute or `/objects/...`). Resolved internally. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Optional low-res base64/URL placeholder shown blurred until the real
   *  image decodes (LQIP). Falls back to a tinted shimmer when absent. */
  lqip?: string | null;
  /** A CSS color/gradient used as the placeholder tint (e.g. rarity color). */
  placeholderTint?: string;
  /** object-fit mode. */
  fit?: "cover" | "contain";
  /** Eager-load above-the-fold hero images; everything else lazy-loads. */
  priority?: boolean;
  /** Fallback node when the image is missing or fails to load. */
  fallback?: React.ReactNode;
  draggable?: boolean;
}

/**
 * Performance-first image: native lazy loading, async decode, blurred LQIP
 * placeholder, fade-in on load, and a graceful fallback on error. Supports
 * JPG/PNG/WEBP/animated-GIF sources transparently (all just <img>).
 */
export function SmartImage({
  src,
  alt,
  className,
  lqip,
  placeholderTint,
  fit = "cover",
  priority = false,
  fallback,
  draggable = false,
}: SmartImageProps) {
  const resolved = resolveImageUrl(src);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(!resolved);

  if (errored || !resolved) {
    return (
      <div
        className={cn("flex h-full w-full flex-col items-center justify-center bg-muted/40 text-muted-foreground", className)}
        style={placeholderTint ? { background: placeholderTint } : undefined}
      >
        {fallback ?? (
          <>
            <ImageIcon className="mb-2 h-8 w-8 opacity-40" />
            <span className="px-3 text-center text-xs font-bold uppercase tracking-widest opacity-70">{alt}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {/* LQIP / tint placeholder — visible until the real image fades in. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 transition-opacity duration-500",
          loaded ? "opacity-0" : "opacity-100",
          !lqip && "animate-pulse",
        )}
        style={
          lqip
            ? { backgroundImage: `url(${lqip})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(16px)", transform: "scale(1.1)" }
            : { background: placeholderTint ?? "hsl(var(--muted))" }
        }
      />
      <img
        src={resolved}
        alt={alt}
        draggable={draggable}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          "h-full w-full transition-opacity duration-500",
          fit === "cover" ? "object-cover" : "object-contain",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
