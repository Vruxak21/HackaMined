import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helper";
import prisma from "@/lib/db";

/**
 * Server-side role-based redirect gate.
 * After any sign-in (email or OAuth) we land here, check the DB role,
 * and push the user to the right section of the app.
 */
export default async function AuthCallbackPage() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (user?.role === "ADMIN") {
    redirect("/admin/dashboard");
  }

  redirect("/user/files");
}
