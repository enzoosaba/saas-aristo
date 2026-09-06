"use client";

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import ProgressBar from "@/components/ui/ProgressBar";
import { useStudyItems, saveStudyItem, type StudyItem } from "@/lib/study-items";

export default function PersonalItems({ kind }: { kind?: "habit" | "task" }) {
  const items = useStudyItems().filter(item => !kind || item.kind === kind);
  const [error, setError] = useState("");
  if (!items.length) return null;
  function update(item: StudyItem) { try { saveStudyItem(item); setError(""); } catch { setError("Não foi possível atualizar. Tente novamente."); } }
  return <section className="personal-items full-width"><h2>{kind === "task" ? "Minhas tarefas" : "Meus hábitos e tarefas"}</h2>{error && <p role="alert">{error}</p>}<div className="personal-items-grid">{items.map(item => <Card key={item.id} className="personal-item"><div className="personal-item-title"><span>{item.kind === "habit" ? "HÁBITO" : "TAREFA"}</span><strong>{item.title}</strong></div><p>{item.kind === "habit" ? item.frequency : `${item.date.split("-").reverse().join("/")} · ${item.priority}`}{item.time ? ` · ${item.time}` : ""}</p>{item.notes && <p>{item.notes}</p>}{item.measure === "count" ? <><div className="personal-counter"><button type="button" aria-label={`Diminuir ${item.title}`} disabled={item.value<=0} onClick={()=>update({...item,value:item.value-1})}><Minus size={18}/></button><span>{item.value} / {item.target} {item.unit}</span><button type="button" aria-label={`Aumentar ${item.title}`} disabled={item.value>=item.target} onClick={()=>update({...item,value:item.value+1})}><Plus size={18}/></button></div><ProgressBar label={item.title} value={item.value} max={item.target}/></> : <button className="personal-done" type="button" aria-pressed={item.done} onClick={()=>update({...item,done:!item.done})}><Check size={18}/>{item.done ? "Concluído" : "Marcar como concluído"}</button>}</Card>)}</div></section>;
}
