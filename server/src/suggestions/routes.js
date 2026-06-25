import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { authRequired } from '../auth/middleware.js';
import { getUserById, isBanned, isMuted } from '../store/users.js';
import {
  listSuggestions,
  createSuggestion,
  getSuggestionRow,
  toggleVote,
  userVoteSet,
} from '../store/suggestions.js';
import { getMatch } from '../football/service.js';
import { getIo } from '../realtime/io.js';
import { suggestionsRoom } from '../realtime/rooms.js';

export const suggestionsRouter = Router();

const TYPES = new Set(['degisiklik', 'taktik', 'dizilis', 'genel']);
const MAX_LEN = 280;

/** Maç bitmediyse (yaklaşan/canlı) öneri ve oy açıktır. */
async function assertOpen(matchId) {
  let group;
  try {
    group = (await getMatch(matchId)).statusGroup;
  } catch (e) {
    // Alttaki futbol API hatasını orijinaliyle yukarı taşı (admin detayını korumak için).
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, 'Maç durumu alınamadı.', 'Maç verisi şu an alınamıyor.');
  }
  if (group === 'finished') throw new ApiError(403, 'Maç bitti, öneri ve oylama kapandı.');
}

// GET /api/suggestions/:matchId
suggestionsRouter.get(
  '/:matchId',
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId)) throw new ApiError(400, 'Geçersiz maç.');
    const userId = req.user?.id ?? null;
    const [suggestions, myVotes] = await Promise.all([
      listSuggestions(matchId, userId),
      userId ? userVoteSet(matchId, userId) : Promise.resolve(new Set()),
    ]);
    res.json({
      matchId,
      suggestions,
      myVotes: [...myVotes],
    });
  })
);

// POST /api/suggestions/:matchId  { type, content }
suggestionsRouter.post(
  '/:matchId',
  authRequired,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId)) throw new ApiError(400, 'Geçersiz maç.');

    const fresh = await getUserById(req.user.id);
    if (isBanned(fresh)) throw new ApiError(403, 'Hesabınız banlandı.');
    if (await isMuted(fresh)) throw new ApiError(403, 'Susturuldunuz, öneri gönderemezsiniz.');

    const type = String(req.body?.type ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    if (!TYPES.has(type)) throw new ApiError(400, 'Geçersiz öneri türü.');
    if (!content) throw new ApiError(400, 'Öneri boş olamaz.');
    if (content.length > MAX_LEN) {
      throw new ApiError(400, `Öneri çok uzun (en fazla ${MAX_LEN} karakter).`);
    }

    await assertOpen(matchId);

    const suggestion = await createSuggestion({ matchId, userId: fresh.id, type, content });
    getIo()
      ?.to(suggestionsRoom(matchId))
      .emit('suggestion:new', { ...suggestion, voted: false });
    res.status(201).json({ suggestion });
  })
);

// POST /api/suggestions/:matchId/:id/vote  (toggle)
suggestionsRouter.post(
  '/:matchId/:id/vote',
  authRequired,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    const id = Number(req.params.id);

    const fresh = await getUserById(req.user.id);
    if (isBanned(fresh)) throw new ApiError(403, 'Hesabınız banlandı.');

    const row = await getSuggestionRow(id);
    if (!row || row.is_deleted || Number(row.match_id) !== matchId) {
      throw new ApiError(404, 'Öneri bulunamadı.');
    }

    await assertOpen(matchId);

    const { voted, voteCount } = await toggleVote(id, fresh.id);
    getIo()?.to(suggestionsRoom(matchId)).emit('suggestion:vote', { suggestionId: id, voteCount });
    res.json({ suggestionId: id, voted, voteCount });
  })
);
