import { requireAdmin } from "@/lib/auth-helper";
import { getSession } from "@/lib/auth-helper";
import { AdminNav } from "@/components/AdminNav";
import { SignOutButton } from "@/components/SignOutButton";
import { Shield } from "lucide-react";

// ── Layout ────────────────────────────────────────────────────────────────────

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard — redirects to "/" if not admin
  await requireAdmin();

  // Grab email for display (session already validated above)
  const session = await getSession();
  const email = session?.user?.email ?? "admin";
  const avatarLetter = email[0].toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white">

        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
            <Shield size={16} className="text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight text-gray-900">
            PII Sanitizer
          </span>
        </div>

        {/* Thin separator */}
        <div className="mx-4 border-t border-gray-100" />

        {/* Section label */}
        <p className="mt-4 px-4 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Admin Panel
        </p>

        {/* Navigation */}
        <div className="mt-2 flex-1 overflow-y-auto px-2">
          <AdminNav />
        </div>

        {/* Bottom user area */}
        <div className="border-t border-gray-100 px-2 py-3">
          {/* User info row */}
          <div className="mb-1 flex items-center gap-2.5 rounded-md px-2 py-2">
            {/* Avatar */}
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
              {avatarLetter}
            </div>

            {/* Email + badge */}
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-xs font-medium text-gray-700"
                title={email}
              >
                {email}
              </p>
              <span className="mt-0.5 inline-block rounded bg-blue-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                Admin
              </span>
            </div>
          </div>

          {/* Sign out */}
          <SignOutButton />
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-white">
        {children}
      </main>
    </div>
  );
}
