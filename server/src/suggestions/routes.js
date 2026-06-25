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

/** Mac bitmediyse (yaklasan/canli) oneri ve oy aciktir. */
async function assertOpen(matchId) {
  let group;
  try {
    group = (await getMatch(matchId)).statusGroup;
  } catch {
    throw new ApiError(502, 'Mac durumu alinamadi.');
  }
  if (group === 'finished') throw new ApiError(403, 'Mac bitti, oneri ve oylama kapandi.');
}

// GET /api/suggestions/:matchId
suggestionsRouter.get(
  '/:matchId',
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId)) throw new ApiError(400, 'Gecersiz mac.');
    const userId = req.user?.id ?? null;
    res.json({
      matchId,
      suggestions: listSuggestions(matchId, userId),
      myVotes: userId ? [...userVoteSet(matchId, userId)] : [],
    });
  })
);

// POST /api/suggestions/:matchId  { type, content }
suggestionsRouter.post(
  '/:matchId',
  authRequired,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!Number.isInteger(matchId)) throw new ApiError(400, 'Gecersiz mac.');

    const fresh = getUserById(req.user.id);
    if (isBanned(fresh)) throw new ApiError(403, 'Hesabiniz banlandi.');
    if (isMuted(fresh)) throw new ApiError(403, 'Susturuldunuz, oneri gonderemezsiniz.');

    const type = String(req.body?.type ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    if (!TYPES.has(type)) throw new ApiError(400, 'Gecersiz oneri turu.');
    if (!content) throw new ApiError(400, 'Oneri bos olamaz.');
    if (content.length > MAX_LEN) {
      throw new ApiError(400, `Oneri cok uzun (en fazla ${MAX_LEN} karakter).`);
    }

    await assertOpen(matchId);

    const suggestion = createSuggestion({ matchId, userId: fresh.id, type, content });
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

    const fresh = getUserById(req.user.id);
    if (isBanned(fresh)) throw new ApiError(403, 'Hesabiniz banlandi.');

    const row = getSuggestionRow(id);
    if (!row || row.is_deleted || row.match_id !== matchId) {
      throw new ApiError(404, 'Oneri bulunamadi.');
    }

    await assertOpen(matchId);

    const { voted, voteCount } = toggleVote(id, fresh.id);
    getIo()?.to(suggestionsRoom(matchId)).emit('suggestion:vote', { suggestionId: id, voteCount });
    res.json({ suggestionId: id, voted, voteCount });
  })
);
