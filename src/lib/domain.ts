export type StudyItem = {
  id: string;

  kind: "habit" | "task";

  title: string;

  notes: string;

  frequency: string;

  measure: "check" | "count";

  target: number;

  unit: string;

  value: number;

  date: string;

  time: string;

  priority: string;

  done: boolean;

  version?: number;
};

export type StudyRecord = {
  itemId: string;

  date: string;

  value: number;

  done: boolean;

  target: number;

  version: number;
};

export type Plan = {
  date: string;

  prioridades: string;

  horarios: string;

  observacoes: string;

  version: number;
};

export type User = {
  id: string;

  name: string;

  email: string;

  role: "student" | "mentor";

  avatar?: string | null;
};

export type QuestionLog = {
  id: string;
  subject: string;
  topic: string;
  date: string;
  total: number;
  correct: number;
  version: number;
};

export type StudySession = {
  id: string;
  title: string;
  subject: string;
  date: string;
  start: string;
  duration: number;
  notes: string;
  version: number;
};
export type StudyState = {
  sessions: StudySession[];
  demo: boolean;
  questions: QuestionLog[];
  ranking: { id: string; name: string; xp: number }[];

  user: User;

  platformAdmin: boolean;

  items: StudyItem[];

  records: StudyRecord[];

  plans: Plan[];

  today: string;
};

export type MentorStudent = {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
};

export type DailyActivity = {
  id: string;
  title: string;
  kind: "habit" | "task";
  measure: "check" | "count";
  target: number;
  unit: string;
  value: number;
  done: boolean;
};

export type DailySummary = {
  student: MentorStudent;
  date: string;
  doneCount: number;
  totalCount: number;
  xp: number;
  activities: DailyActivity[];
  sessions: { subject: string; start: string; duration: number }[];
  questions: { subject: string; topic: string; total: number; correct: number }[];
  plan: { prioridades: string; horarios: string; observacoes: string } | null;
};

export function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",

    year: "numeric",

    month: "2-digit",

    day: "2-digit",
  }).format(new Date());
}

export function dayOffset(date: string, offset: number) {
  const d = new Date(date + "T12:00:00Z");

  d.setUTCDate(d.getUTCDate() + offset);

  return d.toISOString().slice(0, 10);
}

export function minutesOf(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function isScheduled(item: StudyItem, date: string) {
  if (item.kind === "task") return item.date === date;

  if (date < item.date) return false;

  const day = new Date(date + "T12:00:00Z").getUTCDay();

  return (
    item.frequency === "Todos os dias" ||
    (item.frequency === "Segunda a sexta"
      ? day > 0 && day < 6
      : day === 0 || day === 6)
  );
}

export function progress(
  items: StudyItem[],

  records: StudyRecord[],

  today: string,
) {
  const completed = records.filter((r) => r.done);

  const days = new Set(completed.map((r) => r.date));

  let cursor = days.has(today) ? today : dayOffset(today, -1);

  let streak = 0;

  while (days.has(cursor)) {
    streak++;

    cursor = dayOffset(cursor, -1);
  }

  const xp = completed.length * 20;

  const scheduled = items.filter((i) => isScheduled(i, today));

  const todayDone = scheduled.filter((i) =>
    records.some((r) => r.itemId === i.id && r.date === today && r.done),
  ).length;

  return {
    xp,

    level: Math.floor(xp / 200) + 1,

    levelXp: xp % 200,

    streak,

    todayDone,

    todayTotal: scheduled.length,

    todayXp: completed.filter((r) => r.date === today).length * 20,

    totalDone: completed.length,
  };
}

// "0 dias", "1 dia", "2 dias": a streak of exactly one day is singular.
export function daysLabel(count: number) {
  return `${count} ${count === 1 ? "dia" : "dias"}`;
}

export const QUESTION_AREAS = [
  "Linguagens",
  "Humanas",
  "Biologia",
  "Química",
  "Física",
  "Matemática",
];

export function questionAnalytics(
  questions: QuestionLog[],
  today: string,
  period: number,
) {
  const rows = questions.filter(
    (q) => q.date >= dayOffset(today, 1 - period) && q.date <= today,
  );

  const total = rows.reduce((s, q) => s + q.total, 0);

  const correct = rows.reduce((s, q) => s + q.correct, 0);

  const days = Array.from({ length: period }, (_, i) =>
    dayOffset(today, i - period + 1),
  );

  const values = days.map((date) => {
    const r = rows.filter((q) => q.date === date);

    return {
      total: r.reduce((s, q) => s + q.total, 0),

      correct: r.reduce((s, q) => s + q.correct, 0),
    };
  });

  const areaStats = QUESTION_AREAS.map((name) => {
    const list = rows.filter((q) => q.subject === name);

    const areaTotal = list.reduce((s, q) => s + q.total, 0);

    return {
      name,

      total: areaTotal,

      percent: areaTotal
        ? Math.round((list.reduce((s, q) => s + q.correct, 0) / areaTotal) * 100)
        : 0,
    };
  });

  const cumulative = values.map((_, i) => {
    const subset = values.slice(0, i + 1);

    const count = subset.reduce((s, v) => s + v.total, 0);

    return count ? subset.reduce((s, v) => s + v.correct, 0) / count : null;
  });

  const topics = Object.values(
    rows.reduce<Record<string, { label: string; errors: number }>>((a, q) => {
      const label = `${q.subject}: ${q.topic}`;

      a[label] ||= { label, errors: 0 };

      a[label].errors += q.total - q.correct;

      return a;
    }, {}),
  )
    .filter((t) => t.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 5);

  return {
    rows,

    total,

    correct,

    percent: total ? Math.round((correct / total) * 100) : 0,

    days,

    values,

    areaStats,

    cumulative,

    max: Math.max(1, ...values.map((v) => v.total)),

    topics,
  };
}
