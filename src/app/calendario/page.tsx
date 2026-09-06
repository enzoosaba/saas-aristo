"use client";
import {useState} from "react";
import PersonalItems from "@/components/PersonalItems";
import Card from "@/components/ui/Card";
import {useStudy} from "@/components/StudyProvider";
export default function CalendarioPage(){const {data}=useStudy();const [date,setDate]=useState(data.today);return <div className="workspace-page flex flex-col gap-4"><h1>Calendário</h1><p className="page-description">Sua agenda, conectada à rotina.</p><label className="date-picker">Data da agenda<input type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><PersonalItems date={date}/><Card><div className="panel-title"><h2>Provas e simulados</h2></div><div className="study-empty"><strong>Nenhuma prova cadastrada</strong><p>Por enquanto, você pode organizar seus compromissos como tarefas com data e horário.</p></div></Card></div>;}
