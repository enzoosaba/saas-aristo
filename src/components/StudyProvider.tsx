"use client";
import { createContext,useContext,useState,useEffect,useCallback,type ReactNode } from "react";
import type { StudyState,StudyItem } from "@/lib/domain";
import AuthForm from "./auth/AuthForm";
type Context = {data:StudyState;mutate:(payload:unknown)=>Promise<void>;refresh:()=>Promise<void>;editing:StudyItem|null;setEditing:(item:StudyItem|null)=>void;logout:()=>Promise<void>};
const StudyContext=createContext<Context|null>(null);
export function useStudy(){const value=useContext(StudyContext);if(!value)throw Error("StudyProvider ausente");return value;}
export default function StudyProvider({children}:{children:ReactNode}){
 const [data,setData]=useState<StudyState|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [editing,setEditing]=useState<StudyItem|null>(null);
 const refresh=useCallback(async()=>{try{const response=await fetch("/api/study",{cache:"no-store"});if(response.status===401){setData(null);setError("");return;}const result=await response.json();if(!response.ok)throw Error(result.error);setData(result);setError("");}catch{setError("Não foi possível sincronizar. Confira sua conexão e tente novamente.");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();const focus=()=>{void refresh();};window.addEventListener("focus",focus);const interval=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);return()=>{window.removeEventListener("focus",focus);clearInterval(interval);};},[refresh]);
 async function mutate(payload:unknown){const response=await fetch("/api/study",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const result=await response.json();if(response.status===401){setData(null);throw Error("Sua sessão expirou. Entre novamente.");}if(!response.ok)throw Error(result.error||"Não foi possível salvar.");setData(result);setError("");}
 async function logout(){const response=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout"})});if(!response.ok)throw Error("Não foi possível sair. Tente novamente.");setData(null);setEditing(null);}
 if(loading)return <main className="auth-screen"><p role="status">Abrindo seu espaço de estudos…</p></main>;
 if(!data)return <AuthForm onSuccess={refresh} connectionError={error}/>;
 return <StudyContext.Provider value={{data,mutate,refresh,editing,setEditing,logout}}>{error&&<div className="sync-error" role="alert">{error}<button onClick={()=>void refresh()}>Tentar novamente</button></div>}{children}</StudyContext.Provider>;
}
