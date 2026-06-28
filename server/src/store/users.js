import { sql, nowIso, toIso } from '../db.js';

export async function createUser({ username, email, passwordHash, role = 'user' }) {
  const [row] = await sql`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${username}, ${email}, ${passwordHash}, ${role})
    RETURNING *
  `;
  return row;
}

export async function getUserById(id) {
  const [row] = await sql`SELECT * FROM users WHERE id = ${id}`;
  return row || null;
}

export async function getUserByEmail(email) {
  const [row] = await sql`SELECT * FROM users WHERE LOWER(email) = LOWER(${email})`;
  return row || null;
}

export async function getUserByUsername(username) {
  const [row] = await sql`SELECT * FROM users WHERE LOWER(username) = LOWER(${username})`;
  return row || null;
}

export async function getUserByLogin(identifier) {
  const [row] = await sql`
    SELECT * FROM users
    WHERE LOWER(email) = LOWER(${identifier}) OR LOWER(username) = LOWER(${identifier})
    LIMIT 1
  `;
  return row || null;
}

export async function countAdmins() {
  const [row] = await sql`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`;
  return row.n;
}

export async function setRole(userId, role) {
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`;
  return getUserById(userId);
}

export async function setPassword(userId, passwordHash) {
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}`;
  return getUserById(userId);
}

export async function setBanned(userId, isBannedFlag) {
  await sql`UPDATE users SET is_banned = ${!!isBannedFlag} WHERE id = ${userId}`;
  return getUserById(userId);
}

export async function setMutedUntil(userId, untilIso) {
  await sql`UPDATE users SET muted_until = ${untilIso ?? null} WHERE id = ${userId}`;
  return getUserById(userId);
}

export async function listUsers({ search = '', limit = 50, offset = 0 } = {}) {
  if (search) {
    const like = `%${search}%`;
    return sql`
      SELECT * FROM users
      WHERE username ILIKE ${like} OR email ILIKE ${like}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
  }
  return sql`
    SELECT * FROM users
    ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  `;
}

/** Kullanıcı şu anda susturulmuş mu? (Süresi geçmişse otomatik temizler.) */
export async function isMuted(user) {
  if (!user?.muted_until) return false;
  const ts = user.muted_until instanceof Date ? user.muted_until.getTime() : new Date(user.muted_until).getTime();
  if (ts > Date.now()) return true;
  // süresi dolmuş -> temizle
  await setMutedUntil(user.id, null);
  user.muted_until = null;
  return false;
}

export function isBanned(user) {
  return !!user?.is_banned;
}

/** Dışarı açılabilir (şifre hash'i olmadan) kullanıcı nesnesi. */
export async function publicUser(user) {
  if (!user) return null;
  const muted = await isMuted(user);
  return {
    id: Number(user.id),
    username: user.username,
    role: user.role,
    isBanned: !!user.is_banned,
    isMuted: muted,
    mutedUntil: muted ? toIso(user.muted_until) : null,
    createdAt: toIso(user.created_at),
  };
}

/** Admin paneli için e-posta da içeren detay. */
export async function adminUserView(user) {
  if (!user) return null;
  const base = await publicUser(user);
  return { ...base, email: user.email };
}

export { nowIso };
