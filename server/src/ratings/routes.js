import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { getMatchAverages, getUserMatchRatings } from '../store/ratings.js';

export const ratingsRouter = Router();

// GET /api/ratings/:matchId -> { matchId, averages, mine }
// averages herkese acik (eski maclarda da gorulur); mine sadece giris yapana.
ratingsRouter.get(
  '/:matchId',
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId)) throw new ApiError(400, 'Geçersiz maç.');
    const averages = await getMatchAverages(matchId);
    const mine = req.user ? await getUserMatchRatings(matchId, req.user.id) : {};
    res.json({ matchId, averages, mine });
  })
);
