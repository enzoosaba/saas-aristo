"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Target,
  ArrowUpRight,
  ChartNoAxesCombined,
  ListChecks,
  Plus,
  CalendarDays,
} from "lucide-react";
import Card from "./ui/Card";
import ProgressBar from "./ui/ProgressBar";
import { useStudy } from "./StudyProvider";
import { progress, dayOffset, isScheduled } from "@/lib/domain";
export function MissionsPanel() {
  const { data } = useStudy();
  const [week, setWeek] = useState(false);
  const metrics = progress(data.items, data.records, data.today);
  const rows = data.items.filter((i) => isScheduled(i, data.today));
  const doneWeek = data.records.filter(
    (r) =>
      r.done && r.date >= dayOffset(data.today, -6) && r.date <= data.today,
  ).length;
  const periodDays = week
    ? Array.from({ length: 7 }, (_, i) => dayOffset(data.today, i - 6))
    : [data.today];
  const missions = data.items
    .map((item) => {
      const dates = periodDays.filter((d) => isScheduled(item, d));
      const goal = dates.length * (item.measure === "count" ? item.target : 1);
      const value = dates.reduce((sum, d) => {
        const r = data.records.find(
          (r) => r.itemId === item.id && r.date === d,
        );
        return (
          sum +
          (item.measure === "count"
            ? Math.min(r?.value || 0, item.target)
            : Number(r?.done || false))
        );
      }, 0);
      return { item, goal, value };
    })
    .filter((m) => m.goal > 0);
  const doneUnits = periodDays.reduce(
    (sum, d) =>
      sum +
      data.items.filter(
        (i) =>
          isScheduled(i, d) &&
          data.records.some((r) => r.itemId === i.id && r.date === d && r.done),
      ).length,
    0,
  );
  const totalUnits = periodDays.reduce(
    (sum, d) => sum + data.items.filter((i) => isScheduled(i, d)).length,
    0,
  );
  const completion = totalUnits
    ? Math.round((doneUnits / totalUnits) * 100)
    : 0;
  return (
    <Card className="missions-panel">
      <div className="panel-title">
        <h2>
          <Target size={20} />
          Missões
        </h2>
        <div className="period-switch">
          <button aria-pressed={!week} onClick={() => setWeek(false)}>
            Hoje
          </button>
          <button aria-pressed={week} onClick={() => setWeek(true)}>
            Semana
          </button>
        </div>
      </div>
      <div
        key={`mobile-${week ? "week" : "today"}`}
        className="mobile-mission-content motion-tab-panel"
      >
        <div className="mission-summary-line">
          <strong>{completion}% concluídas</strong>
          <span>
            <b>{week ? doneWeek * 20 : metrics.todayXp}</b> XP
          </span>
        </div>
        {missions.slice(0, 4).map(({ item, goal, value }) => (
          <div className="reference-mission-row" key={item.id}>
            <span
              className="mini-progress"
              aria-hidden="true"
              style={{
                background: `conic-gradient(var(--brand-orange) ${(value / goal) * 100}%, var(--border-default) 0)`,
              }}
            >
              <span>
                <ListChecks size={23} />
              </span>
            </span>
            <div>
              <p>
                <strong>{value.toLocaleString("pt-BR")}</strong>
                <span>
                  /{goal.toLocaleString("pt-BR")}
                  {item.unit ? ` ${item.unit}` : ""}
                </span>
              </p>
              <h3>{item.title}</h3>
            </div>
          </div>
        ))}
        {!missions.length && (
          <div className="study-empty">
            <ListChecks size={28} />
            <strong>Sua primeira missão começa aqui</strong>
            <p>Adicione um hábito ou uma tarefa à sua rotina.</p>
          </div>
        )}
        <div className="mission-quick-links">
          <Link href="/questoes">
            <Plus size={20} />
            Questões
          </Link>
          <Link href="/rotina">
            <CalendarDays size={20} />
            Minha rotina
          </Link>
        </div>
      </div>
      <div
        key={`desktop-${week ? "week" : "today"}`}
        className="desktop-mission-content motion-tab-panel"
      >
        <p className="panel-description">
          {week
            ? `${doneWeek} realizações nos últimos 7 dias.`
            : `${metrics.todayDone} de ${metrics.todayTotal} atividades concluídas hoje.`}
        </p>
        {!week && (
          <div className="mission-ring-wrap">
            <div
              className="question-ring"
              role="img"
              aria-label={`${metrics.todayDone} de ${metrics.todayTotal} atividades concluídas`}
              style={{
                background: `conic-gradient(var(--brand-orange) ${metrics.todayTotal ? (metrics.todayDone / metrics.todayTotal) * 100 : 0}%, var(--border-default) 0)`,
              }}
            >
              <div>
                <strong>
                  {metrics.todayDone}/{metrics.todayTotal}
                </strong>
                <span>concluídas</span>
              </div>
            </div>
          </div>
        )}
        {!week &&
          rows.slice(0, 4).map((item) => {
            const log = data.records.find(
              (r) => r.itemId === item.id && r.date === data.today,
            );
            return (
              <div className="mission-row" key={item.id}>
                <div>
                  <div className="mission-line">
                    <strong>{item.title}</strong>
                    <span>
                      {item.measure === "count"
                        ? `${log?.value || 0}/${item.target}`
                        : log?.done
                          ? "Concluído"
                          : "Pendente"}
                    </span>
                  </div>
                  <ProgressBar
                    label={item.title}
                    value={
                      item.measure === "count"
                        ? log?.value || 0
                        : Number(log?.done || false)
                    }
                    max={item.measure === "count" ? item.target : 1}
                  />
                </div>
              </div>
            );
          })}
        {rows.length === 0 && !week && (
          <div className="study-empty">
            <strong>Seu próximo passo</strong>
            <p>Crie uma atividade pelo botão + para começar.</p>
          </div>
        )}
        <Link href="/rotina" className="panel-link">
          Gerenciar minha rotina
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </Card>
  );
}
export function PerformancePanels() {
  const { data } = useStudy();
  const days = Array.from({ length: 7 }, (_, i) =>
    dayOffset(data.today, i - 6),
  );
  const values = days.map(
    (date) => data.records.filter((r) => r.date === date && r.done).length,
  );
  const max = Math.max(...values, 1);
  return (
    <Card>
      <div className="panel-title">
        <h2>
          <ChartNoAxesCombined size={20} />
          Sua última semana
        </h2>
      </div>
      <div
        className="history-bars"
        role="img"
        aria-label={days
          .map((d, i) => `${d}: ${values[i]} atividades concluídas`)
          .join("; ")}
      >
        {days.map((date, i) => (
          <div key={date} className="history-day">
            <span>{values[i]}</span>
            <div style={{ height: `${(values[i] / max) * 120 + 2}px` }} />
            <span>
              {date.slice(8)}/{date.slice(5, 7)}
            </span>
          </div>
        ))}
      </div>
      <p className="panel-description">
        Atividades concluídas por dia, com base no seu histórico.
      </p>
    </Card>
  );
}
