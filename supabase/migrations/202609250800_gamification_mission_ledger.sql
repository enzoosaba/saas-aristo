-- Fase 5A-2: immutable mission-completion ledger feeding the
-- "Cumpridor de Missões" achievement track, plus mentor unlock messages
-- for all 20 badges.
--
-- The ledger is intentionally decoupled from the live `records` table: a
-- row here means "this item was completed on this date" and is written
-- once, on the transition to done, and is never updated or deleted by
-- this migration's functions. Whatever later happens to the item or its
-- `records` row (unchecked, archived, deleted) does not erase the
-- historical credit, and re-marking the same item/date is a no-op
-- (ON CONFLICT DO NOTHING keyed on the natural (user, item, date) key),
-- so toggling done/undone repeatedly cannot inflate the count.

CREATE TABLE aristo.mission_completions (
  user_id TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  date TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id UUID NOT NULL REFERENCES aristo.tenants(id),
  organization_id UUID NOT NULL REFERENCES aristo.organizations(id),
  PRIMARY KEY (user_id, item_id, date)
);
-- No FK to items on purpose: an item being archived or deleted later must
-- never cascade into losing achievement history.
CREATE INDEX mission_completions_tenant ON aristo.mission_completions(tenant_id);
CREATE INDEX mission_completions_user ON aristo.mission_completions(user_id);

-- Preserve the completed state that exists at migration time. records has
-- no completion timestamp, so completed_at truthfully records the backfill
-- time instead of inventing a historical instant.
INSERT INTO aristo.mission_completions
  (user_id, item_id, date, tenant_id, organization_id)
SELECT user_id, item_id, date, tenant_id, organization_id
  FROM aristo.records
 WHERE done = 1 AND value = target
ON CONFLICT (user_id, item_id, date) DO NOTHING;

ALTER TABLE aristo.mission_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.mission_completions FORCE ROW LEVEL SECURITY;

CREATE POLICY mission_completions_select ON aristo.mission_completions FOR SELECT TO aristo_app
  USING (user_id = aristo.current_user_id());
CREATE POLICY mission_completions_insert_denied ON aristo.mission_completions
  FOR INSERT TO aristo_app WITH CHECK (false);
CREATE POLICY mission_completions_update_denied ON aristo.mission_completions
  FOR UPDATE TO aristo_app USING (false) WITH CHECK (false);
CREATE POLICY mission_completions_delete_denied ON aristo.mission_completions
  FOR DELETE TO aristo_app USING (false);

GRANT SELECT ON aristo.mission_completions TO aristo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON aristo.mission_completions FROM aristo_app;

-- Mentors receive only the count for linked students in organizations where
-- both memberships remain active. Raw item/date rows stay self-only above.
CREATE FUNCTION aristo.mentor_student_mission_summary(p_student_id TEXT)
RETURNS TABLE(missions_completed BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
BEGIN
  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM aristo.mentor_students ms
      JOIN aristo.organization_members student_om
        ON student_om.user_id = ms.student_id
       AND student_om.member_role = 'STUDENT'
       AND student_om.status = 'active'
     WHERE ms.mentor_id = v_actor_id
       AND ms.student_id = p_student_id
       AND aristo.is_organization_mentor(student_om.organization_id)
  ) THEN
    RAISE EXCEPTION 'active mentor-student link required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT count(*)
    FROM aristo.mission_completions mc
   WHERE mc.user_id = p_student_id
     AND EXISTS (
       SELECT 1
         FROM aristo.organization_members student_om
        WHERE student_om.user_id = p_student_id
          AND student_om.tenant_id = mc.tenant_id
          AND student_om.organization_id = mc.organization_id
          AND student_om.member_role = 'STUDENT'
          AND student_om.status = 'active'
          AND aristo.is_organization_mentor(student_om.organization_id)
     );
END
$$;

REVOKE EXECUTE ON FUNCTION aristo.mentor_student_mission_summary(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.mentor_student_mission_summary(TEXT) TO aristo_app;

-- Called exactly once per item/date, from the same code path that marks a
-- record done=1 (see integration note in the migration below / the Fase
-- 5A-2 handoff doc). Self-only, same shape as sync_division_achievements:
-- writes cannot be spoofed onto another user because v_actor_id comes
-- from the session, not from the argument.
CREATE FUNCTION aristo.record_mission_completion(p_user_id TEXT, p_item_id TEXT, p_date TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_tenant_id UUID;
  v_organization_id UUID;
BEGIN
  IF v_actor_id IS NULL OR p_user_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'mission completion recording is self-only' USING ERRCODE = '42501';
  END IF;

  -- The caller supplies only the natural key. Scope and completion are
  -- derived from the authoritative record, so arbitrary item/date values
  -- cannot mint permanent achievement credit.
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
     AND r.done = 1 AND r.value = r.target
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

-- Mirrors sync_division_achievements, but for track badges. Only
-- 'cumpridor_missoes' has a live counter so far (sequencia, maratonista and
-- senhor_do_tempo stay dormant — zero rows ever satisfy their threshold —
-- until their own counters land in later phases; this function is written
-- so adding those later is a new WHEN-branch, not a new function).
CREATE FUNCTION aristo.sync_track_achievements(p_user_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id TEXT := aristo.current_user_id();
  v_tenant_id UUID;
  v_organization_id UUID;
  v_missions_completed INTEGER;
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

  INSERT INTO aristo.achievement_unlocks (user_id, badge_id, tenant_id, organization_id)
  SELECT p_user_id, b.id, v_tenant_id, v_organization_id FROM aristo.badges b
   WHERE b.category = 'track' AND b.track = 'cumpridor_missoes'
     AND b.threshold_value <= v_missions_completed
  ON CONFLICT (user_id, badge_id) DO NOTHING;
END
$$;

REVOKE EXECUTE ON FUNCTION aristo.sync_track_achievements(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.sync_track_achievements(TEXT) TO aristo_app;

-- Mentor unlock message shown when a badge is granted.
ALTER TABLE aristo.badges ADD COLUMN message TEXT;
UPDATE aristo.badges SET message = CASE id
  WHEN 'division_aprendiz' THEN 'Todo mestre um dia foi aprendiz. Você acabou de abrir a porta e dar o primeiro passo pra dentro da preparação de verdade. Não tem pressa aqui — só constância, um dia de cada vez.'
  WHEN 'division_dedicado' THEN 'Mil pontos de esforço acumulado não é sorte, é rotina virando hábito. Você já não é mais só um aprendiz curioso — é alguém que aparece, dia após dia. Continue assim.'
  WHEN 'division_estrategista' THEN 'Três mil pontos depois, ficou claro: você não estuda no impulso, estuda com cabeça. É isso que separa quem só se esforça de quem constrói um plano de vitória. Virou estrategista de verdade.'
  WHEN 'division_mestre' THEN 'Seis mil pontos. Isso não é mais dedicação, é domínio. Você chegou onde poucos chegam, porque poucos sustentam esse ritmo por tanto tempo. Agora é defender esse título todo santo dia.'
  WHEN 'track_sequencia_1' THEN 'Três dias seguidos aparecendo. Pequeno? Talvez. Mas é exatamente disso que nascem os hábitos que duram — do primeiro tijolo, não do prédio pronto. Acendeu a chama, agora é manter ela viva.'
  WHEN 'track_sequencia_2' THEN 'Uma semana inteira sem falhar um check-in. Isso já não é empolgação de início — é disciplina se firmando. A brasa tá pegando, não deixa esfriar.'
  WHEN 'track_sequencia_3' THEN 'Quinze dias direto. Isso é fogueira que não se apaga com vento fraco. Você provou pra você mesmo que sustenta o ritmo mesmo nos dias difíceis — e isso vale mais que qualquer prova.'
  WHEN 'track_sequencia_4' THEN 'Sabe o que é mais estável e mais infalível do que uma fogueira? Uma tocha olímpica, própria daqueles que mantêm a constância perfeita. Você acaba de atingir um mês seguido de logins, sem falhas. Estou absurdamente orgulhoso de você. Agora você já está instalado na sua preparação. É só não parar. Virou hábito.'
  WHEN 'track_maratonista_1' THEN 'Dez sessões completas. Você já sentiu o que é sentar, focar e terminar o que começou — dez vezes seguidas. Isso é fôlego nascendo.'
  WHEN 'track_maratonista_2' THEN 'Trinta sessões no bolso. Você não corre mais atrás do estudo, já correu lado a lado com ele por um bom tempo. Isso é ritmo de quem não improvisa.'
  WHEN 'track_maratonista_3' THEN 'Sessenta sessões é resistência de verdade. A motivação vai e volta, mas você aprendeu a estudar mesmo quando ela não aparece — e é isso que separa quem termina de quem só começa.'
  WHEN 'track_maratonista_4' THEN 'Cem sessões. Você virou maratonista de elite da própria preparação. Isso não é mais força de vontade pontual, é identidade — você é alguém que estuda, ponto final.'
  WHEN 'track_senhor_do_tempo_1' THEN 'Cinco horas de foco de verdade, cronometradas. Não é sobre estudar rápido, é sobre estudar com presença — e você já provou que consegue ficar ali, sem fugir da cadeira.'
  WHEN 'track_senhor_do_tempo_2' THEN 'Vinte horas de foco acumuladas. Tempo suficiente pra virar disciplina, não coincidência. Você tá aprendendo a proteger sua atenção, o recurso mais raro que existe hoje.'
  WHEN 'track_senhor_do_tempo_3' THEN 'Cinquenta horas de foco puro. Você não é mais refém do relógio, começou a mandar nele. Cada minuto concentrado valeu mais que uma tarde inteira distraído — e você já sabe disso na prática.'
  WHEN 'track_senhor_do_tempo_4' THEN 'Cem horas de foco absoluto. Isso te coloca numa categoria que pouca gente alcança: você virou senhor do próprio tempo. O relógio trabalha pra você agora, não o contrário.'
  WHEN 'track_cumpridor_missoes_1' THEN 'Quinze missões cumpridas. Não são só tarefas riscadas de uma lista — é prova de que sua palavra com você mesmo vale alguma coisa. Continue honrando o combinado.'
  WHEN 'track_cumpridor_missoes_2' THEN 'Cinquenta missões no currículo. Você já não depende de motivação pra terminar o que começa — o combinado é o combinado, e você cumpre. Isso é raro, e é o que constrói resultado.'
  WHEN 'track_cumpridor_missoes_3' THEN 'Cento e vinte missões é osso duro de roer, e você roeu. Cada tarefa marcada como feita foi um voto de confiança em você mesmo — e você vem ganhando essa eleição todos os dias.'
  WHEN 'track_cumpridor_missoes_4' THEN 'Duzentas e cinquenta missões cumpridas. Isso não é mais consistência, é identidade: você é, literalmente, alguém que cumpre o que promete. Poucos sustentam esse padrão — parabéns por ser um deles.'
END;
ALTER TABLE aristo.badges ALTER COLUMN message SET NOT NULL;
ALTER TABLE aristo.badges ADD CONSTRAINT badges_message_not_blank CHECK (btrim(message) <> '');
