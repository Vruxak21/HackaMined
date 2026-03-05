"use client";

import { SidebarNav } from "./SidebarNav";
import { Files } from "lucide-react";

const navItems = [
  { href: "/user/files", label: "My Files", icon: Files },
];

export function UserNav() {
  return <SidebarNav navItems={navItems} />;
}
