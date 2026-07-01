import { verifyToken } from '../auth/jwt.js';
import { getUserById, isBanned, isMuted } from '../store/users.js';
import { parseRoom, ratingsRoom, suggestionsRoom } from './rooms.js';
import { insertMessage, getMessageRow, toggleLike } from '../store/messages.js';
import { upsertRating, getMatchAverages, getUserMatchRatings } from '../store/ratings.js';
import { getMatch, getMatchPlayerIds } from '../football/service.js';
import { setIo } from './io.js';

const SEND_COOLDOWN_MS = 600;
const MAX_MESSAGE_LEN = 1000;

function fail(ack, message) {
  if (typeof ack === 'function') ack({ ok: false, error: message });
}

export function initRealtime(io) {
  setIo(io);

  // Bağlantı doğrulama: token varsa kullanıcıyı ekle, yoksa anonim (salt-okunur).
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = verifyToken(token);
        const user = await getUserById(payload.sub);
        if (user) socket.data.user = { id: Number(user.id), username: user.username, role: user.role };
      } catch {
        /* geçersiz token -> anonim */
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    socket.data.lastSentAt = 0;

    // --- Sohbet ---
    socket.on('chat:join', (room) => {
      const parsed = parseRoom(room);
      if (parsed) socket.join(parsed.room);
    });

    socket.on('chat:leave', (room) => {
      if (typeof room === 'string') socket.leave(room);
    });

    socket.on('chat:send', async (payload, ack) => {
      try {
        const sess = socket.data.user;
        if (!sess) return fail(ack, 'Mesaj göndermek için giriş yapın.');

        const parsed = parseRoom(payload?.room);
        if (!parsed) return fail(ack, 'Geçersiz sohbet odası.');

        const fresh = await getUserById(sess.id);
        if (!fresh) return fail(ack, 'Kullanıcı bulunamadı.');
        if (isBanned(fresh)) return fail(ack, 'Hesabınız banlandı.');
        if (await isMuted(fresh)) return fail(ack, 'Susturuldunuz, şu an mesaj gönderemezsiniz.');

        const content = String(payload?.content ?? '').trim();
        if (!content) return fail(ack, 'Boş mesaj gönderilemez.');
        if (content.length > MAX_MESSAGE_LEN) {
          return fail(ack, `Mesaj çok uzun (en fazla ${MAX_MESSAGE_LEN} karakter).`);
        }

        const now = Date.now();
        if (now - socket.data.lastSentAt < SEND_COOLDOWN_MS) {
          return fail(ack, 'Çok hızlı mesaj gönderiyorsunuz, biraz yavaşlayın.');
        }
        socket.data.lastSentAt = now;

        const message = await insertMessage({
          room: parsed.room,
          scope: parsed.scope,
          matchId: parsed.matchId,
          playerId: parsed.playerId,
          userId: Number(fresh.id),
          content,
        });

        io.to(parsed.room).emit('chat:message', message);
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[socket] chat:send error', e);
        return fail(ack, 'Mesaj gönderilemedi.');
      }
    });

    // --- Mesaj beğenisi (+1) ---
    socket.on('chat:like', async (payload, ack) => {
      try {
        const sess = socket.data.user;
        if (!sess) return fail(ack, 'Beğenmek için giriş yapın.');

        const messageId = Number(payload?.messageId);
        if (!Number.isInteger(messageId)) return fail(ack, 'Geçersiz mesaj.');

        const row = await getMessageRow(messageId);
        if (!row || row.is_deleted) return fail(ack, 'Mesaj bulunamadı.');

        const { liked, likeCount } = await toggleLike(messageId, sess.id);
        io.to(row.room).emit('chat:liked', { id: messageId, likeCount });
        if (typeof ack === 'function') ack({ ok: true, liked, likeCount });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[socket] chat:like error', e);
        return fail(ack, 'Beğeni kaydedilemedi.');
      }
    });

    // --- Puanlama ---
    socket.on('rating:join', async (matchId) => {
      const id = Number(matchId);
      if (!Number.isInteger(id)) return;
      socket.join(ratingsRoom(id));
      try {
        socket.emit('rating:averages', { matchId: id, averages: await getMatchAverages(id) });
        if (socket.data.user) {
          socket.emit('rating:mine', {
            matchId: id,
            ratings: await getUserMatchRatings(id, socket.data.user.id),
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[socket] rating:join error', e);
      }
    });

    socket.on('rating:leave', (matchId) => {
      const id = Number(matchId);
      if (Number.isInteger(id)) socket.leave(ratingsRoom(id));
    });

    // --- Öneriler (oylama yayını için oda aboneliği; yazma/oylama REST ile) ---
    socket.on('suggestion:join', (matchId) => {
      const id = Number(matchId);
      if (Number.isInteger(id)) socket.join(suggestionsRoom(id));
    });

    socket.on('suggestion:leave', (matchId) => {
      const id = Number(matchId);
      if (Number.isInteger(id)) socket.leave(suggestionsRoom(id));
    });

    socket.on('rating:submit', async (payload, ack) => {
      try {
        const sess = socket.data.user;
        if (!sess) return fail(ack, 'Puan vermek için giriş yapın.');

        const fresh = await getUserById(sess.id);
        if (!fresh) return fail(ack, 'Kullanıcı bulunamadı.');
        if (isBanned(fresh)) return fail(ack, 'Hesabınız banlandı.');

        const matchId = Number(payload?.matchId);
        const playerId = Number(payload?.playerId);
        const score = Number(payload?.score);
        if (!Number.isInteger(matchId) || !Number.isInteger(playerId)) {
          return fail(ack, 'Geçersiz maç veya oyuncu.');
        }
        if (!Number.isInteger(score) || score < 1 || score > 10) {
          return fail(ack, 'Puan 1-10 arasında olmalı.');
        }

        let statusGroup;
        try {
          statusGroup = (await getMatch(matchId)).statusGroup;
        } catch {
          return fail(ack, 'Maç durumu alınamadı.');
        }
        if (statusGroup !== 'live') {
          socket.emit('rating:closed', { matchId });
          return fail(ack, 'Puanlama yalnızca maç canlıyken açık.');
        }

        // Oyuncu gerçekten bu maçın kadrosunda mı? (rastgele ID ile veri kirliliğini önler)
        const validPlayers = await getMatchPlayerIds(matchId);
        if (validPlayers.size > 0 && !validPlayers.has(playerId)) {
          return fail(ack, 'Bu oyuncu maç kadrosunda değil.');
        }

        const agg = await upsertRating({ matchId, playerId, userId: Number(fresh.id), score });
        io.to(ratingsRoom(matchId)).emit('rating:update', agg);
        if (typeof ack === 'function') ack({ ok: true, average: agg.average, count: agg.count, score });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[socket] rating:submit error', e);
        return fail(ack, 'Puan kaydedilemedi.');
      }
    });
  });
}
