"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  ListChecks,
  CalendarDays,
  ArrowLeft,
  Check,
} from "lucide-react";
import { localDate, type StudyItem } from "@/lib/domain";

import { useStudy } from "./StudyProvider";

export default function QuickAdd() {
  const { editing } = useStudy();
  return <QuickAddContent key={editing?.id || "new"} />;
}
function QuickAddContent() {
  const { mutate, editing, setEditing } = useStudy();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [formSession, setFormSession] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<"habit" | "task" | null>(
    editing?.kind || null,
  );
  const [measure, setMeasure] = useState(editing?.measure || "check");
  const [creationDate, setCreationDate] = useState(localDate());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (kind) form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [kind]);
  useEffect(() => {
    if (editing) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    }
  }, [editing]);
  useEffect(() => {
    function requested(event: Event) {
      const detail = (
        event as CustomEvent<{ kind?: "habit" | "task"; date?: string }>
      ).detail;
      returnFocus.current = document.activeElement as HTMLElement;
      setFormSession((n) => n + 1);
      setKind(detail?.kind || null);
      setCreationDate(detail?.date || localDate());
      setError("");
      setSaved("");
      setMeasure("check");
      dialog.current?.showModal();
    }
    window.addEventListener("aristo:add", requested);
    return () => window.removeEventListener("aristo:add", requested);
  }, []);
  function open() {
    returnFocus.current = trigger.current;
    setFormSession((n) => n + 1);
    setCreationDate(localDate());
    setKind(null);
    setError("");
    setSaved("");
    setMeasure("check");
    dialog.current?.showModal();
  }
  function close() {
    dialog.current?.close();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "").trim();
    if (!title) {
      setError("Dê um nome ao item antes de salvar.");
      return;
    }
    const target =
      measure === "count" && kind === "habit" ? Number(data.get("target")) : 1;
    if (!Number.isFinite(target) || target < 1 || target > 100000) {
      setError("A meta deve ficar entre 1 e 100.000.");
      return;
    }
    const item: StudyItem = {
      id: editing?.id || crypto.randomUUID(),
      ...(editing?.version ? { version: editing.version } : {}),
      kind,
      title,
      notes: String(data.get("notes") || "").trim(),
      frequency: String(data.get("frequency") || "Todos os dias"),
      measure: kind === "habit" && measure === "count" ? "count" : "check",
      target,
      unit: String(data.get("unit") || "").trim(),
      value: 0,
      date: String(data.get("date") || editing?.date || creationDate),
      time: String(data.get("time") || ""),
      priority: String(data.get("priority") || "Normal"),
      done: false,
    };
    if (item.measure === "count" && !item.unit) {
      setError("Informe a unidade da meta, como páginas ou questões.");
      return;
    }
    setBusy(true);
    try {
      await mutate({ action: "save-item", item });
      setError("");
      setSaved(
        editing
          ? "Alterações salvas."
          : kind === "habit"
            ? "Hábito adicionado à sua rotina."
            : "Tarefa adicionada à sua agenda.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. Seu preenchimento foi mantido.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="quick-add-trigger"
        aria-label="Adicionar hábito ou tarefa"
        aria-haspopup="dialog"
        onClick={open}
      >
        <Plus size={28} />
      </button>
      <dialog
        ref={dialog}
        className="quick-add-dialog"
        aria-labelledby="quick-add-title"
        onClose={() => {
          setEditing(null);
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
          else trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === dialog.current) {
            const rect = dialog.current.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              close();
          }
        }}
      >
        <div className="quick-add-heading">
          <div>
            <span className="eyebrow">SUA ORGANIZAÇÃO</span>
            <h2 id="quick-add-title">
              {saved
                ? "Tudo certo"
                : editing
                  ? "Editar item"
                  : kind === "habit"
                    ? "Novo hábito"
                    : kind === "task"
                      ? "Nova tarefa diária"
                      : "O que você quer adicionar?"}
            </h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={close}
            aria-label="Fechar painel"
          >
            <X size={22} />
          </button>
        </div>
        {saved ? (
          <div className="quick-add-success">
            <Check size={36} />
            <p role="status">{saved}</p>
            <p>Salvo na sua conta.</p>
            <button className="primary-button" type="button" onClick={close}>
              Concluir
            </button>
          </div>
        ) : !kind ? (
          <div className="quick-add-options">
            <p>Escolha como quer organizar seu dia.</p>
            <button type="button" onClick={() => setKind("habit")}>
              <ListChecks size={26} />
              <span>
                <strong>Novo hábito</strong>
                <small>Uma ação recorrente, com frequência e meta.</small>
              </span>
              <Plus size={20} />
            </button>
            <button type="button" onClick={() => setKind("task")}>
              <CalendarDays size={26} />
              <span>
                <strong>Tarefa diária</strong>
                <small>Um compromisso com data, horário e prioridade.</small>
              </span>
              <Plus size={20} />
            </button>
          </div>
        ) : (
          <form
            key={`${editing?.id || "new"}-${formSession}`}
            ref={form}
            onSubmit={submit}
            className="quick-add-form"
          >
            <button
              disabled={!!editing || busy}
              type="button"
              className="back-choice"
              onClick={() => {
                setKind(null);
                setError("");
              }}
            >
              <ArrowLeft size={16} />
              Alterar tipo
            </button>
            <label>
              Nome
              <input
                name="title"
                defaultValue={editing?.title}
                required
                maxLength={100}
                placeholder={
                  kind === "habit"
                    ? "Ex.: Ler 20 páginas"
                    : "Ex.: Revisar a aula de Matemática"
                }
              />
            </label>
            {kind === "habit" ? (
              <>
                <div className="quick-add-fields">
                  <label>
                    Frequência
                    <select name="frequency" defaultValue={editing?.frequency}>
                      <option>Todos os dias</option>
                      <option>Segunda a sexta</option>
                      <option>Fins de semana</option>
                    </select>
                  </label>
                  <label>
                    Como acompanhar
                    <select
                      disabled={!!editing}
                      name="measure"
                      value={measure}
                      onChange={(e) =>
                        setMeasure(
                          e.target.value === "count" ? "count" : "check",
                        )
                      }
                    >
                      <option value="check">Marcar como concluído</option>
                      <option value="count">Atingir uma quantidade</option>
                    </select>
                  </label>
                </div>
                {measure === "count" && (
                  <div className="quick-add-fields">
                    <label>
                      Meta
                      <input
                        type="number"
                        name="target"
                        required
                        min={1}
                        max={100000}
                        step={1}
                        defaultValue={editing?.target || 20}
                      />
                    </label>
                    <label>
                      Unidade
                      <input
                        name="unit"
                        defaultValue={editing?.unit}
                        required
                        maxLength={30}
                        placeholder="páginas, copos, questões…"
                      />
                    </label>
                  </div>
                )}
                <p className="field-hint">
                  Cada dia tem seu próprio progresso. O histórico dos dias
                  anteriores fica preservado.
                </p>
              </>
            ) : (
              <div className="quick-add-fields">
                <label>
                  Data
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={editing?.date || creationDate}
                  />
                </label>
                <label>
                  Prioridade
                  <select name="priority" defaultValue={editing?.priority}>
                    <option>Normal</option>
                    <option>Alta</option>
                    <option>Baixa</option>
                  </select>
                </label>
              </div>
            )}
            <label>
              Horário <span className="optional">(opcional)</span>
              <input type="time" name="time" defaultValue={editing?.time} />
            </label>
            <label>
              Observações <span className="optional">(opcional)</span>
              <textarea
                name="notes"
                defaultValue={editing?.notes}
                rows={3}
                maxLength={500}
                placeholder="O que você precisa lembrar?"
              />
            </label>
            {error && (
              <p className="quick-add-error" role="alert">
                {error}
              </p>
            )}
            <div className="quick-add-footer">
              <span>Salvo na sua conta.</span>
              <button disabled={busy} type="submit" className="primary-button">
                {busy
                  ? "Salvando…"
                  : editing
                    ? "Salvar alterações"
                    : kind === "habit"
                      ? "Criar hábito"
                      : "Criar tarefa"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
