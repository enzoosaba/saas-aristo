"use client";
import Link from "next/link";
import {
  Map,
  Plus,
  ArrowUpRight,
  NotebookPen,
  CheckCheck,
  Trophy,
} from "lucide-react";
import Card from "./ui/Card";
import { useStudy } from "./StudyProvider";

export function DesktopQuestionsCard() {
  const { data } = useStudy();
  const total = data.questions.reduce((sum, q) => sum + q.total, 0);
  const correct = data.questions.reduce((sum, q) => sum + q.correct, 0);
  const rate = total ? Math.round((correct / total) * 100) : 0;
  return (
    <Card className="desktop-overview-card desktop-overview-questions">
      <div className="section-heading">
        <h2>
          <NotebookPen size={20} />
          Questões feitas
        </h2>
        <Link href="/questoes" aria-label="Abrir Banco de Questões">
          <ArrowUpRight size={20} />
        </Link>
      </div>
      <div className="desktop-question-body">
        <div
          className="question-ring"
          role="img"
          aria-label={`${total} questões respondidas, ${rate}% de acertos`}
          style={{
            background: `conic-gradient(var(--brand-orange) ${rate}%,var(--border-default) 0)`,
          }}
        >
          <div>
            <strong>{total.toLocaleString("pt-BR")}</strong>
            <span>respondidas</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>Acertos</dt>
            <dd>
              {correct.toLocaleString("pt-BR")}
              <span>{rate}%</span>
            </dd>
          </div>
          <div>
            <dt>Erros</dt>
            <dd>
              {(total - correct).toLocaleString("pt-BR")}
              <span>{total ? 100 - rate : 0}%</span>
            </dd>
          </div>
        </dl>
      </div>
      {!total && (
        <p className="panel-description">
          Registre sua primeira prática para acompanhar os resultados.
        </p>
      )}
    </Card>
  );
}
export function DesktopPlanCard() {
  const { data } = useStudy();
  const plan = [...data.plans]
    .filter((p) => p.date >= data.today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return (
    <Card className="desktop-overview-card desktop-plan-card">
      <div className="section-heading">
        <h2>
          <Map size={20} />
          Meu planejamento semanal
        </h2>
        <Link href="/planos" aria-label="Abrir planejamento">
          <ArrowUpRight size={20} />
        </Link>
      </div>
      {plan?.prioridades ? (
        <div className="desktop-plan-copy">
          <p className="eyebrow">
            SUAS PRIORIDADES · {plan.date.split("-").reverse().join("/")}
          </p>
          <p>{plan.prioridades}</p>
          {plan.horarios && (
            <>
              <p className="eyebrow">HORÁRIOS RESERVADOS</p>
              <p>{plan.horarios}</p>
            </>
          )}
        </div>
      ) : (
        <div className="study-empty">
          <Link
            className="plan-add-symbol"
            href="/planos"
            aria-label="Criar meu planejamento"
          >
            <Plus size={28} />
          </Link>
          <strong>Dê direção ao seu próximo passo</strong>
          <p>Organize prioridades e horários para estudar com mais clareza.</p>
        </div>
      )}
      <p className="weekly-plan-count">
        {data.sessions.filter((s) => s.date >= data.today).length} sessões
        futuras planejadas
      </p>
      <Link className="panel-link" href="/planos">
        Organizar minha semana
        <ArrowUpRight size={18} />
      </Link>
    </Card>
  );
}
export function DesktopRecentCard() {
  const { data } = useStudy();
  const completed = data.records
    .filter((r) => r.done)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card className="desktop-overview-card desktop-recent-card">
      <div className="section-heading">
        <h2>
          <Trophy size={20} />
          Realizações recentes
        </h2>
        <Link href="/perfil">
          Ver histórico
          <ArrowUpRight size={16} />
        </Link>
      </div>
      {completed.length ? (
        <div className="desktop-recent-list">
          {completed.slice(0, 4).map((r) => (
            <div key={`${r.itemId}-${r.date}`}>
              <span className="recent-check">
                <CheckCheck size={24} />
              </span>
              <strong>
                {data.items.find((i) => i.id === r.itemId)?.title ||
                  "Atividade concluída"}
              </strong>
              <span>{r.date.split("-").reverse().join("/")}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="study-empty">
          <CheckCheck size={28} />
          <strong>Suas conquistas começam na rotina</strong>
          <p>As atividades concluídas aparecerão aqui.</p>
        </div>
      )}
    </Card>
  );
}
