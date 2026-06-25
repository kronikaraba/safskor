import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { validateUsername, validateEmail, validatePassword } from '../utils/validate.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { config } from '../config.js';
import {
  createUser,
  getUserByEmail,
  getUserByUsername,
  getUserByLogin,
  publicUser,
} from '../store/users.js';
import { authRequired } from './middleware.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');

    for (const err of [
      validateUsername(username),
      validateEmail(email),
      validatePassword(password),
    ]) {
      if (err) throw new ApiError(400, err);
    }

    if (getUserByUsername(username)) throw new ApiError(409, 'Bu kullanici adi alinmis.');
    if (getUserByEmail(email)) throw new ApiError(409, 'Bu e-posta zaten kayitli.');

    const role = config.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
    const passwordHash = await hashPassword(password);
    const user = createUser({ username, email, passwordHash, role });
    const token = signToken(user);
    res.status(201).json({ user: publicUser(user), token });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const identifier = String(
      req.body?.identifier ?? req.body?.email ?? req.body?.username ?? ''
    ).trim();
    const password = String(req.body?.password ?? '');
    if (!identifier || !password) {
      throw new ApiError(400, 'Kullanici adi/e-posta ve sifre gerekli.');
    }
    const user = getUserByLogin(identifier);
    if (!user) throw new ApiError(401, 'Hatali giris bilgileri.');
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw new ApiError(401, 'Hatali giris bilgileri.');
    const token = signToken(user);
    res.json({ user: publicUser(user), token });
  })
);

authRouter.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});
