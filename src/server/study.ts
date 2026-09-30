import { db, isPostgres, transaction } from "./db";

import { HttpError } from "./http";
import {
  executeFocusCommand,
  focusConflictMessage,
  type FocusCommand,
} from "./focus";

import {
  resolveUserScope,
  updateProfileAvatar,
  updateProfileName,
  type UserScope,
} from "./identity";

import { isPlatformAdmin } from "./authorization";

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

type FocusMutation = Extract<
  z.infer<typeof mutation>,
  { action: "focus-start" | "focus-pause" | "focus-resume" | "focus-end" | "focus-abandon" }
>;

function focusError(error: unknown): never {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const message = error instanceof Error ? error.message : "";
  const friendly = focusConflictMessage(code, message);
  if (friendly) throw new HttpError(409, friendly);
  throw error;
}

async function mutateFocus(user: User, data: FocusMutation) {
  if (!isPostgres())
    throw new HttpError(503, "O relógio de foco requer o banco principal.");
  try {
    await executeFocusCommand(user.id, data as FocusCommand, {
      transaction,
      call: async (command, values) => {
        const connection = db();
        if (command === "start")
          await connection
            .prepare("SELECT aristo.focus_start_session(?,NULLIF(?,''))")
            .get(...values);
        if (command === "pause")
          await connection
            .prepare("SELECT aristo.focus_pause_session(?,?)")
            .get(...values);
        if (command === "resume")
          await connection
            .prepare("SELECT aristo.focus_resume_session(?,?,?)")
            .get(...values);
        if (command === "end")
          await connection
            .prepare("SELECT aristo.focus_end_session(?,?)")
            .get(...values);
        if (command === "abandon")
          await connection
            .prepare("SELECT aristo.focus_abandon_session(?,?)")
            .get(...values);
        if (command === "sync")
          await connection
            .prepare("SELECT aristo.sync_track_achievements(?)")
            .get(...values);
      },
    });
  } catch (error) {
    focusError(error);
  }
}

export function state(user: User): Promise<StudyState> {
  // Fase 4B (performance): this used to be 8 independent statements. Under
  // Postgres, any db() call NOT already inside a transaction() opens its own
  // short-lived BEGIN/SET LOCAL actor/COMMIT sequence (see database.ts's
  // query()) — 4 network round trips each. Wrapping the whole read in one
  // transaction() turns "8 statements x 4 round trips" into "1 open + 8
  // statements + 1 close". This does NOT give the 8 reads a single consistent
  // snapshot: Postgres's default READ COMMITTED isolation still lets each
  // statement see whatever is latest-committed as of that statement, not a
  // snapshot fixed at BEGIN, so a concurrent write can still land between two
  // of these reads exactly as it could before. transaction() no-ops on
  // SQLite when nothing needs batching, and correctly detects (and skips
  // opening a second one for) an already-open transaction, so this is safe
  // to call from within study/route.ts's POST handler too, after mutate()'s
  // own transaction has already committed.
  return transaction(async () => stateWithinTransaction(user));
}

async function stateWithinTransaction(user: User): Promise<StudyState> {
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

  const focus = isPostgres()
    ? (((await connection
        .prepare(`WITH active AS (
          SELECT id,status,study_session_id FROM aristo.focus_sessions
           WHERE user_id=? AND status IN ('RUNNING','PAUSED') LIMIT 1
        ), ordered AS (
          SELECT e.session_id,e.type,e.occurred_at,
                 lead(e.occurred_at,1,clock_timestamp()) OVER (
                   PARTITION BY e.session_id ORDER BY e.occurred_at,e.id
                 ) AS next_at
            FROM aristo.focus_session_events e JOIN active a ON a.id=e.session_id
        ), elapsed AS (
          SELECT session_id,COALESCE(floor(sum(extract(epoch FROM next_at-occurred_at)))::INTEGER,0) AS seconds
            FROM ordered WHERE type IN ('started','resumed') AND next_at>occurred_at GROUP BY session_id
        )
        SELECT a.id,a.status,a.study_session_id AS "studySessionId",COALESCE(elapsed.seconds,0) AS "elapsedSeconds",
               clock_timestamp()::TEXT AS "measuredAt",
               COALESCE((SELECT sum(credited_focus_seconds)::INTEGER
                 FROM aristo.focus_session_daily_credit
                WHERE user_id=? AND local_date=(clock_timestamp() AT TIME ZONE 'America/Bahia')::DATE),0)
                 AS "creditedTodaySeconds"
          FROM active a LEFT JOIN elapsed ON elapsed.session_id=a.id
        UNION ALL
        SELECT NULL,NULL,NULL,0,clock_timestamp()::TEXT,
               COALESCE((SELECT sum(credited_focus_seconds)::INTEGER
                 FROM aristo.focus_session_daily_credit
                WHERE user_id=? AND local_date=(clock_timestamp() AT TIME ZONE 'America/Bahia')::DATE),0)
         WHERE NOT EXISTS (SELECT 1 FROM active)`)
        .get(user.id, user.id, user.id)) ?? {}) as {
        id?: string;
        status?: "RUNNING" | "PAUSED";
        studySessionId?: string;
        elapsedSeconds?: number;
        measuredAt?: string;
        creditedTodaySeconds?: number;
      })
    : {};

  const sessions = isPostgres()
    ? ((await connection
        .prepare(
          `SELECT id,data,version,status,
                  actual_start_at AS "actualStartAt",
                  actual_end_at AS "actualEndAt",
                  net_focus_minutes AS "netFocusMinutes"
             FROM study_sessions WHERE user_id=?
            ORDER BY json_extract(data,'$.date'),json_extract(data,'$.start')`,
        )
        .all(user.id)) as (ItemRow & {
          status: "planned" | "in_progress" | "completed" | "abandoned";
          actualStartAt: string | null;
          actualEndAt: string | null;
          netFocusMinutes: number | null;
        })[])
    : ((await connection
        .prepare(
          "SELECT id,data,version FROM study_sessions WHERE user_id=? ORDER BY json_extract(data,'$.date'),json_extract(data,'$.start')",
        )
        .all(user.id)) as ItemRow[]);

  return {
    user,
    // Fase 4A: surfaces admin-panel access to the nav — reuses
    // authorization.ts's isPlatformAdmin() (Fase 3A), not a new check.
    platformAdmin: await isPlatformAdmin(user.id),
    sessions: sessions.map((r) => {
      const execution = "status" in r
        ? (r as ItemRow & {
            status: "planned" | "in_progress" | "completed" | "abandoned";
            actualStartAt: string | null;
            actualEndAt: string | null;
            netFocusMinutes: number | null;
          })
        : null;
      return {
        ...JSON.parse(r.data),
        id: r.id,
        version: r.version,
        ...(execution
          ? {
              status: execution.status,
              actualStartAt: execution.actualStartAt,
              actualEndAt: execution.actualEndAt,
              netFocusMinutes: execution.netFocusMinutes,
            }
          : {}),
      };
    }),
    demo: !!(await connection
      .prepare("SELECT user_id FROM demo_batches WHERE user_id=?")
      .get(user.id)),
    // Fase 3B part 5, batch 5: routed through aristo.get_mentor_ranking()
    // under Postgres, a narrow SECURITY DEFINER function returning only
    // (id, name, xp) — a users SELECT policy broad enough to cover
    // "sibling under the same mentor" directly would expose password to
    // every student in that mentor's roster. SQLite keeps the original
    // direct query (no RLS to route around).
    ranking: (
      isPostgres()
        ? await connection
            .prepare("SELECT * FROM aristo.get_mentor_ranking(?)")
            .all(user.id)
        : await connection
            .prepare(
              `SELECT u.id,u.name,COALESCE((SELECT COUNT(*)*20 FROM records r WHERE r.user_id=u.id AND r.done=1),0) AS xp FROM users u WHERE u.id IN (SELECT ms.student_id FROM mentor_students ms WHERE ms.mentor_id IN (SELECT mentor_id FROM mentor_students WHERE student_id=?)) ORDER BY xp DESC,u.name,u.id`,
            )
            .all(user.id)
    ) as StudyState["ranking"],

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

    focus: {
      active:
        focus.id && focus.status && focus.measuredAt
          ? {
              id: focus.id,
              status: focus.status,
              studySessionId: focus.studySessionId || undefined,
              elapsedSeconds: Number(focus.elapsedSeconds || 0),
              measuredAt: focus.measuredAt,
            }
          : null,
      creditedTodaySeconds: Number(focus.creditedTodaySeconds || 0),
    },

    plans: plans.map((p) => ({
      ...JSON.parse(p.data),

      date: p.date,

      version: p.version,
    })),

    today: localDate(),
  };
}

export function mutate(user: User, data: z.infer<typeof mutation>) {
  if (data.action.startsWith("focus-"))
    return mutateFocus(user, data as FocusMutation);
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

    // Fase 2B: resolved lazily, only by the branches below that create a
    // new row in items/records/plans/questions/study_sessions — actions
    // that don't touch those tables (profile edits, deletions, etc.) must
    // keep working even for a user with no active organization membership.
    // Memoized per mutate() call since only one action runs per call today.
    let scope: UserScope | undefined;
    async function requireScope() {
      if (scope === undefined) {
        const resolved = await resolveUserScope(user.id);
        if (!resolved)
          throw new HttpError(
            403,
            "Sua conta ainda não está vinculada a uma organização. Peça para seu mentor te adicionar.",
          );
        scope = resolved;
      }
      return scope;
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
        if (isPostgres()) {
          const s = await requireScope();
          await connection
            .prepare(
              "INSERT INTO study_sessions(id,user_id,data,tenant_id,organization_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=study_sessions.version+1",
            )
            .run(
              id,
              user.id,
              JSON.stringify(session),
              s.tenantId,
              s.organizationId,
            );
        } else {
          await connection
            .prepare(
              "INSERT INTO study_sessions(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=study_sessions.version+1",
            )
            .run(id, user.id, JSON.stringify(session));
        }
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

        if (isPostgres()) {
          const s = await requireScope();
          await connection
            .prepare(
              "INSERT INTO questions(id,user_id,data,tenant_id,organization_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=questions.version+1",
            )
            .run(
              id,
              user.id,
              JSON.stringify(data.question),
              s.tenantId,
              s.organizationId,
            );
        } else {
          await connection
            .prepare(
              "INSERT INTO questions(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=questions.version+1",
            )
            .run(id, user.id, JSON.stringify(data.question));
        }
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

        // AND version=?: the version was checked above, but another writer may
        // have got in between. 0 rows means exactly that (or an RLS refusal),
        // never a successful save.
        const saved = await connection

          .prepare(
            "UPDATE items SET data=?,version=version+1 WHERE id=? AND user_id=? AND version=?",
          )

          .run(
            JSON.stringify({ ...data.item, value: 0, done: false }),

            data.item.id,

            user.id,

            // equal to data.item.version: checked a few lines above
            row.version,
          );
        if (!saved.changes) conflict();
      } else {
        if (data.item.version) throw new HttpError(404, "Item não encontrado.");

        const itemData = JSON.stringify({
          ...data.item,
          value: 0,
          done: false,
        });
        if (isPostgres()) {
          const s = await requireScope();
          await connection
            .prepare(
              "INSERT INTO items(id,user_id,data,tenant_id,organization_id) VALUES(?,?,?,?,?)",
            )
            .run(
              data.item.id,
              user.id,
              itemData,
              s.tenantId,
              s.organizationId,
            );
        } else {
          await connection
            .prepare("INSERT INTO items(id,user_id,data) VALUES(?,?,?)")
            .run(data.item.id, user.id, itemData);
        }
      }
    }

    if (data.action === "archive-item") {
      const row = await owned(data.id);

      if (row.version !== data.version) conflict();

      const archived = await connection

        .prepare(
          "UPDATE items SET archived=1,version=version+1 WHERE id=? AND user_id=? AND version=?",
        )

        .run(data.id, user.id, data.version);
      if (!archived.changes) conflict();
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

      const done =
        item.measure === "count" ? data.value >= item.target : data.done;

      if (isPostgres()) {
        const s = await requireScope();
        await connection
          .prepare(
            `INSERT INTO records(user_id,item_id,date,value,done,target,version,tenant_id,organization_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,item_id,date) DO UPDATE SET value=excluded.value,done=excluded.done,target=excluded.target,version=records.version+1`,
          )
          .run(
            user.id,
            item.id,
            recordDate,
            data.value,
            Number(done),
            item.target,
            (existing?.version || 0) + 1,
            s.tenantId,
            s.organizationId,
          );
      } else {
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

      if (isPostgres()) {
        const s = await requireScope();
        await connection
          .prepare(
            "INSERT INTO plans(user_id,date,data,tenant_id,organization_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET data=excluded.data,version=plans.version+1",
          )
          .run(user.id, data.date, plan, s.tenantId, s.organizationId);
      } else {
        await connection
          .prepare(
            "INSERT INTO plans(user_id,date,data) VALUES(?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET data=excluded.data,version=plans.version+1",
          )
          .run(user.id, data.date, plan);
      }
    }

    if (data.action === "profile") {
      const renamed = await connection

        .prepare("UPDATE users SET name=? WHERE id=?")

        .run(data.name, user.id);
      if (!renamed.changes) throw new HttpError(404, "Perfil não encontrado.");

      // Fase 0C: keep aristo.profiles in sync while users.role stays the
      // source of authorization.
      await updateProfileName(user.id, data.name);
    }

    if (data.action === "update-avatar") {
      const updated = await connection

        .prepare("UPDATE users SET avatar=? WHERE id=?")

        .run(data.avatar, user.id);
      if (!updated.changes) throw new HttpError(404, "Perfil não encontrado.");

      await updateProfileAvatar(user.id, data.avatar);
    }
  });
}
