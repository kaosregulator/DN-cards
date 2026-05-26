import { Link, useRoute } from "wouter";
import { useNewsPost } from "@/hooks/queries";
import { resolveImageUrl } from "@/lib/api";
import { Loader2, ArrowLeft, Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function NewsDetail() {
  const [, params] = useRoute("/news/:slug");
  const slug = params?.slug ?? "";
  const { data, isLoading, error } = useNewsPost(slug);
  const post = data?.post;

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (error || !post) {
    return (
      <div className="container max-w-3xl py-20 text-center">
        <p className="text-destructive font-mono uppercase tracking-widest mb-3">Post not found.</p>
        <Link href="/news" className="text-sm underline">Back to news</Link>
      </div>
    );
  }

  const img = resolveImageUrl(post.imageUrl);
  return (
    <article className="container max-w-3xl py-12 px-4">
      <Link href="/news" className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="h-3 w-3" /> All news
      </Link>
      {img && <img src={img} alt="" className="w-full max-h-96 object-cover rounded-xl border border-border/40 mb-6" />}
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
        {post.pinned && <Badge variant="outline" className="border-yellow-500/40 text-yellow-400"><Pin className="h-3 w-3 mr-1" />Pinned</Badge>}
        <span>{post.publishedAt ? new Date(post.publishedAt).toLocaleString() : "draft"}</span>
      </div>
      <h1 className="text-4xl font-black tracking-tight mb-6">{post.title}</h1>
      <div className="prose prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">{post.bodyMd}</div>
    </article>
  );
}
