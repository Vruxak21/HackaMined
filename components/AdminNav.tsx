"use client";

import { SidebarNav } from "./SidebarNav";
import {
  LayoutDashboard,
  Upload,
  Files,
  ClipboardList,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/upload", label: "Upload File", icon: Upload },
  { href: "/admin/files", label: "All Files", icon: Files },
  { href: "/admin/audit", label: "Audit Log", icon: ClipboardList },
  { href: "/admin/users", label: "Users", icon: Users },
];

export function AdminNav() {
  return <SidebarNav navItems={navItems} />;
}
