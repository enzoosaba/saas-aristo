// Fase 3B part 6: gives aristo_app (NOLOGIN since part 1) a real password,
// so it can actually be connected to — still inert until part 7 points
// database.ts at it. Generates the password locally with Node's crypto,
// never hardcodes or prints it, and writes APP_DATABASE_URL straight into
// .env.local (already gitignored, same as DATABASE_URL itself) rather than
// echoing it to the terminal.
//
// Two modes:
//   node scripts/provision-app-role.mjs
//     Generates a random password, applies it to the database DATABASE_URL
//     points at, and updates .env.local. For real environments (Supabase).
//   node scripts/provision-app-role.mjs --password <fixed> [--print-url]
//     Applies a caller-supplied password instead of generating one, and
//     prints the resulting connection string to stdout instead of writing
//     a file. For CI's ephemeral, already-non-secret Postgres service
//     (see .github/workflows/ci.yml), which needs the value in that job's
//     own env, not in a file.
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { postgresConfig } from "../src/server/postgres-config.mjs";

const args = process.argv.slice(2);
const passwordFlagIndex = args.indexOf("--password");
const suppliedPassword =
  passwordFlagIndex !== -1 ? args[passwordFlagIndex + 1] : null;
const printUrl = args.includes("--print-url");

if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL não definida — aponte para a conexão dona (postgres) antes de provisionar aristo_app.",
  );

// Hex-only: no quotes, backslashes or other characters that would need
// escaping when embedded directly in the ALTER ROLE literal below. 32
// bytes = 256 bits of entropy, 64 hex characters.
const password = suppliedPassword || randomBytes(32).toString("hex");
if (suppliedPassword && !/^[A-Za-z0-9]+$/.test(suppliedPassword))
  throw new Error(
    "--password deve conter apenas letras/dígitos (evita qualquer necessidade de escaping no literal SQL).",
  );

const client = new Client(postgresConfig());
await client.connect();
try {
  // ALTER ROLE's PASSWORD clause is DDL and does not accept a bind
  // parameter — safe here only because the password is constrained above
  // to a character set with no SQL-meaningful characters.
  await client.query(
    `ALTER ROLE aristo_app WITH LOGIN PASSWORD '${password}'`,
  );
  // stderr, not stdout: --print-url mode's caller (test-postgres.mjs)
  // captures stdout as the connection string verbatim — a status line
  // mixed in there would corrupt it into an invalid URL. Human-run
  // invocations still see this (it's piped to the terminal either way).
  console.error("aristo_app: LOGIN habilitado, senha atualizada.");
} finally {
  await client.end();
}

const ownerUrl = new URL(process.env.DATABASE_URL);
const appUrl = new URL(process.env.DATABASE_URL);
// Supabase's pooler (Supavisor/PgBouncer) encodes a routing tenant id in
// the username as `<role>.<project-ref>` — e.g. `postgres.abcdefgh`. A
// plain role-name swap drops that suffix and the pooler rejects the
// connection outright ("no tenant identifier provided"). Preserve
// whatever suffix the owner's own username already has (there is none
// outside Supabase's pooler, e.g. a direct/local connection, where
// ownerUrl.username has no dot and this is a no-op).
const dotIndex = ownerUrl.username.indexOf(".");
appUrl.username =
  dotIndex === -1
    ? "aristo_app"
    : "aristo_app" + ownerUrl.username.slice(dotIndex);
appUrl.password = password;
const appDatabaseUrl = appUrl.toString();

if (printUrl) {
  console.log(appDatabaseUrl);
} else {
  const envPath = ".env.local";
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = `APP_DATABASE_URL=${appDatabaseUrl}`;
  const updated = /^APP_DATABASE_URL=.*$/m.test(existing)
    ? existing.replace(/^APP_DATABASE_URL=.*$/m, line)
    : existing.replace(/\n?$/, "\n") + line + "\n";
  writeFileSync(envPath, updated);
  console.log(
    `APP_DATABASE_URL escrita em ${envPath} (host/porta/database iguais a DATABASE_URL: ${ownerUrl.host}${ownerUrl.pathname}). Valor não impresso aqui.`,
  );
}
