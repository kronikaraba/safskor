import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { config } from './config.js';
import { createProvider } from './providers/index.js';
import { FanStore, FORMATIONS, STYLES, weekKey, normalizePhone, weakPin, rankOf, rankAtLeast, type TeamBadge } from './services/fanStore.js';
import { MatchService } from './services/matchService.js';
import type { Match, MatchEvent, Player, Side } from './types.js';
import { PAGES, matchPage, matchPath, renderPage, robotsTxt, sitemapXml, standingsPage, unknownMatchPage, type Page } from './seo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provider = createProvider();
const matches = new MatchService(provider, config.focus);
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
app.get('/api/matches', (_req, res) => res.json({ provider: matches.providerInfo, matches: withViewers(), clubs: clubsPayload(), tomorrow: matches.getTomorrow(), yesterday: matches.getYesterday() }));
app.get('/api/standings', (_req, res) => res.json({ standings: matches.getStandings() }));
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
/** Favori takım olarak seçilebilen takımlar (API-Football kimlikleri ve armaları) */
const PICKABLE_TEAMS: TeamBadge[] = [
  { id: '611', name: 'Fenerbahçe', short: 'FB', logo: 'https://media.api-sports.io/football/teams/611.png', color: '#f5d10b' },
  { id: '645', name: 'Galatasaray', short: 'GS', logo: 'https://media.api-sports.io/football/teams/645.png', color: '#a90432' },
  { id: '549', name: 'Beşiktaş', short: 'BJK', logo: 'https://media.api-sports.io/football/teams/549.png', color: '#e5e5e5' },
  { id: '998', name: 'Trabzonspor', short: 'TS', logo: 'https://media.api-sports.io/football/teams/998.png', color: '#7a1e3a' },
];
const pickable = new Map(PICKABLE_TEAMS.map((t) => [t.id, t]));
store.upsertTeams(PICKABLE_TEAMS);
store.keepProfileTeams([...pickable.keys()]);

app.get('/api/teams', (_req, res) => res.json(PICKABLE_TEAMS));

/** Lobide hep görünen Büyük 4 (Bat'ın sırası); ids: demo verisindeki karşılıkları da eşleşsin */
const BIG4 = [
  ['611', 'fb'],
  ['645', 'gs'],
  ['549', 'bjk'],
  ['998', 'ts'],
] as const;
const clubsPayload = () =>
  BIG4.map(([id, demo]) => ({ ...pickable.get(id)!, ids: [id, demo], ...(matches.clubFixtures(id) ?? { next: null, last: null }) }));

// Paylaşım kartı tuvale arma ve oyuncu/teknik direktör fotoğrafı çizebilsin diye API-Football görsellerini aynı kökenden sun (yalnızca media.api-sports.io)
const crestCache = new Map<string, { type: string; body: Buffer }>();
app.get('/img/crest/:kind/:file', async (req, res) => {
  const { kind, file } = req.params;
  if (!/^(teams|leagues|players|coachs)$/.test(kind) || !/^\d{1,9}\.png$/.test(file)) return res.status(404).end();
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
// ------------------------------------------------------------------ SEO: sayfa adresleri, site haritası
// Her adres aynı uygulamayı açar; sunucu yalnızca <head>'deki başlık/açıklama/kanonik etiketleri o sayfaya göre yazar.
const template = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
function sendPage(res: express.Response, page: Page) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(renderPage(template, page));
}
app.get('/', (_req, res) => sendPage(res, PAGES['/']));
app.get('/yarin', (_req, res) => sendPage(res, PAGES['/yarin']));
app.get('/dun', (_req, res) => sendPage(res, PAGES['/dun']));
app.get('/siralama', (_req, res) => sendPage(res, PAGES['/siralama']));
app.get('/puan-durumu', (_req, res) => sendPage(res, standingsPage(matches.getStandings())));
app.get(['/mac/:id', '/mac/:id/:slug'], (req, res) => {
  const id = String(req.params.id).slice(0, 40);
  const m = matches.peek(id);
  if (!m) return sendPage(res, unknownMatchPage(req.path));
  // takım adları adreste: /mac/123/galatasaray-fenerbahce (yanlış ya da eksikse doğrusuna yönlendir)
  const canonical = matchPath(m);
  // sorgu (ör. davet kodu ?ref=) yönlendirmede kaybolmasın
  if (req.path !== canonical) return res.redirect(301, canonical + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
  sendPage(res, matchPage(m));
});
// Android uygulaması (TWA) bu alan adının kendisine ait olduğunu bu dosyayla kanıtlar; yoksa üstte adres çubuğu görünür.
// Parmak izleri: yükleme anahtarı ve Play Console > Uygulama imzalama anahtarı (ANDROID_CERT_SHA256, virgülle ayrılmış)
const ANDROID_PACKAGE = 'com.safskor.app';
const ANDROID_CERTS: string[] = [];
app.get('/.well-known/assetlinks.json', (_req, res) => {
  const certs = [...ANDROID_CERTS, ...(process.env.ANDROID_CERT_SHA256 ?? '').split(',')].map((s) => s.trim().toUpperCase()).filter(Boolean);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(certs.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: certs } }] : []);
});
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(robotsTxt()));
app.get('/sitemap.xml', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('application/xml').send(sitemapXml(matches.knownMatches()));
});

app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
const io = new Server(server, { serveClient: false, maxHttpBufferSize: 16_000 });

const room = (id: string) => `match:${id}`;
const userRoom = (userId: string) => `user:${userId}`;
let lobbyTimer: NodeJS.Timeout | undefined;
/** Odalardaki taraftar sayısı değişince lobiyi (en fazla saniyede bir) güncelle */
function lobbyUpdate() {
  lobbyTimer ??= setTimeout(() => {
    lobbyTimer = undefined;
    io.to('lobby').emit('matches', { provider: matches.providerInfo, matches: withViewers(), clubs: clubsPayload() });
  }, 1000);
}
/** Büyük 4'ten biri canlı oynarken odadaki taraftar sayısı bu sayıdan başlar, gerçek girenler üstüne eklenir (Bat'ın isteği) */
const BIG4_BASE = 35;
const BIG4_IDS = new Set<string>(BIG4.flat());
function roomSize(id: string) {
  const real = io.sockets.adapter.rooms.get(room(id))?.size ?? 0;
  const m = matches.peek(id);
  const big4Live = !!m && (m.status === 'LIVE' || m.status === 'HT') && (BIG4_IDS.has(m.home.id) || BIG4_IDS.has(m.away.id));
  return big4Live ? BIG4_BASE + real : real;
}

// ------------------------------------------------------------------ yardımcılar

const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const isUserId = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(s);
const isSide = (s: unknown): s is Side => s === 'home' || s === 'away';

/** Mesajın yazıldığı andaki maç dakikası; önbellekteki listeden okunur (API isteği yok) */
function matchMinute(id: string): string | null {
  const m = matches.getList().find((x) => x.id === id);
  if (!m) return null;
  if (m.status === 'LIVE') return m.minute != null ? `${m.minute}${m.extra ? '+' + m.extra : ''}'` : 'Canlı';
  if (m.status === 'HT') return 'İY';
  if (m.status === 'FT') return 'MS';
  if (m.status === 'POSTPONED') return 'Ert.';
  return 'Maç öncesi';
}

/** Teknik direktör puan/yorum kimliği: 'coach:home' ya da 'coach:away' (kadroda TD adı varsa) */
function isCoach(m: Match, id: string) {
  const k = /^coach:(home|away)$/.exec(id);
  return !!(k && m.lineups?.[k[1] as Side].coach);
}

function allPlayers(m: Match, side?: Side): Player[] {
  if (!m.lineups) return [];
  const sides: Side[] = side ? [side] : ['home', 'away'];
  return sides.flatMap((s) => [...m.lineups![s].startXI, ...m.lineups![s].subs]);
}

/** Maçta oynamış oyuncu: ilk 11 ya da oyuna giren yedek (değişiklik olayında giren/çıkan sırası sağlayıcıya göre değişebilir) */
function hasPlayed(m: Match, id: string): boolean {
  if (!m.lineups) return false;
  return (['home', 'away'] as Side[]).some((side) => {
    const l = m.lineups![side];
    if (l.startXI.some((p) => p.id === id)) return true;
    const sub = l.subs.find((p) => p.id === id);
    return Boolean(sub && ((sub.stats?.minutes ?? 0) > 0 || m.events.some((e) => e.side === side && e.type === 'sub' && (e.playerId === id || e.relatedId === id))));
  });
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
  /** Kaydetmeden sınıra ulaşıldı mı (yalnızca hatalı denemeleri saymak için) */
  full(key: string) {
    const now = Date.now();
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length >= this.max;
  }
}
const chatLimit = new Limiter(5, 10_000);
const actionLimit = new Limiter(30, 10_000);
const loginFails = new Limiter(20, 10 * 60_000); // IP başına hatalı giriş/kayıt denemesi (başarılılar sayılmaz)

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
  /** girdiği özel oda kodu */
  roomCode?: string;
  session?: string | null; // hesaba giriş yapılmış cihazın oturum anahtarı
}

/** Sunucu yeniden başlayınca veriler sıfırlanabilir: profil yoksa istemcinin bildirdiği (doğrulanmış) takımı kullan */
function restoreTeam(userId: string, claimed: unknown): TeamBadge | null {
  const saved = store.profile(userId);
  if (saved) return saved.team ? (pickable.get(saved.team.id) ?? null) : null;
  return typeof claimed === 'string' ? (pickable.get(claimed) ?? null) : null;
}

// Hesaba bağlı bir kimlik yalnızca o cihaza verilmiş oturum anahtarıyla açılır: eski, sızmış ya da çıkış yapılmış
// bir tarayıcı kimliği hesaba erişemez. İstemci "session_expired" alınca yeni bir anonim kimlikle bağlanır.
io.use((socket, next) => {
  const auth = socket.handshake.auth ?? {};
  if (auth.session != null && auth.session !== '') {
    const userId = typeof auth.session === 'string' ? store.sessionUser(auth.session) : null;
    if (!userId) return next(new Error('session_expired'));
    socket.data = { sessionUserId: userId };
    return next();
  }
  if (isUserId(auth.userId) && store.hasAccount(auth.userId)) return next(new Error('session_expired'));
  next();
});

/** Kapatılan oturumlarla bağlı sekmeleri hemen düşürür; yeniden bağlanırken oturumları geçersiz çıkar */
async function kickOtherSessions(userId: string, keep: string | null) {
  for (const s of await io.in(userRoom(userId)).fetchSockets()) {
    if ((s.data as SocketData).session !== keep) s.disconnect(true);
  }
}

const durationText = (ms: number) => (ms < 3_600_000 ? `${Math.ceil(ms / 60_000)} dakika` : `${Math.ceil(ms / 3_600_000)} saat`);
/** Girişte eski 4-5 haneli şifreler de kabul edilir; yeni şifreler 6 haneli ve kolay tahmin edilemez olmalı */
const pinFormat = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,6}$/.test(pin);
const newPinError = (pin: unknown, phone: string) =>
  typeof pin !== 'string' || !/^\d{6}$/.test(pin)
    ? 'Şifre 6 haneli bir sayı olmalı.'
    : weakPin(pin, phone)
      ? 'Bu şifre kolay tahmin edilir (ör. 123456, 112233 ya da numarandaki rakamlar). Başka bir şifre seç.'
      : null;

/** maç sohbetinde sabitlenen mesaj (maç başına bir tane, bellekte) */
const pins = new Map<string, unknown>();
/** özel odanın soket odası */
const fanRoom = (matchId: string, code: string) => `fr:${matchId}#${code}`;

io.on('connection', (socket: Socket) => {
  const auth = socket.handshake.auth ?? {};
  const sessionUserId: string | undefined = socket.data?.sessionUserId;
  const data: SocketData = {
    userId: sessionUserId ?? (isUserId(auth.userId) ? auth.userId : `anon-${socket.id}`),
    nick: clean(auth.nick, 20) || 'Taraftar',
    team: null,
    session: sessionUserId ? auth.session : null,
  };
  data.team = sessionUserId || isUserId(auth.userId) ? restoreTeam(data.userId, auth.teamId) : null;
  socket.data = data;
  const canDm = isUserId(data.userId);
  if (canDm) {
    store.touchUser(data.userId, data.nick, data.team?.id ?? null);
    socket.join(userRoom(data.userId)); // özel mesajlar kullanıcının açık tüm sekmelerine gider
  }
  socket.emit('hello', { provider: matches.providerInfo, matches: withViewers(), clubs: clubsPayload(), tomorrow: matches.getTomorrow(), yesterday: matches.getYesterday(), ranks: store.rankMap() });
  // tarayıcıdaki favori takım sunucudakiyle eşleşsin (ör. listeden kaldırılmış eski bir takım); uid: herkese açık kimlik
  socket.emit('profile', {
    team: data.team,
    uid: store.pubId(data.userId),
    account: canDm ? store.account(data.userId) : null,
    // davet bağlantısı kodu ve bu bağlantıyla üye olanların sayısı
    ref: canDm ? store.refCode(data.userId) : null,
    invites: canDm ? store.inviteCount(data.userId) : 0,
  });
  if (canDm) socket.emit('dm:unread', { count: store.dmUnread(data.userId) });

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
      team = pickable.get(clean(p.teamId, 40)) ?? null;
      if (!team) return a({ ok: false, error: 'Takım bulunamadı.' });
    }
    data.nick = nick;
    data.team = team;
    if (isUserId(data.userId)) {
      store.saveProfile(data.userId, nick, team?.id ?? null);
      store.touchUser(data.userId, nick, team?.id ?? null);
      store.renameAccount(data.userId, nick);
    }
    a({ ok: true, nick, team });
  });

  // --- üyelik: telefon + isim + şifre (SMS doğrulaması henüz yok; gelince şifrenin yerine kod gelecek)
  // Hatalı denemeler istemcinin IP'sine sayılır. Hangi başlığın gerçek IP olduğu barındırmaya göre değiştiği için
  // hepsine sayılır ve biri sınırı aşınca durdurulur; asıl koruma numara başına kilittir.
  const h = socket.handshake.headers;
  const ipKeys = [String(h['x-forwarded-for'] ?? '').split(',')[0], h['true-client-ip'], h['cf-connecting-ip']].map((v) => String(v ?? '').trim()).filter(Boolean);
  const failKeys = ipKeys.length ? [...new Set(ipKeys)] : [socket.handshake.address];
  const tooManyFails = () => failKeys.some((k) => loginFails.full(k));
  const countFail = () => failKeys.forEach((k) => loginFails.ok(k));
  const TOO_MANY = 'Çok fazla hatalı deneme. Birkaç dakika sonra tekrar dene.';
  const lockedText = (ms: number) => `Çok fazla hatalı deneme. Bu hesap ${durationText(ms)} kilitlendi.`;

  socket.on('account:register', (p, ack) => {
    const a = safeAck(ack);
    if (!isUserId(data.userId)) return a({ ok: false, error: 'Tarayıcı kimliği bulunamadı, sayfayı yenile.' });
    if (tooManyFails()) return a({ ok: false, error: TOO_MANY });
    const phone = normalizePhone(p?.phone);
    if (!phone) return a({ ok: false, error: 'Geçerli bir cep numarası yaz (ör. 0532 123 45 67).' });
    const name = clean(p?.name, 20);
    if (name.length < 2) return a({ ok: false, error: 'İsim en az 2 karakter olmalı.' });
    const pinError = newPinError(p?.pin, phone);
    if (pinError) return a({ ok: false, error: pinError });
    const r = store.register(data.userId, phone, name, p.pin);
    if (r === 'phone_taken') return countFail(), a({ ok: false, error: 'Bu numarayla zaten üyelik var. Giriş yap.' });
    if (r === 'has_account') return a({ ok: false, error: 'Bu tarayıcı zaten bir hesaba bağlı.' });
    // bundan sonra bu kimlik yalnızca oturum anahtarıyla açılır
    data.session = store.createSession(data.userId);
    data.nick = name;
    store.saveProfile(data.userId, name, data.team?.id ?? null);
    store.touchUser(data.userId, name, data.team?.id ?? null);
    // davet bağlantısıyla geldiyse davet edene yazılır; rütbesi değişince herkesin sohbetinde yeni rütbesi görünür
    const ref = clean(p?.ref, 12).toLowerCase();
    const credit = /^[a-z0-9]{4,12}$/.test(ref) ? store.creditReferral(data.userId, ref) : null;
    if (credit) {
      io.to(userRoom(credit.referrerId)).emit('invites', { count: credit.count });
      if (rankOf(credit.count) !== rankOf(credit.count - 1)) io.emit('ranks', store.rankMap());
    }
    a({ ok: true, nick: name, session: data.session, account: store.account(data.userId) });
  });

  socket.on('account:login', (p, ack) => {
    const a = safeAck(ack);
    if (tooManyFails()) return a({ ok: false, error: TOO_MANY });
    const phone = normalizePhone(p?.phone);
    if (!phone || !pinFormat(p?.pin)) return a({ ok: false, error: 'Numara ya da şifre hatalı.' });
    const r = store.login(phone, p.pin);
    if (r === 'wrong' || 'lockedMs' in r) {
      countFail();
      return a({ ok: false, error: r === 'wrong' ? 'Numara ya da şifre hatalı.' : lockedText(r.lockedMs) });
    }
    if (data.session) store.deleteSession(data.session); // bu cihaz başka bir hesaba geçiyor
    // hesabın kendi kimliği istemciye hiç gitmez; cihaz yalnızca kendine ait, kapatılabilir bir oturum anahtarı alır
    const session = store.createSession(r.userId);
    const prof = store.profile(r.userId);
    a({ ok: true, session, nick: prof?.nick ?? r.name, team: prof?.team ?? null });
  });

  socket.on('account:logout', (_p, ack) => {
    if (data.session) store.deleteSession(data.session);
    data.session = null;
    safeAck(ack)({ ok: true });
  });

  socket.on('account:logout-others', async (_p, ack) => {
    const a = safeAck(ack);
    if (!data.session || !store.hasAccount(data.userId)) return a({ ok: false, error: 'Bunun için giriş yapmış olmalısın.' });
    store.deleteOtherSessions(data.userId, data.session);
    await kickOtherSessions(data.userId, data.session);
    a({ ok: true, account: store.account(data.userId) });
  });

  socket.on('account:pin', async (p, ack) => {
    const a = safeAck(ack);
    const phone = data.session ? store.accountPhone(data.userId) : null;
    if (!phone) return a({ ok: false, error: 'Bunun için giriş yapmış olmalısın.' });
    if (tooManyFails()) return a({ ok: false, error: TOO_MANY });
    if (!pinFormat(p?.old)) return a({ ok: false, error: 'Mevcut şifren hatalı.' });
    const pinError = newPinError(p?.pin, phone);
    if (pinError) return a({ ok: false, error: pinError });
    if (p.pin === p.old) return a({ ok: false, error: 'Yeni şifre eskisiyle aynı olamaz.' });
    const r = store.changePin(data.userId, p.old, p.pin);
    if (r === 'no_account') return a({ ok: false, error: 'Bunun için giriş yapmış olmalısın.' });
    if (r === 'wrong' || typeof r === 'object') {
      countFail();
      return a({ ok: false, error: r === 'wrong' ? 'Mevcut şifren hatalı.' : lockedText(r.lockedMs) });
    }
    // şifre değişince diğer cihazlar kapanır: şifreyi öğrenen ya da başka cihazda açık kalan oturum dışarıda kalır
    store.deleteOtherSessions(data.userId, data.session ?? null);
    await kickOtherSessions(data.userId, data.session ?? null);
    a({ ok: true, account: store.account(data.userId) });
  });

  socket.on('teams:list', (_p, ack) => safeAck(ack)({ ok: true, teams: PICKABLE_TEAMS }));
  socket.on('standings:get', (_p, ack) => safeAck(ack)({ ok: true, standings: matches.getStandings() }));

  // --- takım profili: yalnızca sitede görünen takımlar (rastgele kimliklerle API kotası harcanmasın)
  socket.on('team:get', async (p, ack) => {
    const reply = safeAck(ack);
    const id = typeof p?.teamId === 'string' ? p.teamId.slice(0, 40) : '';
    if (!id || !matches.knowsTeam(id)) return reply({ ok: false, error: 'Takım bulunamadı' });
    if (!actionLimit.ok(data.userId)) return reply({ ok: false, error: 'Çok hızlı! Biraz yavaşla.' });
    const profile = await matches.teamProfile(id).catch(() => null);
    reply(profile ? { ok: true, profile } : { ok: false, error: 'Takım bilgisi şu an alınamıyor' });
  });

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
      chatLiked: store.chatLiked(m.id, data.userId),
      pinned: pins.get(m.id) ?? null,
      meta: { formations: FORMATIONS, styles: STYLES },
    });
    io.to(room(m.id)).emit('presence', { matchId: m.id, count: roomSize(m.id) });
    lobbyUpdate();
  });

  function leaveRoom() {
    if (data.roomCode && data.matchId) socket.leave(fanRoom(data.matchId, data.roomCode));
    data.roomCode = undefined;
  }
  function leaveMatch() {
    if (!data.matchId) return;
    const id = data.matchId;
    leaveRoom();
    socket.leave(room(id));
    matches.unwatch(id);
    data.matchId = undefined;
    io.to(room(id)).emit('presence', { matchId: id, count: roomSize(id) });
    lobbyUpdate();
  }
  socket.on('match:leave', leaveMatch);
  socket.on('disconnect', leaveMatch);

  // --- özel oda (Tribün Lideri açar, bağlantısı olan herkes girer)
  socket.on('room:create', async (_p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (!rankAtLeast(store.rank(data.userId), 'lider')) return a({ ok: false, error: 'Özel oda açmak için Tribün Lideri olmalısın.' });
    a({ ok: true, code: store.openRoom(m.id, data.userId) });
  });
  socket.on('room:join', (p, ack) => {
    const a = safeAck(ack);
    if (!data.matchId) return a({ ok: false, error: 'Önce maç odasına katıl.' });
    const r = store.room(clean(p?.code, 12).toLowerCase());
    if (!r || r.matchId !== data.matchId) return a({ ok: false, error: 'Özel oda bulunamadı.' });
    leaveRoom();
    data.roomCode = r.code;
    socket.join(fanRoom(r.matchId, r.code));
    a({ ok: true, room: { code: r.code, owner: r.owner, mine: r.ownerId === data.userId }, chat: store.chatHistory(`${r.matchId}#${r.code}`) });
  });
  socket.on('room:leave', () => leaveRoom());

  // --- sabit mesaj (Efsane): maç sohbetinin üstünde herkese görünür
  socket.on('chat:pin', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (!rankAtLeast(store.rank(data.userId), 'efsane')) return a({ ok: false, error: 'Mesaj sabitlemek için Efsane olmalısın.' });
    if (p?.id == null) pins.delete(m.id);
    else {
      const msg = store.chatReply(m.id, Number(p.id));
      if (!msg) return a({ ok: false, error: 'Mesaj bulunamadı.' });
      pins.set(m.id, { ...msg, by: data.nick });
    }
    io.to(room(m.id)).emit('chat:pinned', { matchId: m.id, pin: pins.get(m.id) ?? null });
    a({ ok: true });
  });

  // --- sohbet
  socket.on('chat:send', async (p, ack) => {
    const a = safeAck(ack);
    const text = clean(p?.text, 280);
    if (!text) return a({ ok: false, error: 'Boş mesaj gönderilemez.' });
    if (!data.matchId) return a({ ok: false, error: 'Önce bir maç odasına katıl.' });
    // özel oda mesajı: yalnızca odadakilere gider, odanın kendi geçmişinde saklanır
    if (p?.room != null) {
      if (!data.roomCode || p.room !== data.roomCode) return a({ ok: false, error: 'Bu odada değilsin.' });
      if (!chatLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı yazıyorsun, birkaç saniye bekle.' });
      const key = `${data.matchId}#${data.roomCode}`;
      io.to(fanRoom(data.matchId, data.roomCode)).emit('chat:message', store.addChat(key, data.userId, data.nick, text, 'user', data.team, matchMinute(data.matchId), null));
      return a({ ok: true });
    }
    const replyId = Number(p?.replyTo);
    const reply = Number.isInteger(replyId) && replyId > 0 ? store.chatReply(data.matchId, replyId) : null;
    if (p?.replyTo != null && !reply) return a({ ok: false, error: 'Yanıtladığın mesaj bulunamadı.' });
    if (!chatLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı yazıyorsun, birkaç saniye bekle.' });
    const minute = matchMinute(data.matchId);
    const msg = store.addChat(data.matchId, data.userId, data.nick, text, 'user', data.team, minute, reply);
    io.to(room(data.matchId)).emit('chat:message', msg);
    // maç olayına verilen yanıt, Özet'te o olayın yorumlarında da görünsün
    const ref = reply ? store.chatRef(reply.id) : null;
    if (ref) {
      const comment = store.addComment(data.matchId, `e:${ref}`, data.userId, data.nick, data.team, text.slice(0, 200), minute);
      io.to(room(data.matchId)).emit('comment:new', comment);
      broadcastFan(data.matchId);
    }
    a({ ok: true });
  });

  // --- sohbet mesajı beğenme (kendi mesajını beğenemezsin)
  socket.on('chat:like', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const id = Number(p?.id);
    const msg = Number.isInteger(id) ? store.chatMessage(id) : null;
    if (!msg || msg.matchId !== m.id || msg.kind !== 'user') return a({ ok: false, error: 'Mesaj bulunamadı.' });
    if (msg.userId === data.userId) return a({ ok: false, error: 'Kendi mesajını beğenemezsin.' });
    const r = store.toggleChatLike(id, data.userId);
    io.to(room(m.id)).emit('chat:likes', { matchId: m.id, id, likes: r.likes });
    a({ ok: true, ...r });
  });

  // --- özel mesajlar (DM)
  /** Karşı tarafı herkese açık kimliğiyle bulur; DM için ortak kontroller */
  function dmPeer(a: Ack, uid: unknown) {
    if (!canDm) return a({ ok: false, error: 'Özel mesaj için tarayıcı kimliği gerekli.' }), null;
    if (!actionLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı! Biraz yavaşla.' }), null;
    const peer = typeof uid === 'string' ? store.userByPub(clean(uid, 40)) : null;
    if (!peer) return a({ ok: false, error: 'Kullanıcı bulunamadı.' }), null;
    if (peer.userId === data.userId) return a({ ok: false, error: 'Kendine mesaj gönderemezsin.' }), null;
    return peer;
  }
  const publicPeer = (peer: { uid: string; nick: string; team: TeamBadge | null; userId: string }) => ({
    uid: peer.uid, nick: peer.nick, team: peer.team, blocked: store.dmBlocked(data.userId, peer.userId),
  });

  socket.on('dm:send', (p, ack) => {
    const a = safeAck(ack);
    const peer = dmPeer(a, p?.to);
    if (!peer) return;
    const text = clean(p?.text, 500);
    if (!text) return a({ ok: false, error: 'Boş mesaj gönderilemez.' });
    if (store.dmBlocked(data.userId, peer.userId)) return a({ ok: false, error: 'Bu kullanıcıyı engelledin. Mesaj göndermek için engeli kaldır.' });
    if (store.dmBlocked(peer.userId, data.userId)) return a({ ok: false, error: 'Bu kullanıcıya mesaj gönderilemiyor.' });
    if (!chatLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı yazıyorsun, birkaç saniye bekle.' });
    const msg = store.addDm(data.userId, peer.userId, text);
    const sender = { uid: store.pubId(data.userId), nick: data.nick, team: data.team };
    io.to(userRoom(peer.userId)).emit('dm:new', { message: msg, peer: sender });
    socket.to(userRoom(data.userId)).emit('dm:new', { message: msg, peer: publicPeer(peer) }); // gönderenin diğer sekmeleri
    io.to(userRoom(peer.userId)).emit('dm:unread', { count: store.dmUnread(peer.userId) });
    a({ ok: true, message: msg });
  });

  socket.on('dm:threads', (_p, ack) => {
    const a = safeAck(ack);
    if (!canDm) return a({ ok: true, threads: [] });
    a({ ok: true, threads: store.dmThreads(data.userId) });
  });

  /** Bir kişiyle konuşmayı açar ve okundu işaretler */
  socket.on('dm:history', (p, ack) => {
    const a = safeAck(ack);
    const peer = dmPeer(a, p?.with);
    if (!peer) return;
    store.markDmRead(data.userId, peer.userId);
    io.to(userRoom(data.userId)).emit('dm:unread', { count: store.dmUnread(data.userId) });
    a({ ok: true, peer: publicPeer(peer), messages: store.dmHistory(data.userId, peer.userId) });
  });

  socket.on('dm:read', (p, ack) => {
    const a = safeAck(ack);
    const peer = dmPeer(a, p?.with);
    if (!peer) return;
    store.markDmRead(data.userId, peer.userId);
    io.to(userRoom(data.userId)).emit('dm:unread', { count: store.dmUnread(data.userId) });
    a({ ok: true });
  });

  socket.on('dm:block', (p, ack) => {
    const a = safeAck(ack);
    const peer = dmPeer(a, p?.uid);
    if (!peer) return;
    store.setDmBlock(data.userId, peer.userId, !!p?.block);
    a({ ok: true, blocked: !!p?.block });
  });

  // --- maç olaylarına ve oyunculara yorum
  /** 'e:<olayId>' ya da 'p:<oyuncuId>' hedefi bu maçta gerçekten var mı */
  const validTarget = (m: Match, t: unknown): string | null => {
    const target = clean(t, 120);
    const [kind, id] = [target.slice(0, 2), target.slice(2)];
    if (kind === 'e:') return m.events.some((e) => e.id === id) ? target : null;
    if (kind === 'p:') return isCoach(m, id) || allPlayers(m).some((p) => p.id === id) ? target : null;
    return null;
  };
  socket.on('comment:list', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const target = validTarget(m, p?.target);
    if (!target) return a({ ok: false, error: 'Yorum yapılacak olay ya da oyuncu bulunamadı.' });
    a({ ok: true, target, comments: store.comments(m.id, target) });
  });
  socket.on('comment:add', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const target = validTarget(m, p?.target);
    if (!target) return a({ ok: false, error: 'Yorum yapılacak olay ya da oyuncu bulunamadı.' });
    const text = clean(p?.text, 200);
    if (!text) return a({ ok: false, error: 'Boş yorum gönderilemez.' });
    if (!chatLimit.ok(data.userId)) return a({ ok: false, error: 'Çok hızlı yazıyorsun, birkaç saniye bekle.' });
    const comment = store.addComment(m.id, target, data.userId, data.nick, data.team, text, matchMinute(m.id));
    io.to(room(m.id)).emit('comment:new', comment);
    broadcastFan(m.id);
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
    const id = String(p?.playerId);
    if (!isCoach(m, id) && !allPlayers(m).some((x) => x.id === id)) return a({ ok: false, error: 'Oyuncu bulunamadı.' });
    if (!isCoach(m, id) && !hasPlayed(m, id)) return a({ ok: false, error: 'Oyuna girmeyen oyuncu puanlanamaz.' });
    store.rate(m.id, id, data.userId, score);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });

  // --- taraftar kartı: kullanıcının bu maçtaki tüm işlemleri, isimleriyle
  socket.on('card:get', async (_p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const act = store.activity(m.id, data.userId);
    // kartta puan kutuları için: isim, takım, forma numarası ve aynı kökenden fotoğraf
    const people = new Map<string, { name: string; side: Side; number?: number; photo?: string }>();
    for (const side of ['home', 'away'] as Side[]) {
      const l = m.lineups?.[side];
      if (!l) continue;
      for (const p of [...l.startXI, ...l.subs]) people.set(p.id, { name: p.name, side, number: p.number, photo: /^\d+$/.test(p.id) ? `/img/crest/players/${p.id}.png` : undefined });
      const cp = /media(?:-\d+)?\.api-sports\.io\/football\/coachs\/(\d+)\.png$/.exec(l.coachPhoto ?? '');
      if (l.coach) people.set(`coach:${side}`, { name: l.coach, side, photo: cp ? `/img/crest/coachs/${cp[1]}.png` : undefined });
    }
    const events = new Map(m.events.map((e) => [e.id, e]));
    const EV: Partial<Record<MatchEvent['type'], string>> = { goal: 'Gol', penalty: 'Penaltı golü', own_goal: 'Kendi kalesine gol', missed_penalty: 'Kaçan penaltı', yellow: 'Sarı kart', red: 'Kırmızı kart', sub: 'Değişiklik', var: 'VAR' };
    const about = (target: string) => {
      const id = target.slice(2);
      if (target.startsWith('p:')) return people.get(id)?.name ?? 'Oyuncu';
      const e = events.get(id);
      return e ? `${e.minute}' ${EV[e.type] ?? 'Olay'}${e.player ? ` · ${e.player}` : ''}` : 'Maç olayı';
    };
    a({
      ok: true,
      ratings: Object.entries(act.ratings)
        .filter(([id]) => people.has(id))
        .map(([id, score]) => {
          const p = people.get(id)!;
          const t = m[p.side];
          return { name: p.name, score, coach: id.startsWith('coach:'), number: p.number, photo: p.photo, team: t.short, color: t.color };
        })
        .sort((x, y) => y.score - x.score),
      prediction: act.prediction,
      tactics: (['home', 'away'] as Side[]).flatMap((side) => (act.tactics[side] ? [{ team: m[side].short, ...act.tactics[side]! }] : [])),
      subs: act.subs.map((s) => ({ ...s, team: m[s.side].short })),
      polls: act.polls,
      comments: act.comments.map((c) => ({ about: about(c.target), text: c.text })),
      chat: act.chat,
      chatLikes: act.chatLikes,
      tacticLikes: act.tacticLikes.map((t) => ({ ...t, team: m[t.side].short })),
    });
  });

  // --- anketler
  socket.on('poll:vote', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    const poll = store.poll(Number(p?.pollId));
    const idx = Number(p?.option);
    if (!poll || poll.matchId !== m.id) return a({ ok: false, error: 'Anket bulunamadı.' });
    // sonuç belli olunca "kim kazanır" oylaması kapanır (hakem anketi maç sonunda da açık)
    if (poll.key === 'winner' && m.status === 'FT') return a({ ok: false, error: 'Maç bitti; bu anket kapandı.' });
    if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) return a({ ok: false, error: 'Geçersiz seçenek.' });
    store.vote(poll.id, data.userId, idx);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });


  // --- taktik önerisi
  socket.on('tactic:submit', async (p, ack) => {
    const a = safeAck(ack);
    const m = await context(a);
    if (!m) return;
    if (m.status === 'FT') return a({ ok: false, error: 'Maç bitti; taktik önerileri kapandı.' });
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
    if (m.status === 'FT') return a({ ok: false, error: 'Maç bitti; talepler arşivlendi.' });
    store.toggleSubVote(Number(p.id), data.userId);
    broadcastFan(m.id);
    sendMine(m.id);
    a({ ok: true });
  });
});

// ------------------------------------------------------------------ canlı güncellemeler

matches.on('list', lobbyUpdate);
matches.on('clubs', lobbyUpdate);
// yarının/dünün listesi ve puan durumu seyrek değişir: herkese (maç odasındakiler dahil) gönder ki lobiye dönünce güncel olsun
matches.on('tomorrow', (list) => io.emit('tomorrow', list));
matches.on('yesterday', (list) => io.emit('yesterday', list));
matches.on('standings', (table) => io.emit('standings', table));

// ------------------------------------------------------------------ takımlar ve tahmin puanlama

matches.on('list', (list: { status: string; home: TeamBadge; away: TeamBadge; id: string }[]) => {
  // seçilebilir takımların adı/kısaltması sabit kalsın; diğer takımlar yalnızca kayıt için
  const seen = list.flatMap((m) => [m.home, m.away]).filter((t) => !pickable.has(t.id));
  store.upsertTeams(seen.map(({ id, name, short, logo, color }) => ({ id, name, short, logo, color })));
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
    const msg = store.addChat(matchId, null, 'Safskor', fmt(e, e.side === 'home' ? m.home.name : m.away.name), 'system', null, null, null, e.id);
    io.to(room(matchId)).emit('chat:message', msg);
  }
});

matches.on('status', (m: Match) => {
  io.to(room(m.id)).emit('presence', { matchId: m.id, count: roomSize(m.id) });
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
