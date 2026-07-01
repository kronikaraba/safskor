import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { authRequired } from '../auth/middleware.js';
import { rateLimit } from '../utils/rateLimit.js';
import { validateUsername } from '../utils/validate.js';
import { getPublicProfile, getUserByUsername, setUsername, publicUser } from '../store/users.js';

export const usersRouter = Router();

// POST /api/users/me — kendi kullanıcı adını değiştir
usersRouter.post(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const err = validateUsername(username);
    if (err) throw new ApiError(400, err);
    const existing = await getUserByUsername(username);
    if (existing && Number(existing.id) !== Number(req.user.id)) {
      throw new ApiError(409, 'Bu kullanıcı adı alınmış.');
    }
    const updated = await setUsername(req.user.id, username);
    res.json({ user: await publicUser(updated) });
  })
);

// Kimlik doğrulaması + rate limit: id'leri tarayarak toplu üye/istatistik
// toplanmasını (enumeration) engeller. (Giriş yapan kullanıcılar görebilir.)
const profileLimiter = rateLimit({
  name: 'profile',
  windowMs: 60 * 1000,
  max: 40,
  message: 'Çok fazla profil isteği. Lütfen biraz sonra tekrar deneyin.',
});

// GET /api/users/:id — sade üye profili (yalnızca giriş yapmış üyeler)
usersRouter.get(
  '/:id',
  profileLimiter,
  authRequired,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, 'Geçersiz üye.');
    const profile = await getPublicProfile(id);
    if (!profile) throw new ApiError(404, 'Üye bulunamadı.');
    res.json({ profile });
  })
);
