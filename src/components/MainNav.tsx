"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

import {
  Home,
  ListChecks,
  NotebookPen,
  CalendarDays,
  User,
  Users,
  ShieldCheck,
} from "lucide-react";
import { useStudy } from "./StudyProvider";

const items = [
  { href: "/", label: "Início", icon: Home },

  { href: "/rotina", label: "Rotina", icon: ListChecks },

  { href: "/calendario", label: "Calendário", icon: CalendarDays },

  { href: "/questoes", label: "Questões", icon: NotebookPen },

  { href: "/perfil", label: "Perfil", icon: User },
];

const mentorItem = { href: "/mentoria", label: "Mentoria", icon: Users };
const adminItem = { href: "/admin", label: "Torre de controle", icon: ShieldCheck };

export default function MainNav() {
  const pathname = usePathname();
  const { data } = useStudy();
  const links = [
    ...items,
    ...(data.user.role === "mentor" ? [mentorItem] : []),
    ...(data.platformAdmin ? [adminItem] : []),
  ];

  return (
    <nav className="header-navigation" aria-label="Navegação principal">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}

          aria-current={pathname === href ? "page" : undefined}

          className={`header-tab ${pathname === href ? "is-current" : ""}`}
        >
          <Icon size={19} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
