// Uçtan uca duman testi: çalışan sunucuya iki istemciyle bağlanır ve tüm taraftar etkileşimlerini dener.
// Kullanım: npm start (ayrı terminalde) ardından  BASE=http://localhost:3000 npm run smoke
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:3000';
const ok = (c, msg) => {
  if (!c) throw new Error('BAŞARISIZ: ' + msg);
  console.log('✓', msg);
};
const connect = (userId, nick) =>
  new Promise((res) => {
    const s = io(BASE, { auth: { userId, nick }, transports: ['websocket'] });
    s.on('connect', () => res(s));
  });
const call = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
const waitFor = (s, ev, pred = () => true, ms = 15000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms);
    const fn = (d) => pred(d) && (clearTimeout(t), s.off(ev, fn), res(d));
    s.on(ev, fn);
  });

const list = await (await fetch(`${BASE}/api/matches`)).json();
ok(list.matches.length > 0, `maç listesi geldi (${list.matches.length} maç, sağlayıcı: ${list.provider.name})`);
const live = list.matches.find((m) => m.status === 'LIVE');
ok(live, `canlı maç var: ${live.home.name} - ${live.away.name} ${live.minute}'`);

const a = await connect('smoke-user-aaaa', 'Ali');
const b = await connect('smoke-user-bbbb', 'Ayşe');
const ja = await call(a, 'match:join', { matchId: live.id });
const jb = await call(b, 'match:join', { matchId: live.id });
ok(ja.ok && jb.ok, 'iki kullanıcı maç odasına katıldı');
const m = ja.match;
ok(m.lineups?.home.startXI.length === 11 && m.stats.length > 0, 'detayda kadro ve istatistik var');

// canlı güncelleme
const upd = await waitFor(a, 'match', (x) => x.id === live.id);
ok(upd.minute >= live.minute, `canlı güncelleme alındı (${upd.minute}')`);

// sohbet
const got = waitFor(b, 'chat:message', (x) => x.text === 'Selam millet!');
ok((await call(a, 'chat:send', { text: 'Selam millet!' })).ok, 'sohbet mesajı gönderildi');
ok((await got).nick === 'Ali', 'diğer kullanıcı mesajı gerçek zamanlı aldı');
ok(!(await call(a, 'chat:send', { text: '   ' })).ok, 'boş mesaj reddedildi');

// puanlama
const p = m.lineups.home.startXI[9];
const fanA = waitFor(b, 'fan:state', (f) => f.ratings[p.id]?.count === 2);
ok((await call(a, 'rating:set', { playerId: p.id, score: 8 })).ok, 'oyuncu puanlandı (8)');
ok((await call(b, 'rating:set', { playerId: p.id, score: 5 })).ok, 'ikinci kullanıcı puanladı (5)');
ok((await fanA).ratings[p.id].avg === 6.5, 'topluluk ortalaması 6.5');
ok(!(await call(a, 'rating:set', { playerId: p.id, score: 11 })).ok, '11 puan reddedildi');

// anket
const poll = ja.fan.polls[0];
ok(poll && poll.options.length === 3, `otomatik anket: ${poll.question}`);
await call(a, 'poll:vote', { pollId: poll.id, option: 0 });
const pollState = waitFor(b, 'fan:state', (f) => f.polls[0].total === 2);
await call(b, 'poll:vote', { pollId: poll.id, option: 2 });
ok((await pollState).polls[0].options[2].votes === 1, 'anket oyları toplandı');
ok((await call(a, 'poll:create', { question: 'İlk değişikliği kim yapar?', options: ['Ev sahibi', 'Deplasman'] })).ok, 'kullanıcı anketi oluşturuldu');

// taktik
await call(a, 'tactic:submit', { side: 'home', formation: '4-4-2', style: 'Hücum', note: 'Kanatlar kullanılmalı' });
const tac = waitFor(a, 'fan:state', (f) => f.tactics.home.total === 2);
await call(b, 'tactic:submit', { side: 'home', formation: '4-4-2', style: 'Dengeli', note: '' });
const t = (await tac).tactics.home;
ok(t.formations[0].value === '4-4-2' && t.formations[0].pct === 100, 'taktik anketi: 4-4-2 %100');
ok((await call(b, 'tactic:like', { id: t.notes[0].id })).ok, 'taktik notu beğenildi');
ok(!(await call(a, 'tactic:submit', { side: 'home', formation: '9-9-9', style: 'Hücum' })).ok, 'geçersiz diziliş reddedildi');

// değişiklik talebi
const cur = (await (await fetch(`${BASE}/api/matches/${live.id}`)).json());
const gone = new Set(cur.events.filter((e) => e.side === 'home' && (e.type === 'sub' || e.type === 'red')).map((e) => e.playerId));
const came = new Set(cur.events.filter((e) => e.side === 'home' && e.type === 'sub').map((e) => e.relatedId));
const outP = cur.lineups.home.startXI.find((x) => !gone.has(x.id) && x.pos !== 'G');
const inP = cur.lineups.home.subs.find((x) => !came.has(x.id) && !gone.has(x.id));
const sr = await call(a, 'sub:request', { side: 'home', outId: outP.id, inId: inP.id });
ok(sr.ok, `değişiklik talebi: ${outP.name} ↔ ${inP.name}`);
const subState = waitFor(a, 'fan:state', (f) => f.subs.home.find((x) => x.id === sr.id)?.votes === 2);
await call(b, 'sub:vote', { id: sr.id });
ok(await subState, 'talep 2 destek aldı');
ok(!(await call(a, 'sub:request', { side: 'home', outId: inP.id, inId: outP.id })).ok, 'yedekteki oyuncuyu çıkarma talebi reddedildi');

const mine = await (await fetch(`${BASE}/api/matches/${live.id}/fan`)).json();
ok(mine.chat.some((c) => c.text === 'Selam millet!'), 'sohbet geçmişi kalıcı (REST)');

a.close();
b.close();
console.log('\nTüm kontroller geçti.');
process.exit(0);
