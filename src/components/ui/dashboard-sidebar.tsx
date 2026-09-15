"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Search,
  Home,
  ListChecks,
  NotebookPen,
  ClipboardList,
  CalendarDays,
  User,
  Users,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ArrowUpRight,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

type Destination = {
  href: string;
  title: string;
  icon: LucideIcon;
  description: string;
};

const destinations: Destination[] = [
  {
    href: "/",
    title: "Início",
    icon: Home,
    description: "Visão geral e missões",
  },
  {
    href: "/rotina",
    title: "Rotina",
    icon: ListChecks,
    description: "Hábitos e tarefas diárias",
  },
  {
    href: "/planos",
    title: "Planos",
    icon: ClipboardList,
    description: "Planejamento de estudos",
  },
  {
    href: "/calendario",
    title: "Calendário",
    icon: CalendarDays,
    description: "Agenda e provas",
  },
  {
    href: "/questoes",
    title: "Banco de questões",
    icon: NotebookPen,
    description: "Registros e desempenho",
  },
  {
    href: "/perfil",
    title: "Perfil",
    icon: User,
    description: "Histórico e minha conta",
  },
];

const mentorDestination: Destination = {
  href: "/mentoria",
  title: "Espaço do mentor",
  icon: Users,
  description: "Alunos e desempenho diário",
};

import { useStudy } from "../StudyProvider";
import Avatar from "./Avatar";

export default function DashboardSidebar() {
  const { data } = useStudy();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const workspace = useRef<HTMLDetailsElement>(null);
  const searchable =
    data.user.role === "mentor" ? [...destinations, mentorDestination] : destinations;
  const current = searchable.find((item) => item.href === pathname);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const results = searchable.filter((item) =>
    normalize(`${item.title} ${item.description}`).includes(normalize(query)),
  );

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    function keydown(event: KeyboardEvent) {
      if (
        desktop.matches &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setQuery("");
        dialog.current?.showModal();
      }
    }
    function resize() {
      if (!desktop.matches) dialog.current?.close();
    }
    document.addEventListener("keydown", keydown);
    desktop.addEventListener("change", resize);
    return () => {
      document.removeEventListener("keydown", keydown);
      desktop.removeEventListener("change", resize);
    };
  }, []);

  function navLink(item: (typeof destinations)[number]) {
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className="desktop-nav-item"
        aria-current={pathname === item.href ? "page" : undefined}
        title={collapsed ? item.title : undefined}
      >
        <Icon size={18} strokeWidth={1.5} />
        <span>
          {item.title}
          <small>{item.description}</small>
        </span>
        {pathname === item.href && <i aria-hidden="true" />}
      </Link>
    );
  }

  return (
    <div className="desktop-sidebar-shell" data-collapsed={collapsed}>
      <aside className="desktop-sidebar" aria-label="Espaço da mentoria">
        <details className="desktop-workspace" ref={workspace}>
          <summary aria-label="Opções da Mentoria Coelho">
            <Image src="/brand/coelho.png" alt="" width={36} height={36} />
            <span>
              <strong>Mentoria Coelho</strong>
              <small>Seu espaço de estudos</small>
            </span>
            <ChevronDown size={16} />
          </summary>
          <div className="desktop-workspace-menu">
            <p>Mentoria Coelho</p>
            <Link
              href="/"
              onClick={() => workspace.current?.removeAttribute("open")}
            >
              Visão geral
            </Link>
            <Link
              href="/perfil"
              onClick={() => workspace.current?.removeAttribute("open")}
            >
              Meu perfil
            </Link>
          </div>
        </details>
        <button
          ref={searchButton}
          type="button"
          className="desktop-search-button"
          aria-label="Buscar páginas"
          aria-haspopup="dialog"
          onClick={() => {
            setQuery("");
            dialog.current?.showModal();
          }}
        >
          <Search size={18} />
          <span>Buscar páginas</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Navegação principal desktop" className="desktop-nav">
          <div className="desktop-nav-group">
            <p>VISÃO GERAL</p>
            {navLink(destinations[0])}
          </div>
          <div className="desktop-nav-group">
            <p>ORGANIZAR & ESTUDAR</p>
            {destinations.slice(1, 5).map(navLink)}
          </div>
          <div className="desktop-nav-group">
            <p>MINHA EVOLUÇÃO</p>
            {navLink(destinations[5])}
          </div>
          {data.user.role === "mentor" && (
            <div className="desktop-nav-group">
              <p>MENTORIA</p>
              {navLink(mentorDestination)}
            </div>
          )}
        </nav>
        <div className="desktop-sidebar-footer">
          <div className="desktop-workspace-note">
            <GraduationCap size={20} />
            <span>
              Seu plano, no seu ritmo.<small>Organize. Estude. Evolua.</small>
            </span>
          </div>
          <Link href="/perfil" className="desktop-user">
            <Avatar user={data.user} />
            <span>
              <strong>{data.user.name}</strong>
              <small>Minha conta</small>
            </span>
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </aside>
      <div className="desktop-breadcrumb">
        <button
          type="button"
          aria-label={
            collapsed ? "Expandir menu lateral" : "Recolher menu lateral"
          }
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
        </button>
        <span>Mentoria Coelho</span>
        <ChevronRight size={13} />
        <strong>{current?.title || "Meu espaço"}</strong>
      </div>
      <dialog
        ref={dialog}
        className="desktop-search-dialog"
        aria-labelledby="desktop-search-title"
        onClose={() => {
          if (window.matchMedia("(min-width: 1024px)").matches)
            searchButton.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === dialog.current) {
            const r = dialog.current.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              dialog.current.close();
          }
        }}
      >
        <div className="desktop-search-field">
          <Search size={20} />
          <label
            className="sr-only"
            id="desktop-search-title"
            htmlFor="desktop-search"
          >
            Buscar páginas da plataforma
          </label>
          <input
            id="desktop-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar páginas da plataforma…"
          />
          <button
            type="button"
            aria-label="Fechar busca"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <div className="desktop-search-results">
          {results.length ? (
            results.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => dialog.current?.close()}
              >
                <item.icon size={20} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <ArrowUpRight size={16} />
              </Link>
            ))
          ) : (
            <p role="status">
              Nenhuma página encontrada. Tente “rotina”, “agenda” ou “perfil”.
            </p>
          )}
        </div>
        <p className="desktop-search-hint">
          Tab para navegar · Enter para abrir · Esc para fechar
        </p>
      </dialog>
    </div>
  );
}
