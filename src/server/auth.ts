import { cookies } from "next/headers";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";
import { HttpError } from "./http";
import type { User } from "@/lib/domain";
const derive=promisify(scrypt);
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function passwordHash(password:string) { const salt=randomBytes(16).toString("hex");const key=await derive(password,salt,64) as Buffer; return salt+":"+key.toString("hex"); }
export async function passwordMatches(password:string,stored:string) {const [salt,value]=stored.split(":");const candidate=await derive(password,salt,64) as Buffer;const expected=Buffer.from(value,"hex");return expected.length===candidate.length && timingSafeEqual(expected,candidate);}
export async function currentUser():Promise<User|null> {
 const token=(await cookies()).get("coelho-session")?.value;if(!token)return null;
 return db().prepare("SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?").get(hash(token),Date.now()) as User || null;
}
export async function requireUser(){const user=await currentUser();if(!user)throw new HttpError(401,"Entre na sua conta para continuar.");return user;}
export async function createSession(userId:string) {
 const token=randomBytes(32).toString("hex");const maxAge=60*60*24*7;
 db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
 db().prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)").run(hash(token),userId,Date.now()+maxAge*1000);
 (await cookies()).set("coelho-session",token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge});
}
export async function logout(){const jar=await cookies();const token=jar.get("coelho-session")?.value;if(token)db().prepare("DELETE FROM sessions WHERE token=?").run(hash(token));jar.delete("coelho-session");}
