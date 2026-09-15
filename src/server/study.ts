import { db, transaction } from "./db";

import { HttpError } from "./http";

import { mutation } from "./validation";

import {
  localDate,
  isScheduled,
  minutesOf,
  type StudyItem,
  type User,
  type StudyState,
} from "@/lib/domain";

import { z } from "zod";

type ItemRow = { id: string; data: string; version: number };

export async function state(user: User): Promise<StudyState> {
  const connection = db();

  const items = (await connection

    .prepare(
      "SELECT id,data,version FROM items WHERE user_id=? AND archived=0 ORDER BY rowid",
    )

    .all(user.id)) as ItemRow[];

  const records = (await connection

    .prepare(
      'SELECT item_id AS "itemId",date,value,done,target,version FROM records WHERE user_id=? ORDER BY date',
    )

    .all(user.id)) as {
    itemId: string;

    date: string;

    value: number;

    done: number;

    target: number;

    version: number;
  }[];

  const plans = (await connection

    .prepare(
      "SELECT date,data,version FROM plans WHERE user_id=? ORDER BY date DESC",
    )

    .all(user.id)) as { date: string; data: string; version: number }[];

  return {
    user,
    sessions: (
      (await connection
        .prepare(
          "SELECT id,data,version FROM study_sessions WHERE user_id=? ORDER BY json_extract(data,'$.date'),json_extract(data,'$.start')",
        )
        .all(user.id)) as ItemRow[]
    ).map((r) => ({ ...JSON.parse(r.data), id: r.id, version: r.version })),
    demo: !!(await connection
      .prepare("SELECT user_id FROM demo_batches WHERE user_id=?")
      .get(user.id)),
    ranking: (await connection
      .prepare(
        `SELECT u.id,u.name,COALESCE((SELECT COUNT(*)*20 FROM records r WHERE r.user_id=u.id AND r.done=1),0) AS xp FROM users u WHERE u.id IN (SELECT ms.student_id FROM mentor_students ms WHERE ms.mentor_id IN (SELECT mentor_id FROM mentor_students WHERE student_id=?)) ORDER BY xp DESC,u.name,u.id`,
      )
      .all(user.id)) as StudyState["ranking"],

    questions: (
      (await connection
        .prepare(
          "SELECT id,data,version FROM questions WHERE user_id=? ORDER BY rowid DESC",
        )
        .all(user.id)) as ItemRow[]
    ).map((r) => ({ ...JSON.parse(r.data), id: r.id, version: r.version })),

    items: items.map((row) => ({
      ...JSON.parse(row.data),

      id: row.id,

      version: row.version,
    })),

    records: records.map((r) => ({ ...r, done: !!r.done })),

    plans: plans.map((p) => ({
      ...JSON.parse(p.data),

      date: p.date,

      version: p.version,
    })),

    today: localDate(),
  };
}

export function mutate(user: User, data: z.infer<typeof mutation>) {
  return transaction(async () => {
    const connection = db();
    // Serialize each user's mutations across PostgreSQL connections/instances.
    await connection.prepare("SELECT id FROM users WHERE id=? FOR UPDATE").get(user.id);

    async function owned(id: string) {
      const row = (await connection

        .prepare(
          "SELECT id,data,version FROM items WHERE id=? AND user_id=? AND archived=0",
        )

        .get(id, user.id)) as ItemRow | undefined;

      if (!row) throw new HttpError(404, "Item não encontrado.");

      return row;
    }

    function conflict() {
      throw new HttpError(
        409,

        "Este registro mudou em outra aba. Atualize a página antes de tentar novamente.",
      );
    }

    if (data.action === "save-session" || data.action === "delete-session") {
      const id = data.action === "save-session" ? data.session.id : data.id;
      const version =
        data.action === "save-session" ? data.session.version : data.version;
      const row = (await connection
        .prepare("SELECT user_id,version FROM study_sessions WHERE id=?")
        .get(id)) as { user_id: string; version: number } | undefined;
      if (row && row.user_id !== user.id)
        throw new HttpError(404, "Sessão não encontrada.");
      if (!row && data.action === "delete-session")
        throw new HttpError(404, "Esta sessão já foi removida.");
      if ((row?.version || 0) !== version) conflict();
      if (data.action === "delete-session")
        await connection
          .prepare("DELETE FROM study_sessions WHERE id=? AND user_id=?")
          .run(id, user.id);
      else {
        const session = data.session;
        const start = minutesOf(session.start);
        const others = (await connection
          .prepare(
            "SELECT data FROM study_sessions WHERE user_id=? AND id<>? AND json_extract(data,'$.date')=?",
          )
          .all(user.id, id, session.date)) as { data: string }[];
        if (
          others.some((r) => {
            const o = JSON.parse(r.data);
            const t = minutesOf(o.start);
            return start < t + o.duration && start + session.duration > t;
          })
        )
          throw new HttpError(
            409,
            "Esse horário já tem uma sessão. Escolha outro horário.",
          );
        await connection
          .prepare(
            "INSERT INTO study_sessions(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=study_sessions.version+1",
          )
          .run(id, user.id, JSON.stringify(session));
      }
    }
    if (data.action === "save-question" || data.action === "delete-question") {
      const id = data.action === "save-question" ? data.question.id : data.id;

      const row = (await connection
        .prepare("SELECT user_id,version FROM questions WHERE id=?")
        .get(id)) as { user_id: string; version: number } | undefined;

      if (row && row.user_id !== user.id)
        throw new HttpError(404, "Registro não encontrado.");

      if (!row && data.action === "delete-question")
        throw new HttpError(404, "Este registro já foi removido.");

      const version =
        data.action === "save-question" ? data.question.version : data.version;

      if ((row?.version || 0) !== version) conflict();

      if (data.action === "delete-question")
        await connection
          .prepare("DELETE FROM questions WHERE id=? AND user_id=?")
          .run(id, user.id);
      else {
        if (data.question.date > localDate())
          throw new HttpError(400, "Registre apenas questões já realizadas.");

        await connection
          .prepare(
            "INSERT INTO questions(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=questions.version+1",
          )
          .run(id, user.id, JSON.stringify(data.question));
      }
    }

    if (data.action === "save-item") {
      const existing = await connection

        .prepare("SELECT id FROM items WHERE id=?")

        .get(data.item.id);

      if (existing) {
        const row = await owned(data.item.id);

        if (row.version !== data.item.version) conflict();

        const original = JSON.parse(row.data) as StudyItem;

        if (
          original.kind !== data.item.kind ||
          original.measure !== data.item.measure
        )
          throw new HttpError(
            400,

            "O tipo de acompanhamento não pode mudar após a criação.",
          );

        await connection

          .prepare(
            "UPDATE items SET data=?,version=version+1 WHERE id=? AND user_id=?",
          )

          .run(
            JSON.stringify({ ...data.item, value: 0, done: false }),

            data.item.id,

            user.id,
          );
      } else {
        if (data.item.version) throw new HttpError(404, "Item não encontrado.");

        await connection

          .prepare("INSERT INTO items(id,user_id,data) VALUES(?,?,?)")

          .run(
            data.item.id,

            user.id,

            JSON.stringify({ ...data.item, value: 0, done: false }),
          );
      }
    }

    if (data.action === "archive-item") {
      const row = await owned(data.id);

      if (row.version !== data.version) conflict();

      await connection

        .prepare(
          "UPDATE items SET archived=1,version=version+1 WHERE id=? AND user_id=?",
        )

        .run(data.id, user.id);
    }

    if (data.action === "record") {
      const row = await owned(data.id);

      const item = JSON.parse(row.data) as StudyItem;

      if (data.date > localDate())
        throw new HttpError(
          400,

          "Não é possível concluir uma atividade em uma data futura.",
        );

      if (item.kind === "habit" && !isScheduled(item, data.date))
        throw new HttpError(400, "O hábito não está programado para esse dia.");

      if (
        item.kind === "task" &&
        (item.date > localDate() || data.date < item.date)
      )
        throw new HttpError(
          400,

          "A conclusão não pode ser anterior à data da tarefa.",
        );

      const existing = (
        item.kind === "task"
          ? await connection

              .prepare(
                "SELECT date,version FROM records WHERE user_id=? AND item_id=?",
              )

              .get(user.id, item.id)
          : await connection

              .prepare(
                "SELECT date,version FROM records WHERE user_id=? AND item_id=? AND date=?",
              )

              .get(user.id, item.id, data.date)
      ) as { date: string; version: number } | undefined;

      if ((existing?.version || 0) !== data.version) conflict();

      const recordDate =
        item.kind === "task" && !data.done && existing
          ? existing.date
          : data.date;

      if (item.kind === "task" && existing && existing.date !== recordDate)
        await connection

          .prepare("DELETE FROM records WHERE user_id=? AND item_id=?")

          .run(user.id, item.id);

      if (data.value > item.target)
        throw new HttpError(400, "O progresso não pode ultrapassar a meta.");

      const done =
        item.measure === "count" ? data.value >= item.target : data.done;

      await connection

        .prepare(
          `INSERT INTO records(user_id,item_id,date,value,done,target,version) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,item_id,date) DO UPDATE SET value=excluded.value,done=excluded.done,target=excluded.target,version=records.version+1`,
        )

        .run(
          user.id,

          item.id,

          recordDate,

          data.value,

          Number(done),

          item.target,

          (existing?.version || 0) + 1,
        );
    }

    if (data.action === "save-plan") {
      const existing = (await connection

        .prepare("SELECT version FROM plans WHERE user_id=? AND date=?")

        .get(user.id, data.date)) as { version: number } | undefined;

      if ((existing?.version || 0) !== data.version) conflict();

      const plan = JSON.stringify({
        prioridades: data.prioridades,

        horarios: data.horarios,

        observacoes: data.observacoes,
      });

      await connection

        .prepare(
          "INSERT INTO plans(user_id,date,data) VALUES(?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET data=excluded.data,version=plans.version+1",
        )

        .run(user.id, data.date, plan);
    }

    if (data.action === "profile")
      await connection

        .prepare("UPDATE users SET name=? WHERE id=?")

        .run(data.name, user.id);

    if (data.action === "update-avatar")
      await connection

        .prepare("UPDATE users SET avatar=? WHERE id=?")

        .run(data.avatar, user.id);
  });
}
