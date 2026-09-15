import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const userId = process.argv[2];
if (!userId) throw Error("Informe o ID da conta a preencher.");
const db = new DatabaseSync(
  resolve(process.env.DATABASE_PATH || "data/coelho.sqlite"),
);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
const user = db.prepare("SELECT id,name FROM users WHERE id=?").get(userId);
if (!user) throw Error("Conta não encontrada.");
if (
  db.prepare("SELECT user_id FROM demo_batches WHERE user_id=?").get(userId)
) {
  console.log("Dados demonstrativos já carregados para esta conta.");
  db.close();
  process.exit(0);
}
mkdirSync("data/backups", { recursive: true });
const snapshot = resolve(`data/backups/before-demo-${Date.now()}.sqlite`);
await backup(db, snapshot);
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bahia",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const offset = (d, n) => {
  const x = new Date(d + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const start = offset(today, -34);
const monday = offset(
  today,
  -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7),
);
const makeItem = (
  title,
  kind = "habit",
  date = start,
  target = 1,
  unit = "",
  time = "",
) => ({
  id: randomUUID(),
  kind,
  title,
  notes: "Exemplo para apresentação da plataforma.",
  frequency: "Todos os dias",
  measure: unit ? "count" : "check",
  target,
  unit,
  value: 0,
  date,
  time,
  priority: "Normal",
  done: false,
});
const insertItem = db.prepare(
  "INSERT INTO items(id,user_id,data) VALUES(?,?,?)",
);
const record = db.prepare(
  "INSERT INTO records(user_id,item_id,date,value,done,target) VALUES(?,?,?,?,?,?)",
);
db.exec("BEGIN IMMEDIATE");
try {
  const habits = [
    makeItem("Questões de revisão", "habit", start, 30, "questões"),
    makeItem("Aulas e anotações", "habit", start, 3, "aulas"),
    makeItem("Foco nos estudos", "habit", start, 180, "min"),
    makeItem("Revisão de flashcards", "habit", start, 40, "cards"),
  ];
  for (const [h, item] of habits.entries()) {
    insertItem.run(item.id, userId, JSON.stringify(item));
    for (let i = 0; i < 35; i++) {
      const date = offset(start, i);
      const done = date < today && ((i >= 17 && h === 0) || (i + h) % 5 !== 0);
      const value =
        date === today
          ? [18, 1, 95, 24][h]
          : done
            ? item.target
            : Math.floor(item.target * 0.4);
      record.run(userId, item.id, date, value, Number(done), item.target);
    }
  }
  const tasks = [
    makeItem("Revisar funções e gráficos", "task", today, 1, "", "14:00"),
    makeItem("Resolver lista de cinemática", "task", today, 1, "", "16:00"),
    makeItem(
      "Revisar redação com a mentoria",
      "task",
      offset(today, 1),
      1,
      "",
      "18:00",
    ),
    makeItem(
      "Planejar a próxima semana",
      "task",
      offset(monday, 6),
      1,
      "",
      "19:00",
    ),
  ];
  tasks.forEach((i) => insertItem.run(i.id, userId, JSON.stringify(i)));
  const subjects = [
    "Linguagens",
    "Humanas",
    "Biologia",
    "Química",
    "Física",
    "Matemática",
  ];
  const topics = [
    "Interpretação de texto",
    "Brasil República",
    "Ecologia",
    "Estequiometria",
    "Cinemática",
    "Funções e geometria",
  ];
  for (let i = 0; i < 42; i++) {
    const a = i % 6;
    const total = 12 + (i % 7) * 3;
    const correct = Math.round(
      total * ([0.84, 0.74, 0.79, 0.69, 0.73, 0.88][a] - (i % 3) * 0.025),
    );
    const q = {
      id: randomUUID(),
      subject: subjects[a],
      topic: topics[a],
      date: offset(today, -Math.floor(i / 2)),
      total,
      correct,
      version: 1,
    };
    db.prepare("INSERT INTO questions(id,user_id,data) VALUES(?,?,?)").run(
      q.id,
      userId,
      JSON.stringify(q),
    );
  }
  for (let i = 0; i < 14; i++) {
    const date = offset(monday, i);
    db.prepare(
      "INSERT OR IGNORE INTO plans(user_id,date,data) VALUES(?,?,?)",
    ).run(
      userId,
      date,
      JSON.stringify({
        prioridades: `Revisar ${topics[i % 6].toLowerCase()} e resolver uma lista de questões.\nRetomar os erros da última revisão.`,
        horarios:
          "09h às 10h: teoria e anotações\n14h às 15h: exercícios e revisão",
        observacoes:
          "Manter pausas curtas e registrar as dúvidas para a próxima mentoria.",
      }),
    );
    if (i % 7 === 6) continue;
    for (let k = 0; k < 2; k++) {
      const a = (i + k) % 6;
      const session = {
        id: randomUUID(),
        title: topics[a],
        subject: subjects[a],
        date,
        start: k ? "14:00" : "09:00",
        duration: k ? 60 : 90,
        notes: "Sessão demonstrativa: teoria, prática e revisão dos erros.",
        version: 1,
      };
      const collisions = db
        .prepare(
          "SELECT data FROM study_sessions WHERE user_id=? AND json_extract(data,'$.date')=?",
        )
        .all(userId, date)
        .some((r) => {
          const s = JSON.parse(r.data);
          const start =
            Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3));
          const n = k ? 840 : 540;
          return start < n + session.duration && start + s.duration > n;
        });
      if (!collisions)
        db.prepare(
          "INSERT INTO study_sessions(id,user_id,data) VALUES(?,?,?)",
        ).run(session.id, userId, JSON.stringify(session));
    }
  }
  const salt = randomBytes(16).toString("hex");
  const disabledPassword =
    salt +
    ":" +
    scryptSync(randomBytes(48).toString("hex"), salt, 64).toString("hex");
  function demoUser(name, role = "student") {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)",
    ).run(id, name, `${id}@demo.invalid`, disabledPassword, role, Date.now());
    return id;
  }
  const mentor = demoUser("Mentoria demonstrativa", "mentor");
  db.prepare(
    "INSERT INTO mentor_students(mentor_id,student_id) VALUES(?,?)",
  ).run(mentor, userId);
  for (const [index, name] of [
    "Ana · demonstração",
    "Lucas · demonstração",
    "Marina · demonstração",
  ].entries()) {
    const id = demoUser(name);
    db.prepare(
      "INSERT INTO mentor_students(mentor_id,student_id) VALUES(?,?)",
    ).run(mentor, id);
    for (let h = 0; h < 4; h++) {
      const item = makeItem(`Prática demonstrativa ${h + 1}`);
      insertItem.run(item.id, id, JSON.stringify(item));
      for (let n = 0; n < 26 + index * 5; n++)
        record.run(id, item.id, offset(today, -n), 1, 1, 1);
    }
  }
  db.prepare("INSERT INTO demo_batches(user_id,created_at) VALUES(?,?)").run(
    userId,
    new Date().toISOString(),
  );
  db.exec("COMMIT");
  console.log(
    JSON.stringify({
      account: user.name,
      habits: 4,
      tasks: 4,
      questionLogs: 42,
      plannedWeeks: 2,
      backup: snapshot,
    }),
  );
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
} finally {
  db.close();
}
