import { db, transaction } from "./db";
import { HttpError } from "./http";
import { mutation } from "./validation";
import {
  localDate,
  isScheduled,
  type StudyItem,
  type User,
  type StudyState,
} from "@/lib/domain";
import { z } from "zod";
type ItemRow = { id: string; data: string; version: number };
export function state(user: User): StudyState {
  const connection = db();
  const items = connection
    .prepare(
      "SELECT id,data,version FROM items WHERE user_id=? AND archived=0 ORDER BY rowid",
    )
    .all(user.id) as ItemRow[];
  const records = connection
    .prepare(
      "SELECT item_id AS itemId,date,value,done,target,version FROM records WHERE user_id=? ORDER BY date",
    )
    .all(user.id) as {
    itemId: string;
    date: string;
    value: number;
    done: number;
    target: number;
    version: number;
  }[];
  const plans = connection
    .prepare(
      "SELECT date,data,version FROM plans WHERE user_id=? ORDER BY date DESC",
    )
    .all(user.id) as { date: string; data: string; version: number }[];
  return {
    user,
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
  return transaction(() => {
    const connection = db();
    function owned(id: string) {
      const row = connection
        .prepare(
          "SELECT id,data,version FROM items WHERE id=? AND user_id=? AND archived=0",
        )
        .get(id, user.id) as ItemRow | undefined;
      if (!row) throw new HttpError(404, "Item não encontrado.");
      return row;
    }
    function conflict() {
      throw new HttpError(
        409,
        "Este registro mudou em outra aba. Atualize a página antes de tentar novamente.",
      );
    }
    if (data.action === "save-item") {
      const existing = connection
        .prepare("SELECT id FROM items WHERE id=?")
        .get(data.item.id);
      if (existing) {
        const row = owned(data.item.id);
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
        connection
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
        connection
          .prepare("INSERT INTO items(id,user_id,data) VALUES(?,?,?)")
          .run(
            data.item.id,
            user.id,
            JSON.stringify({ ...data.item, value: 0, done: false }),
          );
      }
    }
    if (data.action === "archive-item") {
      const row = owned(data.id);
      if (row.version !== data.version) conflict();
      connection
        .prepare(
          "UPDATE items SET archived=1,version=version+1 WHERE id=? AND user_id=?",
        )
        .run(data.id, user.id);
    }
    if (data.action === "record") {
      const row = owned(data.id);
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
          ? connection
              .prepare(
                "SELECT date,version FROM records WHERE user_id=? AND item_id=?",
              )
              .get(user.id, item.id)
          : connection
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
        connection
          .prepare("DELETE FROM records WHERE user_id=? AND item_id=?")
          .run(user.id, item.id);
      if (data.value > item.target)
        throw new HttpError(400, "O progresso não pode ultrapassar a meta.");
      const done =
        item.measure === "count" ? data.value >= item.target : data.done;
      connection
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
      const existing = connection
        .prepare("SELECT version FROM plans WHERE user_id=? AND date=?")
        .get(user.id, data.date) as { version: number } | undefined;
      if ((existing?.version || 0) !== data.version) conflict();
      const plan = JSON.stringify({
        prioridades: data.prioridades,
        horarios: data.horarios,
        observacoes: data.observacoes,
      });
      connection
        .prepare(
          "INSERT INTO plans(user_id,date,data) VALUES(?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET data=excluded.data,version=plans.version+1",
        )
        .run(user.id, data.date, plan);
    }
    if (data.action === "profile")
      connection
        .prepare("UPDATE users SET name=? WHERE id=?")
        .run(data.name, user.id);
  });
}
