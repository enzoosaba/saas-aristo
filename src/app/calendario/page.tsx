import { PinIcon, ListChecks, CalendarDays } from "lucide-react";
import PersonalItems from "@/components/PersonalItems";
import Card from "@/components/ui/Card";
import ProgressBar from "@/components/ui/ProgressBar";
import { aluno, horariosDiarios, proximaProva, streakCalendario } from "@/lib/mock-data";

const NIVEL_COR: Record<0 | 1 | 2 | 3, string> = {
  0: "bg-black/8",
  1: "bg-accent/30",
  2: "bg-accent/65",
  3: "bg-accent-dark",
};

export default function CalendarioPage() {
  return (
    <div className="workspace-page calendar-page responsive-panels">
      <h1 className="text-xl font-semibold">Calendário</h1>
      <p className="page-description">Sua jornada de estudos, no seu tempo.</p>

      <Card className="exam-highlight border border-accent/20 bg-linear-to-br from-accent/15 to-transparent">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-accent">
          <PinIcon size={12} /> Destaque
        </div>
        <p className="mt-1 text-sm text-ink/70">Faltam</p>
        <p className="exam-countdown">
          {proximaProva.diasRestantes} dias <span className="exam-name">para o {proximaProva.nome}</span>
        </p>
        <p className="text-xs text-ink/50">{proximaProva.data}</p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar label="Preparação para a prova" value={proximaProva.progresso} max={100} colorClassName="bg-accent" />
          </div>
          <span className="text-xs font-semibold text-accent">{proximaProva.progresso}%</span>
        </div>
      </Card>

      <Card><div className="panel-title"><h2><ListChecks size={20}/>Próximo simulado</h2></div><div className="study-empty"><CalendarDays size={34}/><strong>Nenhum simulado cadastrado</strong><p>Quando houver uma data cadastrada, ela aparecerá aqui para você se organizar.</p></div></Card>

      <Card className="full-width">
        <div className="panel-title"><h2><CalendarDays size={20}/>Sequência de estudo</h2><span className="streak-pill">{aluno.streakUsoPlataforma} dias de constância</span></div>
        <p className="text-xs text-ink/50">Últimos 30 dias</p>
        <div className="mt-3 grid grid-cols-10 gap-1.5">
          {streakCalendario.map(({ dia, nivel }) => (
            <div
              key={dia}
              title={`Dia ${dia}`}
              className={`aspect-square w-full rounded-[4px] ${NIVEL_COR[nivel]}`}
            />
          ))}
        </div>
      </Card>

      <PersonalItems kind="task"/>
      <div className="full-width">
        <p className="mb-2 text-sm font-semibold">Agenda de hoje</p>
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
    </div>
  );
}
