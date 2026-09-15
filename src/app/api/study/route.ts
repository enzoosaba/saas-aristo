import { requireUser } from "@/server/auth";
import { body, failure, json, limit } from "@/server/http";
import { state, mutate } from "@/server/study";
import { mutation } from "@/server/validation";
export const runtime = "nodejs";
export async function GET() {
  try {
    return json(await state(await requireUser()));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await limit("write:" + user.id, 120);
    const data = mutation.parse(await body(request));
    await mutate(user, data);
    const updated =
      data.action === "profile"
        ? { ...user, name: data.name }
        : data.action === "update-avatar"
          ? { ...user, avatar: data.avatar }
          : user;
    return json(await state(updated));
  } catch (e) {
    return failure(e);
  }
}
