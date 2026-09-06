"use client";

import { useState } from "react";
import Link from "next/link";
import { Target, NotebookPen, Clock3, Layers, ArrowUpRight, ChartNoAxesCombined, Trophy, AlertTriangle } from "lucide-react";
import Card from "@/components/ui/Card";
import ProgressBar from "@/components/ui/ProgressBar";
import { desempenho, evolucaoAcerto, habitos, metasSemanais, periodos, topicosErros, xpHojeAtual, xpHojeMeta, type PeriodoId } from "@/lib/mock-data";

export function MissionsPanel() {
 const [period,setPeriod] = useState<"hoje" | "semana">("hoje");
 const today = habitos.filter(h=>h.tipo === "medivel").filter(h=>h.id !== "h2").map(h=>({nome:h.nome,atual:h.valor,meta:h.meta,unidade:h.unidade}));
 const rows = period === "hoje" ? today : metasSemanais.map(m=>({...m,unidade:m.id==="m2" ? "horas" : ""}));
 const icons = [NotebookPen,Layers,Clock3];
 return <Card className="missions-panel"><div className="panel-title"><h2><Target size={20}/>Missões</h2><div className="period-switch" aria-label="Período das missões">{(["hoje","semana"] as const).map(p=><button key={p} aria-pressed={p===period} onClick={()=>setPeriod(p)}>{p==="hoje" ? "Hoje" : "Semana"}</button>)}</div></div>
 <p className="panel-description">{period==="hoje" ? "Pequenas metas para avançar hoje." : "Acompanhe suas metas desta semana."}</p>
 {period==="hoje" && <div className="mission-xp"><span>Experiência de hoje</span><strong>{xpHojeAtual} / {xpHojeMeta} XP</strong><ProgressBar label="Experiência de hoje" value={xpHojeAtual} max={xpHojeMeta}/></div>}
 <div aria-live="polite">{rows.map((m,i)=>{const Icon=icons[i%icons.length];return <div className="mission-row" key={m.nome}><span className="mission-icon"><Icon size={21}/></span><div><div className="mission-line"><strong>{m.nome}</strong><span>{m.atual}/{m.meta} {m.unidade}</span></div><ProgressBar label={m.nome} value={m.atual} max={m.meta}/></div></div>;})}</div><Link href="/rotina" className="panel-link">Gerenciar minha rotina<ArrowUpRight size={16}/></Link></Card>;
}

export function QuestionsPanel() {
 return <Card className="questions-panel"><div className="panel-title"><h2><NotebookPen size={20}/>Questões feitas</h2></div><div className="questions-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="questions-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff8b38"/><stop offset=".45" stopColor="#ff5d00"/><stop offset="1" stopColor="#e85002"/></linearGradient></defs><circle cx="100" cy="100" r="83" fill="none" stroke="var(--border-default)" strokeWidth="13"/><circle cx="100" cy="100" r="83" fill="none" stroke="url(#questions-gradient)" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${2*Math.PI*83*desempenho.taxaAcerto/100} ${2*Math.PI*83}`} transform="rotate(-90 100 100)"/></svg><div><strong>{desempenho.questoesPeriodo}</strong><span>questões respondidas</span></div></div><p className="ring-caption"><span/>{desempenho.taxaAcerto}% de acerto</p><Link href="/perfil" className="panel-link">Explorar meu desempenho<ArrowUpRight size={16}/></Link></Card>;
}

export function PerformancePanels() {
 const [view,setView]=useState<"grafico" | "lista">("grafico");
 const areas=desempenho.areas;
 const point=(i:number,value:number)=>{const angle=-Math.PI/2+i*Math.PI/3;return [180+Math.cos(angle)*value,165+Math.sin(angle)*value];};
 const polygon=(scale:number)=>areas.map((_,i)=>point(i,100*scale).join(",")).join(" ");
 return <div className="performance-panels"><div className="insight-grid"><Card className="insight-card"><Trophy size={23}/><span>Melhor área</span><strong>{desempenho.melhorArea}</strong><p>Seu destaque no resumo disponível.</p></Card><Card className="insight-card"><AlertTriangle size={23}/><span>Ponto de atenção</span><strong>{desempenho.pontoDeAtencao}</strong><p>Reserve um tempo para revisar seus erros.</p></Card></div>
 <Card className="area-chart-panel"><div className="panel-title"><h2><Target size={20}/>Taxa de acerto por área</h2><div className="period-switch" aria-label="Visualização por área"><button aria-pressed={view==="grafico"} onClick={()=>setView("grafico")}>Gráfico</button><button aria-pressed={view==="lista"} onClick={()=>setView("lista")}>Lista</button></div></div>
 {view==="grafico" ? <svg className="radar-chart" viewBox="0 0 360 340" role="img" aria-label={areas.map(a=>`${a.nome}: ${a.valor}%`).join("; ")}><defs><linearGradient id="radar-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff8b38"/><stop offset=".5" stopColor="#ff5d00"/><stop offset="1" stopColor="#e85002"/></linearGradient></defs>{[.25,.5,.75,1].map(v=><polygon key={v} points={polygon(v)} fill="none" stroke="var(--border-default)" strokeDasharray="3 4"/>)}{areas.map((a,i)=>{const [x,y]=point(i,100);return <line key={a.nome} x1="180" y1="165" x2={x} y2={y} stroke="var(--border-default)"/>;})}<polygon points={areas.map((a,i)=>point(i,a.valor).join(",")).join(" ")} fill="url(#radar-gradient)" fillOpacity=".24" stroke="url(#radar-gradient)" strokeWidth="2.5"/>{areas.map((a,i)=>{const [x,y]=point(i,a.valor);const [tx,ty]=point(i,135);return <g key={a.nome}><circle cx={x} cy={y} r="4" fill="#ffb254" stroke="var(--surface-card)" strokeWidth="2"/><text x={tx} y={ty} textAnchor="middle" fill="#c4b9c6" fontSize="10">{a.nome==="Linguagens e Códigos" ? "Linguagens" : a.nome==="Ciências Humanas" ? "Humanas" : a.nome}</text><text x={tx} y={ty+16} textAnchor="middle" fill="#ffb254" fontSize="12" fontWeight="600">{a.valor}%</text></g>;})}</svg> : <div className="area-list">{areas.map(a=><div key={a.nome}><div className="mission-line"><span>{a.nome}</span><strong>{a.valor}%</strong></div><ProgressBar label={a.nome} value={a.valor} max={100}/></div>)}</div>}
 <p className="panel-description">Resumo disponível · dados demonstrativos</p></Card>
 <div className="insight-grid history-panels"><EvolutionPanel/><TopicsPanel/></div>
 </div>;
}

function EvolutionPanel() {
 const maxQuestoes = Math.max(...evolucaoAcerto.map(p=>p.questoes));
 const x = (i:number) => 34 + i*(292/(evolucaoAcerto.length-1));
 const y = (taxa:number) => 122 - (taxa/100)*88;
 const linha = evolucaoAcerto.map((p,i)=>`${x(i)},${y(p.taxa)}`).join(" ");
 const mediaLinha = evolucaoAcerto.map((p,i)=>`${x(i)},${y(p.media)}`).join(" ");
 return <Card className="evolution-panel"><div className="panel-title"><h2><ChartNoAxesCombined size={20}/>Evolução da taxa de acerto</h2></div>
  <p className="chart-legend"><span className="legend-line"/>Você<span className="legend-dashed"/>Média dos alunos<span className="legend-bar"/>Questões no dia</p>
  <svg className="evolution-chart" viewBox="0 0 340 160" role="img" aria-label={evolucaoAcerto.map(p=>`${p.data}: ${p.taxa}% de acerto em ${p.questoes} questões`).join("; ")}>
   <defs><linearGradient id="evolution-gradient" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#ff8b38"/><stop offset=".5" stopColor="#ff5d00"/><stop offset="1" stopColor="#e85002"/></linearGradient></defs>
   {[0,25,50,75,100].map(v=><g key={v}><line x1="34" x2="326" y1={y(v)} y2={y(v)} stroke="var(--border-default)" strokeDasharray="3 4"/><text x="26" y={y(v)+4} textAnchor="end" fill="var(--text-secondary)" fontSize="9">{v}</text></g>)}
   {evolucaoAcerto.map((p,i)=>{const altura=(p.questoes/maxQuestoes)*54;return <rect key={p.data} x={x(i)-9} y={134-altura} width="18" height={altura} rx="3" fill="#ff5d00" fillOpacity=".22"/>;})}
   <polyline points={mediaLinha} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="4 4"/>
   <polyline points={linha} fill="none" stroke="url(#evolution-gradient)" strokeWidth="2.5" strokeLinejoin="round"/>
   {evolucaoAcerto.map((p,i)=><circle key={p.data} cx={x(i)} cy={y(p.taxa)} r="3.5" fill="#ffb254" stroke="var(--surface-card)" strokeWidth="2"/>)}
   {evolucaoAcerto.map((p,i)=><text key={p.data} x={x(i)} y="152" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">{p.data}</text>)}
  </svg></Card>;
}

function TopicsPanel() {
 return <Card className="topics-panel"><div className="panel-title"><h2><AlertTriangle size={20}/>Tópicos com mais erros</h2></div>
  <ol className="topic-list">{topicosErros.map(t=><li key={t.topico} className={`topic-row topic-rank-${t.posicao}`}><span className="topic-rank">{t.posicao}</span><div><strong>{t.topico}</strong><span>{t.area}</span></div><span className="topic-errors">{t.erros} erros</span></li>)}</ol>
  <Link href="/rotina" className="panel-link">Revisar meus pontos fracos<ArrowUpRight size={16}/></Link></Card>;
}

export function PeriodSwitch({periodo,onChange}:{periodo:PeriodoId; onChange:(p:PeriodoId)=>void}) {
 return <div className="period-switch period-filter" aria-label="Período do desempenho">
  {periodos.map(p=><button key={p.id} aria-pressed={p.id===periodo} onClick={()=>onChange(p.id)}>{p.label}</button>)}
 </div>;
}
