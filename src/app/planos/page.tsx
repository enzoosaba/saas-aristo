"use client";
import WeeklyPlanner from "@/components/WeeklyPlanner";
import { useState } from "react";
import Card from "@/components/ui/Card";
import { useStudy } from "@/components/StudyProvider";
import { dayOffset, type Plan } from "@/lib/domain";
const fields = [
  { id: "prioridades", label: "Prioridades do dia" },
  { id: "horarios", label: "Horário de estudo planejado" },
  { id: "observacoes", label: "Observações do dia" },
] as const;
function PlanEditor({
  date,
  initial,
  tab,
  onTabChange,
  onDraft,
}: {
  date: string;
  initial?: Plan;
  tab: string;
  onTabChange: (tab: string) => void;
  onDraft: (plan: Plan) => void;
}) {
  const { mutate } = useStudy();
  const [version, setVersion] = useState(initial?.version || 0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    const form = new FormData(event.currentTarget);
    try {
      await mutate({
        action: "save-plan",
        date,
        version,
        prioridades: form.get("prioridades"),
        horarios: form.get("horarios"),
        observacoes: form.get("observacoes"),
      });
      onDraft({
        date,
        version: version + 1,
        prioridades: String(form.get("prioridades") || ""),
        horarios: String(form.get("horarios") || ""),
        observacoes: String(form.get("observacoes") || ""),
      });
      setVersion(version + 1);
      setStatus("Planejamento salvo na sua conta.");
    } catch (e) {
      setError(true);
      setStatus(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. Seu texto foi mantido.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-5 lg:grid-cols-2">
      <div
        className="period-switch lg:col-span-2"
        aria-label="Tipo de planejamento"
      >
        <button
          type="button"
          aria-pressed={tab === "planning"}
          onClick={() => onTabChange("planning")}
        >
          Planejamento do dia seguinte
        </button>
        <button
          type="button"
          aria-pressed={tab === "reflection"}
          onClick={() => onTabChange("reflection")}
        >
          Autorreflexão
        </button>
      </div>
      {fields.map((field, i) => {
        const hideField =
          field.id === "observacoes"
            ? tab !== "reflection"
            : tab !== "planning";
        return (
          <Card
            key={field.id}
            className={`${i === 0 ? "lg:col-span-2" : ""} ${hideField ? "plan-hidden" : ""}`}
          >
            <label htmlFor={field.id}>{field.label}</label>
            <textarea
              id={field.id}
              name={field.id}
              defaultValue={initial?.[field.id] || ""}
              maxLength={4000}
              rows={5}
              className="mt-4 w-full rounded-xl border p-4"
              onChange={(event) => {
                setStatus("");
                const form = new FormData(event.currentTarget.form!);
                onDraft({
                  date,
                  version,
                  prioridades: String(form.get("prioridades") || ""),
                  horarios: String(form.get("horarios") || ""),
                  observacoes: String(form.get("observacoes") || ""),
                });
              }}
            />
          </Card>
        );
      })}
      <div className="lg:col-span-2">
        <p role={error ? "alert" : "status"}>{status}</p>
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? "Salvando…" : "Salvar planejamento"}
        </button>
      </div>
    </form>
  );
}
export default function PlanosPage() {
  const { data } = useStudy();
  const [drafts, setDrafts] = useState<Record<string, Plan>>({});
  const [tab, setTab] = useState("planning");
  const [date, setDate] = useState(dayOffset(data.today, 1));
  function changeTab(next: string) {
    setTab(next);
    setDate(next === "reflection" ? data.today : dayOffset(data.today, 1));
  }
  return (
    <div className="workspace-page flex flex-col gap-4">
      <h1>Planos</h1>
      <p className="page-description">
        Organize os blocos da semana e registre suas prioridades diárias.
      </p>
      <WeeklyPlanner />
      <h2 className="daily-plan-heading">Planejamento e reflexão do dia</h2>
      <label className="date-picker">
        Dia do planejamento
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
      </label>
      <PlanEditor
        key={date}
        date={date}
        initial={drafts[date] || data.plans.find((p) => p.date === date)}
        onDraft={(plan) =>
          setDrafts((current) => ({ ...current, [plan.date]: plan }))
        }
        tab={tab}
        onTabChange={changeTab}
      />
    </div>
  );
}
