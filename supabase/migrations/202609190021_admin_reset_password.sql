-- Fase 4A: "Redefinir senha" in the Torre de Controle. Password recovery by
-- e-mail (Resend) is postponed until a verified domain exists, so without this
-- a student who forgets their password is locked out and the only fix is a
-- hand-run script — the friction the panel exists to remove.
--
-- Same shape and reasoning as set_member_role() (migration 0020): users.password
-- has an UPDATE column grant for aristo_app, but users_update's policy is
-- self-only (id = current_user_id()), so an admin actor cannot write another
-- person's row directly. This is the one narrow, gated path, SECURITY DEFINER,
-- checking is_platform_admin() itself before doing anything.
--
-- The hash is computed by the application (scrypt, same as register / change
-- password) and only the hash reaches SQL — a clear-text password is never sent
-- to the database. The format check below is a guard against a caller passing
-- one by mistake, not a security boundary (an admin can already do everything a
-- password reset can).
--
-- Like the self-service change-password flow, it also invalidates the account's
-- live sessions and any pending recovery links: whoever held the old password
-- must not stay signed in, and an old e-mailed link must not be able to
-- overwrite the password the admin just set.
--
-- Returns TRUE when an account was updated, FALSE when the id matches nobody
-- (the route turns that into a 404 rather than reporting a phantom success).
CREATE OR REPLACE FUNCTION aristo.admin_reset_password(p_target_user_id TEXT, p_new_password_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = aristo, pg_catalog AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF NOT aristo.is_platform_admin() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_new_password_hash IS NULL OR p_new_password_hash !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN
    RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023';
  END IF;

  UPDATE aristo.users SET password = p_new_password_hash WHERE id = p_target_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN FALSE;
  END IF;

  DELETE FROM aristo.sessions WHERE user_id = p_target_user_id;
  DELETE FROM aristo.password_resets WHERE user_id = p_target_user_id;
  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION aristo.admin_reset_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.admin_reset_password(text, text) TO aristo_app;
