import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helper";
import { getSession } from "@/lib/auth-helper";
import { SignOutButton } from "@/components/SignOutButton";
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
  const email = session?.user?.email ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Top navbar ─────────────────────────────────────────────── */}
      <header className="flex h-13 items-center justify-between border-b border-border bg-card px-6">
        {/* Left: brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex size-6 items-center justify-center rounded-md bg-foreground">
            <Shield size={12} className="text-background" />
          </div>
          <span className="text-xs font-bold tracking-tight text-foreground">PII Sanitizer</span>
        </div>

        {/* Right: email + sign out */}
        <div className="flex items-center gap-4">
          <span className="max-w-48 truncate text-xs text-muted-foreground" title={email}>
            {email}
          </span>
          <SignOutButton
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/6 hover:text-destructive"
          />
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────── */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
