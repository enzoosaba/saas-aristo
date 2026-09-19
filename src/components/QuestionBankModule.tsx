"use client";
import { useRef, useState } from "react";
import { useStudy } from "@/components/StudyProvider";
import Card from "@/components/ui/Card";
import QuestionAnalytics from "@/components/QuestionAnalytics";
import { QUESTION_AREAS, type QuestionLog } from "@/lib/domain";

// The full question-bank screen (registration form, analytics, history).
// Not rendered while QUESTION_BANK_ENABLED is false — see src/lib/features.ts.
export default function QuestionBankModule() {
  const { data, mutate } = useStudy();
  const [editing, setEditing] = useState<QuestionLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await mutate({
        action: "save-question",
        question: {
          id: editing?.id || crypto.randomUUID(),
          version: editing?.version || 0,
          subject: f.get("subject"),
          topic: f.get("topic"),
          date: f.get("date"),
          total: Number(f.get("total")),
          correct: Number(f.get("correct")),
        },
      });
      setEditing(null);
      form.current?.reset();
      setStatus("Registro salvo. Seu desempenho foi atualizado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(q: QuestionLog) {
    setBusy(true);
    setError("");
    try {
      await mutate({ action: "delete-question", id: q.id, version: q.version });
      setDeleting(null);
      setStatus("Registro excluído.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page module-stack">
      <div>
        <p className="eyebrow">PRÁTICA COM DIREÇÃO</p>
        <h1>Banco de questões</h1>
        <p className="page-description">
          Registre sua prática e descubra onde concentrar a próxima revisão.
        </p>
      </div>
      <Card>
        <h2>{editing ? "Editar registro" : "Registrar questões"}</h2>
        <form
          ref={form}
          key={editing?.id || "new"}
          onSubmit={save}
          className="question-form"
        >
          <label>
            Matéria / área
            <select
              name="subject"
              defaultValue={editing?.subject || "Linguagens"}
            >
              {QUESTION_AREAS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Tópico
            <input
              name="topic"
              required
              maxLength={120}
              defaultValue={editing?.topic}
              placeholder="Ex.: interpretação de texto"
            />
          </label>
          <label>
            Data da prática
            <input
              name="date"
              type="date"
              required
              max={data.today}
              defaultValue={editing?.date || data.today}
            />
          </label>
          <label>
            Questões respondidas
            <input
              name="total"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={100000}
              defaultValue={editing?.total}
            />
          </label>
          <label>
            Acertos
            <input
              name="correct"
              type="number"
              inputMode="numeric"
              required
              min={0}
              max={100000}
              defaultValue={editing?.correct}
            />
          </label>
          <div className="form-actions">
            <button className="primary-button" disabled={busy}>
              {busy ? "Salvando…" : "Salvar registro"}
            </button>
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancelar edição
              </button>
            )}
          </div>
        </form>
        <p role="alert">{error}</p>
        <p role="status">{status}</p>
      </Card>
      <QuestionAnalytics />
      <Card>
        <h2>Histórico de registros</h2>
        {!data.questions.length ? (
          <div className="study-empty">
            Suas questões aparecerão aqui após o primeiro registro.
          </div>
        ) : (
          data.questions.map((q) => (
            <div className="question-log" key={q.id}>
              <div>
                <strong>{q.topic}</strong>
                <p>
                  {q.subject} · {q.date.split("-").reverse().join("/")} ·{" "}
                  {q.correct}/{q.total} acertos
                </p>
              </div>
              <div className="form-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(q);
                    setError("");
                    setStatus("");
                    form.current?.scrollIntoView({ block: "center" });
                  }}
                >
                  Editar
                </button>
                <button disabled={busy} onClick={() => setDeleting(q.id)}>
                  Excluir
                </button>
              </div>
              {deleting === q.id && (
                <div className="delete-confirmation">
                  <p>Excluir este registro e atualizar os gráficos?</p>
                  <button disabled={busy} onClick={() => remove(q)}>
                    Confirmar exclusão
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
