import { getMatchesByDate, getMatchEvents } from '../football/service.js';
import { insertMessage } from '../store/messages.js';
import { matchRoom } from '../realtime/rooms.js';
import { ensureBotUser, getBotId } from './botUser.js';
import { renderTemplate } from './templates.js';

// Canlı maçların olaylarını izler ve maç sohbetine 🤖 rozetli otomatik mesaj
// düşer. Bütünüyle şeffaftır (bot rolü) ve yalnızca API'den gelen gerçek
// olaylara tepki verir.

const POLL_MS = Number(process.env.BOT_POLL_MS) || 90 * 1000;
const MAX_WATCHED = 8; // aynı anda izlenecek canlı maç sayısı (kotayı korur)

const known = new Set(); // ilk görüşte "baseline" alınmış maç id'leri
const seen = new Map(); // matchId -> Set(eventKey)
const flags = new Map(); // matchId -> { half, finish }

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function eventKey(e) {
  return `${e.type}:${e.minute ?? ''}:${e.extra ?? 0}:${e.player ?? ''}:${e.teamName ?? ''}`;
}

function templateType(e) {
  if (e.type === 'goal') {
    if (e.detail === 'PENALTY') return 'penalty';
    if (e.detail === 'OWN') return 'own_goal';
    return 'goal';
  }
  if (['yellow_card', 'red_card', 'substitution'].includes(e.type)) return e.type;
  return null; // var/other → duyurma
}

function scoreStr(m) {
  const h = m.score?.home;
  const a = m.score?.away;
  return h != null && a != null ? `${h}-${a}` : '';
}

let io = null;

async function post(matchId, content) {
  if (!content) return;
  const botId = getBotId();
  if (!botId) return;
  const room = matchRoom(matchId);
  try {
    const message = await insertMessage({ room, scope: 'match', matchId, playerId: null, userId: botId, content });
    io?.to(room).emit('chat:message', message);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[bot] mesaj gönderilemedi:', e?.message);
  }
}

async function tick() {
  let data;
  try {
    data = await getMatchesByDate(todayUtc());
  } catch {
    return;
  }
  const live = (data.live ?? []).slice(0, MAX_WATCHED);

  // Bitmiş maçlar için kapanış duyurusu (daha önce izlediklerimiz).
  for (const m of data.finished ?? []) {
    if (!known.has(m.id)) continue;
    const f = flags.get(m.id) ?? {};
    if (f.finish) continue;
    f.finish = true;
    flags.set(m.id, f);
    await post(
      m.id,
      renderTemplate('finish', {
        home: m.homeTeam?.name,
        away: m.awayTeam?.name,
        sh: m.score?.home ?? 0,
        sa: m.score?.away ?? 0,
      })
    );
  }

  for (const m of live) {
    let events;
    try {
      events = await getMatchEvents(m.id);
    } catch {
      continue;
    }
    const keys = events.map(eventKey);

    // İlk görüşte: mevcut tüm olayları "görülmüş" say (yeniden başlatmada eski
    // olayları tekrar duyurmamak için), yalnızca bundan sonrakileri duyur.
    if (!known.has(m.id)) {
      known.add(m.id);
      seen.set(m.id, new Set(keys));
      flags.set(m.id, {});
      // Maç yeni başladıysa (olay yok + dakika küçük) başlangıcı duyur.
      if (events.length === 0 && (m.minute == null || m.minute <= 3)) {
        await post(m.id, renderTemplate('start', { home: m.homeTeam?.name, away: m.awayTeam?.name }));
      }
      continue;
    }

    // Devre arası duyurusu (status short 'HT').
    const f = flags.get(m.id) ?? {};
    if (m.status === 'HT' && !f.half) {
      f.half = true;
      flags.set(m.id, f);
      await post(
        m.id,
        renderTemplate('halftime', {
          home: m.homeTeam?.name,
          away: m.awayTeam?.name,
          sh: m.score?.halfTime?.home ?? m.score?.home ?? 0,
          sa: m.score?.halfTime?.away ?? m.score?.away ?? 0,
        })
      );
    }

    // Yeni olaylar.
    const seenSet = seen.get(m.id);
    for (let i = 0; i < events.length; i += 1) {
      const key = keys[i];
      if (seenSet.has(key)) continue;
      seenSet.add(key);
      const e = events[i];
      const type = templateType(e);
      if (!type) continue;
      await post(
        m.id,
        renderTemplate(type, {
          min: e.minute ?? '',
          player: e.player ?? 'Oyuncu',
          team: e.teamName ?? '',
          score: scoreStr(m),
        })
      );
    }
  }
}

export async function startBot(socketIo) {
  io = socketIo;
  try {
    await ensureBotUser();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[bot] bot kullanıcısı oluşturulamadı:', e?.message);
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[bot] SafSkor Bot etkin (canlı maç olayları).');
  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), POLL_MS).unref?.();
}
