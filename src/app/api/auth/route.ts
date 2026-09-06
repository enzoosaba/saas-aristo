import { z } from "zod";
import { randomUUID } from "node:crypto";
import { currentUser,createSession,passwordHash,passwordMatches,logout } from "@/server/auth";
import { db } from "@/server/db";
import { body,failure,HttpError,json,limit } from "@/server/http";
export const runtime="nodejs";
const credentials=z.object({action:z.enum(["login","register"]),email:z.string().trim().toLowerCase().email().max(254),password:z.string().min(12).max(128),name:z.string().trim().min(2).max(80).optional()}).strict();
export async function GET(){try{const user=await currentUser();return json({user},user?200:401);}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const input=await body(request);
 if(input?.action==="logout"){await logout();return json({ok:true});}
 const data=credentials.parse(input);
 // Shared budget is deliberately conservative without trusting forwarded client IP headers.
 limit("auth-global",100,15*60000);limit("auth:"+data.email,10,15*60000);
 const connection=db();
 if(data.action==="register"){
  if(!data.name)throw new HttpError(400,"Informe seu nome.");
  const password=await passwordHash(data.password);const id=randomUUID();
  const result=connection.prepare("INSERT OR IGNORE INTO users(id,name,email,password,created_at) VALUES(?,?,?,?,?)").run(id,data.name,data.email,password,Date.now());
  if(!result.changes)throw new HttpError(409,"Não foi possível criar a conta com esses dados. Tente entrar.");
  await createSession(id);return json({ok:true},201);
 }
 const user=connection.prepare("SELECT id,password FROM users WHERE email=?").get(data.email) as {id:string,password:string}|undefined;
 const valid=await passwordMatches(data.password,user?.password || "00000000000000000000000000000000:"+"00".repeat(64));
 if(!user || !valid)throw new HttpError(401,"E-mail ou senha incorretos.");
 await createSession(user.id);return json({ok:true});
}catch(e){return failure(e);}}
