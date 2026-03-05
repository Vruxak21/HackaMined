import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "./auth";
import prisma from "./db";
import type { Action } from "./generated/prisma/client";

// ── getSession ─────────────────────────────────────────────────────────────
// Reads the current Better Auth session from incoming request headers.
// Returns the session object or null (never throws).

export async function getSession() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    return session ?? null;
  } catch {
    return null;
  }
}

// ── requireAdmin ───────────────────────────────────────────────────────────
// For use in Server Components / Route Handlers that need ADMIN access.
// Always re-queries the DB — never trusts the session role field alone.
// Redirects to /signin (unauthenticated) or /user/files (wrong role).

export async function requireAdmin() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) {
    redirect("/signin");
  }

  if (user.role !== "ADMIN") {
    redirect("/user/files");
  }

  return user;
}

// ── requireAuth ────────────────────────────────────────────────────────────
// For use in Server Components / Route Handlers that need any authenticated user.
// Returns user with role included from DB.

export async function requireAuth() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    redirect("/signin");
  }

  return user;
}

// ── logAction ──────────────────────────────────────────────────────────────
// Fire-and-forget audit logger. NEVER throws — logging must never crash
// the main operation. Call with await but failure is silent.

export async function logAction(params: {
  userId: string;
  action: Action;
  fileId?: string;
  detail?: string;
  ipAddress?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        fileId: params.fileId ?? null,
        detail: params.detail ?? null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Intentionally silenced — audit log failure must never surface to users
    console.error("[logAction] Failed to write audit log:", err);
  }
}
