"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, Plus } from "lucide-react";
import { sessionEnd } from "@/components/WeeklyPlanner";
import Link from "next/link";
import PersonalItems from "@/components/PersonalItems";
import Card from "@/components/ui/Card";
import { useStudy } from "@/components/StudyProvider";
import { isScheduled } from "@/lib/domain";
export default function CalendarioPage() {
  const { data } = useStudy();
  const [date, setDate] = useState(data.today);
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const dialog = useRef<HTMLDialogElement>(null);
  const first = new Date(month + "-01T12:00:00Z");
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(
    first.getUTCFullYear(),
    first.getUTCMonth() + 1,
    0,
  ).getDate();
  function move(n: number) {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  }
  const title = first.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="workspace-page module-stack">
      <div>
        <p className="eyebrow">UM DIA DE CADA VEZ</p>
        <h1>Calendário</h1>
        <p className="page-description">
          Sua rotina, vista de cima. Selecione um dia para organizar os
          detalhes.
        </p>
      </div>
      <Card>
        <div className="month-heading">
          <button aria-label="Mês anterior" onClick={() => move(-1)}>
            <ChevronLeft />
          </button>
          <h2 aria-live="polite">{title}</h2>
          <button aria-label="Próximo mês" onClick={() => move(1)}>
            <ChevronRight />
          </button>
        </div>
        <button
          className="calendar-today"
          onClick={() => {
            setMonth(data.today.slice(0, 7));
            setDate(data.today);
            dialog.current?.showModal();
          }}
        >
          Hoje
        </button>
        <div className="month-grid">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
            <span className="weekday" key={d}>
              {d}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={`blank${i}`} />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const d = month + "-" + String(i + 1).padStart(2, "0");
            const n =
              data.items.filter((item) => isScheduled(item, d)).length +
              data.sessions.filter((s) => s.date === d).length;
            return (
              <button
                key={d}
                className={d === data.today ? "is-today" : ""}
                aria-label={`${i + 1} de ${title}, ${n} atividades`}
                aria-current={d === data.today ? "date" : undefined}
                onClick={() => {
                  setDate(d);
                  dialog.current?.showModal();
                }}
              >
                <strong>{i + 1}</strong>
                <span aria-hidden="true">{n ? "•" : ""}</span>
              </button>
            );
          })}
        </div>
        <p className="chart-legend">• Dia com atividades programadas</p>
      </Card>
      <dialog
        ref={dialog}
        className="calendar-sheet"
        aria-labelledby="day-title"
      >
        <div className="section-heading">
          <h2 id="day-title">{date.split("-").reverse().join("/")}</h2>
          <button
            aria-label="Fechar detalhes do dia"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        <div className="calendar-sessions">
          {data.sessions
            .filter((s) => s.date === date)
            .map((s) => (
              <Link href="/planos" className="calendar-session" key={s.id}>
                <strong>{s.title}</strong>
                <span>
                  {s.start} — {sessionEnd(s)} · {s.subject}
                </span>
              </Link>
            ))}
        </div>
        <PersonalItems date={date} />
        <button
          className="primary-button"
          onClick={() => {
            dialog.current?.close();
            window.dispatchEvent(
              new CustomEvent("coelho:add", { detail: { kind: "task", date } }),
            );
          }}
        >
          <Plus size={20} />
          Adicionar tarefa neste dia
        </button>
      </dialog>
    </div>
  );
}
