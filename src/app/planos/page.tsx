"use client";
import { useState } from "react";
import Card from "@/components/ui/Card";
import { useStudy } from "@/components/StudyProvider";
import { type Plan } from "@/lib/domain";
const fields = [
  { id: "prioridades", label: "Prioridades do dia" },
  { id: "horarios", label: "Horário de estudo planejado" },
  { id: "observacoes", label: "Observações do dia" },
] as const;
function PlanEditor({ date, initial }: { date: string; initial?: Plan }) {
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
      {fields.map((field, i) => (
        <Card key={field.id} className={i === 0 ? "lg:col-span-2" : ""}>
          <label htmlFor={field.id}>{field.label}</label>
          <textarea
            id={field.id}
            name={field.id}
            defaultValue={initial?.[field.id] || ""}
            maxLength={4000}
            rows={5}
            className="mt-4 w-full rounded-xl border p-4"
            onChange={() => setStatus("")}
          />
        </Card>
      ))}
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
  const [date, setDate] = useState(data.today);
  return (
    <div className="workspace-page flex flex-col gap-4">
      <h1>Planos</h1>
      <p className="page-description">
        Cada dia tem seu espaço. Salve seu planejamento antes de trocar a data.
      </p>
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
        initial={data.plans.find((p) => p.date === date)}
      />
    </div>
  );
}
