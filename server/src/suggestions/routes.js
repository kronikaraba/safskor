import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { authRequired } from '../auth/middleware.js';
import { getUserById, isBanned, isMuted } from '../store/users.js';
import {
  listSuggestions,
  createSuggestion,
  withdrawSuggestion,
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
    const suggestions = await listSuggestions(matchId, userId);
    res.json({ matchId, suggestions });
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

    const { suggestion, created } = await createSuggestion({
      matchId,
      userId: fresh.id,
      type,
      content,
    });
    if (created) {
      getIo()
        ?.to(suggestionsRoom(matchId))
        .emit('suggestion:new', { ...suggestion, voted: false });
    }
    res.status(created ? 201 : 200).json({ suggestion, created });
  })
);

// POST /api/suggestions/:matchId/:id/withdraw  (kullanıcı kendi önerisini geri çeker)
suggestionsRouter.post(
  '/:matchId/:id/withdraw',
  authRequired,
  asyncHandler(async (req, res) => {
    const matchId = Number(req.params.matchId);
    const id = Number(req.params.id);

    const result = await withdrawSuggestion(id, req.user.id);
    if (!result) throw new ApiError(404, 'Öneri bulunamadı veya size ait değil.');

    getIo()?.to(suggestionsRoom(matchId)).emit('suggestion:deleted', { id, matchId });
    res.json({ ok: true });
  })
);
