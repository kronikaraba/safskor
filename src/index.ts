import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { config } from './config.js';
import { createProvider } from './providers/index.js';
import { DEMO_TEAMS } from './providers/demo.js';
import { FanStore, FORMATIONS, STYLES, weekKey, type TeamBadge } from './services/fanStore.js';
import { MatchService } from './services/matchService.js';
import type { Match, MatchEvent, Player, Side } from './types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provider = createProvider();
const matches = new MatchService(provider);
const store = new FanStore(config.dbPath);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https://media.api-sports.io; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
  );
  next();
});

// ------------------------------------------------------------------ REST

const withViewers = () => matches.getList().map((m) => ({ ...m, viewers: roomSize(m.id) }));

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: matches.providerInfo }));
app.get('/api/matches', (_req, res) => res.json({ provider: matches.providerInfo, matches: withViewers() }));
app.get('/api/matches/:id', async (req, res) => {
  const m = await matches.getMatch(req.params.id);
  if (!m) return res.status(404).json({ error: 'Maç bulunamadı' });
  res.json(m);
});
app.get('/api/matches/:id/fan', async (req, res) => {
  const m = await matches.getMatch(req.params.id);
  if (!m) return res.status(404).json({ error: 'Maç bulunamadı' });
  store.ensureAutoPolls(m);
  res.json({ ...store.state(m.id), chat: store.chatHistory(m.id) });
});
app.get('/api/meta', (_req, res) => res.json({ formations: FORMATIONS, styles: STYLES }));
app.get('/api/teams', (_req, res) => res.json(store.teams()));

// Paylaşım kartı tuvale arma çizebilsin diye API-Football armalarını aynı kökenden sun (yalnızca media.api-sports.io)
const crestCache = new Map<string, { type: string; body: Buffer }>();
app.get('/img/crest/:kind/:file', async (req, res) => {
  const { kind, file } = req.params;
  if (!/^(teams|leagues)$/.test(kind) || !/^\d{1,9}\.png$/.test(file)) return res.status(404).end();
  const key = `${kind}/${file}`;
  let hit = crestCache.get(key);
  if (!hit) {
    try {
      const r = await fetch(`https://media.api-sports.io/football/${key}`, { signal: AbortSignal.timeout(8000) });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.startsWith('image/')) return res.status(404).end();
      const body = Buffer.from(await r.arrayBuffer());
      if (body.length > 300_000) return res.status(404).end();
      hit = { type, body };
      if (crestCache.size > 500) crestCache.delete(crestCache.keys().next().value!);
      crestCache.set(key, hit);
    } catch {
      return res.status(502).end();
    }
  }
  res.setHeader('Content-Type', hit.type);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(hit.body);
});

app.use('/vendor/socket.io.esm.min.js', (_req, res) =>
  res.sendFile(path.join(root, 'node_modules/socket.io/client-dist/socket.io.esm.min.js')),
);
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
const io = new Server(server, { serveClient: false, maxHttpBufferSize: 16_000 });

const room = (id: string) => `match:${id}`;
let lobbyTimer: NodeJS.Timeout | undefined;
/** Odalardaki taraftar sayısı değişince lobiyi (en fazla saniyede bir) güncelle */
function lobbyUpdate() {
  lobbyTimer ??= setTimeout(() => {
    lobbyTimer = undefined;
    io.to('lobby').emit('matches', { provider: matches.providerInfo, matches: withViewers() });
  }, 1000);
}
function roomSize(id: string) {
  return io.sockets.adapter.rooms.get(room(id))?.size ?? 0;
}

// ------------------------------------------------------------------ yardımcılar

const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const isUserId = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(s);
const isSide = (s: unknown): s is Side => s === 'home' || s === 'away';

function allPlayers(m: Match, side?: Side): Player[] {
  if (!m.lineups) return [];
  const sides: Side[] = side ? [side] : ['home', 'away'];
  return sides.flatMap((s) => [...m.lineups![s].startXI, ...m.lineups![s].subs]);
}

/** Sahada olan oyuncular: ilk 11 + girenler − çıkanlar − kırmızı görenler */
function onPitch(m: Match, side: Side): Set<string> {
  const l = m.lineups![side];
  const set = new Set(l.startXI.map((p) => p.id));
  for (const e of m.events) {
    if (e.side !== side) continue;
    if (e.type === 'sub') {
      if (e.playerId) set.delete(e.playerId);
      if (e.relatedId) set.add(e.relatedId);
    }
    if (e.type === 'red' && e.playerId) set.delete(e.playerId);
  }
  return set;
}

/** Basit kayan pencere hız sınırı */
class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  ok(key: string) {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) return false;
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
const chatLimit = new Limiter(5, 10_000);
const actionLimit = new Limiter(30, 10_000);

// Her maç için taraftar durumu yayınını grupla (çok sık oy gelirse yükü azaltır)
const pendingFan = new Map<string, NodeJS.Timeout>();
function broadcastFan(matchId: string) {
  if (pendingFan.has(matchId)) return;
  pendingFan.set(
    matchId,
    setTimeout(() => {
      pendingFan.delete(matchId);
      io.to(room(matchId)).emit('fan:state', { matchId, ...store.state(matchId) });
    }, 250),
  );
}

// ------------------------------------------------------------------ socket

interface SocketData {
  userId: string;
  nick: string;
  team: TeamBadge | null;
  matchId?: string;
}

/** Sunucu yeniden başlayınca veriler sıfırlanabilir: profil yoksa istemcinin bildirdiği (doğrulanmış) takımı kullan */
function restoreTeam(userId: string, claimed: unknown): TeamBadge | null {
  const saved = store.profile(userId);
  if (saved) return saved.team;
  const id = typeof claimed === 'string' ? claimed.slice(0, 40) : '';
  return id ? store.team(id) : null;
}

io.on('connection', (socket: Socket) => {
  const auth = socket.handshake.auth ?? {};
  const data: SocketData = {
    userId: isUserId(auth.userId) ? auth.userId : `anon-${socket.id}`,
    nick: clean(auth.nick, 20) || 'Taraftar',
    team: null,
  };
  data.team = isUserId(auth.userId) ? restoreTeam(data.userId, auth.teamId) : null;
  socket.data = data;
  socket.emit('hello', { provider: matches.providerInfo, matches: withViewers() });

  type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
  const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

  /** Ortak kontrol: kullanıcı bir maç odasında mı, hız sınırı aşıldı mı */
  async function context(ack: Ack): Promise<Match | null> {
    if (!actionLimit.ok(data.userId)) return ack({ ok: false, error: 'Çok hızlı! Biraz yavaşla.' }), null;
    if (!data.matchId) return ack({ ok: false, error: 'Önce bir maç odasına katıl.' }), null;
    const m = await matches.getMatch(data.matchId);
    if (!m) return ack({ ok: false, error: 'Maç bulunamadı.' }), null;
    return m;
  }
  const sendMine = (matchId: string) => socket.emit('fan:mine', { matchId, ...store.mine(matchId, data.userId) });

  socket.on('profile:set', (p, ack) => {
    const a = safeAck(ack);
    if (!actionLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı! Biraz yavaşla.' });
    const nick = clean(p?.nick, 20);
    if (nick.length < 2) return a({ ok: false, error: 'Takma ad en az 2 karakter olmalı.' });
    let team = data.team;
    if (p?.teamId === null || p?.teamId === '') team = null;
    else if (p?.teamId !== undefined) {
      team = store.team(clean(p.teamId, 40));
      if (!team) return a({ ok: false, error: 'Takım bulunamadı.' });
    }
    data.nick = nick;
    data.team = team;
    if (isUserId(data.userId)) store.saveProfile(data.userId, nick, team?.id ?? null);
    a({ ok: true, nick, team });
  });

  socket.on('teams:list', (_p, ack) => safeAck(ack)({ ok: true, teams: store.teams() }));

  socket.on('leaderboard:get', (p, ack) => {
    const week = typeof p?.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? p.week : weekKey(Date.now());
    safeAck(ack)({ ok: true, ...store.leaderboard(week, data.userId) });
  });

  // --- skor (ve isteğe bağlı ilk 11) tahmini: maç başlayana kadar açık
  socket.on('prediction:set', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (!isUserId(data.userId)) return a({ ok: false, error: 'Tahmin için tarayıcı kimliği gerekli.' });
    if (m.status !== 'SCHEDULED' || Date.now() >= Date.parse(m.kickoff)) return a({ ok: false, error: 'Maç başladı, tahminler kilitlendi.' });
    const home = Number(p?.home);
    const away = Number(p?.away);
    const okScore = (n: number) => Number.isInteger(n) && n >= 0 && n <= 20;
    if (!okScore(home) || !okScore(away)) return a({ ok: false, error: 'Skor 0-20 arasında olmalı.' });
    let xi: string[] | undefined;
    let xiSide: Side | undefined;
    if (Array.isArray(p?.xi) && p.xi.length) {
      if (!m.lineups) return a({ ok: false, error: 'Kadrolar açıklanmadan ilk 11 tahmini yapılamaz.' });
      if (!isSide(p?.xiSide)) return a({ ok: false, error: 'İlk 11 için takım seç.' });
      const squad = new Set(allPlayers(m, p.xiSide).map((x) => x.id));
      xi = [...new Set((p.xi as unknown[]).map(String))];
      if (xi.length !== 11 || !xi.every((id) => squad.has(id))) return a({ ok: false, error: 'İlk 11 tahmini kadrodan tam 11 oyuncu olmalı.' });
      xiSide = p.xiSide;
    }
    store.setPrediction(m.id, Date.parse(m.kickoff), data.userId, data.nick, { home, away, xi, xiSide });
    store.saveProfile(data.userId, data.nick, data.team?.id ?? null);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });

  socket.on('lobby:join', () => socket.join('lobby'));
  socket.on('lobby:leave', () => socket.leave('lobby'));

  socket.on('match:join', async (p, ack) => {
    const id = clean(p?.matchId, 40);
    const m = id ? await matches.getMatch(id) : null;
    if (!m) return safeAck(ack)({ ok: false, error: 'Maç bulunamadı.' });
    leaveMatch();
    data.matchId = m.id;
    socket.join(room(m.id));
    matches.watch(m.id);
    store.ensureAutoPolls(m);
    safeAck(ack)({
      ok: true,
      match: m,
      fan: store.state(m.id),
      mine: store.mine(m.id, data.userId),
      chat: store.chatHistory(m.id),
      meta: { formations: FORMATIONS, styles: STYLES },
    });
    io.to(room(m.id)).emit('presence', { matchId: m.id, count: roomSize(m.id) });
    lobbyUpdate();
  });

  function leaveMatch() {
    if (!data.matchId) return;
    const id = data.matchId;
    socket.leave(room(id));
    matches.unwatch(id);
    data.matchId = undefined;
    io.to(room(id)).emit('presence', { matchId: id, count: roomSize(id) });
    lobbyUpdate();
  }
  socket.on('match:leave', leaveMatch);
  socket.on('disconnect', leaveMatch);

  // --- sohbet
  socket.on('chat:send', async (p, ack) => {
    const a = safeAck(ack);
    const text = clean(p?.text, 280);
    if (!text) return a({ ok: false, error: 'Boş mesaj gönderilemez.' });
    if (!data.matchId) return a({ ok: false, error: 'Önce bir maç odasına katıl.' });
    if (!chatLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı yazıyorsun, birkaç saniye bekle.' });
    const msg = store.addChat(data.matchId, data.userId, data.nick, text, 'user', data.team);
    io.to(room(data.matchId)).emit('chat:message', msg);
    a({ ok: true });
  });

  // --- oyuncu puanı (0-10)
  socket.on('rating:set', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (m.status === 'SCHEDULED' || m.status === 'POSTPONED') return a({ ok: false, error: 'Puanlama maç başlayınca açılır.' });
    const score = Number(p?.score);
    if (!Number.isInteger(score) || score < 0 || score > 10) return a({ ok: false, error: 'Puan 0-10 arasında olmalı.' });
    const player = allPlayers(m).find((x) => x.id === String(p?.playerId));
    if (!player) return a({ ok: false, error: 'Oyuncu bulunamadı.' });
    store.rate(m.id, player.id, data.userId, score);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });

  // --- anketler
  socket.on('poll:vote', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const poll = store.poll(Number(p?.pollId));
    const idx = Number(p?.option);
    if (!poll || poll.matchId !== m.id) return a({ ok: false, error: 'Anket bulunamadı.' });
    if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) return a({ ok: false, error: 'Geçersiz seçenek.' });
    store.vote(poll.id, data.userId, idx);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });

  socket.on('poll:create', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const question = clean(p?.question, 120);
    const options = (Array.isArray(p?.options) ? p.options : []).map((o: unknown) => clean(o, 40)).filter(Boolean);
    if (question.length < 5) return a({ ok: false, error: 'Soru en az 5 karakter olmalı.' });
    if (options.length < 2 || options.length > 4) return a({ ok: false, error: '2 ile 4 arasında seçenek gir.' });
    if (new Set(options.map((o: string) => o.toLocaleLowerCase('tr'))).size !== options.length) return a({ ok: false, error: 'Seçenekler farklı olmalı.' });
    if (store.userPollCount(m.id, data.userId) >= 3) return a({ ok: false, error: 'Bir maçta en fazla 3 anket açabilirsin.' });
    store.createPoll(m.id, data.userId, data.nick, question, options);
    broadcastFan(m.id);
    a({ ok: true });
  });

  // --- taktik önerisi
  socket.on('tactic:submit', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (!isSide(p?.side)) return a({ ok: false, error: 'Takım seç.' });
    if (!FORMATIONS.includes(p?.formation)) return a({ ok: false, error: 'Geçersiz diziliş.' });
    if (!STYLES.includes(p?.style)) return a({ ok: false, error: 'Geçersiz oyun anlayışı.' });
    const note = clean(p?.note, 200);
    store.submitTactic(m.id, p.side, data.userId, data.nick, p.formation, p.style, note);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });

  socket.on('tactic:like', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const t = store.tactic(Number(p?.id));
    if (!t || t.matchId !== m.id) return a({ ok: false, error: 'Öneri bulunamadı.' });
    store.toggleTacticLike(Number(p.id), data.userId);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });

  // --- oyuncu değişikliği talebi
  socket.on('sub:request', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (m.status !== 'LIVE' && m.status !== 'HT') return a({ ok: false, error: 'Değişiklik talebi yalnızca maç oynanırken yapılabilir.' });
    if (!isSide(p?.side) || !m.lineups) return a({ ok: false, error: 'Takım seç.' });
    const pitch = onPitch(m, p.side);
    const players = allPlayers(m, p.side);
    const out = players.find((x) => x.id === String(p?.outId));
    const inn = players.find((x) => x.id === String(p?.inId));
    if (!out || !pitch.has(out.id)) return a({ ok: false, error: 'Çıkacak oyuncu sahada değil.' });
    const usedOut = new Set(m.events.filter((e) => e.side === p.side && (e.type === 'sub' || e.type === 'red')).map((e) => e.playerId));
    if (!inn || pitch.has(inn.id) || usedOut.has(inn.id)) return a({ ok: false, error: 'Girecek oyuncu yedeklerde olmalı.' });
    const id = store.requestSub(m.id, p.side, out, inn, data.userId, data.nick);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true, id });
  });

  socket.on('sub:vote', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const r = store.subRequest(Number(p?.id));
    if (!r || r.matchId !== m.id) return a({ ok: false, error: 'Talep bulunamadı.' });
    store.toggleSubVote(Number(p.id), data.userId);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });
});

// ------------------------------------------------------------------ canlı güncellemeler

matches.on('list', lobbyUpdate);

// ------------------------------------------------------------------ takımlar ve tahmin puanlama

store.upsertTeams(DEMO_TEAMS);
matches.on('list', (list: { status: string; home: TeamBadge; away: TeamBadge; id: string }[]) => {
  store.upsertTeams(list.flatMap((m) => [m.home, m.away]).map(({ id, name, short, logo, color }) => ({ id, name, short, logo, color })));
  scorePending(list);
});

/** Bitmiş maçların tahminlerini puanla ve odadakilere kendi sonuçlarını gönder (tekrar çağrılması güvenli) */
async function scoreMatch(m: Match) {
  const users = new Set(store.scorePredictions(m));
  if (!users.size) return;
  console.log(`[tahmin] ${m.home.name} - ${m.away.name}: ${users.size} tahmin puanlandı`);
  broadcastFan(m.id);
  for (const s of await io.in(room(m.id)).fetchSockets()) {
    const uid = (s.data as SocketData | undefined)?.userId;
    if (uid && users.has(uid)) s.emit('fan:mine', { matchId: m.id, ...store.mine(m.id, uid) });
  }
}
const scoreTried = new Map<string, number>();
/** Durum değişimi kaçırılsa bile (ör. yeniden başlatma) listede bitmiş görünen maçları puanla */
function scorePending(list: { id: string; status: string }[]) {
  const pending = new Set(store.unscoredMatchIds());
  for (const m of list) {
    if (m.status !== 'FT' || !pending.has(m.id) || Date.now() - (scoreTried.get(m.id) ?? 0) < 10 * 60_000) continue;
    scoreTried.set(m.id, Date.now());
    matches.getMatch(m.id).then((full) => full && scoreMatch(full)).catch((e) => console.error('[tahmin] puanlama hatası', e));
  }
}
matches.on('match', (m: Match) => io.to(room(m.id)).emit('match', m));

const EVENT_TEXT: Partial<Record<MatchEvent['type'], (e: MatchEvent, team: string) => string>> = {
  goal: (e, t) => `⚽ GOL! ${t} — ${e.player ?? ''}${e.related ? ` (asist: ${e.related})` : ''}`,
  penalty: (e, t) => `⚽ PENALTI GOLÜ! ${t} — ${e.player ?? ''}`,
  own_goal: (e, t) => `⚽ Kendi kalesine gol: ${e.player ?? ''} (${t} lehine)`,
  missed_penalty: (e, t) => `❌ ${t} penaltıdan yararlanamadı — ${e.player ?? ''}`,
  red: (e, t) => `🟥 Kırmızı kart: ${e.player ?? ''} (${t})`,
  sub: (e, t) => `🔁 ${t} değişikliği: ↑ ${e.related ?? ''} ↓ ${e.player ?? ''}`,
};

matches.on('events', (matchId: string, fresh: MatchEvent[], m: Match) => {
  for (const e of fresh) {
    const fmt = EVENT_TEXT[e.type];
    if (!fmt) continue;
    const msg = store.addChat(matchId, null, 'Safskor', fmt(e, e.side === 'home' ? m.home.name : m.away.name), 'system');
    io.to(room(matchId)).emit('chat:message', msg);
  }
});

matches.on('status', (m: Match) => {
  if (m.status === 'FT') scoreMatch(m).catch((e) => console.error('[tahmin] puanlama hatası', e));
  const text =
    m.status === 'LIVE' && m.minute != null && m.minute <= 1 ? '🟢 Maç başladı! İyi seyirler.'
    : m.status === 'HT' ? `⏸️ İlk yarı sona erdi: ${m.home.short} ${m.score.home}-${m.score.away} ${m.away.short}`
    : m.status === 'LIVE' ? '▶️ İkinci yarı başladı.'
    : m.status === 'FT' ? `🏁 Maç sona erdi: ${m.home.name} ${m.score.home}-${m.score.away} ${m.away.name}. Oyuncuları puanlamayı unutma!`
    : null;
  if (!text) return;
  const msg = store.addChat(m.id, null, 'Safskor', text, 'system');
  io.to(room(m.id)).emit('chat:message', msg);
});

await matches.start();
server.listen(config.port, () => {
  console.log(`Safskor http://localhost:${config.port} adresinde çalışıyor (sağlayıcı: ${matches.providerInfo.name}${matches.providerInfo.demo ? ', demo' : ''})`);
});
