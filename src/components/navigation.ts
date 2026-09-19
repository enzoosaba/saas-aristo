import {
  Home,
  ListChecks,
  NotebookPen,
  CalendarDays,
  User,
  Users,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { StudyState } from "@/lib/domain";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const primaryNavItems: NavItem[] = [
  { href: "/", label: "Início", icon: Home },
  { href: "/rotina", label: "Rotina", icon: ListChecks },
  { href: "/calendario", label: "Calendário", icon: CalendarDays },
  { href: "/questoes", label: "Questões", icon: NotebookPen },
  { href: "/perfil", label: "Perfil", icon: User },
];

const mentorItem: NavItem = { href: "/mentoria", label: "Mentoria", icon: Users };
const adminItem: NavItem = {
  href: "/admin",
  label: "Torre de controle",
  icon: ShieldCheck,
};

// Who sees which role-gated destination. Single source of truth for both the
// navigation rail/bar (MainNav) and the mobile "more" menu (MobileMoreMenu),
// so the two can never disagree about visibility — only about *where* the
// item is drawn.
export function roleNavItems(
  data: Pick<StudyState, "user" | "platformAdmin">,
): NavItem[] {
  return [
    ...(data.user.role === "mentor" ? [mentorItem] : []),
    ...(data.platformAdmin ? [adminItem] : []),
  ];
}
