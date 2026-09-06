"use client";

import { useState } from "react";
import { Check, Flame, Minus, Plus } from "lucide-react";
import PersonalItems from "@/components/PersonalItems";
import Card from "@/components/ui/Card";
import ProgressBar from "@/components/ui/ProgressBar";
import {
  habitos as habitosIniciais,
  horariosDiarios,
  metasSemanais,
  xpHojeAtual,
  xpHojeMeta,
} from "@/lib/mock-data";

type Aba = "habitos" | "controle";

export default function RotinaPage() {
  const [aba, setAba] = useState<Aba>("habitos");
  const [habitos, setHabitos] = useState(habitosIniciais);

  function toggleChecklist(id: string) {
    setHabitos((prev) =>
      prev.map((h) => (h.id === id && h.tipo === "checklist" ? { ...h, feito: !h.feito } : h))
    );
  }

  function ajustarValor(id: string, delta: number) {
    setHabitos((prev) =>
      prev.map((h) =>
        h.id === id && h.tipo === "medivel"
          ? { ...h, valor: Math.max(0, Math.min(h.meta!, (h.valor ?? 0) + delta)) }
          : h
      )
    );
  }

  return (
    <div className="workspace-page flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Rotina</h1>
      <p className="page-description">Construa constância, um hábito de cada vez.</p>

      <div className="flex gap-2 rounded-full bg-black/5 p-1">
        {(
          [
            ["habitos", "Hábitos"],
            ["controle", "Controle"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={aba === key}
            onClick={() => setAba(key)}
            className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
              aba === key ? "bg-ink text-white" : "text-ink/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <PersonalItems/>
      {aba === "habitos" ? (
        <div className="habits-layout flex flex-col gap-3">
          <Card>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">XP de hoje</span>
              <span className="text-ink/50">
                {xpHojeAtual}/{xpHojeMeta} XP
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar label="Experiência de hoje" value={xpHojeAtual} max={xpHojeMeta} />
            </div>
          </Card>

          {habitos.map((h) => (
            <Card key={h.id} className="habit-row flex items-center gap-3">
              {h.tipo === "checklist" ? (
                <button
                  aria-label={`${h.feito ? "Desmarcar" : "Concluir"} ${h.nome}`}
                  aria-pressed={h.feito}
                  onClick={() => toggleChecklist(h.id)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                    h.feito ? "border-transparent bg-accent text-ink" : "border-black/15 text-transparent"
                  }`}
                >
                  <Check size={16} />
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    disabled={h.valor <= 0}
                    aria-label={`Diminuir ${h.nome}`}
                    onClick={() => ajustarValor(h.id, -1)}
                    className="habit-control flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-ink/70"
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    disabled={h.valor >= h.meta}
                    aria-label={`Aumentar ${h.nome}`}
                    onClick={() => ajustarValor(h.id, 1)}
                    className="habit-control flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-ink/70"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{h.nome}</p>
                {h.tipo === "medivel" ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1">
                      <ProgressBar label={h.nome} value={h.valor!} max={h.meta!} colorClassName="bg-accent" />
                    </div>
                    <span className="whitespace-nowrap text-xs text-ink/50">
                      {h.valor}/{h.meta} {h.unidade}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-ink/50">+{h.xp} XP</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1 text-xs text-accent-dark">
                <Flame size={14} />
                {h.streak}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="routine-control flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold">Horários do dia</p>
            <Card className="divide-y divide-black/5 p-0">
              {horariosDiarios.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-14 shrink-0 text-sm font-semibold text-accent-dark">
                    {h.horario}
                  </span>
                  <span className="text-sm text-ink/80">{h.atividade}</span>
                </div>
              ))}
            </Card>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Metas da semana</p>
            <div className="flex flex-col gap-3">
              {metasSemanais.map((m) => (
                <Card key={m.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{m.nome}</span>
                    <span className="text-ink/50">
                      {m.atual}/{m.meta}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar label={m.nome} value={m.atual} max={m.meta} />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
