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
const selam = await got;
ok(selam.uid && !('userId' in selam) && !JSON.stringify(selam).includes('smoke-user-aaaa'), 'mesajda gizli tarayıcı kimliği yok, herkese açık kimlik var');

// sohbet mesajı beğenme ve özel mesaj: hız sınırına takılmamak için ayrı iki kullanıcıyla
const c = await connect('smoke-user-cccc', 'Can');
const d = await connect('smoke-user-dddd', 'Deniz');
ok((await call(c, 'match:join', { matchId: live.id })).ok && (await call(d, 'match:join', { matchId: live.id })).ok, 'iki kullanıcı daha odaya katıldı');
const likeSeen = waitFor(a, 'chat:likes', (x) => x.id === selam.id && x.likes === 1);
const lk = await call(d, 'chat:like', { id: selam.id });
ok(lk.ok && lk.liked && lk.likes === 1, 'mesaj beğenildi');
ok(await likeSeen, 'beğeni sayısı odaya anında yayıldı');
ok(!(await call(a, 'chat:like', { id: selam.id })).ok, 'kendi mesajını beğenme reddedildi');
const rejoinD = await call(d, 'match:join', { matchId: live.id });
ok(rejoinD.chatLiked.includes(selam.id) && rejoinD.chat.find((x) => x.id === selam.id)?.likes === 1, 'beğeni kalıcı, kullanıcı kendi beğenisini görüyor');
const unlk = await call(d, 'chat:like', { id: selam.id });
ok(unlk.ok && !unlk.liked && unlk.likes === 0, 'beğeni geri alındı');

const gotC = waitFor(d, 'chat:message', (x) => x.text === 'Ben Can');
const gotD = waitFor(c, 'chat:message', (x) => x.text === 'Ben Deniz');
await call(c, 'chat:send', { text: 'Ben Can' });
await call(d, 'chat:send', { text: 'Ben Deniz' });
const uidC = (await gotC).uid;
const uidD = (await gotD).uid;
const dmSeen = waitFor(d, 'dm:new', (x) => x.message.text === 'Selam, maç nasıl?');
const unreadD = waitFor(d, 'dm:unread', (x) => x.count === 1);
const dm = await call(c, 'dm:send', { to: uidD, text: 'Selam, maç nasıl?' });
ok(dm.ok && dm.message.from === uidC && dm.message.to === uidD, 'özel mesaj gönderildi');
const dmGot = await dmSeen;
ok(dmGot.peer.nick === 'Can' && dmGot.peer.uid === uidC, 'alıcı özel mesajı anında aldı');
ok(await unreadD, 'alıcının okunmamış sayısı 1');
const th = await call(d, 'dm:threads', {});
ok(th.ok && th.threads.length === 1 && th.threads[0].nick === 'Can' && th.threads[0].unread === 1, 'konuşma listesi okunmamışla geldi');
const readNow = waitFor(d, 'dm:unread', (x) => x.count === 0);
const hist = await call(d, 'dm:history', { with: uidC });
ok(hist.ok && hist.messages.length === 1 && hist.peer.nick === 'Can', 'konuşma geçmişi açıldı');
ok(await readNow, 'açılınca okundu sayıldı');
ok(!(await call(c, 'dm:send', { to: uidC, text: 'x' })).ok, 'kendine mesaj reddedildi');
ok(!(await call(c, 'dm:send', { to: 'uyokboylebirkimlik', text: 'x' })).ok, 'olmayan kullanıcıya mesaj reddedildi');
ok((await call(d, 'dm:block', { uid: uidC, block: true })).blocked, 'kullanıcı engellendi');
ok(!(await call(c, 'dm:send', { to: uidD, text: 'Engelli mesaj' })).ok, 'engelleyen kullanıcıya mesaj gitmedi');
await call(d, 'dm:block', { uid: uidC, block: false });
ok((await call(c, 'dm:send', { to: uidD, text: 'Tekrar selam' })).ok, 'engel kalkınca mesaj gitti');
c.close();
d.close();

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
ok(ja.fan.polls.length === 2, 'yalnızca iki anket var (kazanan, hakem)');

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
await call(a, 'sub:vote', { id: sr.id });
const afterOwn = await (await fetch(`${BASE}/api/matches/${live.id}/fan`)).json();
ok(afterOwn.subs?.home?.find((x) => x.id === sr.id)?.votes === 2, 'talep eden kendi desteğini geri alamaz, talep kaybolmaz');
ok(!(await call(a, 'sub:request', { side: 'home', outId: inP.id, inId: outP.id })).ok, 'yedekteki oyuncuyu çıkarma talebi reddedildi');

// olay ve oyuncu yorumları
const ev = cur.events[0];
ok(ev, 'yorum için maç olayı var');
const evTarget = `e:${ev.id}`;
const gotComment = waitFor(b, 'comment:new', (c) => c.target === evTarget && c.text === 'Ne goldü!');
ok((await call(a, 'comment:add', { target: evTarget, text: 'Ne goldü!' })).ok, 'olaya yorum yazıldı');
ok(await gotComment, 'olay yorumu odadaki diğer kullanıcıya anında geldi');
const pTarget = `p:${cur.lineups.away.startXI[0].id}`;
ok((await call(b, 'comment:add', { target: pTarget, text: 'Bugün çok iyi' })).ok, 'oyuncuya yorum yazıldı');
const pl = await call(a, 'comment:list', { target: pTarget });
ok(pl.ok && pl.comments.length === 1 && pl.comments[0].nick === 'Ayşe', 'oyuncu yorumları listelendi');
ok(!(await call(a, 'comment:add', { target: 'p:yok-boyle-oyuncu', text: 'x' })).ok, 'olmayan oyuncuya yorum reddedildi');
const withCounts = waitFor(a, 'fan:state', (f) => f.comments?.[evTarget] === 1 && f.comments?.[pTarget] === 1);
ok(await withCounts, 'yorum sayıları taraftar durumunda');

const mine = await (await fetch(`${BASE}/api/matches/${live.id}/fan`)).json();
ok(mine.chat.some((c) => c.text === 'Selam millet!'), 'sohbet geçmişi kalıcı (REST)');
ok(!JSON.stringify(mine).includes('smoke-user-'), 'REST yanıtında gizli tarayıcı kimliği yok');

// üyelik: telefon + isim + şifre; her cihaza ayrı, kapatılabilir oturum
const connectWith = (auth) =>
  new Promise((res) => {
    const s = io(BASE, { auth, transports: ['websocket'], reconnection: false });
    s.on('profile', (profile) => res({ s, ok: true, profile }));
    s.on('connect_error', (e) => res({ s, ok: false, error: e.message }));
  });
const phoneNo = `05${Date.now().toString().slice(-9)}`; // her çalıştırmada farklı numara
const u = await connect('smoke-acct-uuuu', 'Uğur');
ok(!(await call(u, 'account:register', { phone: phoneNo, name: 'Uğur', pin: '5839' })).ok, '6 haneden kısa yeni şifre reddedildi');
ok(!(await call(u, 'account:register', { phone: phoneNo, name: 'Uğur', pin: '123456' })).ok, 'kolay şifre (123456) reddedildi');
ok(!(await call(u, 'account:register', { phone: phoneNo, name: 'Uğur', pin: phoneNo.slice(-6) })).ok, 'numaranın son haneleri şifre olarak reddedildi');
const reg = await call(u, 'account:register', { phone: phoneNo, name: 'Uğur', pin: '583920' });
ok(reg.ok && reg.session && reg.account.devices === 1 && !JSON.stringify(reg).includes('smoke-acct-'), 'üye olundu, cihaza oturum anahtarı verildi');
const raw = await connectWith({ userId: 'smoke-acct-uuuu', nick: 'Hırsız' });
ok(!raw.ok && raw.error === 'session_expired', 'hesaba bağlanmış eski tarayıcı kimliğiyle giriş reddedildi');
const fake = await connectWith({ session: 'x'.repeat(43), userId: 'smoke-acct-zzzz' });
ok(!fake.ok && fake.error === 'session_expired', 'uydurma oturum anahtarı reddedildi');
const v = await connect('smoke-acct-vvvv', 'Veli');
ok(!(await call(v, 'account:register', { phone: phoneNo, name: 'Veli', pin: '583921' })).ok, 'aynı numarayla ikinci üyelik reddedildi');
const lg = await call(v, 'account:login', { phone: phoneNo, pin: '583920' });
ok(lg.ok && lg.session && lg.session !== reg.session && !('userId' in lg), 'başka cihazdan giriş: yalnızca o cihaza özel anahtar geldi');
const dev1 = await connectWith({ session: reg.session, nick: 'Uğur' });
const dev2 = await connectWith({ session: lg.session, nick: 'Uğur' });
ok(dev1.ok && dev2.ok && dev1.profile.uid === dev2.profile.uid && dev2.profile.account?.devices === 2, 'iki cihaz aynı hesapta, hesap 2 cihazda açık görünüyor');
const kicked2 = new Promise((res) => dev2.s.on('disconnect', res));
const lo = await call(dev1.s, 'account:logout-others', {});
ok(lo.ok && lo.account.devices === 1 && (await kicked2) === 'io server disconnect', 'diğer cihazlardan çıkış: öbür cihaz anında düştü');
const again = await connectWith({ session: lg.session });
ok(!again.ok && again.error === 'session_expired', 'kapatılan cihazın oturumu bir daha açılmıyor');
ok(!(await call(dev1.s, 'account:pin', { old: '999999', pin: '640271' })).ok, 'yanlış mevcut şifreyle şifre değiştirme reddedildi');
const dev3 = await connectWith({ session: (await call(v, 'account:login', { phone: phoneNo, pin: '583920' })).session });
const kicked3 = new Promise((res) => dev3.s.on('disconnect', res));
const cp = await call(dev1.s, 'account:pin', { old: '583920', pin: '640271' });
ok(cp.ok && (await kicked3) === 'io server disconnect', 'şifre değişti, diğer cihaz anında düştü');
ok(!(await call(v, 'account:login', { phone: phoneNo, pin: '583920' })).ok, 'eski şifre artık geçmiyor');
ok((await call(v, 'account:login', { phone: phoneNo, pin: '640271' })).ok, 'yeni şifreyle giriş yapıldı');
await call(dev1.s, 'account:logout', {});
const out = await connectWith({ session: reg.session });
ok(!out.ok && out.error === 'session_expired', 'çıkış yapınca o cihazın oturumu sunucuda da kapandı');
for (let i = 0; i < 4; i++) await call(v, 'account:login', { phone: phoneNo, pin: '000001' });
const locked = await call(v, 'account:login', { phone: phoneNo, pin: '000001' });
ok(!locked.ok && locked.error.includes('15 dakika'), '5 hatalı şifrede hesap 15 dakika kilitlendi');
ok(!(await call(v, 'account:login', { phone: phoneNo, pin: '640271' })).ok, 'kilitliyken doğru şifre de geçmiyor');
for (const x of [u, v, dev1.s, dev2.s, dev3.s, raw.s, fake.s, again.s, out.s]) x.close();

a.close();
b.close();
console.log('\nTüm kontroller geçti.');
process.exit(0);
