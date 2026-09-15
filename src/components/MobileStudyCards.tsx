"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  CalendarDays,
  CheckCheck,
  Plus,
  Minus,
  ArrowUpRight,
} from "lucide-react";
import Card from "./ui/Card";
import { useStudy } from "./StudyProvider";
import { dayOffset, isScheduled, type StudyItem } from "@/lib/domain";

export default function MobileStudyCards() {
  const { data, mutate } = useStudy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const habits = data.items.filter(
    (i) => i.kind === "habit" && i.measure === "count",
  );
  const days = new Set(data.records.filter((r) => r.done).map((r) => r.date))
    .size;
  const monthDays = Array.from(
    { length: Number(data.today.slice(8)) },
    (_, i) => `${data.today.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`,
  );
  const completedDays = monthDays.filter((d) => {
    const scheduled = data.items.filter((i) => isScheduled(i, d));
    return (
      scheduled.length > 0 &&
      scheduled.every((i) =>
        data.records.some((r) => r.itemId === i.id && r.date === d && r.done),
      )
    );
  }).length;
  const next = data.items
    .filter(
      (i) =>
        i.kind === "task" &&
        i.date >= data.today &&
        !data.records.some((r) => r.itemId === i.id && r.done),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  async function adjust(item: StudyItem, delta: number) {
    setBusy(true);
    setError("");
    try {
      await mutate({
        action: "save-item",
        item: { ...item, target: item.target + delta },
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível atualizar a meta.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mobile-study-cards">
      <Card className="reference-achievements">
        <div>
          <CalendarDays aria-hidden="true" />
          <p>
            <strong>
              {days} {days === 1 ? "dia" : "dias"}
            </strong>
            <span>com atividades concluídas</span>
          </p>
        </div>
        <div>
          <CheckCheck aria-hidden="true" />
          <p>
            <strong>
              {completedDays}/{monthDays.length}
            </strong>
            <span>dias com todas as metas cumpridas no mês</span>
          </p>
        </div>
      </Card>
      <Card className="reference-goals">
        <h2>
          <CalendarDays size={22} />
          Minha rotina diária
        </h2>
        {habits.length ? (
          habits.slice(0, 4).map((item) => (
            <div className="reference-goal" key={item.id}>
              <button
                aria-label={`Diminuir meta de ${item.title}`}
                disabled={busy || item.target <= 1}
                onClick={() => adjust(item, -1)}
              >
                <Minus size={20} />
              </button>
              <div>
                <span>{item.title}</span>
                <strong>
                  {item.target.toLocaleString("pt-BR")} {item.unit}/dia
                </strong>
              </div>
              <button
                aria-label={`Aumentar meta de ${item.title}`}
                disabled={busy || item.target >= 100000}
                onClick={() => adjust(item, 1)}
              >
                <Plus size={20} />
              </button>
            </div>
          ))
        ) : (
          <div className="study-empty">
            <CalendarDays size={30} />
            <strong>Uma rotina que cabe no seu dia</strong>
            <p>Crie hábitos com metas para acompanhar sua evolução.</p>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {habits.length > 0 && (
          <>
            <p className="reference-projection-caption">
              Seguindo sua frequência nos próximos 30 dias:
            </p>
            <div className="reference-projections">
              {habits.slice(0, 4).map((i) => (
                <div key={i.id}>
                  <strong>
                    {(
                      Array.from({ length: 30 }, (_, n) =>
                        dayOffset(data.today, n),
                      ).filter((d) => isScheduled(i, d)).length * i.target
                    ).toLocaleString("pt-BR")}
                  </strong>
                  <span>{i.unit}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <Link className="panel-link" href="/rotina">
          Organizar minha rotina
          <ArrowUpRight size={20} />
        </Link>
      </Card>
      <Card className="reference-reminder">
        <h2>
          <Bookmark size={22} />
          Lembrete
        </h2>
        {next ? (
          <>
            <strong>{next.title}</strong>
            <time>
              {next.date.split("-").reverse().join("/")}
              {next.time ? ` · ${next.time}` : ""}
            </time>
            <p>
              {next.notes ||
                "Reserve esse momento para dar o próximo passo nos seus estudos."}
            </p>
            <Link className="primary-button" href="/calendario">
              <CalendarDays size={20} />
              Ver na agenda
              <ArrowUpRight size={20} />
            </Link>
          </>
        ) : (
          <>
            <div className="study-empty">
              <Bookmark size={30} />
              <strong>Seu próximo compromisso</strong>
              <p>
                Adicione uma tarefa com data e horário para encontrá-la aqui.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("aristo:add", {
                    detail: { kind: "task", date: data.today },
                  }),
                )
              }
            >
              <Plus size={20} />
              Adicionar à agenda
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
