import { db, nowIso } from '../db.js';

const insertStmt = db.prepare(
  `INSERT INTO users (username, email, password_hash, role)
   VALUES (?, ?, ?, ?)`
);

export function createUser({ username, email, passwordHash, role = 'user' }) {
  const info = insertStmt.run(username, email, passwordHash, role);
  return getUserById(Number(info.lastInsertRowid));
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

export function getUserByLogin(identifier) {
  return db
    .prepare(
      'SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE'
    )
    .get(identifier, identifier);
}

export function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

export function setRole(userId, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return getUserById(userId);
}

export function setBanned(userId, isBanned) {
  db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(isBanned ? 1 : 0, userId);
  return getUserById(userId);
}

export function setMutedUntil(userId, untilIso) {
  db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(untilIso ?? null, userId);
  return getUserById(userId);
}

export function listUsers({ search = '', limit = 50, offset = 0 } = {}) {
  if (search) {
    const like = `%${search}%`;
    return db
      .prepare(
        `SELECT * FROM users
         WHERE username LIKE ? OR email LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(like, like, limit, offset);
  }
  return db
    .prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

/** Kullanici su anda susturulmus mu? (Suresi gecmisse otomatik temizler.) */
export function isMuted(user) {
  if (!user?.muted_until) return false;
  if (new Date(user.muted_until).getTime() > Date.now()) return true;
  // suresi dolmus -> temizle
  setMutedUntil(user.id, null);
  user.muted_until = null;
  return false;
}

export function isBanned(user) {
  return !!user?.is_banned;
}

/** Disari acilabilir (sifre hash'i olmadan) kullanici nesnesi. */
export function publicUser(user) {
  if (!user) return null;
  const muted = isMuted(user);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isBanned: !!user.is_banned,
    isMuted: muted,
    mutedUntil: muted ? user.muted_until : null,
    createdAt: user.created_at,
  };
}

/** Admin paneli icin e-posta da iceren detay. */
export function adminUserView(user) {
  if (!user) return null;
  return {
    ...publicUser(user),
    email: user.email,
  };
}

export { nowIso };
