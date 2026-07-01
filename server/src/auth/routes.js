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
  getUserById,
  setPassword,
  publicUser,
} from '../store/users.js';
import {
  createResetToken,
  getValidReset,
  markResetUsed,
} from '../store/passwordResets.js';
import { sendResetEmail } from '../lib/email.js';
import { authRequired } from './middleware.js';
import { rateLimit } from '../utils/rateLimit.js';

export const authRouter = Router();

// Kaba kuvvet / spam koruması (IP başına).
const loginLimiter = rateLimit({ name: 'login', windowMs: 5 * 60 * 1000, max: 10 });
const registerLimiter = rateLimit({ name: 'register', windowMs: 60 * 60 * 1000, max: 5 });
const forgotLimiter = rateLimit({ name: 'forgot', windowMs: 60 * 60 * 1000, max: 4 });

// Kullanıcı yokken de bcrypt'e benzer gecikme yaratıp zamanlama sızıntısını önler.
const DUMMY_HASH = '$2a$10$XoRmbXFng5ULRsyTg.aEF.CsiUxDYslBHDVnzoAiQU1i7dpVc0HQW';

authRouter.post(
  '/register',
  registerLimiter,
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

    if (await getUserByUsername(username)) throw new ApiError(409, 'Bu kullanıcı adı alınmış.');
    if (await getUserByEmail(email)) throw new ApiError(409, 'Bu e-posta zaten kayıtlı.');

    const role = config.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await createUser({ username, email, passwordHash, role });
    } catch (e) {
      // UNIQUE index ihlali (eşzamanlı kayıt yarışı) → 409
      if (e?.code === '23505') throw new ApiError(409, 'Bu kullanıcı adı veya e-posta zaten kayıtlı.');
      throw e;
    }
    const token = signToken(user);
    res.status(201).json({ user: await publicUser(user), token });
  })
);

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const identifier = String(
      req.body?.identifier ?? req.body?.email ?? req.body?.username ?? ''
    ).trim();
    const password = String(req.body?.password ?? '');
    if (!identifier || !password) {
      throw new ApiError(400, 'Kullanici adi/e-posta ve sifre gerekli.');
    }
    const user = await getUserByLogin(identifier);
    // Kullanıcı yoksa da bcrypt çalıştır: yanıt süresinden kullanıcı varlığı sızmasın.
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new ApiError(401, 'Hatalı giriş bilgileri.');
    const token = signToken(user);
    res.json({ user: await publicUser(user), token });
  })
);

authRouter.get('/me', authRequired, asyncHandler(async (req, res) => {
  res.json({ user: await publicUser(req.user) });
}));

// Şifre sıfırlama isteği — e-posta varsa bağlantı gönderilir.
// Güvenlik: e-postanın kayıtlı olup olmadığını sızdırmamak için her zaman ok döner.
authRouter.post(
  '/forgot-password',
  forgotLimiter,
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    if (validateEmail(email)) throw new ApiError(400, 'Geçerli bir e-posta girin.');

    const user = await getUserByEmail(email);
    if (user) {
      const token = await createResetToken(user.id);
      const resetUrl = `${config.appUrl}/sifre-sifirla?token=${token}`;
      try {
        await sendResetEmail(user.email, resetUrl);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[forgot-password] e-posta gönderilemedi:', e?.message);
      }
    }
    res.json({ ok: true });
  })
);

// Yeni şifre belirleme (jeton ile).
authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!token) throw new ApiError(400, 'Sıfırlama bağlantısı geçersiz.');
    const pErr = validatePassword(password);
    if (pErr) throw new ApiError(400, pErr);

    const reset = await getValidReset(token);
    if (!reset) {
      throw new ApiError(400, 'Bağlantı geçersiz veya süresi dolmuş. Yeniden sıfırlama isteyin.');
    }

    const passwordHash = await hashPassword(password);
    await setPassword(reset.user_id, passwordHash);
    await markResetUsed(reset.id);

    const user = await getUserById(reset.user_id);
    const authToken = signToken(user);
    res.json({ ok: true, user: await publicUser(user), token: authToken });
  })
);
