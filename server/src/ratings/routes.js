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
    if (!Number.isInteger(matchId)) throw new ApiError(400, 'Gecersiz mac.');
    const averages = getMatchAverages(matchId);
    const mine = req.user ? getUserMatchRatings(matchId, req.user.id) : {};
    res.json({ matchId, averages, mine });
  })
);
