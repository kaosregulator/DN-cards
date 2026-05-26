import { useState } from "react";
import { getAdminToken, setAdminToken, ApiError, uploadImageFile, resolveImageUrl } from "@/lib/api";
import {
  useAdminNews, useCreateNews, useUpdateNews, useDeleteNews,
  type NewsPost, type NewsPostPatch,
} from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Upload, Loader2, LogOut, Pin } from "lucide-react";

function TokenGate({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="container max-w-md py-16">
      <div className="border border-border/50 bg-card/50 rounded-xl p-6 space-y-4">
        <h1 className="font-mono uppercase tracking-widest text-lg">News Admin</h1>
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) { setAdminToken(value.trim()); onAuthed(); } }} className="space-y-3">
          <Input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="ADMIN_TOKEN" className="font-mono" />
          <Button type="submit" className="w-full">Authenticate</Button>
        </form>
      </div>
    </div>
  );
}

function PostDialog({
  post, open, onOpenChange,
}: { post: NewsPost | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateNews();
  const update = useUpdateNews();
  const [form, setForm] = useState<NewsPostPatch>({});
  const [tracked, setTracked] = useState<number | "new" | null>(null);
  const [uploading, setUploading] = useState(false);

  const key = post?.id ?? (open ? "new" : null);
  if (open && tracked !== key) {
    setTracked(key);
    setForm(post ? {
      slug: post.slug, title: post.title, bodyMd: post.bodyMd, imageUrl: post.imageUrl,
      pinned: post.pinned, publishedAt: post.publishedAt,
    } : { slug: "", title: "", bodyMd: "", imageUrl: null, pinned: false, publishedAt: null });
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (post) {
        await update.mutateAsync({ id: post.id, patch: form });
        toast({ title: "Post updated" });
      } else {
        if (!form.title?.trim()) { toast({ variant: "destructive", title: "Title required" }); return; }
        await create.mutateAsync({
          title: form.title.trim(),
          slug: (form.slug ?? "").trim() || form.title.trim(),
          bodyMd: form.bodyMd ?? "",
          imageUrl: form.imageUrl ?? null,
          pinned: form.pinned ?? false,
          publishedAt: form.publishedAt ?? null,
        });
        toast({ title: "Post created" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const img = resolveImageUrl(form.imageUrl ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">{post ? `Edit · #${post.id}` : "New post"}</DialogTitle>
          <DialogDescription>Posts are visible to the public when "Published" is on.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="n-title">Title</Label>
            <Input id="n-title" value={form.title ?? ""} onChange={e => setForm(s => ({ ...s, title: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="n-slug">Slug (URL)</Label>
            <Input id="n-slug" value={form.slug ?? ""} onChange={e => setForm(s => ({ ...s, slug: e.target.value }))} placeholder="auto-generated from title" />
          </div>
          <div>
            <Label>Banner image</Label>
            <div className="flex gap-3 items-start">
              <div className="h-20 w-32 rounded-md bg-muted/50 border border-border/40 overflow-hidden flex-shrink-0">
                {img && <img src={img} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex-1 space-y-2">
                <Input value={form.imageUrl ?? ""} onChange={e => setForm(s => ({ ...s, imageUrl: e.target.value || null }))} placeholder="https://..." />
                <label className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border/60 cursor-pointer hover:bg-muted ${uploading ? "opacity-60" : ""}`}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload
                  <input type="file" accept="image/*" className="sr-only" disabled={uploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]; e.target.value = "";
                      if (!file) return;
                      setUploading(true);
                      try {
                        const path = await uploadImageFile(file);
                        setForm(s => ({ ...s, imageUrl: path }));
                      } catch (err) {
                        toast({ variant: "destructive", title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error" });
                      } finally { setUploading(false); }
                    }} />
                </label>
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="n-body">Body</Label>
            <Textarea id="n-body" rows={10} value={form.bodyMd ?? ""} onChange={e => setForm(s => ({ ...s, bodyMd: e.target.value }))} />
            <p className="text-xs text-muted-foreground mt-1">Plain text + line breaks. Markdown rendering will be added later.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between border border-border/40 rounded-md p-3 cursor-pointer">
              <span>Pinned</span>
              <Switch checked={!!form.pinned} onCheckedChange={v => setForm(s => ({ ...s, pinned: v }))} />
            </label>
            <label className="flex items-center justify-between border border-border/40 rounded-md p-3 cursor-pointer">
              <span>Published</span>
              <Switch checked={!!form.publishedAt} onCheckedChange={v => setForm(s => ({ ...s, publishedAt: v ? new Date().toISOString() : null }))} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {(create.isPending || update.isPending) ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function NewsAdmin() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [editing, setEditing] = useState<NewsPost | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const query = useAdminNews(authed);
  const del = useDeleteNews();

  if (authed && query.error instanceof ApiError && query.error.status === 401) {
    setAdminToken(null);
    setAuthed(false);
    toast({ variant: "destructive", title: "Token rejected" });
  }
  if (!authed) return <TokenGate onAuthed={() => setAuthed(true)} />;

  const posts = query.data?.posts ?? [];

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono uppercase tracking-widest">News Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">{posts.length} posts · {posts.filter(p => p.publishedAt).length} published</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" /> New post</Button>
          <Button size="sm" variant="outline" onClick={() => { setAdminToken(null); setAuthed(false); }}>
            <LogOut className="h-4 w-4 mr-1" /> Sign out
          </Button>
        </div>
      </div>

      {query.isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}
      {!query.isLoading && posts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No posts yet. Create one to get started.</div>
      )}

      {posts.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden bg-card/40">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase font-mono tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left p-3">Title</th>
                <th className="text-left p-3">Slug</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Updated</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(p => (
                <tr key={p.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="p-3 font-medium">{p.title}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{p.slug}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {p.pinned && <Badge variant="outline" className="text-xs border-yellow-500/40 text-yellow-400"><Pin className="h-3 w-3 mr-1" />pinned</Badge>}
                      {p.publishedAt
                        ? <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400">published</Badge>
                        : <Badge variant="outline" className="text-xs">draft</Badge>}
                    </div>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString()}</td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={async () => {
                        if (!confirm(`Delete "${p.title}"?`)) return;
                        try { await del.mutateAsync(p.id); toast({ title: "Deleted" }); }
                        catch (err) { toast({ variant: "destructive", title: "Delete failed", description: err instanceof Error ? err.message : "Unknown error" }); }
                      }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PostDialog post={editing} open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} />
      <PostDialog post={null} open={creating} onOpenChange={setCreating} />
    </div>
  );
}
