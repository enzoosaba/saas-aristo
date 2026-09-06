"use client";

import { useState } from "react";
import Image from "next/image";
import { Star, Target, Trophy } from "lucide-react";
import { PerformancePanels, PeriodSwitch } from "@/components/StudyPanels";
import Card from "@/components/ui/Card";
import ProgressBar from "@/components/ui/ProgressBar";
import { aluno, desempenho, desempenhoPorPeriodo, type PeriodoId } from "@/lib/mock-data";

type Aba = "desempenho" | "ranking";

export default function PerfilPage() {
  const [aba, setAba] = useState<Aba>("desempenho");
  const [periodo, setPeriodo] = useState<PeriodoId>("total");
  const metricas = desempenhoPorPeriodo[periodo];
  const ranking = [...desempenho.rankingMentor].sort((a, b) => b.score - a.score);

  return (
    <div className="workspace-page profile-page flex flex-col gap-4">
      <h1 className="desktop-profile-title">Meu perfil</h1>
      <div className="profile-identity">
        <div className="profile-cover" aria-hidden="true"><Image src="/brand/coelho.png" alt="" width={160} height={160}/><span>CONSTÂNCIA QUE TRANSFORMA</span></div>
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black/10 text-2xl font-semibold text-ink/50">
          {aluno.nome
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </div>
        <h1 className="text-lg font-semibold">{aluno.nome}</h1>
        <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-ink/70">
          {aluno.tier.toUpperCase()}
        </span>
      </div>

      <div className="profile-summary grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-ink/50">Nível</p>
          <p className="text-2xl font-bold">{aluno.nivel}</p>
          <div className="mt-2">
            <ProgressBar label="Experiência para o próximo nível" value={aluno.xpAtual} max={aluno.xpProximoNivel} />
          </div>
          <p className="mt-1 text-[11px] text-ink/40">
            {aluno.xpAtual}/{aluno.xpProximoNivel} XP
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink/50">Ranking do mentor</p>
          <p className="text-sm font-medium text-ink/70">{aluno.tier}</p>
          <p className="mt-1 text-2xl font-bold">{aluno.rankingScore}</p>
        </Card>
      </div>

      <div className="flex gap-2 rounded-full bg-black/5 p-1">
        {(
          [
            ["desempenho", "Desempenho"],
            ["ranking", "Ranking"],
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

      {aba === "desempenho" ? (
        <div className="performance-layout flex flex-col gap-5">
          <div className="period-filter-row">
            <PeriodSwitch periodo={periodo} onChange={setPeriodo} />
          </div>

          <div className="performance-metrics grid grid-cols-2 gap-3" aria-live="polite">
            <Card className="metric-card">
              <Target size={18} className="text-accent-dark" />
              <p className="text-xl font-bold">{metricas.taxaAcerto}%</p>
              <p className="text-xs text-ink/50">Taxa de acerto</p>
            </Card>
            <Card className="metric-card">
              <Star size={18} className="text-accent-dark" />
              <p className="text-xl font-bold">{metricas.questoes}</p>
              <p className="text-xs text-ink/50">Questões no período</p>
            </Card>
          </div>

          <PerformancePanels/>

        </div>
      ) : (
        <div className="ranking-layout"><div className="ranking-heading"><h2>Ranking do mentor</h2><p>Pontuação dos alunos · dados demonstrativos</p></div><div className="ranking-podium" aria-label="Três primeiras posições">{ranking.slice(0,3).map((r,i)=><div key={r.nome} className={`podium-place podium-${i+1}`}><span className="podium-avatar">{r.nome.split(" ").map(n=>n[0]).join("")}</span><strong>{r.nome}</strong><span>{r.score} pontos</span><div className="podium-step"><Trophy size={24}/><strong>{i+1}º</strong></div></div>)}</div><Card className="divide-y divide-black/5 p-0">
          {ranking.map((r, i) => (
            <div
              key={r.nome}
              className={`flex items-center gap-3 px-4 py-3 ${r.voce ? "bg-accent/8" : ""}`}
            >
              <span className="flex w-6 shrink-0 items-center justify-center text-sm font-semibold text-ink/50">
                {i === 0 ? <Trophy size={16} className="text-accent-dark" /> : i + 1}
              </span>
              <span className={`flex-1 text-sm ${r.voce ? "font-semibold" : "text-ink/80"}`}>
                {r.nome}
                {r.voce ? " (você)" : ""}
              </span>
              <span className="text-sm font-semibold text-ink/70">{r.score}</span>
            </div>
          ))}
        </Card></div>
      )}
    </div>
  );
}
