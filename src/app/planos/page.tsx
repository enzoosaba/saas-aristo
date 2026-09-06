"use client";
import { useRef, useEffect, useState } from "react";
import { MessageSquareText, Check, Save, NotebookPen } from "lucide-react";
import Card from "@/components/ui/Card";
const fields = [
 {id:"prioridades",label:"Prioridades de amanhã",hint:"O que merece sua atenção primeiro?",placeholder:"Ex.: terminar a aula de Tipos Textuais e revisar flashcards de Geografia…"},
 {id:"horarios",label:"Horário de estudo planejado",hint:"Reserve tempo para estudar e descansar.",placeholder:"Ex.: 08h–10h Matemática, 14h–16h redação…"},
 {id:"observacoes",label:"Observações do dia",hint:"Reflita sobre o que funcionou para você.",placeholder:"Como você se sentiu? O que gostaria de fazer diferente amanhã?"},
];
export default function PlanosPage() {
 const formRef = useRef<HTMLFormElement>(null);
 const [status,setStatus] = useState("");
 const [saveError,setSaveError] = useState(false);
 useEffect(()=>{try {const stored=localStorage.getItem("coelho-planejamento"); if(stored) {const parsed=JSON.parse(stored); if(parsed && typeof parsed === "object") fields.forEach(f=>{const input=formRef.current?.elements.namedItem(f.id);if(input instanceof HTMLTextAreaElement) input.value=typeof parsed[f.id]==="string" ? parsed[f.id] : "";});}} catch { /* A fresh form remains available when stored data cannot be read. */ }},[]);
 function save(){setSaveError(false);try{localStorage.setItem("coelho-planejamento",JSON.stringify(Object.fromEntries(new FormData(formRef.current!))));setStatus("Planejamento salvo neste navegador.");}catch{setSaveError(true);setStatus("Não foi possível salvar. Verifique o armazenamento do navegador e tente novamente.");}}
 return <div className="workspace-page flex flex-col gap-4"><div><p className="eyebrow">UM DIA COM MAIS INTENÇÃO</p><h1 className="font-semibold">Planos</h1><p className="text-sm text-ink/60">Organize amanhã e abra espaço para suas conquistas.</p></div>
 <Card className="flex items-start gap-3 border-accent/20 bg-accent/5"><MessageSquareText size={21} className="mt-0.5 shrink-0 text-accent"/><div><p className="text-xs font-semibold uppercase tracking-wide text-accent">Instruções do mentor</p><p className="mt-2 text-sm leading-relaxed text-ink/80">Foque nas questões de Matemática antes das 14h e revise os erros de História do simulado passado.</p></div></Card>
 <form ref={formRef} onSubmit={e=>{e.preventDefault();save();}} className="grid gap-5 lg:grid-cols-2">{fields.map((f,i)=><Card key={f.id} className={i===0 ? "lg:col-span-2" : ""}><div className="mb-2 flex items-center gap-2"><NotebookPen size={17} className="text-accent-dark"/><label htmlFor={f.id} className="text-sm font-semibold">{f.label}</label></div><p id={`${f.id}-hint`} className="text-xs text-ink/60">{f.hint}</p><textarea id={f.id} aria-describedby={`${f.id}-hint`} rows={4} name={f.id} onChange={()=>{setStatus("");setSaveError(false);}} placeholder={f.placeholder} className="mt-4 w-full rounded-xl border border-black/10 p-4 text-sm"/></Card>)}<div className="flex flex-wrap items-center justify-between gap-4 lg:col-span-2"><p role={saveError ? "alert" : "status"} className="form-feedback text-xs text-ink/70">{status || "Seu planejamento fica salvo neste navegador."}</p><button type="submit" className="flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-white hover:bg-ink/90">{status.startsWith("Planejamento salvo") ? <Check size={17}/> : <Save size={17}/>}Salvar planejamento</button></div></form></div>;
}
