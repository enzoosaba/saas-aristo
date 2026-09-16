-- Fase 3B.3-bis (review finding): PostgreSQL grants EXECUTE on every new
-- function to PUBLIC by default — confirmed empirically that all 13
-- authorization functions from migration 009 still had this default (NULL
-- ACL). Revoke it and grant explicitly to aristo_app instead. Defense in
-- depth: these functions only ever return a computed boolean/id derived
-- from the caller's own SET LOCAL context, so an unrestricted grantee
-- couldn't extract more than "true/false for a tenant/org id they already
-- supply" — but there's no reason any other role should be able to call
-- them at all, and closing this now costs nothing.
REVOKE EXECUTE ON FUNCTION aristo.can_access_business_row(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.can_access_student(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.can_manage_organization(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.can_manage_tenant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.current_tenant_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.current_user_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.find_user_by_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.is_organization_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.is_organization_mentor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.is_platform_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.is_tenant_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.is_tenant_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aristo.verify_login_credential(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION aristo.can_access_business_row(text, uuid, uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.can_access_student(text, uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.can_manage_organization(uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.can_manage_tenant(uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.current_tenant_id() TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.current_user_id() TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.find_user_by_email(text) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.is_organization_member(uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.is_organization_mentor(uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.is_platform_admin() TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.is_tenant_admin(uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.is_tenant_member(uuid) TO aristo_app;
GRANT EXECUTE ON FUNCTION aristo.verify_login_credential(text) TO aristo_app;

-- Every function created here from now on should get the same treatment
-- automatically, the same way ALTER DEFAULT PRIVILEGES already covers
-- future tables/sequences (migration 008).
ALTER DEFAULT PRIVILEGES IN SCHEMA aristo REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA aristo GRANT EXECUTE ON FUNCTIONS TO aristo_app;
