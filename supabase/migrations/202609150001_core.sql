-- Private server-side schema. Do not add "coelho" to the exposed Data API schemas.
CREATE SCHEMA IF NOT EXISTS coelho;
REVOKE ALL ON SCHEMA coelho FROM PUBLIC;

CREATE TABLE coelho.users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','mentor')),
  created_at BIGINT NOT NULL, avatar TEXT
);
CREATE TABLE coelho.mentor_students (
  mentor_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  PRIMARY KEY(mentor_id,student_id), CHECK(mentor_id <> student_id)
);
CREATE TABLE coelho.sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE INDEX sessions_user ON coelho.sessions(user_id);
CREATE INDEX sessions_expires ON coelho.sessions(expires);
CREATE TABLE coelho.items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  sequence_id BIGSERIAL UNIQUE, UNIQUE(user_id,id)
);
CREATE INDEX items_user ON coelho.items(user_id,archived);
CREATE TABLE coelho.records (
  user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL, date TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0 CHECK(value >= 0),
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
  target INTEGER NOT NULL CHECK(target > 0), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  PRIMARY KEY(user_id,item_id,date),
  FOREIGN KEY(user_id,item_id) REFERENCES coelho.items(user_id,id) ON DELETE CASCADE
);
CREATE TABLE coelho.plans (
  user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), PRIMARY KEY(user_id,date)
);
CREATE TABLE coelho.questions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), sequence_id BIGSERIAL UNIQUE
);
CREATE INDEX questions_user ON coelho.questions(user_id);
CREATE TABLE coelho.study_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE INDEX study_sessions_user ON coelho.study_sessions(user_id);
CREATE INDEX study_sessions_date ON coelho.study_sessions(user_id,((data::jsonb)->>'date'));
CREATE TABLE coelho.rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, until BIGINT NOT NULL);
CREATE INDEX rate_limits_expiry ON coelho.rate_limits(until);
CREATE TABLE coelho.demo_batches (
  user_id TEXT PRIMARY KEY REFERENCES coelho.users(id) ON DELETE CASCADE, created_at TEXT NOT NULL
);

-- Deny all direct client access. Authorization is enforced by authenticated Next.js APIs.
ALTER TABLE coelho.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.mentor_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE coelho.demo_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA coelho FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA coelho FROM PUBLIC;
