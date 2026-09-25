-- Fase 5A-1: immutable product badge catalog and achievement unlocks.
-- Track counters do not exist yet, so this phase can only grant division
-- badges, whose threshold is derived from the existing records-based XP.

CREATE TABLE aristo.badges (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('division', 'track')),
  track TEXT CHECK (track IN ('sequencia', 'maratonista', 'senhor_do_tempo', 'cumpridor_missoes')),
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 4),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  threshold_type TEXT NOT NULL CHECK (threshold_type IN ('xp', 'streak_days', 'sessions_completed', 'focus_minutes', 'missions_completed')),
  threshold_value INTEGER NOT NULL CHECK (threshold_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((category = 'division') = (track IS NULL)),
  CHECK (
    (category = 'division' AND track IS NULL AND threshold_type = 'xp')
    OR (category = 'track' AND track = 'sequencia' AND threshold_type = 'streak_days')
    OR (category = 'track' AND track = 'maratonista' AND threshold_type = 'sessions_completed')
    OR (category = 'track' AND track = 'senhor_do_tempo' AND threshold_type = 'focus_minutes')
    OR (category = 'track' AND track = 'cumpridor_missoes' AND threshold_type = 'missions_completed')
  )
);

-- NULL values are distinct to an ordinary UNIQUE constraint in PostgreSQL,
-- so divisions and track ranks need separate partial unique indexes.
CREATE UNIQUE INDEX badges_division_tier_unique ON aristo.badges(tier) WHERE category = 'division';
CREATE UNIQUE INDEX badges_track_tier_unique ON aristo.badges(track, tier) WHERE category = 'track';
CREATE INDEX badges_category_track ON aristo.badges(category, track);

INSERT INTO aristo.badges (id, category, track, tier, name, threshold_type, threshold_value) VALUES
  ('division_aprendiz', 'division', NULL, 1, 'Aprendiz', 'xp', 0),
  ('division_dedicado', 'division', NULL, 2, 'Dedicado', 'xp', 1000),
  ('division_estrategista', 'division', NULL, 3, 'Estrategista', 'xp', 3000),
  ('division_mestre', 'division', NULL, 4, 'Mestre', 'xp', 6000),
  ('track_sequencia_1', 'track', 'sequencia', 1, 'Sequência I', 'streak_days', 3),
  ('track_sequencia_2', 'track', 'sequencia', 2, 'Sequência II', 'streak_days', 7),
  ('track_sequencia_3', 'track', 'sequencia', 3, 'Sequência III', 'streak_days', 15),
  ('track_sequencia_4', 'track', 'sequencia', 4, 'Sequência IV', 'streak_days', 30),
  ('track_maratonista_1', 'track', 'maratonista', 1, 'Maratonista I', 'sessions_completed', 10),
  ('track_maratonista_2', 'track', 'maratonista', 2, 'Maratonista II', 'sessions_completed', 30),
  ('track_maratonista_3', 'track', 'maratonista', 3, 'Maratonista III', 'sessions_completed', 60),
  ('track_maratonista_4', 'track', 'maratonista', 4, 'Maratonista IV', 'sessions_completed', 100),
  ('track_senhor_do_tempo_1', 'track', 'senhor_do_tempo', 1, 'Senhor do Tempo I', 'focus_minutes', 300),
  ('track_senhor_do_tempo_2', 'track', 'senhor_do_tempo', 2, 'Senhor do Tempo II', 'focus_minutes', 1200),
  ('track_senhor_do_tempo_3', 'track', 'senhor_do_tempo', 3, 'Senhor do Tempo III', 'focus_minutes', 3000),
  ('track_senhor_do_tempo_4', 'track', 'senhor_do_tempo', 4, 'Senhor do Tempo IV', 'focus_minutes', 6000),
  ('track_cumpridor_missoes_1', 'track', 'cumpridor_missoes', 1, 'Cumpridor de Missões I', 'missions_completed', 15),
  ('track_cumpridor_missoes_2', 'track', 'cumpridor_missoes', 2, 'Cumpridor de Missões II', 'missions_completed', 50),
  ('track_cumpridor_missoes_3', 'track', 'cumpridor_missoes', 3, 'Cumpridor de Missões III', 'missions_completed', 120),
  ('track_cumpridor_missoes_4', 'track', 'cumpridor_missoes', 4, 'Cumpridor de Missões IV', 'missions_completed', 250);

CREATE TABLE aristo.achievement_unlocks (
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES aristo.badges(id) ON DELETE RESTRICT,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id UUID NOT NULL REFERENCES aristo.tenants(id),
  organization_id UUID NOT NULL REFERENCES aristo.organizations(id),
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX achievement_unlocks_tenant ON aristo.achievement_unlocks(tenant_id);
CREATE INDEX achievement_unlocks_organization_user ON aristo.achievement_unlocks(organization_id, user_id);
CREATE INDEX achievement_unlocks_badge ON aristo.achievement_unlocks(badge_id);

ALTER TABLE aristo.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.badges FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.achievement_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.achievement_unlocks FORCE ROW LEVEL SECURITY;

CREATE POLICY badges_select ON aristo.badges FOR SELECT TO aristo_app
  USING (aristo.current_user_id() IS NOT NULL);
CREATE POLICY achievement_unlocks_select ON aristo.achievement_unlocks FOR SELECT TO aristo_app
  USING (aristo.can_access_business_row(user_id, tenant_id, organization_id));

-- ALTER DEFAULT PRIVILEGES grants new tables full DML to aristo_app. Narrow
-- both objects explicitly: the catalog is owner-managed and unlocks are
-- writeable only through sync_division_achievements().
GRANT SELECT ON aristo.badges, aristo.achievement_unlocks TO aristo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON aristo.badges, aristo.achievement_unlocks FROM aristo_app;

CREATE FUNCTION aristo.sync_division_achievements(p_user_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_tenant_id UUID;
  v_organization_id UUID;
  v_xp INTEGER;
BEGIN
  IF v_actor_id IS NULL OR p_user_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'achievement synchronization is self-only' USING ERRCODE = '42501';
  END IF;

  SELECT tm.tenant_id, om.organization_id INTO v_tenant_id, v_organization_id
    FROM aristo.tenant_members tm
    JOIN aristo.organization_members om ON om.tenant_id = tm.tenant_id AND om.user_id = tm.user_id
   WHERE tm.user_id = p_user_id
     AND tm.role = 'STUDENT' AND tm.status = 'active'
     AND om.member_role = 'STUDENT' AND om.status = 'active'
   ORDER BY tm.joined_at, om.joined_at LIMIT 1;
  IF v_tenant_id IS NULL OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'active student scope not found' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INTEGER * 20 INTO v_xp FROM aristo.records
   WHERE user_id = p_user_id AND done = 1;

  INSERT INTO aristo.achievement_unlocks (user_id, badge_id, tenant_id, organization_id)
  SELECT p_user_id, b.id, v_tenant_id, v_organization_id FROM aristo.badges b
   WHERE b.category = 'division' AND b.threshold_value <= v_xp
  ON CONFLICT (user_id, badge_id) DO NOTHING;
END
$$;

REVOKE EXECUTE ON FUNCTION aristo.sync_division_achievements(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.sync_division_achievements(TEXT) TO aristo_app;
