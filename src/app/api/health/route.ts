import { db } from "@/server/db";
export const runtime="nodejs";
export async function GET(){try{db().prepare("SELECT 1").get();return Response.json({status:"ok"},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({status:"unavailable"},{status:503});}}
