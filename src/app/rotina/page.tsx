"use client";
import { PerformancePanels } from "@/components/StudyPanels";
import { isScheduled, dayOffset } from "@/lib/domain";
import { Plus } from "lucide-react";
import { useState } from "react";
import PersonalItems from "@/components/PersonalItems";
import { useStudy } from "@/components/StudyProvider";
export default function RotinaPage() {
  const { data } = useStudy();
  const [date, setDate] = useState(data.today);
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    dayOffset(data.today, i - 6),
  );
  const weekTotal = weekDays.reduce(
    (sum, d) => sum + data.items.filter((i) => isScheduled(i, d)).length,
    0,
  );
  const weekDone = weekDays.reduce(
    (sum, d) =>
      sum +
      data.items.filter(
        (i) =>
          isScheduled(i, d) &&
          data.records.some((r) => r.itemId === i.id && r.date === d && r.done),
      ).length,
    0,
  );
  const [tab, setTab] = useState("habits");
  const [all, setAll] = useState(false);
  return (
    <div className="workspace-page routine-page flex flex-col gap-4">
      <h1>Rotina</h1>
      <p className="page-description">
        Construa constância, um hábito de cada vez.
      </p>
      <div className="period-switch" aria-label="Visualização da rotina">
        <button
          aria-pressed={tab === "habits"}
          onClick={() => setTab("habits")}
        >
          Habit tracker
        </button>
        <button
          aria-pressed={tab === "control"}
          onClick={() => setTab("control")}
        >
          Controle
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="date-picker">
          Dia da rotina
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        <div className="period-switch">
          <button aria-pressed={!all} onClick={() => setAll(false)}>
            Neste dia
          </button>
          <button aria-pressed={all} onClick={() => setAll(true)}>
            Todos os itens
          </button>
        </div>
      </div>
      {tab === "habits" ? (
        <PersonalItems date={date} showAll={all} />
      ) : (
        <>
          <section className="study-card">
            <h2>Horários do dia</h2>
            <div className="routine-timeline">
              {data.items
                .filter((i) => isScheduled(i, date))
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((i) => (
                  <div key={i.id}>
                    <time>{i.time || "Livre"}</time>
                    <strong>{i.title}</strong>
                    <span>{i.kind === "habit" ? "Hábito" : "Tarefa"}</span>
                  </div>
                ))}
              {!data.items.some((i) => isScheduled(i, date)) && (
                <div className="study-empty">
                  Nenhuma atividade programada para este dia.
                </div>
              )}
            </div>
          </section>
          <section className="study-card">
            <h2>Metas da semana</h2>
            <p>
              {weekDone} de {weekTotal} atividades programadas nos últimos 7
              dias.
            </p>
            <progress
              className="weekly-progress"
              aria-label="Metas concluídas na semana"
              max={weekTotal || 1}
              value={weekDone}
            />
          </section>
          <PerformancePanels />
        </>
      )}
      <button
        className="primary-button routine-add"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("coelho:add", { detail: { kind: "habit", date } }),
          )
        }
      >
        <Plus size={20} />
        Adicionar hábito
      </button>
    </div>
  );
}
