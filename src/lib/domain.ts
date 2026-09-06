export type StudyItem = {
 id: string; kind: "habit" | "task"; title: string; notes: string;
 frequency: string; measure: "check" | "count"; target: number; unit: string;
 value: number; date: string; time: string; priority: string; done: boolean; version?: number;
};
export type StudyRecord = { itemId: string; date: string; value: number; done: boolean; target: number; version: number };
export type Plan = { date: string; prioridades: string; horarios: string; observacoes: string; version: number };
export type User = { id: string; name: string; email: string; role: "student" | "mentor" };
export type StudyState = { user: User; items: StudyItem[]; records: StudyRecord[]; plans: Plan[]; today: string };
export function localDate() { return new Intl.DateTimeFormat("en-CA", {timeZone:"America/Bahia",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
export function dayOffset(date: string, offset: number) { const d=new Date(date+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10); }
export function isScheduled(item: StudyItem, date: string) {
 if(item.kind === "task") return item.date === date;
 if(date < item.date) return false;
 const day=new Date(date+"T12:00:00Z").getUTCDay();
 return item.frequency === "Todos os dias" || (item.frequency === "Segunda a sexta" ? day>0 && day<6 : day===0 || day===6);
}
export function progress(items: StudyItem[], records: StudyRecord[], today: string) {
 const completed=records.filter(r=>r.done); const days=new Set(completed.map(r=>r.date));
 let cursor=days.has(today)?today:dayOffset(today,-1); let streak=0;
 while(days.has(cursor)){streak++;cursor=dayOffset(cursor,-1);}
 const xp=completed.length*20;
 const scheduled=items.filter(i=>isScheduled(i,today));
 const todayDone=scheduled.filter(i=>records.some(r=>r.itemId===i.id && r.date===today && r.done)).length;
 return {xp,level:Math.floor(xp/200)+1,levelXp:xp%200,streak,todayDone,todayTotal:scheduled.length,todayXp:completed.filter(r=>r.date===today).length*20,totalDone:completed.length};
}
