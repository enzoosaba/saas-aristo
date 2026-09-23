"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  X,
} from "lucide-react";
import { dayOffset, minutesOf, type StudySession } from "@/lib/domain";
import { useStudy } from "./StudyProvider";

function monday(date: string) {
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return dayOffset(date, -((day + 6) % 7));
}
export function sessionEnd(session: StudySession) {
  const n = (minutesOf(session.start) + session.duration) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export default function WeeklyPlanner() {
  const { data, mutate } = useStudy();
  const [week, setWeek] = useState(monday(data.today));
  const [selected, setSelected] = useState(data.today);
  const [draft, setDraft] = useState<StudySession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dragged = useRef<StudySession | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => dayOffset(week, i));
  const sessions = data.sessions.filter((s) => days.includes(s.date));
  const minutes = sessions.reduce((sum, s) => sum + s.duration, 0);
  useEffect(() => {
    if (draft) dialog.current?.showModal();
  }, [draft]);
  function open(date: string, session?: StudySession) {
    setError("");
    setConfirm(false);
    setDraft(
      session || {
        id: crypto.randomUUID(),
        title: "",
        subject: "Matemática",
        date,
        start: "09:00",
        duration: 60,
        notes: "",
        version: 0,
      },
    );
  }
  function changeWeek(offset: number) {
    const d = dayOffset(week, offset);
    setWeek(d);
    setSelected(d);
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await mutate({
        action: "save-session",
        session: {
          ...draft,
          title: f.get("title"),
          subject: f.get("subject"),
          date: f.get("date"),
          start: f.get("start"),
          duration: Number(f.get("duration")),
          notes: f.get("notes"),
        },
      });
      setStatus("Sessão salva no planejamento semanal.");
      dialog.current?.close();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível salvar a sessão.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draft) return;
    setBusy(true);
    try {
      await mutate({
        action: "delete-session",
        id: draft.id,
        version: draft.version,
      });
      setStatus("Sessão removida.");
      dialog.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível remover.");
    } finally {
      setBusy(false);
    }
  }
  async function move(date: string) {
    const session = dragged.current;
    dragged.current = null;
    if (!session || session.date === date || busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate({ action: "save-session", session: { ...session, date } });
      setStatus("Sessão movida para o dia escolhido.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível mover a sessão.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="weekly-planner" aria-labelledby="weekly-title">
      <div className="weekly-heading">
        <div>
          <p className="eyebrow">ESPAÇO PARA O QUE IMPORTA</p>
          <h2 id="weekly-title">Organização semanal</h2>
          <p>Distribua suas sessões e construa uma semana possível.</p>
        </div>
        <button
          className="primary-button"
          aria-expanded={Boolean(draft && !draft.version)}
          onClick={() => open(selected)}
        >
          <Plus size={20} />
          Nova sessão
        </button>
      </div>
      <div className="week-toolbar">
        <div className="week-pagination">
          <button aria-label="Semana anterior" onClick={() => changeWeek(-7)}>
            <ChevronLeft />
          </button>
          <strong>
            {week.slice(8)}/{week.slice(5, 7)} — {days[6].slice(8)}/
            {days[6].slice(5, 7)}/{days[6].slice(0, 4)}
          </strong>
          <button aria-label="Próxima semana" onClick={() => changeWeek(7)}>
            <ChevronRight />
          </button>
          <button
            onClick={() => {
              setWeek(monday(data.today));
              setSelected(data.today);
            }}
          >
            Esta semana
          </button>
        </div>
        <span>
          <Clock size={16} />
          {Math.floor(minutes / 60)}h{minutes % 60 ? ` ${minutes % 60}min` : ""}{" "}
          planejadas · {sessions.length} sessões
        </span>
      </div>
      <div className="week-day-picker" role="group" aria-label="Dia da semana">
        {days.map((d, i) => (
          <button
            key={d}
            aria-pressed={selected === d}
            onClick={() => setSelected(d)}
          >
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][i]}
            <strong>{d.slice(8)}</strong>
          </button>
        ))}
      </div>
      {error && !draft && <p role="alert">{error}</p>}
      <p role="status" className="planner-status">
        {status}
      </p>
      <div className="week-board">
        {days.map((d, i) => (
          <section
            className="week-day"
            key={d}
            data-selected={selected === d}
            data-today={d === data.today}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              void move(d);
            }}
            aria-label={`${["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"][i]}, ${d}`}
          >
            <header>
              <span>
                {
                  [
                    "Segunda",
                    "Terça",
                    "Quarta",
                    "Quinta",
                    "Sexta",
                    "Sábado",
                    "Domingo",
                  ][i]
                }
              </span>
              <strong>{d.slice(8)}</strong>
            </header>
            <div className="week-blocks">
              {sessions
                .filter((s) => s.date === d)
                .sort((a, b) => a.start.localeCompare(b.start))
                .map((s) => (
                  <button
                    key={s.id}
                    className="study-session-block"
                    disabled={busy}
                    draggable={!busy}
                    onDragStart={(e) => {
                      dragged.current = s;
                      e.dataTransfer.setData("text/plain", s.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      dragged.current = null;
                    }}
                    onClick={() => open(d, s)}
                    aria-label={`Editar sessão ${s.title}, ${s.start} às ${sessionEnd(s)}`}
                  >
                    <time>
                      {s.start} — {sessionEnd(s)}
                    </time>
                    <strong>{s.title}</strong>
                    <span>{s.subject}</span>
                    <small>{s.duration} min</small>
                  </button>
                ))}
              {!sessions.some((s) => s.date === d) && (
                <p className="day-free">Espaço livre</p>
              )}
            </div>
            <button
              className="add-day-session"
              aria-label={`Adicionar sessão em ${d}`}
              onClick={() => open(d)}
            >
              <Plus size={18} />
              <span>Adicionar</span>
            </button>
          </section>
        ))}
      </div>
      <p className="week-help">
        Selecione um bloco para editar o dia, o horário ou a duração. No
        desktop, você também pode arrastá-lo para outro dia.
      </p>
      <dialog
        ref={dialog}
        className="session-dialog"
        aria-labelledby="session-dialog-title"
        onClose={() => {
          setDraft(null);
          setError("");
        }}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="section-heading">
          <h2 id="session-dialog-title">
            <CalendarDays size={22} />
            {draft?.version ? "Editar sessão" : "Nova sessão de estudo"}
          </h2>
          <button
            disabled={busy}
            aria-label="Fechar sessão"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        {draft && (
          <form key={draft.id} className="session-form" onSubmit={save}>
            <label>
              Nome da sessão
              <input
                name="title"
                required
                maxLength={100}
                defaultValue={draft.title}
                placeholder="Ex.: Funções e gráficos"
                autoFocus
              />
            </label>
            <label>
              Matéria da sessão
              <input
                name="subject"
                required
                maxLength={60}
                defaultValue={draft.subject}
              />
            </label>
            <div className="session-form-row">
              <label>
                Dia da sessão
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={draft.date}
                />
              </label>
              <label>
                Início da sessão
                <input
                  type="time"
                  name="start"
                  required
                  defaultValue={draft.start}
                />
              </label>
            </div>
            <label>
              Duração em minutos
              <input
                type="number"
                inputMode="numeric"
                name="duration"
                min={15}
                max={480}
                required
                defaultValue={draft.duration}
              />
            </label>
            <label>
              Objetivo e observações
              <textarea
                name="notes"
                rows={3}
                maxLength={500}
                defaultValue={draft.notes}
              />
            </label>
            <p role="alert">{error}</p>
            <button className="primary-button" disabled={busy}>
              {busy ? "Salvando…" : "Salvar sessão"}
            </button>
            {draft.version > 0 && !confirm && (
              <button
                type="button"
                className="session-delete"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Excluir sessão
              </button>
            )}
            {confirm && (
              <div className="session-delete-confirm">
                <p>Remover este bloco do planejamento?</p>
                <button type="button" disabled={busy} onClick={remove}>
                  Confirmar exclusão
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Cancelar
                </button>
              </div>
            )}
          </form>
        )}
      </dialog>
    </section>
  );
}
