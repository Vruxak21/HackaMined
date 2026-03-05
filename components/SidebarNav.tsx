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
    <nav className="flex flex-col gap-1">
      {navItems.map(({ href, label, icon: Icon }) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={[
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
              // left border always present to avoid layout shift; color changes on active
              "border-l-2",
              isActive
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-transparent text-gray-500 hover:bg-blue-50/60 hover:text-blue-600",
            ].join(" ")}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={16} className="shrink-0" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
