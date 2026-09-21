import { AsyncLocalStorage } from "node:async_hooks";

// "Who is making this request", read by database.ts and applied to every
// Postgres statement with SET LOCAL app.user_id so RLS policies can consult it.
//
// withActor() is the ONLY way to establish an actor, and it is
// AsyncLocalStorage.run(): the actor exists exactly for the callback and
// everything it awaits, and concurrent requests never see each other's.
// There is deliberately no enterWith()-style "set it for the rest of this
// execution" function: enterWith() called inside a callee (as a helper like
// requireUser() would) does not reach the caller once the caller resumes after
// its await, so every later query ran with no actor and RLS silently returned
// nothing / updated nothing. tests/actor-context.test.mjs keeps it that way.
type ActorContext = { userId: string | null };
const shared = globalThis as unknown as {
  aristoActorContext?: AsyncLocalStorage<ActorContext>;
};
const actorContext = (shared.aristoActorContext ??=
  new AsyncLocalStorage<ActorContext>());

export function withActor<T>(
  userId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  return actorContext.run({ userId }, work);
}

export function currentActorId(): string | null {
  return actorContext.getStore()?.userId ?? null;
}
