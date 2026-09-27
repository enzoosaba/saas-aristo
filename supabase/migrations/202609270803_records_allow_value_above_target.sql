-- A count target is a completion threshold, not a ceiling on real progress.
ALTER TABLE aristo.records
  DROP CONSTRAINT records_value_within_target;
ALTER TABLE aristo.records
  ADD CONSTRAINT records_value_nonnegative
  CHECK (value >= 0 AND target > 0);

-- Keep immutable mission credit tied to reaching or exceeding the target.
CREATE OR REPLACE FUNCTION aristo.record_mission_completion(p_user_id TEXT, p_item_id TEXT, p_date TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_tenant_id UUID;
  v_organization_id UUID;
BEGIN
  IF v_actor_id IS NULL OR p_user_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'mission completion recording is self-only' USING ERRCODE = '42501';
  END IF;

  SELECT r.tenant_id, r.organization_id INTO v_tenant_id, v_organization_id
    FROM aristo.records r
    JOIN aristo.tenant_members tm
      ON tm.tenant_id = r.tenant_id AND tm.user_id = r.user_id
    JOIN aristo.organization_members om
      ON om.tenant_id = r.tenant_id
     AND om.organization_id = r.organization_id
     AND om.user_id = r.user_id
   WHERE r.user_id = p_user_id
     AND r.item_id = p_item_id AND r.date = p_date
     AND r.done = 1 AND r.value >= r.target
     AND tm.role = 'STUDENT' AND tm.status = 'active'
     AND om.member_role = 'STUDENT' AND om.status = 'active'
   LIMIT 1;
  IF v_tenant_id IS NULL OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'completed mission record not found in an active student scope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO aristo.mission_completions (user_id, item_id, date, tenant_id, organization_id)
  VALUES (p_user_id, p_item_id, p_date, v_tenant_id, v_organization_id)
  ON CONFLICT (user_id, item_id, date) DO NOTHING;

  PERFORM aristo.sync_track_achievements(p_user_id);
END
$$;

REVOKE EXECUTE ON FUNCTION aristo.record_mission_completion(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.record_mission_completion(TEXT, TEXT, TEXT) TO aristo_app;
