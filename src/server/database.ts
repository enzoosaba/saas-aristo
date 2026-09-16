import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { db as sqlite } from "./sqlite";
import { postgresConfig, postgresSql } from "./postgres-config.mjs";

type Context = { client?: PoolClient };
type ActorContext = { userId: string | null };
const shared = globalThis as unknown as {
  aristoPool?: Pool;
  aristoContext?: AsyncLocalStorage<Context>;
  aristoActorContext?: AsyncLocalStorage<ActorContext>;
  aristoQueue?: Promise<void>;
};
const context = (shared.aristoContext ??= new AsyncLocalStorage<Context>());
// Fase 3B: "who is making this request", threaded through to every
// Postgres statement via SET LOCAL (see applyActorContext) so RLS policies
// can consult it. Separate from `context` above (the transaction client)
// on purpose — an actor can be established before a transaction exists
// (see withActor below) and the two are set at different points.
const actorContext = (shared.aristoActorContext ??= new AsyncLocalStorage<ActorContext>());
export const isPostgres = () => Boolean(process.env.DATABASE_URL);

// Fase 3B part 7 (cutover): the running app connects as aristo_app
// (RLS-restricted) when APP_DATABASE_URL is set, falling back to
// DATABASE_URL (the owning role, bypasses RLS) otherwise — so the cutover
// and its rollback are each a single environment variable change plus a
// restart, never a code change or schema migration. Every other Postgres
// connection in this codebase (migrate-postgres.mjs, check-postgres.mjs,
// backup-postgres.mjs, provision-app-role.mjs, set-mentor.mjs,
// import-sqlite.mjs) calls postgresConfig() with no override and must
// keep using DATABASE_URL/the owner role — they perform schema changes or
// administrative reads/writes that RLS would otherwise block.
function pool() {
  if (!shared.aristoPool) {
    const connectionUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
    shared.aristoPool = new Pool(
      postgresConfig({ ...process.env, DATABASE_URL: connectionUrl }),
    );
    shared.aristoPool.on("error", () => console.error("postgres_pool_error"));
  }
  return shared.aristoPool;
}

async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const previous = shared.aristoQueue ?? Promise.resolve();
  let release!: () => void;
  shared.aristoQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

// Establishes "who is acting" for every Postgres statement run inside
// `work`, including ones not wrapped in an explicit transaction() — see
// query() below, which opens a short-lived transaction for those
// specifically so this can apply. Call this once per request (requireUser
// et al.), or explicitly with a fresh id mid-transaction for the one
// legitimate case where there is no session yet (registration minting a
// new user's own id — see src/app/api/auth/route.ts).
export function withActor<T>(
  userId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  return actorContext.run({ userId }, work);
}

function currentActorId(): string | null {
  return actorContext.getStore()?.userId ?? null;
}

// Sets the actor for the rest of the current async execution chain without
// requiring a callback wrapper around every route — see currentUser() in
// src/server/auth.ts, the single place every authenticated request passes
// through. Node's AsyncLocalStorage.enterWith() scopes this to the current
// context and everything that continues from it (this request), not to
// other concurrent requests.
export function setActor(userId: string | null) {
  actorContext.enterWith({ userId });
}

// SET LOCAL, not SET: scoped to the current transaction only, so it can
// never leak into whatever request the pool hands this connection to next.
// Uses set_config's parameterized form rather than string-interpolating
// SET LOCAL app.user_id = '...' — belt-and-braces, since user ids are our
// own randomUUID()s today, but this is the only injection-safe way to do
// it regardless.
async function applyActorContext(client: PoolClient) {
  await client.query("SELECT set_config('app.user_id', $1, true)", [
    currentActorId() ?? "",
  ]);
}

function formatRows(
  result: { rows: Array<Record<string, unknown>> },
  mode: "get" | "all" | "run",
  rowCount: number | null,
) {
  if (mode === "run") return { changes: rowCount ?? 0 };
  const rows = result.rows.map((row) =>
    "xp" in row ? { ...row, xp: Number(row.xp) } : row,
  );
  return mode === "get" ? rows[0] : rows;
}

async function query(
  sql: string,
  values: (string | number | null)[],
  mode: "get" | "all" | "run",
) {
  if (isPostgres()) {
    const existingClient = context.getStore()?.client;
    if (existingClient) {
      const result = await existingClient.query<Record<string, unknown>>(
        postgresSql(sql),
        values,
      );
      return formatRows(result, mode, result.rowCount);
    }
    // No explicit transaction() wraps this call: a bare pool.query() would
    // autocommit immediately, before a SET LOCAL could ever take effect,
    // so every standalone statement gets its own short-lived transaction
    // purely to make the actor context apply to it too.
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await applyActorContext(client);
      const result = await client.query<Record<string, unknown>>(
        postgresSql(sql),
        values,
      );
      await client.query("COMMIT");
      return formatRows(result, mode, result.rowCount);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const work = async () => {
    const statement = sqlite().prepare(sql.replace(/\s+FOR UPDATE\b/gi, ""));
    return statement[mode](...values);
  };
  return context.getStore() ? work() : exclusive(work);
}

export function db() {
  if (!isPostgres() && process.env.VERCEL)
    throw new Error("DATABASE_URL é obrigatória nesta hospedagem.");
  return {
    prepare(sql: string) {
      return {
        get: (...values: (string | number | null)[]) =>
          query(sql, values, "get"),
        all: (...values: (string | number | null)[]) =>
          query(sql, values, "all"),
        run: async (...values: (string | number | null)[]) =>
          (await query(sql, values, "run")) as { changes: number },
      };
    },
  };
}

export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  if (context.getStore()) return work();
  if (isPostgres()) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await applyActorContext(client);
      const result = await context.run({ client }, work);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return exclusive(async () => {
    sqlite().exec("BEGIN IMMEDIATE");
    try {
      const result = await context.run({}, work);
      sqlite().exec("COMMIT");
      return result;
    } catch (error) {
      sqlite().exec("ROLLBACK");
      throw error;
    }
  });
}
