"use client";
import Image from "next/image";
import Link from "next/link";
import { Flame, Trophy, Sparkles } from "lucide-react";
import ProgressBar from "@/components/ui/ProgressBar";
import { useStudy } from "./StudyProvider";
import { progress } from "@/lib/domain";

export default function StudentOverview() {
  const { data } = useStudy();
  const stats = progress(data.items, data.records, data.today);
  const aluno = {
    nome: data.user.name,
    tier: "Aluno",
    nivel: stats.level,
    xpAtual: stats.levelXp,
    xpProximoNivel: 200,
    rankingScore: stats.xp,
    streakUsoPlataforma: stats.streak,
  };
  return (
    <section className="student-overview" aria-label="Resumo do aluno">
      <Link href="/perfil" className="student-overview-identity">
        <Image src="/brand/coelho.png" width={78} height={78} alt="" />
        <div>
          <span className="eyebrow">VISÃO GERAL</span>
          <strong>{aluno.nome}</strong>
          <span className="student-tier">{aluno.tier} · Mentoria Coelho</span>
        </div>
      </Link>
      <div className="student-overview-card">
        <span>
          <Sparkles size={15} />
          Nível
        </span>
        <strong>{aluno.nivel}</strong>
        <ProgressBar
          label="Experiência para o próximo nível"
          value={aluno.xpAtual}
          max={aluno.xpProximoNivel}
        />
        <small>
          {aluno.xpAtual} / {aluno.xpProximoNivel} XP
        </small>
      </div>
      <Link href="/perfil" className="student-overview-card">
        <span>
          <Trophy size={15} />
          Pontuação
        </span>
        <strong>{aluno.rankingScore}</strong>
        <small>XP acumulado</small>
      </Link>
      <div className="student-overview-card">
        <span>
          <Flame size={15} />
          Constância
        </span>
        <strong>
          {aluno.streakUsoPlataforma}
          <small> dias</small>
        </strong>
        <small>dias com atividades concluídas</small>
      </div>
    </section>
  );
}
