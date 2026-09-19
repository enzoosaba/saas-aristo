"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useStudy } from "./StudyProvider";
import { roleNavItems } from "./navigation";

// Overflow (bottom-bar range, <1024px) for the role-gated destinations (Mentoria, Torre de
// controle) that no longer fit in the bottom bar. Renders nothing for a
// plain student, so their header is unchanged.
export default function MobileMoreMenu() {
  const { data } = useStudy();
  const pathname = usePathname();
  const items = roleNavItems(data);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;
  const onRoleRoute = items.some((item) => item.href === pathname);
  return (
    <div className="more-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="more-menu-trigger"
        aria-label="Mais seções"
        aria-expanded={open}
        aria-controls="more-menu-panel"
        data-current={onRoleRoute || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
      </button>
      <nav
        id="more-menu-panel"
        className="more-menu-panel"
        aria-label="Seções adicionais"
        hidden={!open}
      >
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="more-menu-item"
            aria-current={pathname === href ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
