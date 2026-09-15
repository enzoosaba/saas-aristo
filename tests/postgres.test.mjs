import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { postgresSql, postgresConfig } from "../src/server/postgres-config.mjs";

test("remote PostgreSQL verifies TLS even if URL requests no verification", () => {
  const config = postgresConfig({
    DATABASE_URL: "postgresql://user:secret@example.org/db?sslmode=no-verify",
  });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.ok(!config.connectionString.includes("sslmode"));
  assert.equal(
    postgresConfig({ DATABASE_URL: "postgresql://localhost/test" }).ssl,
    false,
  );
});

test("all application SQL compiles against the PostgreSQL migration", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const files = [
      "src/server/auth.ts",
      "src/server/http.ts",
      "src/server/study.ts",
      "src/server/mentor.ts",
      "src/app/api/auth/route.ts",
      "src/app/api/health/route.ts",
      "src/app/api/auth/recovery/route.ts",
    ];
    let queries = 0;
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const sqls = [];
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "prepare"
        ) {
          assert.ok(
            ts.isStringLiteralLike(node.arguments[0]),
            "SQL must be a fixed string",
          );
          sqls.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      for (const sql of sqls) {
        const converted = postgresSql(sql);
        const count = Math.max(
          0,
          ...[...converted.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
        );
        await db.query(`EXPLAIN ${converted}`, Array(count).fill(null));
        queries++;
      }
    }
    assert.ok(queries >= 35);
    await db.exec(
      "INSERT INTO aristo.users(id,name,email,password,created_at) VALUES('a','A','a@example.test','hash',0),('b','B','b@example.test','hash',0)",
    );
    await db.exec(
      "INSERT INTO aristo.items(id,user_id,data) VALUES('i','a','{}')",
    );
    await assert.rejects(
      db.exec(
        "INSERT INTO aristo.records(user_id,item_id,date,target) VALUES('b','i','2026-09-15',1)",
      ),
      /foreign key/i,
    );
    await db.exec("CREATE ROLE client_test; SET ROLE client_test");
    await assert.rejects(
      db.query("SELECT * FROM aristo.users"),
      /permission denied/i,
    );
    await db.exec("RESET ROLE");
    const aliases = await db.query(
      postgresSql('SELECT item_id AS "itemId" FROM records WHERE user_id=?'),
      ["a"],
    );
    assert.equal(aliases.fields[0].name, "itemId");
  } finally {
    await db.close();
  }
});
