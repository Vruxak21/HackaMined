import { requireAdmin } from "@/lib/auth-helper";
import { getSession } from "@/lib/auth-helper";
import { AdminShell } from "@/components/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  const session = await getSession();
  const name  = session?.user?.name  ?? session?.user?.email ?? "Admin";
  const email = session?.user?.email ?? "";
  const role  = (session?.user as { role?: string })?.role ?? "ADMIN";

  return (
    <AdminShell userName={name} userEmail={email} userRole={role}>
      {children}
    </AdminShell>
  );
}

