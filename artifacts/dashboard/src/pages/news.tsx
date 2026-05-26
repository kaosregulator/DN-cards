import { Link } from "wouter";
import { useNews } from "@/hooks/queries";
import { resolveImageUrl } from "@/lib/api";
import { Loader2, Pin, Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function News() {
  const { data, isLoading, error } = useNews();
  const posts = data?.posts ?? [];

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (error) {
    return <div className="container py-20 text-center text-destructive">Failed to load news.</div>;
  }

  return (
    <div className="container max-w-3xl py-12 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Newspaper className="h-7 w-7 text-primary" />
        <h1 className="text-4xl font-black uppercase tracking-tight">News</h1>
      </div>
      {posts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground font-mono text-sm">No posts yet — check back soon.</div>
      ) : (
        <ul className="space-y-4">
          {posts.map(p => {
            const img = resolveImageUrl(p.imageUrl);
            return (
              <li key={p.id} className="rounded-xl border border-border/50 bg-card/40 overflow-hidden hover:bg-card/60 transition-colors">
                <Link href={`/news/${p.slug}`} className="block">
                  {img && <img src={img} alt="" className="w-full max-h-48 object-cover" loading="lazy" />}
                  <div className="p-5 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                      {p.pinned && <Badge variant="outline" className="border-yellow-500/40 text-yellow-400"><Pin className="h-3 w-3 mr-1" />Pinned</Badge>}
                      <span>{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : "draft"}</span>
                    </div>
                    <h2 className="text-xl font-bold">{p.title}</h2>
                    <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">{p.bodyMd.slice(0, 280)}{p.bodyMd.length > 280 ? "…" : ""}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
