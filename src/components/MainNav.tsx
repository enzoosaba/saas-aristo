"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

import { useStudy } from "./StudyProvider";
import { primaryNavItems, roleNavItems } from "./navigation";

export default function MainNav() {
  const pathname = usePathname();
  const { data } = useStudy();
  // Role-gated items stay in the DOM (visibility logic is unchanged); below
  // 1024px, where this renders as a bottom bar, CSS hides them from it and
  // MobileMoreMenu offers them from the top bar instead.
  const links = [
    ...primaryNavItems.map((item) => ({ ...item, role: false })),
    ...roleNavItems(data).map((item) => ({ ...item, role: true })),
  ];

  return (
    <nav className="header-navigation" aria-label="Navegação principal">
      {links.map(({ href, label, icon: Icon, role }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={`header-tab ${role ? "header-tab--role" : ""} ${pathname === href ? "is-current" : ""}`}
        >
          <Icon size={19} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
