import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { db as sqlite } from "./sqlite";
import { postgresConfig, postgresSql } from "./postgres-config.mjs";

type Context = { client?: PoolClient };
const shared = globalThis as unknown as {
  aristoPool?: Pool;
  aristoContext?: AsyncLocalStorage<Context>;
  aristoQueue?: Promise<void>;
};
const context = (shared.aristoContext ??= new AsyncLocalStorage<Context>());
export const isPostgres = () => Boolean(process.env.DATABASE_URL);

function pool() {
  if (!shared.aristoPool) {
    shared.aristoPool = new Pool(postgresConfig());
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

async function query(
  sql: string,
  values: (string | number | null)[],
  mode: "get" | "all" | "run",
) {
  if (isPostgres()) {
    const result = await (context.getStore()?.client ?? pool()).query(
      postgresSql(sql),
      values,
    );
    if (mode === "run") return { changes: result.rowCount ?? 0 };
    const rows = result.rows.map((row) =>
      "xp" in row ? { ...row, xp: Number(row.xp) } : row,
    );
    return mode === "get" ? rows[0] : rows;
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
