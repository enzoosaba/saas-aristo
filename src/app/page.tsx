"use client";
import { useState } from "react";
import {
  DesktopQuestionsCard,
  DesktopPlanCard,
  DesktopRecentCard,
} from "@/components/DesktopOverview";
import MobileStudyCards from "@/components/MobileStudyCards";
import QuestionAnalytics from "@/components/QuestionAnalytics";
import Link from "next/link";
import {
  ArrowUpRight,
  Flame,
  ListChecks,
  NotebookPen,
  CalendarDays,
  ChartNoAxesCombined,
} from "lucide-react";
import { MissionsPanel, PerformancePanels } from "@/components/StudyPanels";
import Card from "@/components/ui/Card";
import { useStudy } from "@/components/StudyProvider";
import { daysLabel, progress } from "@/lib/domain";
const shortcuts = [
  { href: "/rotina", label: "Minha rotina", icon: ListChecks },
  { href: "/planos", label: "Meu planejamento", icon: NotebookPen },
  { href: "/calendario", label: "Meu calendário", icon: CalendarDays },
  { href: "/questoes", label: "Banco de questões", icon: ChartNoAxesCombined },
];
export default function InicioPage() {
  const { data } = useStudy();
  const [view, setView] = useState("today");
  const [minimized, setMinimized] = useState(false);
  const stats = progress(data.items, data.records, data.today);
  const tasks = data.items
    .filter((i) => i.kind === "task" && i.date === data.today)
    .sort((a, b) => a.time.localeCompare(b.time));
  return (
    <div className="workspace-page home-workspace flex flex-col gap-5">
      {data.demo && (
        <p className="demo-data-label">
          Dados demonstrativos para apresentação
        </p>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">UM DIA DE CADA VEZ</p>
          <h1>Olá, {data.user.name.split(" ")[0]}</h1>
          <p>Seu progresso começa com o que você faz hoje.</p>
        </div>
        <span className="streak-pill">
          <Flame size={18} />
          {daysLabel(stats.streak)} de constância
        </span>
      </div>
      <div
        className="home-view-switch"
        role="group"
        aria-label="Seções do início"
      >
        {[
          { id: "today", label: "Hoje" },
          { id: "performance", label: "Desempenho" },
          { id: "goals", label: "Metas" },
        ].map((v) => (
          <button
            key={v.id}
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "today" && (
        <div className="desktop-today-grid">
          <section className="streak-highlight">
            <div className="section-heading">
              <h2>Sua constância, em movimento</h2>
              <button
                aria-label={
                  minimized ? "Expandir destaque" : "Minimizar destaque"
                }
                aria-expanded={!minimized}
                onClick={() => setMinimized(!minimized)}
              >
                {minimized ? "+" : "−"}
              </button>
            </div>
            {!minimized && (
              <>
                <strong className="hero-streak-number">
                  <Flame aria-hidden="true" />
                  {stats.streak}{" "}
                  <span>{stats.streak === 1 ? "dia" : "dias"}</span>
                </strong>
                <p>Pequenos passos hoje. Novas possibilidades amanhã.</p>
                <Link className="desktop-hero-action" href="/rotina">
                  Continuar minha rotina
                  <ArrowUpRight size={18} />
                </Link>
                <div className="highlight-progress">
                  <span>
                    {stats.todayDone} de {stats.todayTotal} atividades de hoje
                  </span>
                  <progress
                    aria-label="Atividades concluídas hoje"
                    max={stats.todayTotal || 1}
                    value={stats.todayDone}
                  />
                </div>
              </>
            )}
          </section>
          <MissionsPanel />
          <DesktopQuestionsCard />
          <DesktopPlanCard />
          <DesktopRecentCard />
          <div className="shortcuts">
            {shortcuts.map(({ href, label, icon: Icon }) => (
              <Link href={href} className="shortcut" key={href}>
                <span className="shortcut-icon">
                  <Icon size={22} />
                </span>
                <ArrowUpRight className="shortcut-arrow" size={18} />
                <h2>{label}</h2>
              </Link>
            ))}
          </div>

          <div className="desktop-today-secondary">
            <Card className="agenda-card">
              <div className="section-heading">
                <h2>Agenda de hoje</h2>
                <Link href="/calendario">Ver agenda</Link>
              </div>
              {tasks.length ? (
                tasks.map((task) => (
                  <div className="agenda-item" key={task.id}>
                    <div>
                      <span className="agenda-time">
                        {task.time || "Sem horário"}
                      </span>
                      <p>{task.title}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="study-empty">
                  <strong>Dia com espaço livre</strong>
                  <p>Adicione suas tarefas pelo botão + no topo.</p>
                </div>
              )}
            </Card>
            <div className="daily-quote">
              <p className="eyebrow">SEU PRÓXIMO PASSO</p>
              <blockquote>Um plano possível. Uma ação por vez.</blockquote>
              <Link className="panel-link" href="/planos">
                Planejar meu dia
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      )}
      {view === "performance" && (
        <div className="home-section-content">
          <QuestionAnalytics />
          <PerformancePanels />
        </div>
      )}
      {view === "goals" && (
        <div className="home-section-content">
          <div className="section-intro">
            <h2>Seu plano de constância</h2>
            <p>
              Ajuste metas possíveis e reserve espaço para o próximo
              compromisso.
            </p>
          </div>
          <MobileStudyCards />
          <div className="desktop-goal-history">
            <MissionsPanel />
            <PerformancePanels />
          </div>
        </div>
      )}
    </div>
  );
}
