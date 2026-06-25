import { sql, toIso } from '../db.js';

export async function logModeration({
  adminId,
  action,
  targetUserId = null,
  targetMessageId = null,
  reason = null,
  meta = null,
}) {
  await sql`
    INSERT INTO moderation_actions
      (admin_id, action, target_user_id, target_message_id, reason, meta)
    VALUES
      (${adminId}, ${action}, ${targetUserId}, ${targetMessageId}, ${reason}, ${meta ? sql.json(meta) : null})
  `;
}

export async function listModeration({ limit = 100 } = {}) {
  const rows = await sql`
    SELECT ma.*, a.username AS admin_username, t.username AS target_username
    FROM moderation_actions ma
    LEFT JOIN users a ON a.id = ma.admin_id
    LEFT JOIN users t ON t.id = ma.target_user_id
    ORDER BY ma.id DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    action: r.action,
    adminId: r.admin_id != null ? Number(r.admin_id) : null,
    adminUsername: r.admin_username,
    targetUserId: r.target_user_id != null ? Number(r.target_user_id) : null,
    targetUsername: r.target_username,
    targetMessageId: r.target_message_id != null ? Number(r.target_message_id) : null,
    reason: r.reason,
    meta: r.meta || null,
    createdAt: toIso(r.created_at),
  }));
}
