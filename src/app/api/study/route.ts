import { requireUser } from "@/server/auth";
import { body, failure, json, limit } from "@/server/http";
import { state, mutate } from "@/server/study";
import { mutation } from "@/server/validation";
import { withActor } from "@/server/db";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await requireUser();
    // requireUser() only identifies the caller; withActor() is what sets the
    // actor RLS reads, for everything state() does below.
    return json(await withActor(user.id, () => state(user)));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return json(
      await withActor(user.id, async () => {
        await limit("write:" + user.id, 120);
        const data = mutation.parse(await body(request));
        await mutate(user, data);
        const updated =
          data.action === "profile"
            ? { ...user, name: data.name }
            : data.action === "update-avatar"
              ? { ...user, avatar: data.avatar }
              : user;
        return state(updated);
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
