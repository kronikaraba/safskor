import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { adminRequired } from '../auth/middleware.js';
import {
  listUsers,
  getUserById,
  setBanned,
  setMutedUntil,
  adminUserView,
} from '../store/users.js';
import {
  getMessageRow,
  softDeleteMessage,
  listRecentMessages,
} from '../store/messages.js';
import {
  getSuggestionRow,
  softDeleteSuggestion,
  listRecentSuggestions,
} from '../store/suggestions.js';
import { logModeration, listModeration } from '../store/moderation.js';
import { getIo } from '../realtime/io.js';
import { suggestionsRoom } from '../realtime/rooms.js';

export const adminRouter = Router();

// Tum admin rotalari yetki ister. NOT: admin SADECE moderasyon yapar;
// mac/takim/oyuncu/skor/lig verisi girme endpoint'i bilerek YOKTUR.
adminRouter.use(adminRequired);

async function notifyUserSockets(userId, event, payload, disconnect = false) {
  const io = getIo();
  if (!io) return;
  try {
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.data?.user?.id === userId) {
        s.emit(event, payload);
        if (disconnect) s.disconnect(true);
      }
    }
  } catch {
    /* yok say */
  }
}

// --- Kullanicilar ---
adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const users = listUsers({ search, limit: 100 }).map(adminUserView);
    res.json({ users });
  })
);

// --- Mesajlar ---
adminRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const rows = listRecentMessages({ search, limit: 100 });
    res.json({
      messages: rows.map((r) => ({
        id: r.id,
        room: r.room,
        scope: r.scope,
        matchId: r.match_id,
        playerId: r.player_id,
        userId: r.user_id,
        username: r.username,
        content: r.is_deleted ? null : r.content,
        isDeleted: !!r.is_deleted,
        createdAt: r.created_at,
      })),
    });
  })
);

adminRouter.post(
  '/messages/:id/delete',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = getMessageRow(id);
    if (!row) throw new ApiError(404, 'Mesaj bulunamadi.');
    const message = softDeleteMessage(id, req.user.id);
    logModeration({
      adminId: req.user.id,
      action: 'delete_message',
      targetUserId: row.user_id,
      targetMessageId: id,
      reason: req.body?.reason ?? null,
    });
    getIo()?.to(row.room).emit('chat:deleted', { id, room: row.room });
    res.json({ ok: true, message });
  })
);

// --- Oneriler ---
adminRouter.get(
  '/suggestions',
  asyncHandler(async (_req, res) => {
    const rows = listRecentSuggestions({ limit: 100 });
    res.json({
      suggestions: rows.map((r) => ({
        id: r.id,
        matchId: r.match_id,
        type: r.type,
        userId: r.user_id,
        username: r.username,
        content: r.is_deleted ? null : r.content,
        voteCount: r.vote_count,
        isDeleted: !!r.is_deleted,
        createdAt: r.created_at,
      })),
    });
  })
);

adminRouter.post(
  '/suggestions/:id/delete',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = getSuggestionRow(id);
    if (!row) throw new ApiError(404, 'Oneri bulunamadi.');
    softDeleteSuggestion(id, req.user.id);
    logModeration({
      adminId: req.user.id,
      action: 'delete_suggestion',
      targetUserId: row.user_id,
      targetMessageId: id,
      reason: req.body?.reason ?? null,
    });
    getIo()?.to(suggestionsRoom(row.match_id)).emit('suggestion:deleted', { id, matchId: row.match_id });
    res.json({ ok: true });
  })
);

// --- Susturma (timed mute) ---
adminRouter.post(
  '/users/:id/mute',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanici bulunamadi.');
    if (user.role === 'admin') throw new ApiError(400, 'Admin susturulamaz.');
    const minutes = Number(req.body?.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60 * 24 * 30) {
      throw new ApiError(400, 'Gecersiz sure (1 dk - 30 gun).');
    }
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    setMutedUntil(id, until);
    logModeration({
      adminId: req.user.id,
      action: 'mute',
      targetUserId: id,
      reason: req.body?.reason ?? null,
      meta: { minutes, until },
    });
    await notifyUserSockets(id, 'moderation:muted', { until });
    res.json({ ok: true, user: adminUserView(getUserById(id)) });
  })
);

adminRouter.post(
  '/users/:id/unmute',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanici bulunamadi.');
    setMutedUntil(id, null);
    logModeration({ adminId: req.user.id, action: 'unmute', targetUserId: id });
    await notifyUserSockets(id, 'moderation:unmuted', {});
    res.json({ ok: true, user: adminUserView(getUserById(id)) });
  })
);

// --- Ban ---
adminRouter.post(
  '/users/:id/ban',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanici bulunamadi.');
    if (user.role === 'admin') throw new ApiError(400, 'Admin banlanamaz.');
    setBanned(id, true);
    logModeration({
      adminId: req.user.id,
      action: 'ban',
      targetUserId: id,
      reason: req.body?.reason ?? null,
    });
    await notifyUserSockets(id, 'moderation:banned', {}, true);
    res.json({ ok: true, user: adminUserView(getUserById(id)) });
  })
);

adminRouter.post(
  '/users/:id/unban',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanici bulunamadi.');
    setBanned(id, false);
    logModeration({ adminId: req.user.id, action: 'unban', targetUserId: id });
    res.json({ ok: true, user: adminUserView(getUserById(id)) });
  })
);

// --- Moderasyon kaydi ---
adminRouter.get(
  '/log',
  asyncHandler(async (_req, res) => {
    res.json({ log: listModeration({ limit: 100 }) });
  })
);
