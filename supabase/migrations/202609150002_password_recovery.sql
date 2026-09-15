CREATE TABLE coelho.password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES coelho.users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE INDEX password_resets_user ON coelho.password_resets(user_id);
CREATE INDEX password_resets_expires ON coelho.password_resets(expires);
ALTER TABLE coelho.password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coelho.password_resets FROM PUBLIC;
