import { verifyToken } from '../auth/jwt.js';
import { getUserById, isBanned, isMuted } from '../store/users.js';
import { parseRoom, ratingsRoom, suggestionsRoom } from './rooms.js';
import { insertMessage } from '../store/messages.js';
import { upsertRating, getMatchAverages, getUserMatchRatings } from '../store/ratings.js';
import { getMatch } from '../football/service.js';
import { setIo } from './io.js';

const SEND_COOLDOWN_MS = 600;
const MAX_MESSAGE_LEN = 1000;

function fail(ack, message) {
  if (typeof ack === 'function') ack({ ok: false, error: message });
}

export function initRealtime(io) {
  setIo(io);

  // Baglanti dogrulama: token varsa kullaniciyi ekle, yoksa anonim (salt-okunur).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = verifyToken(token);
        const user = getUserById(payload.sub);
        if (user) socket.data.user = { id: user.id, username: user.username, role: user.role };
      } catch {
        /* gecersiz token -> anonim */
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

    socket.on('chat:send', (payload, ack) => {
      const sess = socket.data.user;
      if (!sess) return fail(ack, 'Mesaj gondermek icin giris yapin.');

      const parsed = parseRoom(payload?.room);
      if (!parsed) return fail(ack, 'Gecersiz sohbet odasi.');

      const fresh = getUserById(sess.id);
      if (!fresh) return fail(ack, 'Kullanici bulunamadi.');
      if (isBanned(fresh)) return fail(ack, 'Hesabiniz banlandi.');
      if (isMuted(fresh)) return fail(ack, 'Susturuldunuz, su an mesaj gonderemezsiniz.');

      const content = String(payload?.content ?? '').trim();
      if (!content) return fail(ack, 'Bos mesaj gonderilemez.');
      if (content.length > MAX_MESSAGE_LEN) {
        return fail(ack, `Mesaj cok uzun (en fazla ${MAX_MESSAGE_LEN} karakter).`);
      }

      const now = Date.now();
      if (now - socket.data.lastSentAt < SEND_COOLDOWN_MS) {
        return fail(ack, 'Cok hizli mesaj gonderiyorsunuz, biraz yavaslayin.');
      }
      socket.data.lastSentAt = now;

      const message = insertMessage({
        room: parsed.room,
        scope: parsed.scope,
        matchId: parsed.matchId,
        playerId: parsed.playerId,
        userId: fresh.id,
        content,
      });

      io.to(parsed.room).emit('chat:message', message);
      if (typeof ack === 'function') ack({ ok: true, message });
    });

    // --- Puanlama ---
    socket.on('rating:join', (matchId) => {
      const id = Number(matchId);
      if (!Number.isInteger(id)) return;
      socket.join(ratingsRoom(id));
      socket.emit('rating:averages', { matchId: id, averages: getMatchAverages(id) });
      if (socket.data.user) {
        socket.emit('rating:mine', {
          matchId: id,
          ratings: getUserMatchRatings(id, socket.data.user.id),
        });
      }
    });

    socket.on('rating:leave', (matchId) => {
      const id = Number(matchId);
      if (Number.isInteger(id)) socket.leave(ratingsRoom(id));
    });

    // --- Oneriler (oylama yayini icin oda aboneligi; yazma/oylama REST ile) ---
    socket.on('suggestion:join', (matchId) => {
      const id = Number(matchId);
      if (Number.isInteger(id)) socket.join(suggestionsRoom(id));
    });

    socket.on('suggestion:leave', (matchId) => {
      const id = Number(matchId);
      if (Number.isInteger(id)) socket.leave(suggestionsRoom(id));
    });

    socket.on('rating:submit', async (payload, ack) => {
      const sess = socket.data.user;
      if (!sess) return fail(ack, 'Puan vermek icin giris yapin.');

      const fresh = getUserById(sess.id);
      if (!fresh) return fail(ack, 'Kullanici bulunamadi.');
      if (isBanned(fresh)) return fail(ack, 'Hesabiniz banlandi.');

      const matchId = Number(payload?.matchId);
      const playerId = Number(payload?.playerId);
      const score = Number(payload?.score);
      if (!Number.isInteger(matchId) || !Number.isInteger(playerId)) {
        return fail(ack, 'Gecersiz mac veya oyuncu.');
      }
      if (!Number.isInteger(score) || score < 1 || score > 10) {
        return fail(ack, 'Puan 1-10 arasinda olmali.');
      }

      // Mac canli mi? (cache'ten gelir, API'yi yormaz)
      let statusGroup;
      try {
        statusGroup = (await getMatch(matchId)).statusGroup;
      } catch {
        return fail(ack, 'Mac durumu alinamadi.');
      }
      if (statusGroup !== 'live') {
        socket.emit('rating:closed', { matchId });
        return fail(ack, 'Puanlama yalnizca mac canliyken acik.');
      }

      const agg = upsertRating({ matchId, playerId, userId: fresh.id, score });
      io.to(ratingsRoom(matchId)).emit('rating:update', agg);
      if (typeof ack === 'function') ack({ ok: true, average: agg.average, count: agg.count, score });
    });
  });
}
