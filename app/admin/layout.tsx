import { requireAdmin } from "@/lib/auth-helper";
import { getSession } from "@/lib/auth-helper";
import { AdminNav } from "@/components/AdminNav";
import { SignOutButton } from "@/components/SignOutButton";
import { Shield, ShieldCheck } from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  const session = await getSession();
  const email = session?.user?.email ?? "admin";
  const name = session?.user?.name ?? email;
  const avatarLetter = (name[0] ?? email[0]).toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card">

        {/* Brand lockup */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
          <div className="flex size-7 items-center justify-center rounded-md bg-foreground">
            <Shield size={13} className="text-background" />
          </div>
          <div>
            <p className="text-xs font-bold tracking-tight text-foreground leading-none">PII Sanitizer</p>
            <p className="text-[0.6rem] uppercase tracking-widest text-muted-foreground mt-0.5 font-semibold">Admin</p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <AdminNav />
        </div>

        {/* Security badge */}
        <div className="mx-2 mb-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5">
            <ShieldCheck size={11} className="shrink-0 text-primary" />
            <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">AES-256-GCM</span>
          </div>
        </div>

        {/* User area */}
        <div className="border-t border-border px-2 py-3 space-y-1">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[0.6rem] font-bold text-primary">
              {avatarLetter}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground" title={email}>
                {email}
              </p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
