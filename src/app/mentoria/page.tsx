"use client";
import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";
import { useStudy } from "@/components/StudyProvider";
import type { MentorStudent, DailySummary } from "@/lib/domain";
import { UserPlus, Trash2, Wallet, MessageSquareQuote } from "lucide-react";

const tabs = [
  { id: "alunos", label: "Alunos" },
  { id: "financeiro", label: "Financeiro" },
  { id: "frases", label: "Frases" },
] as const;
type Tab = (typeof tabs)[number]["id"];

export default function MentoriaPage() {
  const { data } = useStudy();
  const [tab, setTab] = useState<Tab>("alunos");

  if (data.user.role !== "mentor")
    return (
      <div className="workspace-page flex flex-col gap-5">
        <h1>Espaço do mentor</h1>
        <Card>
          <p className="panel-description">
            Esta área é exclusiva para contas de mentor.
          </p>
        </Card>
      </div>
    );

  return (
    <div className="workspace-page flex flex-col gap-5">
      <h1>Espaço do mentor</h1>
      <p className="page-description">
        Acompanhe seus alunos e gerencie a mentoria.
      </p>
      <div className="period-switch" aria-label="Seções da mentoria">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "alunos" && <AlunosTab today={data.today} />}
      {tab === "financeiro" && (
        <Card>
          <div className="panel-title">
            <h2>
              <Wallet size={18} />
              Financeiro
            </h2>
          </div>
          <div className="study-empty">
            <Wallet size={28} />
            <strong>Em breve</strong>
            <p>
              O dashboard financeiro da mentoria será integrado em uma
              próxima etapa.
            </p>
          </div>
        </Card>
      )}
      {tab === "frases" && (
        <Card>
          <div className="panel-title">
            <h2>
              <MessageSquareQuote size={18} />
              Frases motivacionais
            </h2>
          </div>
          <div className="study-empty">
            <MessageSquareQuote size={28} />
            <strong>Em breve</strong>
            <p>
              O controle das frases exibidas aos alunos será integrado em
              uma próxima etapa.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function AlunosTab({ today }: { today: string }) {
  const [students, setStudents] = useState<MentorStudent[] | null>(null);
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [email, setEmail] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/mentor", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "Não foi possível carregar seus alunos.");
        if (!active) return;
        setStudents(result.students);
        setSelected((current) =>
          current &&
          result.students.some((s: MentorStudent) => s.id === current)
            ? current
            : result.students[0]?.id || "",
        );
      })
      .catch((e) => {
        if (!active) return;
        setError(true);
        setStatus(
          e instanceof Error ? e.message : "Não foi possível carregar seus alunos.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the fetch that starts right after as in-flight.
    setSummaryBusy(true);
    fetch(`/api/mentor?student=${selected}&date=${date}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "Não foi possível carregar o resumo.");
        if (active) setSummary(result);
      })
      .catch((e) => {
        if (!active) return;
        setError(true);
        setStatus(
          e instanceof Error ? e.message : "Não foi possível carregar o resumo.",
        );
      })
      .finally(() => {
        if (active) setSummaryBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selected, date]);

  async function addStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRosterBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-student", email }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Não foi possível adicionar o aluno.");
      setStudents(result.students);
      setEmail("");
      setStatus("Aluno adicionado.");
    } catch (e) {
      setError(true);
      setStatus(
        e instanceof Error ? e.message : "Não foi possível adicionar o aluno.",
      );
    } finally {
      setRosterBusy(false);
    }
  }

  async function removeStudent(studentId: string) {
    setRosterBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-student", studentId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Não foi possível remover o aluno.");
      setStudents(result.students);
      setStatus("Aluno removido.");
    } catch (e) {
      setError(true);
      setStatus(
        e instanceof Error ? e.message : "Não foi possível remover o aluno.",
      );
    } finally {
      setRosterBusy(false);
    }
  }

  return (
    <>
      <Card>
        <div className="panel-title">
          <h2>Meus alunos</h2>
        </div>
        <form className="account-form" onSubmit={(e) => void addStudent(e)}>
          <label>
            Adicionar aluno pelo e-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="aluno@exemplo.com"
              required
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={rosterBusy}
          >
            <UserPlus size={16} />
            {rosterBusy ? "Aguarde…" : "Adicionar aluno"}
          </button>
        </form>
        <p role={error ? "alert" : "status"}>{status}</p>
        {students === null ? (
          <p className="panel-description">Carregando seus alunos…</p>
        ) : students.length ? (
          <ul className="mentor-roster">
            {students.map((student) => (
              <li key={student.id}>
                <button
                  type="button"
                  className={`mentor-roster-item ${selected === student.id ? "is-current" : ""}`}
                  onClick={() => setSelected(student.id)}
                >
                  <Avatar user={student} />
                  <span>
                    <strong>{student.name}</strong>
                    <small>{student.email}</small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${student.name}`}
                  disabled={rosterBusy}
                  onClick={() => void removeStudent(student.id)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="study-empty">
            <UserPlus size={28} />
            <strong>Nenhum aluno vinculado</strong>
            <p>
              Adicione um aluno pelo e-mail da conta dele para acompanhar o
              desempenho diário.
            </p>
          </div>
        )}
      </Card>
      {selected && (
        <Card>
          <div className="panel-title">
            <h2>Resumo diário</h2>
            <label className="date-picker">
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value);
                }}
              />
            </label>
          </div>
          {summaryBusy || !summary ? (
            <p className="panel-description">Carregando resumo…</p>
          ) : (
            <>
              <div className="real-metrics">
                <Card>
                  <p>Concluído</p>
                  <strong>
                    {summary.doneCount}/{summary.totalCount}
                  </strong>
                </Card>
                <Card>
                  <p>XP no dia</p>
                  <strong>{summary.xp}</strong>
                </Card>
              </div>
              {summary.activities.length ? (
                <ul className="mentor-activity-list">
                  {summary.activities.map((a) => (
                    <li key={a.id} className={a.done ? "is-done" : ""}>
                      <span>
                        {a.kind === "habit" ? "Hábito" : "Tarefa"}
                        {" · "}
                        <strong>{a.title}</strong>
                      </span>
                      <span>
                        {a.measure === "count"
                          ? `${a.value}/${a.target}${a.unit ? " " + a.unit : ""}`
                          : a.done
                            ? "Concluído"
                            : "Pendente"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel-description">
                  Nenhum hábito ou tarefa programado para este dia.
                </p>
              )}
              {summary.sessions.length > 0 && (
                <>
                  <h3>Sessões de estudo</h3>
                  <ul className="mentor-session-list">
                    {summary.sessions.map((s, i) => (
                      <li key={i}>
                        <strong>{s.title}</strong>
                        <span>
                          {s.subject} · {s.start} · {s.duration} min
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {summary.questions.length > 0 && (
                <>
                  <h3>Questões</h3>
                  <ul className="mentor-session-list">
                    {summary.questions.map((q, i) => (
                      <li key={i}>
                        <strong>
                          {q.subject} · {q.topic}
                        </strong>
                        <span>
                          {q.correct}/{q.total} corretas
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3>Planejamento e reflexão do aluno</h3>
              {summary.plan &&
              (summary.plan.prioridades ||
                summary.plan.horarios ||
                summary.plan.observacoes) ? (
                <div className="mentor-reflection">
                  {summary.plan.prioridades && (
                    <p>
                      <strong>Prioridades: </strong>
                      {summary.plan.prioridades}
                    </p>
                  )}
                  {summary.plan.horarios && (
                    <p>
                      <strong>Horários: </strong>
                      {summary.plan.horarios}
                    </p>
                  )}
                  {summary.plan.observacoes && (
                    <p>
                      <strong>Observações: </strong>
                      {summary.plan.observacoes}
                    </p>
                  )}
                </div>
              ) : (
                <p className="panel-description">
                  O aluno ainda não escreveu um planejamento para este dia.
                </p>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}
