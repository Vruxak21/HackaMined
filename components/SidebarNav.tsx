"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarNavProps {
  navItems: NavItem[];
}

export function SidebarNav({ navItems }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {navItems.map(({ href, label, icon: Icon }) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={[
              "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
              "relative overflow-hidden",
              isActive
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
            aria-current={isActive ? "page" : undefined}
          >
            {/* Amber left accent bar */}
            <span
              className={[
                "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full transition-all duration-200",
                isActive ? "h-4 bg-primary opacity-100" : "h-0 opacity-0",
              ].join(" ")}
            />
            <Icon
              size={15}
              className={[
                "shrink-0 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              ].join(" ")}
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
