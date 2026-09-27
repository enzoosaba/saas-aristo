-- Activate the Maratonista and Senhor do Tempo badge tracks from the
-- server-derived focus timer projections.

CREATE OR REPLACE FUNCTION aristo.sync_track_achievements(p_user_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_tenant_id UUID;
  v_organization_id UUID;
  v_missions_completed INTEGER;
  v_sessions_completed INTEGER;
  v_focus_seconds BIGINT;
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

  SELECT count(*)::INTEGER INTO v_missions_completed
    FROM aristo.mission_completions WHERE user_id = p_user_id;

  SELECT count(*)::INTEGER INTO v_sessions_completed
    FROM aristo.focus_sessions
   WHERE user_id = p_user_id
     AND status = 'ENDED'
     AND counts_toward_maratonista = true;

  SELECT COALESCE(sum(c.credited_focus_seconds), 0) INTO v_focus_seconds
    FROM aristo.focus_session_daily_credit c
    JOIN aristo.focus_sessions s ON s.id = c.session_id
   WHERE c.user_id = p_user_id
     AND s.user_id = p_user_id
     AND s.status = 'ENDED'
     AND s.counts_toward_maratonista = true;

  INSERT INTO aristo.achievement_unlocks (user_id, badge_id, tenant_id, organization_id)
  SELECT p_user_id, b.id, v_tenant_id, v_organization_id FROM aristo.badges b
   WHERE b.category = 'track' AND b.track = 'cumpridor_missoes'
     AND b.threshold_value <= v_missions_completed
  ON CONFLICT (user_id, badge_id) DO NOTHING;

  INSERT INTO aristo.achievement_unlocks (user_id, badge_id, tenant_id, organization_id)
  SELECT p_user_id, b.id, v_tenant_id, v_organization_id FROM aristo.badges b
   WHERE b.category = 'track' AND b.track = 'maratonista'
     AND b.threshold_value <= v_sessions_completed
  ON CONFLICT (user_id, badge_id) DO NOTHING;

  INSERT INTO aristo.achievement_unlocks (user_id, badge_id, tenant_id, organization_id)
  SELECT p_user_id, b.id, v_tenant_id, v_organization_id FROM aristo.badges b
   WHERE b.category = 'track' AND b.track = 'senhor_do_tempo'
     AND (b.threshold_value::BIGINT * 60) <= v_focus_seconds
  ON CONFLICT (user_id, badge_id) DO NOTHING;
END
$$;

REVOKE EXECUTE ON FUNCTION aristo.sync_track_achievements(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.sync_track_achievements(TEXT) TO aristo_app;
