"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, NotebookPen, CalendarDays, User } from "lucide-react";

const items = [
  { href: "/", label: "Início", icon: Home },
  { href: "/rotina", label: "Rotina", icon: ListChecks },
  { href: "/planos", label: "Planos", icon: NotebookPen },
  { href: "/calendario", label: "Calendário", icon: CalendarDays },
  { href: "/perfil", label: "Perfil", icon: User },
];

export default function MainNav() {
  const pathname = usePathname();
  return <nav className="header-navigation" aria-label="Navegação principal">
    {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href}
      aria-current={pathname === href ? "page" : undefined}
      className={`header-tab ${pathname === href ? "is-current" : ""}`}>
      <Icon size={19} /><span>{label}</span>
    </Link>)}
  </nav>;
}
