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

// Tüm admin rotaları yetki ister. NOT: admin SADECE moderasyon yapar;
// maç/takım/oyuncu/skor/lig verisi girme endpoint'i bilerek YOKTUR.
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

// --- Kullanıcılar ---
adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const rows = await listUsers({ search, limit: 100 });
    const users = await Promise.all(rows.map(adminUserView));
    res.json({ users });
  })
);

// --- Mesajlar ---
adminRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const rows = await listRecentMessages({ search, limit: 100 });
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
    const row = await getMessageRow(id);
    if (!row) throw new ApiError(404, 'Mesaj bulunamadı.');
    const message = await softDeleteMessage(id, req.user.id);
    await logModeration({
      adminId: req.user.id,
      action: 'delete_message',
      targetUserId: Number(row.user_id),
      targetMessageId: id,
      reason: req.body?.reason ?? null,
    });
    getIo()?.to(row.room).emit('chat:deleted', { id, room: row.room });
    res.json({ ok: true, message });
  })
);

// --- Öneriler ---
adminRouter.get(
  '/suggestions',
  asyncHandler(async (_req, res) => {
    const rows = await listRecentSuggestions({ limit: 100 });
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
    const row = await getSuggestionRow(id);
    if (!row) throw new ApiError(404, 'Öneri bulunamadı.');
    await softDeleteSuggestion(id, req.user.id);
    await logModeration({
      adminId: req.user.id,
      action: 'delete_suggestion',
      targetUserId: Number(row.user_id),
      targetMessageId: id,
      reason: req.body?.reason ?? null,
    });
    getIo()
      ?.to(suggestionsRoom(Number(row.match_id)))
      .emit('suggestion:deleted', { id, matchId: Number(row.match_id) });
    res.json({ ok: true });
  })
);

// --- Susturma (timed mute) ---
adminRouter.post(
  '/users/:id/mute',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanıcı bulunamadı.');
    if (user.role === 'admin') throw new ApiError(400, 'Admin susturulamaz.');
    const minutes = Number(req.body?.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60 * 24 * 30) {
      throw new ApiError(400, 'Geçersiz süre (1 dk - 30 gün).');
    }
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    await setMutedUntil(id, until);
    await logModeration({
      adminId: req.user.id,
      action: 'mute',
      targetUserId: id,
      reason: req.body?.reason ?? null,
      meta: { minutes, until },
    });
    await notifyUserSockets(id, 'moderation:muted', { until });
    res.json({ ok: true, user: await adminUserView(await getUserById(id)) });
  })
);

adminRouter.post(
  '/users/:id/unmute',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanıcı bulunamadı.');
    await setMutedUntil(id, null);
    await logModeration({ adminId: req.user.id, action: 'unmute', targetUserId: id });
    await notifyUserSockets(id, 'moderation:unmuted', {});
    res.json({ ok: true, user: await adminUserView(await getUserById(id)) });
  })
);

// --- Ban ---
adminRouter.post(
  '/users/:id/ban',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanıcı bulunamadı.');
    if (user.role === 'admin') throw new ApiError(400, 'Admin banlanamaz.');
    await setBanned(id, true);
    await logModeration({
      adminId: req.user.id,
      action: 'ban',
      targetUserId: id,
      reason: req.body?.reason ?? null,
    });
    await notifyUserSockets(id, 'moderation:banned', {}, true);
    res.json({ ok: true, user: await adminUserView(await getUserById(id)) });
  })
);

adminRouter.post(
  '/users/:id/unban',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await getUserById(id);
    if (!user) throw new ApiError(404, 'Kullanıcı bulunamadı.');
    await setBanned(id, false);
    await logModeration({ adminId: req.user.id, action: 'unban', targetUserId: id });
    res.json({ ok: true, user: await adminUserView(await getUserById(id)) });
  })
);

// --- Moderasyon kaydı ---
adminRouter.get(
  '/log',
  asyncHandler(async (_req, res) => {
    res.json({ log: await listModeration({ limit: 100 }) });
  })
);
