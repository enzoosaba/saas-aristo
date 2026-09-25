"use client";
import { useState } from "react";
import { Check, Minus, Plus, Pencil, Archive } from "lucide-react";
import Card from "./ui/Card";
import ProgressBar from "./ui/ProgressBar";
import { useStudy } from "./StudyProvider";
import { isScheduled, type StudyItem } from "@/lib/domain";
import { clampCount, countQuickSteps } from "@/lib/counter";
export default function PersonalItems({
  kind,
  date,
  showAll = false,
}: {
  kind?: "habit" | "task";
  date?: string;
  showAll?: boolean;
}) {
  const { data, mutate, setEditing, showToast } = useStudy();
  const selected = date || data.today;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [completedPulse, setCompletedPulse] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<{
    itemId: string;
    draft: string;
  } | null>(null);
  const items = data.items
    .filter(
      (i) =>
        (!kind || i.kind === kind) &&
        (showAll || isScheduled(i, selected)) &&
        i.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );
  async function update(item: StudyItem, value: number, done: boolean) {
    setBusy(item.id);
    setError("");
    const record = data.records.find(
      (r) =>
        r.itemId === item.id && (item.kind === "task" || r.date === selected),
    );
    try {
      await mutate({
        action: "record",
        id: item.id,
        date: selected,
        value,
        done,
        version: record?.version || 0,
      });
      const wasCompleted =
        !!record?.done || (record?.value || 0) >= item.target;
      const completed = item.kind === "habit" && (done || value >= item.target);
      if (completed && !wasCompleted) {
        setCompletedPulse(item.id);
        showToast(`${item.title} concluído. Muito bem!`);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar.");
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function saveDirectValue(item: StudyItem) {
    if (!editingValue || editingValue.itemId !== item.id) return;
    const parsed = Number(editingValue.draft);
    if (!editingValue.draft.trim() || !Number.isFinite(parsed)) {
      setError("Informe um valor numérico válido.");
      return;
    }
    const value = clampCount(parsed, item.target);
    if (await update(item, value, false)) setEditingValue(null);
  }
  async function archive(item: StudyItem) {
    setBusy(item.id);
    try {
      await mutate({
        action: "archive-item",
        id: item.id,
        version: item.version,
      });
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível arquivar.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="personal-items full-width">
      <div className="section-heading">
        <h2>
          {kind === "task"
            ? "Minhas tarefas"
            : kind === "habit"
              ? "Meus hábitos"
              : "Hábitos e tarefas"}
        </h2>
      </div>
      <label className="search-items">
        Buscar itens
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nome do hábito ou tarefa"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!items.length && (
        <Card>
          <div className="study-empty">
            <strong>
              {search ? "Nenhum resultado" : "Tudo pronto para começar"}
            </strong>
            <p>
              {search
                ? "Tente outro nome."
                : "Use o botão + no topo para criar um hábito ou uma tarefa."}
            </p>
          </div>
        </Card>
      )}
      <div className="personal-items-grid">
        {items.map((item) => {
          const record = data.records.find(
            (r) =>
              r.itemId === item.id &&
              (item.kind === "task" || r.date === selected),
          );
          const value = record?.value || 0;
          const done = record?.done || false;
          const future = selected > data.today || item.date > selected;
          const unscheduled =
            item.kind === "habit" && !isScheduled(item, selected);
          const blocked = future || unscheduled;
          return (
            <Card key={item.id} className="personal-item">
              <div className="personal-item-title">
                <span>
                  {item.kind === "habit" ? "HÁBITO" : "TAREFA"}
                  {item.kind === "task" && item.date < data.today && !done
                    ? " · ATRASADA"
                    : ""}
                </span>
                <strong>{item.title}</strong>
              </div>
              <p>
                {item.kind === "habit"
                  ? item.frequency
                  : item.date.split("-").reverse().join("/") +
                    " · " +
                    item.priority}
                {item.time ? " · " + item.time : ""}
              </p>
              {item.notes && <p>{item.notes}</p>}
              {item.measure === "count" ? (
                <>
                  <div className="personal-counter">
                    {editingValue?.itemId === item.id ? (
                      <form
                        className="counter-direct-form"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveDirectValue(item);
                        }}
                      >
                        <label>
                          Valor atual de {item.title}
                          <input
                            autoFocus
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={item.target}
                            step={1}
                            value={editingValue.draft}
                            disabled={!!busy || blocked}
                            onChange={(event) =>
                              setEditingValue({
                                itemId: item.id,
                                draft: event.target.value,
                              })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setEditingValue(null);
                            }}
                          />
                        </label>
                        <button type="submit" disabled={!!busy || blocked}>
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingValue(null)}
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <div className="counter-main">
                        <button
                          className="counter-step"
                          aria-label={`Diminuir ${item.title}`}
                          disabled={!!busy || blocked || value <= 0}
                          onClick={() => void update(item, value - 1, false)}
                        >
                          <Minus size={18} />
                        </button>
                        <button
                          className="counter-value-button"
                          aria-label={`Editar valor de ${item.title}: ${value} de ${item.target} ${item.unit}`}
                          disabled={!!busy || blocked}
                          onClick={() =>
                            setEditingValue({
                              itemId: item.id,
                              draft: String(value),
                            })
                          }
                        >
                          {value} / {item.target} {item.unit}
                        </button>
                        <button
                          className="counter-step"
                          aria-label={`Aumentar ${item.title}`}
                          disabled={!!busy || blocked || value >= item.target}
                          onClick={() => void update(item, value + 1, false)}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    )}
                    <div
                      className="counter-quick-steps"
                      aria-label={`Incrementos rápidos de ${item.title}`}
                    >
                      {countQuickSteps(item.target).map((step) => (
                        <button
                          key={step}
                          type="button"
                          disabled={!!busy || blocked || value >= item.target}
                          onClick={() =>
                            void update(
                              item,
                              clampCount(value + step, item.target),
                              false,
                            )
                          }
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ProgressBar
                    label={item.title}
                    value={value}
                    max={item.target}
                  />
                </>
              ) : (
                <button
                  className="personal-done"
                  aria-pressed={done}
                  disabled={!!busy || blocked}
                  onClick={() => void update(item, 0, !done)}
                >
                  <Check
                    size={18}
                    className={
                      done && completedPulse === item.id
                        ? "habit-check-complete"
                        : undefined
                    }
                  />
                  {done ? "Concluído" : "Marcar como concluído"}
                </button>
              )}
              {blocked && (
                <p className="field-hint">
                  {future
                    ? "O registro fica disponível na data programada."
                    : "Este hábito não está programado para este dia."}
                </p>
              )}
              <div className="item-actions">
                <button
                  aria-label={`Editar ${item.title}`}
                  disabled={!!busy}
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={16} />
                  Editar
                </button>
                <button
                  aria-label={`Arquivar ${item.title}`}
                  disabled={!!busy}
                  onClick={() => setConfirm(item.id)}
                >
                  <Archive size={16} />
                  Arquivar
                </button>
              </div>
              {confirm === item.id && (
                <div className="archive-confirm">
                  <p>Arquivar este item? O histórico será preservado.</p>
                  <button disabled={!!busy} onClick={() => void archive(item)}>
                    Confirmar arquivamento
                  </button>
                  <button disabled={!!busy} onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
