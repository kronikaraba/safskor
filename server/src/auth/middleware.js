import { verifyToken } from './jwt.js';
import { getUserById } from '../store/users.js';

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Token varsa req.user'a tam kullanici satirini koyar; yoksa sessizce gecer. */
export function attachUser(req, _res, next) {
  const token = tokenFromRequest(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      const user = getUserById(payload.sub);
      if (user) req.user = user;
    } catch {
      /* gecersiz/expired token -> anonim */
    }
  }
  next();
}

export function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Giris yapmaniz gerekiyor.' });
  next();
}

export function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Giris yapmaniz gerekiyor.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Bu islem icin yetkiniz yok.' });
  next();
}
