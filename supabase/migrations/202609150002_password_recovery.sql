CREATE TABLE aristo.password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE INDEX password_resets_user ON aristo.password_resets(user_id);
CREATE INDEX password_resets_expires ON aristo.password_resets(expires);
ALTER TABLE aristo.password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aristo.password_resets FROM PUBLIC;
