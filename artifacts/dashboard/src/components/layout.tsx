import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

export function Nav() {
  const [location] = useLocation();
  const { user, isOwner, logout } = useAuth();

  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/", label: "Roster", show: true },
    { href: "/leaderboard", label: "Leaderboard", show: true },
    { href: "/profile", label: "Profile", show: true },
    { href: "/admin", label: "Admin", show: !!user },
    { href: "/admin/embeds", label: "Embeds", show: !!user },
    { href: "/admin/users", label: "Users", show: isOwner },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center gap-4">
        <Link href="/" className="flex items-center space-x-2 shrink-0">
          <span className="hidden font-bold sm:inline-block text-primary tracking-wider uppercase">
            DN COMMAND
          </span>
        </Link>
        <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium overflow-x-auto">
          {links.filter(l => l.show).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition-colors hover:text-foreground/80 uppercase tracking-widest whitespace-nowrap ${
                location === link.href ? "text-foreground" : "text-foreground/60"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {user ? (
            <>
              <span className="hidden sm:inline text-muted-foreground">{user.username}</span>
              <button
                onClick={() => logout.mutate()}
                className="text-foreground/60 hover:text-foreground uppercase tracking-widest"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="text-foreground/60 hover:text-foreground uppercase tracking-widest">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t py-6 md:py-0">
      <div className="container flex flex-col items-center justify-between gap-4 md:h-16 md:flex-row max-w-screen-2xl">
        <p className="text-sm leading-loose text-muted-foreground md:text-left tracking-wide">
          DN Cards public dashboard. A companion tool for the Discord bot.
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background">
      <Nav />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
