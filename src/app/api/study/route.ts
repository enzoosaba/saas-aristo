import { requireUser } from "@/server/auth";
import { body,failure,json,limit } from "@/server/http";
import { state,mutate } from "@/server/study";
import { mutation } from "@/server/validation";
export const runtime="nodejs";
export async function GET(){try{return json(state(await requireUser()));}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await requireUser();limit("write:"+user.id,120);const data=mutation.parse(await body(request));mutate(user,data);return json(state(data.action==="profile"?{...user,name:data.name}:user));}catch(e){return failure(e);}}
