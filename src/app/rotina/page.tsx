"use client";
import {useState} from "react";
import PersonalItems from "@/components/PersonalItems";
import {useStudy} from "@/components/StudyProvider";
export default function RotinaPage(){const {data}=useStudy();const [date,setDate]=useState(data.today);const [all,setAll]=useState(false);return <div className="workspace-page flex flex-col gap-4"><h1>Rotina</h1><p className="page-description">Construa constância, um hábito de cada vez.</p><div className="flex flex-wrap gap-4"><label className="date-picker">Dia da rotina<input type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><div className="period-switch"><button aria-pressed={!all} onClick={()=>setAll(false)}>Neste dia</button><button aria-pressed={all} onClick={()=>setAll(true)}>Todos os itens</button></div></div><PersonalItems date={date} showAll={all}/></div>;}
