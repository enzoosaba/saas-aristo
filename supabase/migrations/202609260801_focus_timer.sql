-- Focus timer protocol v4: immutable commands/events plus mutable projections.
-- Achievement synchronization deliberately stays in the application layer so
-- it can run only after the transaction containing focus_end_session commits.

CREATE TABLE aristo.focus_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES aristo.tenants(id),
  organization_id UUID NOT NULL REFERENCES aristo.organizations(id),
  study_session_id TEXT REFERENCES aristo.study_sessions(id),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','PAUSED','ENDED')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  paused_seconds_total INTEGER NOT NULL DEFAULT 0 CHECK (paused_seconds_total >= 0),
  net_seconds INTEGER CHECK (net_seconds >= 0),
  counts_toward_maratonista BOOLEAN,
  CONSTRAINT focus_sessions_ended_fields_check CHECK (
    (status = 'ENDED') =
    (ended_at IS NOT NULL AND net_seconds IS NOT NULL AND counts_toward_maratonista IS NOT NULL)
  )
);
CREATE UNIQUE INDEX focus_sessions_one_active_per_user
  ON aristo.focus_sessions(user_id) WHERE status IN ('RUNNING','PAUSED');
CREATE INDEX focus_sessions_user_ended
  ON aristo.focus_sessions(user_id, ended_at, id) WHERE status = 'ENDED';

CREATE TABLE aristo.focus_session_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES aristo.focus_sessions(id),
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES aristo.tenants(id),
  organization_id UUID NOT NULL REFERENCES aristo.organizations(id),
  command_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('started','paused','resumed','ended')),
  motivo TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, command_id),
  CONSTRAINT focus_session_events_motivo_check CHECK (
    (type = 'resumed' AND motivo IS NOT NULL AND btrim(motivo) <> '')
    OR (type <> 'resumed' AND motivo IS NULL)
  )
);
CREATE INDEX focus_session_events_session
  ON aristo.focus_session_events(session_id, occurred_at, id);

CREATE TABLE aristo.focus_session_daily_credit (
  session_id UUID NOT NULL REFERENCES aristo.focus_sessions(id),
  local_date DATE NOT NULL,
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES aristo.tenants(id),
  organization_id UUID NOT NULL REFERENCES aristo.organizations(id),
  credited_focus_seconds INTEGER NOT NULL CHECK (credited_focus_seconds > 0),
  PRIMARY KEY (session_id, local_date)
);
CREATE INDEX focus_session_daily_credit_user_date
  ON aristo.focus_session_daily_credit(user_id, local_date);

ALTER TABLE aristo.focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.focus_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.focus_session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.focus_session_events FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.focus_session_daily_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.focus_session_daily_credit FORCE ROW LEVEL SECURITY;

CREATE POLICY focus_sessions_select ON aristo.focus_sessions FOR SELECT TO aristo_app
  USING (user_id = aristo.current_user_id());
CREATE POLICY focus_sessions_insert_denied ON aristo.focus_sessions FOR INSERT TO aristo_app WITH CHECK (false);
CREATE POLICY focus_sessions_update_denied ON aristo.focus_sessions FOR UPDATE TO aristo_app USING (false) WITH CHECK (false);
CREATE POLICY focus_sessions_delete_denied ON aristo.focus_sessions FOR DELETE TO aristo_app USING (false);

CREATE POLICY focus_session_events_select ON aristo.focus_session_events FOR SELECT TO aristo_app
  USING (user_id = aristo.current_user_id());
CREATE POLICY focus_session_events_insert_denied ON aristo.focus_session_events FOR INSERT TO aristo_app WITH CHECK (false);
CREATE POLICY focus_session_events_update_denied ON aristo.focus_session_events FOR UPDATE TO aristo_app USING (false) WITH CHECK (false);
CREATE POLICY focus_session_events_delete_denied ON aristo.focus_session_events FOR DELETE TO aristo_app USING (false);

CREATE POLICY focus_session_daily_credit_select ON aristo.focus_session_daily_credit FOR SELECT TO aristo_app
  USING (user_id = aristo.current_user_id());
CREATE POLICY focus_session_daily_credit_insert_denied ON aristo.focus_session_daily_credit FOR INSERT TO aristo_app WITH CHECK (false);
CREATE POLICY focus_session_daily_credit_update_denied ON aristo.focus_session_daily_credit FOR UPDATE TO aristo_app USING (false) WITH CHECK (false);
CREATE POLICY focus_session_daily_credit_delete_denied ON aristo.focus_session_daily_credit FOR DELETE TO aristo_app USING (false);

GRANT SELECT ON aristo.focus_sessions, aristo.focus_session_events, aristo.focus_session_daily_credit TO aristo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON aristo.focus_sessions, aristo.focus_session_events, aristo.focus_session_daily_credit FROM aristo_app;

CREATE FUNCTION aristo.focus_start_session(p_command_id UUID, p_study_session_id TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

  -- A stable parent row serializes starts before an active session row exists.
  PERFORM 1 FROM aristo.users WHERE id = v_actor_id FOR UPDATE;

  SELECT e.session_id, e.type, s.study_session_id
    INTO v_existing_session_id, v_existing_type, v_existing_study_session_id
    FROM aristo.focus_session_events e
    JOIN aristo.focus_sessions s ON s.id = e.session_id
   WHERE e.user_id = v_actor_id AND e.command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_type = 'started'
       AND v_existing_study_session_id IS NOT DISTINCT FROM p_study_session_id THEN
      RETURN v_existing_session_id;
    END IF;
    RAISE EXCEPTION 'focus command_id reused with different payload' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM aristo.focus_sessions
     WHERE user_id = v_actor_id AND status IN ('RUNNING','PAUSED')
  ) THEN
    RAISE EXCEPTION 'focus session already active' USING ERRCODE = 'P0001';
  END IF;

  SELECT tm.tenant_id, om.organization_id INTO v_tenant_id, v_organization_id
    FROM aristo.tenant_members tm
    JOIN aristo.organization_members om
      ON om.tenant_id = tm.tenant_id AND om.user_id = tm.user_id
   WHERE tm.user_id = v_actor_id
     AND tm.role = 'STUDENT' AND tm.status = 'active'
     AND om.member_role = 'STUDENT' AND om.status = 'active'
   ORDER BY tm.joined_at, om.joined_at LIMIT 1;
  IF v_tenant_id IS NULL OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'active student scope not found' USING ERRCODE = '22023';
  END IF;

  IF p_study_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM aristo.study_sessions
     WHERE id = p_study_session_id AND user_id = v_actor_id
       AND tenant_id = v_tenant_id AND organization_id = v_organization_id
  ) THEN
    RAISE EXCEPTION 'study session does not belong to active student scope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO aristo.focus_sessions
    (id,user_id,tenant_id,organization_id,study_session_id,status,started_at)
  VALUES
    (v_session_id,v_actor_id,v_tenant_id,v_organization_id,p_study_session_id,'RUNNING',v_now);
  INSERT INTO aristo.focus_session_events
    (session_id,user_id,tenant_id,organization_id,command_id,type,occurred_at)
  VALUES
    (v_session_id,v_actor_id,v_tenant_id,v_organization_id,p_command_id,'started',v_now);
  RETURN v_session_id;
END
$$;

CREATE FUNCTION aristo.focus_pause_session(p_command_id UUID, p_session_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_session aristo.focus_sessions%ROWTYPE;
  v_existing_session_id UUID;
  v_existing_type TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'focus session is self-only' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'focus command_id and session_id are required' USING ERRCODE = '22023';
  END IF;
  SELECT session_id,type INTO v_existing_session_id,v_existing_type
    FROM aristo.focus_session_events
   WHERE user_id=v_actor_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_existing_type='paused' AND v_existing_session_id=p_session_id THEN RETURN p_session_id; END IF;
    RAISE EXCEPTION 'focus command_id reused with different payload' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_session FROM aristo.focus_sessions
   WHERE id=p_session_id AND user_id=v_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'focus session unavailable' USING ERRCODE = '42501'; END IF;
  IF v_session.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'invalid focus session transition' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO aristo.focus_session_events
    (session_id,user_id,tenant_id,organization_id,command_id,type,occurred_at)
  VALUES (p_session_id,v_actor_id,v_session.tenant_id,v_session.organization_id,p_command_id,'paused',v_now);
  UPDATE aristo.focus_sessions SET status='PAUSED' WHERE id=p_session_id;
  RETURN p_session_id;
END
$$;

CREATE FUNCTION aristo.focus_resume_session(p_command_id UUID, p_session_id UUID, p_motivo TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_session aristo.focus_sessions%ROWTYPE;
  v_existing_session_id UUID;
  v_existing_type TEXT;
  v_existing_motivo TEXT;
  v_motivo TEXT := regexp_replace(btrim(p_motivo), '\s+', ' ', 'g');
  v_paused_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'focus session is self-only' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'focus command_id and session_id are required' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR v_motivo = '' THEN
    RAISE EXCEPTION 'focus resume reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT session_id,type,motivo INTO v_existing_session_id,v_existing_type,v_existing_motivo
    FROM aristo.focus_session_events
   WHERE user_id=v_actor_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_existing_type='resumed' AND v_existing_session_id=p_session_id
       AND v_existing_motivo=v_motivo THEN RETURN p_session_id; END IF;
    RAISE EXCEPTION 'focus command_id reused with different payload' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_session FROM aristo.focus_sessions
   WHERE id=p_session_id AND user_id=v_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'focus session unavailable' USING ERRCODE = '42501'; END IF;
  IF v_session.status <> 'PAUSED' THEN
    RAISE EXCEPTION 'invalid focus session transition' USING ERRCODE = 'P0001';
  END IF;
  SELECT occurred_at INTO v_paused_at FROM aristo.focus_session_events
   WHERE session_id=p_session_id AND type='paused' ORDER BY occurred_at DESC,id DESC LIMIT 1;
  INSERT INTO aristo.focus_session_events
    (session_id,user_id,tenant_id,organization_id,command_id,type,motivo,occurred_at)
  VALUES (p_session_id,v_actor_id,v_session.tenant_id,v_session.organization_id,p_command_id,'resumed',v_motivo,v_now);
  UPDATE aristo.focus_sessions SET status='RUNNING',
    paused_seconds_total=paused_seconds_total+GREATEST(0,floor(extract(epoch FROM v_now-v_paused_at))::INTEGER)
   WHERE id=p_session_id;
  RETURN p_session_id;
END
$$;

CREATE FUNCTION aristo.focus_end_session(p_command_id UUID, p_session_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_session aristo.focus_sessions%ROWTYPE;
  v_existing_session_id UUID;
  v_existing_type TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_net_seconds INTEGER;
  v_counts BOOLEAN := false;
  v_prior_qualified INTEGER;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'focus session is self-only' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'focus command_id and session_id are required' USING ERRCODE = '22023';
  END IF;
  SELECT session_id,type INTO v_existing_session_id,v_existing_type
    FROM aristo.focus_session_events
   WHERE user_id=v_actor_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_existing_type='ended' AND v_existing_session_id=p_session_id THEN RETURN p_session_id; END IF;
    RAISE EXCEPTION 'focus command_id reused with different payload' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_session FROM aristo.focus_sessions
   WHERE id=p_session_id AND user_id=v_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'focus session unavailable' USING ERRCODE = '42501'; END IF;
  IF v_session.status NOT IN ('RUNNING','PAUSED') THEN
    RAISE EXCEPTION 'invalid focus session transition' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO aristo.focus_session_events
    (session_id,user_id,tenant_id,organization_id,command_id,type,occurred_at)
  VALUES (p_session_id,v_actor_id,v_session.tenant_id,v_session.organization_id,p_command_id,'ended',v_now);

  WITH ordered AS (
    SELECT type,occurred_at,lead(occurred_at) OVER (ORDER BY occurred_at,id) AS next_at
      FROM aristo.focus_session_events WHERE session_id=p_session_id
  )
  SELECT COALESCE(floor(sum(extract(epoch FROM next_at-occurred_at)))::INTEGER,0)
    INTO v_net_seconds FROM ordered
   WHERE type IN ('started','resumed') AND next_at IS NOT NULL AND next_at>occurred_at;

  UPDATE aristo.focus_sessions SET status='ENDED',ended_at=v_now,
    net_seconds=v_net_seconds,
    paused_seconds_total=GREATEST(0,floor(extract(epoch FROM v_now-started_at))::INTEGER-v_net_seconds),
    counts_toward_maratonista=false
   WHERE id=p_session_id;

  IF v_net_seconds >= 180 THEN
    SELECT count(*)::INTEGER INTO v_prior_qualified
      FROM aristo.focus_sessions
     WHERE user_id=v_actor_id AND status='ENDED' AND net_seconds>=180
       AND id<>p_session_id
       AND (ended_at AT TIME ZONE 'America/Bahia')::DATE=(v_now AT TIME ZONE 'America/Bahia')::DATE
       AND (ended_at,id)<(v_now,p_session_id);
    v_counts := v_prior_qualified < 12;
  END IF;
  UPDATE aristo.focus_sessions SET counts_toward_maratonista=v_counts WHERE id=p_session_id;

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
        FROM running r
        CROSS JOIN LATERAL generate_series(
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
          SELECT sum(c.credited_focus_seconds) FROM aristo.focus_session_daily_credit c
           WHERE c.user_id=v_actor_id AND c.local_date=raw.local_date
        ),0)))::INTEGER AS seconds
        FROM raw
    )
    INSERT INTO aristo.focus_session_daily_credit
      (session_id,local_date,user_id,tenant_id,organization_id,credited_focus_seconds)
    SELECT p_session_id,local_date,v_actor_id,v_session.tenant_id,v_session.organization_id,seconds
      FROM credits WHERE seconds>0;
  END IF;
  RETURN p_session_id;
END
$$;

REVOKE EXECUTE ON FUNCTION aristo.focus_start_session(UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.focus_pause_session(UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.focus_resume_session(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.focus_end_session(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.focus_start_session(UUID,TEXT) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.focus_pause_session(UUID,UUID) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.focus_resume_session(UUID,UUID,TEXT) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.focus_end_session(UUID,UUID) TO aristo_app;
