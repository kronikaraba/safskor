import crypto from 'node:crypto';
import { sql } from '../db.js';
import { config } from '../config.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Yeni bir sıfırlama jetonu üretir, hash'ini saklar; düz jetonu döndürür. */
export async function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.resetTokenTtlMs).toISOString();
  // Kullanıcının önceki kullanılmamış jetonlarını geçersiz kıl.
  await sql`UPDATE password_resets SET used = TRUE WHERE user_id = ${userId} AND used = FALSE`;
  await sql`
    INSERT INTO password_resets (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `;
  return token;
}

/** Geçerli (kullanılmamış, süresi dolmamış) jeton kaydını döndürür ya da null. */
export async function getValidReset(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await sql`
    SELECT id, user_id, expires_at, used
    FROM password_resets
    WHERE token_hash = ${tokenHash} AND used = FALSE AND expires_at > NOW()
    LIMIT 1
  `;
  return row || null;
}

export async function markResetUsed(id) {
  await sql`UPDATE password_resets SET used = TRUE WHERE id = ${id}`;
}
