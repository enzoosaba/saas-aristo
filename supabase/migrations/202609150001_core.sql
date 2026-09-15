-- Private server-side schema. Do not add "aristo" to the exposed Data API schemas.
CREATE SCHEMA IF NOT EXISTS aristo;
REVOKE ALL ON SCHEMA aristo FROM PUBLIC;

CREATE TABLE aristo.users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','mentor')),
  created_at BIGINT NOT NULL, avatar TEXT
);
CREATE TABLE aristo.mentor_students (
  mentor_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  PRIMARY KEY(mentor_id,student_id), CHECK(mentor_id <> student_id)
);
CREATE TABLE aristo.sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE INDEX sessions_user ON aristo.sessions(user_id);
CREATE INDEX sessions_expires ON aristo.sessions(expires);
CREATE TABLE aristo.items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  sequence_id BIGSERIAL UNIQUE, UNIQUE(user_id,id)
);
CREATE INDEX items_user ON aristo.items(user_id,archived);
CREATE TABLE aristo.records (
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL, date TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0 CHECK(value >= 0),
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
  target INTEGER NOT NULL CHECK(target > 0), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  PRIMARY KEY(user_id,item_id,date),
  FOREIGN KEY(user_id,item_id) REFERENCES aristo.items(user_id,id) ON DELETE CASCADE
);
CREATE TABLE aristo.plans (
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), PRIMARY KEY(user_id,date)
);
CREATE TABLE aristo.questions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), sequence_id BIGSERIAL UNIQUE
);
CREATE INDEX questions_user ON aristo.questions(user_id);
CREATE TABLE aristo.study_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(jsonb_typeof(data::jsonb)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE INDEX study_sessions_user ON aristo.study_sessions(user_id);
CREATE INDEX study_sessions_date ON aristo.study_sessions(user_id,((data::jsonb)->>'date'));
CREATE TABLE aristo.rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, until BIGINT NOT NULL);
CREATE INDEX rate_limits_expiry ON aristo.rate_limits(until);
CREATE TABLE aristo.demo_batches (
  user_id TEXT PRIMARY KEY REFERENCES aristo.users(id) ON DELETE CASCADE, created_at TEXT NOT NULL
);

-- Deny all direct client access. Authorization is enforced by authenticated Next.js APIs.
ALTER TABLE aristo.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.mentor_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.demo_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA aristo FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA aristo FROM PUBLIC;
