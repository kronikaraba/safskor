import { db } from '../db.js';

export function logModeration({
  adminId,
  action,
  targetUserId = null,
  targetMessageId = null,
  reason = null,
  meta = null,
}) {
  db.prepare(
    `INSERT INTO moderation_actions
       (admin_id, action, target_user_id, target_message_id, reason, meta)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(adminId, action, targetUserId, targetMessageId, reason, meta ? JSON.stringify(meta) : null);
}

export function listModeration({ limit = 100 } = {}) {
  const rows = db
    .prepare(
      `SELECT ma.*, a.username AS admin_username, t.username AS target_username
       FROM moderation_actions ma
       LEFT JOIN users a ON a.id = ma.admin_id
       LEFT JOIN users t ON t.id = ma.target_user_id
       ORDER BY ma.id DESC LIMIT ?`
    )
    .all(limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    adminId: r.admin_id,
    adminUsername: r.admin_username,
    targetUserId: r.target_user_id,
    targetUsername: r.target_username,
    targetMessageId: r.target_message_id,
    reason: r.reason,
    meta: r.meta ? JSON.parse(r.meta) : null,
    createdAt: r.created_at,
  }));
}
