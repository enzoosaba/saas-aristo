import { db, isPostgres, transaction } from "./db";
import { HttpError } from "./http";
import {
  ensureOrganizationMembership,
  releaseOrganizationMembershipIfOrphaned,
} from "./identity";
import {
  isScheduled,
  type StudyItem,
  type MentorStudent,
  type DailySummary,
} from "@/lib/domain";

export async function roster(mentorId: string): Promise<MentorStudent[]> {
  // Fase 3B part 5, batch 5: routed through aristo.get_mentor_roster()
  // under Postgres — a users SELECT policy broad enough to cover "a
  // linked student" would expose password to every mentor with at least
  // one student. SQLite keeps the original direct join.
  return (
    isPostgres()
      ? await db().prepare("SELECT * FROM aristo.get_mentor_roster(?)").all(mentorId)
      : await db()
          .prepare(
            "SELECT u.id,u.name,u.email,u.avatar FROM mentor_students ms JOIN users u ON u.id=ms.student_id WHERE ms.mentor_id=? ORDER BY u.name",
          )
          .all(mentorId)
  ) as MentorStudent[];
}

export async function dailySummary(
  mentorId: string,
  studentId: string,
  date: string,
): Promise<DailySummary> {
  const connection = db();

  const linked = await connection
    .prepare("SELECT 1 FROM mentor_students WHERE mentor_id=? AND student_id=?")
    .get(mentorId, studentId);
  if (!linked) throw new HttpError(404, "Aluno não encontrado na sua lista.");

  // Fase 3B part 5, batch 5: routed through aristo.get_linked_student()
  // under Postgres, same reason as roster() above. SQLite keeps the
  // original direct lookup.
  const student = (
    isPostgres()
      ? await connection
          .prepare("SELECT * FROM aristo.get_linked_student(?,?)")
          .get(mentorId, studentId)
      : await connection
          .prepare("SELECT id,name,email,avatar FROM users WHERE id=?")
          .get(studentId)
  ) as MentorStudent;

  const items = (
    (await connection
      .prepare(
        "SELECT id,data,version FROM items WHERE user_id=? AND archived=0",
      )
      .all(studentId)) as { id: string; data: string; version: number }[]
  ).map((r) => ({
    ...JSON.parse(r.data),
    id: r.id,
    version: r.version,
  })) as StudyItem[];

  const records = (await connection
    .prepare(
      'SELECT item_id AS "itemId",value,done FROM records WHERE user_id=? AND date=?',
    )
    .all(studentId, date)) as { itemId: string; value: number; done: number }[];

  const activities = items
    .filter((item) => isScheduled(item, date))
    .map((item) => {
      const record = records.find((r) => r.itemId === item.id);
      return {
        id: item.id,
        title: item.title,
        kind: item.kind,
        measure: item.measure,
        target: item.target,
        unit: item.unit,
        value: record?.value || 0,
        done: !!record?.done,
      };
    });

  const sessions = (
    (await connection
      .prepare(
        "SELECT data FROM study_sessions WHERE user_id=? AND json_extract(data,'$.date')=? ORDER BY json_extract(data,'$.start')",
      )
      .all(studentId, date)) as { data: string }[]
  ).map((r) => {
    const s = JSON.parse(r.data);
    return {
      title: s.title,
      subject: s.subject,
      start: s.start,
      duration: s.duration,
    };
  });

  const questions = (
    (await connection
      .prepare(
        "SELECT data FROM questions WHERE user_id=? AND json_extract(data,'$.date')=?",
      )
      .all(studentId, date)) as { data: string }[]
  ).map((r) => {
    const q = JSON.parse(r.data);
    return {
      subject: q.subject,
      topic: q.topic,
      total: q.total,
      correct: q.correct,
    };
  });

  const planRow = (await connection
    .prepare("SELECT data FROM plans WHERE user_id=? AND date=?")
    .get(studentId, date)) as { data: string } | undefined;
  const plan = planRow
    ? (({ prioridades, horarios, observacoes }) => ({
        prioridades,
        horarios,
        observacoes,
      }))(JSON.parse(planRow.data))
    : null;

  return {
    student,
    date,
    doneCount: activities.filter((a) => a.done).length,
    totalCount: activities.length,
    xp: activities.filter((a) => a.done).length * 20,
    activities,
    sessions,
    questions,
    plan,
  };
}

export async function addStudent(mentorId: string, email: string) {
  const connection = db();
  // Fase 3B part 4: the mentor is already authenticated at this point, but
  // this specific lookup is for an *arbitrary other* user by email, before
  // any mentor_students/organization_members link exists between them — a
  // future users RLS policy scoped to "your own row or someone you're
  // already linked to" can't see this row yet, by construction. Routed
  // through aristo.find_user_by_email(), the same narrow SECURITY DEFINER
  // lookup used for login/recovery. SQLite keeps the original direct query.
  const student = (
    isPostgres()
      ? await connection
          .prepare("SELECT * FROM aristo.find_user_by_email(?)")
          .get(email)
      : await connection
          .prepare("SELECT id,role FROM users WHERE email=?")
          .get(email)
  ) as { id: string; role: string } | undefined;
  if (!student)
    throw new HttpError(404, "Nenhuma conta encontrada com esse e-mail.");
  if (student.id === mentorId)
    throw new HttpError(400, "Você não pode se adicionar como aluno.");
  if (student.role !== "student")
    throw new HttpError(400, "Esta conta não é de um aluno.");
  // Fase 1C: the link and both sides' organization membership are created
  // atomically — any failure rolls back the whole operation.
  await transaction(async () => {
    await connection
      .prepare(
        "INSERT OR IGNORE INTO mentor_students(mentor_id,student_id) VALUES(?,?)",
      )
      .run(mentorId, student.id);
    await ensureOrganizationMembership(mentorId, "MENTOR");
    await ensureOrganizationMembership(student.id, "STUDENT");
  });
}

export async function removeStudent(mentorId: string, studentId: string) {
  await transaction(async () => {
    await db()
      .prepare(
        "DELETE FROM mentor_students WHERE mentor_id=? AND student_id=?",
      )
      .run(mentorId, studentId);
    // Only release the student's organization membership if this was their
    // last mentor_students link; a mentor is never released this way.
    await releaseOrganizationMembershipIfOrphaned(studentId);
  });
}
