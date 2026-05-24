import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] text-center px-4 bg-tactical-pattern">
      <div className="bg-card/50 p-8 rounded-xl border border-border/50 max-w-md w-full backdrop-blur-sm">
        <ShieldAlert className="mx-auto h-16 w-16 text-destructive mb-6" />
        <h1 className="text-4xl font-bold uppercase tracking-widest text-foreground mb-4 font-mono">
          404: Intel Not Found
        </h1>
        <p className="text-muted-foreground mb-8 text-sm uppercase tracking-widest font-mono">
          The coordinates you entered do not match any known assets or command sectors.
        </p>
        <Link 
          href="/" 
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 uppercase tracking-widest font-mono"
        >
          Return to Command
        </Link>
      </div>
    </div>
  );
}
