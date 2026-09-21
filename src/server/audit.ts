import { db } from "./db";

export type AdminAction =
  | "admin.create-member"
  | "admin.set-role"
  | "admin.reset-password";

// Who did what to which account, and when: one row in aristo.audit_logs per
// sensitive admin action. Metadata only — never a password, a hash or a session
// token. aristo.audit_logs already exists with admin-only RLS (an INSERT needs
// is_platform_admin() for the acting user), so this must run inside the same
// withActor() as the action itself.
//
// Best effort by design: it runs AFTER the action has succeeded and committed, in
// its own statement, and a failure here is logged (type and action only, no data)
// and swallowed — a broken audit log must not undo, or report as failed, an action
// that already happened.
export async function recordAdminAction(entry: {
  actorId: string;
  action: AdminAction;
  targetUserId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}) {
  try {
    await db()
      .prepare(
        "INSERT INTO audit_logs(tenant_id,user_id,action,entity_type,entity_id,old_value,new_value) VALUES((SELECT tenant_id FROM tenant_members WHERE user_id=? AND status='active' ORDER BY created_at LIMIT 1),?,?,'user',?,?::jsonb,?::jsonb)",
      )
      .run(
        entry.targetUserId,
        entry.actorId,
        entry.action,
        entry.targetUserId,
        entry.oldValue ? JSON.stringify(entry.oldValue) : null,
        entry.newValue ? JSON.stringify(entry.newValue) : null,
      );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "audit_log_failed",
        action: entry.action,
        type: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}
