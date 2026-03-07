"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield,
  Bell,
  LayoutDashboard,
  Upload,
  Files,
  ClipboardList,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard",  icon: LayoutDashboard },
  { href: "/admin/upload",    label: "Upload File", icon: Upload },
  { href: "/admin/files",     label: "All Files",   icon: Files },
  { href: "/admin/audit",     label: "Audit Log",   icon: ClipboardList },
  { href: "/admin/users",     label: "Users",       icon: Users },
] as const;

// ── Theme toggle ──────────────────────────────────────────────────────────────

function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-9 w-9 shrink-0" />;
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark
        ? <Sun size={16} className="transition-transform duration-300" />
        : <Moon size={16} className="transition-transform duration-300" />}
    </button>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

interface AdminShellProps {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  userRole: string;
}

export function AdminShell({
  children,
  userName,
  userEmail,
  userRole,
}: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const avatarLetter = (userName[0] ?? userEmail[0] ?? "A").toUpperCase();
  const isAdmin = userRole === "ADMIN";

  // Persist sidebar state
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pii-sentinel-sidebar");
      if (saved === "true") setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  function toggle() {
    setCollapsed((v) => {
      try { localStorage.setItem("pii-sentinel-sidebar", String(!v)); } catch {}
      return !v;
    });
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.push("/");
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* ── Topbar ─────────────────────────────────────────────── */}
        <header className="flex h-15 shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md z-50">

          {/* Left */}
          <div className="flex items-center gap-2">
            {/* Collapse toggle */}
            <button
              onClick={toggle}
              className="hidden lg:flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed
                ? <ChevronRight size={14} />
                : <ChevronLeft size={14} />}
            </button>

            {/* Brand */}
            <Link
              href="/admin/dashboard"
              className="group flex items-center gap-2.5"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary shadow-[0_0_12px_rgba(214,89,174,0.25)] transition-all duration-200 group-hover:shadow-[0_0_20px_rgba(214,89,174,0.4)]">
                <Shield size={13} className="text-primary-foreground" />
              </div>
              <div className="hidden sm:block">
                <p className="font-display text-sm font-bold tracking-tight text-foreground leading-none">
                  PII Sentinel
                </p>
                <p className="text-[0.55rem] font-semibold uppercase tracking-widest text-muted-foreground mt-0.5 leading-none">
                  by Tribastion
                </p>
              </div>
            </Link>
          </div>

          {/* Right */}
          <div className="flex items-center gap-1">
            <ThemeButton />

            <button
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={16} />
            </button>

            <div className="mx-1.5 h-5 w-px bg-border" />

            {/* User chip */}
            <div className="flex items-center gap-2 rounded-md px-2 py-1">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[0.65rem] font-bold text-primary ring-1 ring-primary/25">
                {avatarLetter}
              </div>
              <div className="hidden md:block">
                <p className="max-w-30 truncate text-xs font-semibold text-foreground leading-none" title={userName}>
                  {userName}
                </p>
                <p className="text-[0.58rem] text-muted-foreground mt-0.5 leading-none">
                  {isAdmin ? "Administrator" : "Standard User"}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Sidebar ──────────────────────────────────────────── */}
          <aside
            className={cn(
              "hidden lg:flex flex-col shrink-0 overflow-hidden border-r border-border bg-sidebar",
              "transition-[width] duration-250 ease-in-out",
              collapsed ? "w-16" : "w-64"
            )}
          >
            {/* Nav */}
            <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 space-y-0.5">
              {!collapsed && (
                <p className="mb-1 px-3 pb-1 text-[0.58rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
                  Navigation
                </p>
              )}

              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const isActive = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium overflow-hidden",
                      "transition-all duration-150",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {/* Active accent bar */}
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full bg-primary",
                        "transition-all duration-200",
                        isActive ? "h-5 opacity-100" : "h-0 opacity-0"
                      )}
                    />

                    <Icon
                      size={15}
                      className={cn(
                        "shrink-0 transition-colors duration-150",
                        collapsed ? "mx-auto" : "",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />

                    <span
                      className={cn(
                        "whitespace-nowrap leading-none",
                        "transition-all duration-250",
                        collapsed ? "w-0 opacity-0 overflow-hidden" : "opacity-100"
                      )}
                    >
                      {label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {/* Footer */}
            <div className="shrink-0 border-t border-border px-2 py-3 space-y-1">
              {/* Encryption badge */}
              {!collapsed && (
                <div className="mx-1 mb-2 flex items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5">
                  <Shield size={10} className="shrink-0 text-primary" />
                  <span className="text-[0.58rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    AES-256-GCM
                  </span>
                </div>
              )}

              {/* Sign out */}
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                title={collapsed ? "Sign Out" : undefined}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground",
                  "transition-all duration-150 hover:bg-destructive/10 hover:text-destructive",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <LogOut
                  size={14}
                  className={cn(
                    "shrink-0 transition-colors",
                    collapsed ? "mx-auto" : "",
                    "group-hover:text-destructive"
                  )}
                />
                <span
                  className={cn(
                    "whitespace-nowrap leading-none",
                    "transition-all duration-250",
                    collapsed ? "w-0 opacity-0 overflow-hidden" : "opacity-100"
                  )}
                >
                  {signingOut ? "Signing out…" : "Sign Out"}
                </span>
              </button>

              {/* Version */}
              {!collapsed && (
                <p className="px-3 pt-1 text-[0.55rem] text-muted-foreground/50">
                  PII Sentinel v0.1 · {userEmail}
                </p>
              )}
            </div>
          </aside>

          {/* ── Main content ─────────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto bg-background">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
