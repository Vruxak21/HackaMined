import { redirect } from "next/navigation";
import { requireAuth, getSession } from "@/lib/auth-helper";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Shield } from "lucide-react";

export default async function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  if (user.role === "ADMIN") {
    redirect("/admin/dashboard");
  }

  const session = await getSession();
  const name = session?.user?.name ?? session?.user?.email ?? "";
  const email = session?.user?.email ?? "";
  const initials = name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Top navbar ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-15 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur-md">
        {/* Left: brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary shadow-sm">
            <Shield size={14} className="text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-sm font-bold tracking-tight text-foreground">PII Sentinel</span>
            <span className="text-[0.6rem] font-medium text-muted-foreground">by Tribastion</span>
          </div>
        </div>

        {/* Right: theme + user chip + sign out */}
        <div className="flex items-center gap-3">
          <ThemeToggle />

          {/* User chip */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-1.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[0.6rem] font-bold text-primary">
              {initials}
            </div>
            <div className="hidden flex-col leading-none sm:flex">
              <span className="max-w-32 truncate text-[0.7rem] font-semibold text-foreground" title={name}>
                {name}
              </span>
              <span className="text-[0.6rem] text-muted-foreground">User</span>
            </div>
          </div>

          <SignOutButton
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:border-destructive/40 hover:bg-destructive/8 hover:text-destructive active:scale-[0.97]"
          />
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────── */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
