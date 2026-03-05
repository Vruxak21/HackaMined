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
  // Guard — redirects to "/" if not authenticated
  const user = await requireAuth();

  // Admins should not use the user portal
  if (user.role === "ADMIN") {
    redirect("/admin/dashboard");
  }

  const session = await getSession();
  const email = session?.user?.email ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* ── Top navbar ───────────────────────────────────────────────────────── */}
      <header className="relative flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6 shadow-sm">
        {/* Left: brand */}
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 shadow-sm">
            <Shield size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight text-gray-900">PII Sanitizer</span>
        </div>

        {/* Center: section title */}
        <span className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-gray-600">
          Sanitized Files
        </span>

        {/* Right: email + sign out */}
        <div className="flex items-center gap-3">
          <span className="max-w-45 truncate text-xs text-gray-500" title={email}>
            {email}
          </span>
          <SignOutButton
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          />
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1">{children}</main>
    </div>
  );
}

