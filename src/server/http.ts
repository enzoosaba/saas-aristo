import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function body(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "Origem não autorizada.");
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Envie dados em JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Dados ausentes.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 24000) {
      await reader.cancel();
      throw new HttpError(413, "Conteúdo muito grande.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Dados inválidos.");
  }
}
export function limit(key: string, max = 60, duration = 60000) {
  const now = Date.now();
  const connection = db();
  connection.prepare("DELETE FROM rate_limits WHERE until < ?").run(now);
  const hash = createHash("sha256").update(key).digest("hex");
  const entry = connection
    .prepare(
      `INSERT INTO rate_limits(key,hits,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits`,
    )
    .get(hash, now + duration) as { hits: number };
  if (entry.hits > max)
    throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos.");
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return json(
      {
        error: "Revise os campos informados.",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    );
  const requestId = randomUUID();
  console.error(
    JSON.stringify({
      event: "request_failed",
      requestId,
      type: error instanceof Error ? error.name : "unknown",
    }),
  );
  return json(
    { error: "Não foi possível concluir. Tente novamente.", requestId },
    500,
  );
}
