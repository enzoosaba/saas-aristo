// Server-only configuration shared with operational scripts.
export function postgresConfig(env = process.env) {
  if (!env.DATABASE_URL)
    throw new Error("Configure DATABASE_URL para o PostgreSQL.");
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL: formato de conexão inválido.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("DATABASE_URL inválida.");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    url.hostname,
  );
  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          ...(env.DATABASE_SSL_CA
            ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, "\n") }
            : {}),
        },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
    statement_timeout: 15000,
    allowExitOnIdle: true,
  };
}

// Fixed application SQL only; user input always remains a bound parameter.
export function postgresSql(sql) {
  let parameter = 0;
  let result = sql.replace(
    /json_extract\(data,'\$\.(\w+)'\)/g,
    "(data::jsonb->>'$1')",
  );
  const ignore = /INSERT OR IGNORE/i.test(result);
  result = result.replace(/INSERT OR IGNORE/gi, "INSERT");
  result = result.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|\?|\browid\b/g,
    (token) => {
      if (token === "?") return `$${++parameter}`;
      if (token === "rowid") return "sequence_id";
      return token;
    },
  );
  result = result.replace(
    /\b(FROM|JOIN|INTO|UPDATE)\s+(users|mentor_students|sessions|items|records|plans|rate_limits|questions|study_sessions|demo_batches|password_resets|tenants|profiles|tenant_members|platform_admins|tenant_settings|audit_logs|organizations|organization_members)\b/gi,
    "$1 aristo.$2",
  );
  if (ignore) result += " ON CONFLICT DO NOTHING";
  return result;
}
