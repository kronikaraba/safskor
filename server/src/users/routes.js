import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { getPublicProfile } from '../store/users.js';

export const usersRouter = Router();

// GET /api/users/:id — herkese açık sade üye profili
usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, 'Geçersiz üye.');
    const profile = await getPublicProfile(id);
    if (!profile) throw new ApiError(404, 'Üye bulunamadı.');
    res.json({ profile });
  })
);
