-- Applied to production and committed (7e5ac3f). See the retroactive review
-- in the Fase 5A/focus-timer conversation thread for the schema/RLS audit
-- that covered this migration together with the other 7 from the same batch.

ALTER TABLE aristo.focus_session_events
  DROP CONSTRAINT focus_session_events_type_check,
  ADD CONSTRAINT focus_session_events_type_check
    CHECK (type IN ('started','paused','resumed','ended','abandoned'));

ALTER TABLE aristo.focus_sessions
  DROP CONSTRAINT focus_sessions_status_check,
  DROP CONSTRAINT focus_sessions_ended_fields_check,
  ADD CONSTRAINT focus_sessions_status_check
    CHECK (status IN ('RUNNING','PAUSED','ENDED','ABANDONED')),
  ADD CONSTRAINT focus_sessions_closed_fields_check CHECK (
    (status IN ('ENDED','ABANDONED')) =
    (ended_at IS NOT NULL AND net_seconds IS NOT NULL AND counts_toward_maratonista IS NOT NULL)
  ),
  ADD CONSTRAINT focus_sessions_abandoned_not_maratonista_check CHECK (
    status <> 'ABANDONED' OR counts_toward_maratonista = false
  );

ALTER TABLE aristo.study_sessions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','abandoned')),
  ADD COLUMN actual_start_at TIMESTAMPTZ,
  ADD COLUMN actual_end_at TIMESTAMPTZ,
  ADD COLUMN net_focus_minutes INTEGER CHECK (net_focus_minutes >= 0),
  ADD CONSTRAINT study_sessions_execution_projection_check CHECK (
    (status = 'planned'
      AND actual_start_at IS NULL AND actual_end_at IS NULL AND net_focus_minutes IS NULL)
    OR
    (status = 'in_progress'
      AND actual_start_at IS NOT NULL AND actual_end_at IS NULL AND net_focus_minutes IS NULL)
    OR
    (status IN ('completed','abandoned')
      AND actual_start_at IS NOT NULL AND actual_end_at IS NOT NULL
      AND actual_end_at >= actual_start_at AND net_focus_minutes IS NOT NULL)
  );

-- Keep the existing application able to create/edit planning data, but prevent
-- aristo_app from writing execution outcomes outside the SECURITY DEFINER functions.
REVOKE INSERT, UPDATE ON aristo.study_sessions FROM aristo_app;
GRANT INSERT (id,user_id,data,version,tenant_id,organization_id)
  ON aristo.study_sessions TO aristo_app;
GRANT UPDATE (data,version) ON aristo.study_sessions TO aristo_app;

-- Production had zero focus rows at review time. These statements make the
-- migration safe if a linked session is created between review and application.
UPDATE aristo.study_sessions ss
   SET status='in_progress',actual_start_at=f.started_at,version=ss.version+1
  FROM aristo.focus_sessions f
 WHERE f.study_session_id=ss.id AND f.status IN ('RUNNING','PAUSED')
   AND ss.status='planned';

WITH latest AS (
  SELECT DISTINCT ON (study_session_id)
         study_session_id,started_at,ended_at,net_seconds
    FROM aristo.focus_sessions
   WHERE study_session_id IS NOT NULL AND status='ENDED'
   ORDER BY study_session_id,ended_at DESC,id DESC
)
UPDATE aristo.study_sessions ss
   SET status='completed',actual_start_at=latest.started_at,
       actual_end_at=latest.ended_at,
       net_focus_minutes=floor(latest.net_seconds/60.0)::INTEGER,
       version=ss.version+1
  FROM latest WHERE latest.study_session_id=ss.id AND ss.status='planned';

CREATE OR REPLACE FUNCTION aristo.focus_start_session(
  p_command_id UUID,
  p_study_session_id TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_tenant_id UUID;
  v_organization_id UUID;
  v_existing_session_id UUID;
  v_existing_type TEXT;
  v_existing_study_session_id TEXT;
  v_session_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'focus session is self-only' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL THEN
    RAISE EXCEPTION 'focus command_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM aristo.users WHERE id=v_actor_id FOR UPDATE;

  SELECT e.session_id,e.type,s.study_session_id
    INTO v_existing_session_id,v_existing_type,v_existing_study_session_id
    FROM aristo.focus_session_events e
    JOIN aristo.focus_sessions s ON s.id=e.session_id
   WHERE e.user_id=v_actor_id AND e.command_id=p_command_id;
  IF FOUND THEN
    IF v_existing_type='started'
       AND v_existing_study_session_id IS NOT DISTINCT FROM p_study_session_id THEN
      RETURN v_existing_session_id;
    END IF;
    RAISE EXCEPTION 'focus command_id reused with different payload' USING ERRCODE='P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM aristo.focus_sessions
              WHERE user_id=v_actor_id AND status IN ('RUNNING','PAUSED')) THEN
    RAISE EXCEPTION 'focus session already active' USING ERRCODE='P0001';
  END IF;

  SELECT tm.tenant_id,om.organization_id INTO v_tenant_id,v_organization_id
    FROM aristo.tenant_members tm
    JOIN aristo.organization_members om
      ON om.tenant_id=tm.tenant_id AND om.user_id=tm.user_id
   WHERE tm.user_id=v_actor_id
     AND tm.role='STUDENT' AND tm.status='active'
     AND om.member_role='STUDENT' AND om.status='active'
   ORDER BY tm.joined_at,om.joined_at LIMIT 1;
  IF v_tenant_id IS NULL OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'active student scope not found' USING ERRCODE='22023';
  END IF;

  IF p_study_session_id IS NOT NULL THEN
    PERFORM 1 FROM aristo.study_sessions
     WHERE id=p_study_session_id AND user_id=v_actor_id
       AND tenant_id=v_tenant_id AND organization_id=v_organization_id
       AND status='planned'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'planned study session unavailable' USING ERRCODE='22023';
    END IF;
  END IF;

  INSERT INTO aristo.focus_sessions
    (id,user_id,tenant_id,organization_id,study_session_id,status,started_at)
  VALUES
    (v_session_id,v_actor_id,v_tenant_id,v_organization_id,p_study_session_id,'RUNNING',v_now);
  INSERT INTO aristo.focus_session_events
    (session_id,user_id,tenant_id,organization_id,command_id,type,occurred_at)
  VALUES
    (v_session_id,v_actor_id,v_tenant_id,v_organization_id,p_command_id,'started',v_now);

  IF p_study_session_id IS NOT NULL THEN
    UPDATE aristo.study_sessions
       SET status='in_progress',actual_start_at=v_now,version=version+1
     WHERE id=p_study_session_id AND user_id=v_actor_id
       AND tenant_id=v_tenant_id AND organization_id=v_organization_id
       AND status='planned';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'study session projection conflict' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN v_session_id;
END
$$;

CREATE FUNCTION aristo._focus_close_session(
  p_command_id UUID,
  p_session_id UUID,
  p_abandoned BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_session aristo.focus_sessions%ROWTYPE;
  v_existing_session_id UUID;
  v_existing_type TEXT;
  v_event_type TEXT := CASE WHEN p_abandoned THEN 'abandoned' ELSE 'ended' END;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_net_seconds INTEGER;
  v_counts BOOLEAN := false;
  v_prior_qualified INTEGER;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'focus session is self-only' USING ERRCODE='42501';
  END IF;
  IF p_command_id IS NULL OR p_session_id IS NULL OR p_abandoned IS NULL THEN
    RAISE EXCEPTION 'focus close arguments are required' USING ERRCODE='22023';
  END IF;

  SELECT session_id,type INTO v_existing_session_id,v_existing_type
    FROM aristo.focus_session_events
   WHERE user_id=v_actor_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_existing_type=v_event_type AND v_existing_session_id=p_session_id THEN
      RETURN p_session_id;
    END IF;
    RAISE EXCEPTION 'focus command_id reused with different payload' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_session FROM aristo.focus_sessions
   WHERE id=p_session_id AND user_id=v_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'focus session unavailable' USING ERRCODE='42501';
  END IF;
  IF v_session.status NOT IN ('RUNNING','PAUSED') THEN
    RAISE EXCEPTION 'invalid focus session transition' USING ERRCODE='P0001';
  END IF;

  INSERT INTO aristo.focus_session_events
    (session_id,user_id,tenant_id,organization_id,command_id,type,occurred_at)
  VALUES
    (p_session_id,v_actor_id,v_session.tenant_id,v_session.organization_id,
     p_command_id,v_event_type,v_now);

  WITH ordered AS (
    SELECT type,occurred_at,lead(occurred_at) OVER (ORDER BY occurred_at,id) AS next_at
      FROM aristo.focus_session_events WHERE session_id=p_session_id
  )
  SELECT COALESCE(floor(sum(extract(epoch FROM next_at-occurred_at)))::INTEGER,0)
    INTO v_net_seconds FROM ordered
   WHERE type IN ('started','resumed') AND next_at IS NOT NULL AND next_at>occurred_at;

  IF NOT p_abandoned AND v_net_seconds>=180 THEN
    SELECT count(*)::INTEGER INTO v_prior_qualified
      FROM aristo.focus_sessions
     WHERE user_id=v_actor_id AND status='ENDED' AND net_seconds>=180
       AND id<>p_session_id
       AND (ended_at AT TIME ZONE 'America/Bahia')::DATE=
           (v_now AT TIME ZONE 'America/Bahia')::DATE
       AND (ended_at,id)<(v_now,p_session_id);
    v_counts := v_prior_qualified<12;
  END IF;

  UPDATE aristo.focus_sessions
     SET status=CASE WHEN p_abandoned THEN 'ABANDONED' ELSE 'ENDED' END,
         ended_at=v_now,net_seconds=v_net_seconds,
         paused_seconds_total=GREATEST(
           0,floor(extract(epoch FROM v_now-started_at))::INTEGER-v_net_seconds
         ),
         counts_toward_maratonista=v_counts
   WHERE id=p_session_id;

  IF v_session.study_session_id IS NOT NULL THEN
    UPDATE aristo.study_sessions
       SET status=CASE WHEN p_abandoned THEN 'abandoned' ELSE 'completed' END,
           actual_start_at=v_session.started_at,actual_end_at=v_now,
           net_focus_minutes=floor(v_net_seconds/60.0)::INTEGER,
           version=version+1
     WHERE id=v_session.study_session_id AND user_id=v_actor_id
       AND tenant_id=v_session.tenant_id
       AND organization_id=v_session.organization_id
       AND status='in_progress';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'study session projection conflict' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Preserve the existing credit rules exactly for normal completion.
  IF v_counts THEN
    WITH ordered AS (
      SELECT type,occurred_at,lead(occurred_at) OVER (ORDER BY occurred_at,id) AS next_at
        FROM aristo.focus_session_events WHERE session_id=p_session_id
    ), running AS (
      SELECT occurred_at AS start_at,next_at AS end_at FROM ordered
       WHERE type IN ('started','resumed') AND next_at IS NOT NULL AND next_at>occurred_at
    ), pieces AS (
      SELECT d::DATE AS local_date,
        greatest(r.start_at,d AT TIME ZONE 'America/Bahia') AS segment_start,
        least(r.end_at,(d+interval '1 day') AT TIME ZONE 'America/Bahia') AS segment_end
        FROM running r CROSS JOIN LATERAL generate_series(
          date_trunc('day',r.start_at AT TIME ZONE 'America/Bahia'),
          date_trunc('day',(r.end_at-interval '1 microsecond') AT TIME ZONE 'America/Bahia'),
          interval '1 day'
        ) d
    ), raw AS (
      SELECT local_date,floor(sum(extract(epoch FROM segment_end-segment_start)))::INTEGER AS seconds
        FROM pieces WHERE segment_end>segment_start GROUP BY local_date
    ), credits AS (
      SELECT raw.local_date,
        least(raw.seconds,greatest(0,21600-COALESCE((
          SELECT sum(c.credited_focus_seconds)
            FROM aristo.focus_session_daily_credit c
           WHERE c.user_id=v_actor_id AND c.local_date=raw.local_date
        ),0)))::INTEGER AS seconds
        FROM raw
    )
    INSERT INTO aristo.focus_session_daily_credit
      (session_id,local_date,user_id,tenant_id,organization_id,credited_focus_seconds)
    SELECT p_session_id,local_date,v_actor_id,v_session.tenant_id,
           v_session.organization_id,seconds
      FROM credits WHERE seconds>0;
  END IF;
  RETURN p_session_id;
END
$$;

CREATE OR REPLACE FUNCTION aristo.focus_end_session(
  p_command_id UUID,
  p_session_id UUID
) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT aristo._focus_close_session(p_command_id,p_session_id,false)
$$;

CREATE FUNCTION aristo.focus_abandon_session(
  p_command_id UUID,
  p_session_id UUID
) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT aristo._focus_close_session(p_command_id,p_session_id,true)
$$;

REVOKE EXECUTE ON FUNCTION aristo._focus_close_session(UUID,UUID,BOOLEAN) FROM PUBLIC,aristo_app;
REVOKE EXECUTE ON FUNCTION aristo.focus_start_session(UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.focus_end_session(UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.focus_abandon_session(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.focus_start_session(UUID,TEXT) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.focus_end_session(UUID,UUID) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.focus_abandon_session(UUID,UUID) TO aristo_app;
