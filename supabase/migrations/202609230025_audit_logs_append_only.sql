-- The application may append audit events and read them as platform_admin,
-- but may never edit or erase them, even with that actor context.
REVOKE UPDATE, DELETE ON aristo.audit_logs FROM aristo_app;

-- Default-deny also protects rows if a write privilege is re-granted later.
-- Existing SELECT/INSERT grants and policies are deliberately untouched.
DROP POLICY IF EXISTS audit_logs_update ON aristo.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete ON aristo.audit_logs;
