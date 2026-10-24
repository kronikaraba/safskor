import { io } from '/vendor/socket.io.esm.min.js';
import { h, mount, storage, openSheet, closeSheet, toast, teamBadge } from './util.js';
import { renderLobby } from './lobby.js';
import { renderMatch } from './match.js';
import { initDm } from './dm.js';
import { renderPrivacy, renderNotFound } from './pages.js';

// ------------------------------------------------------------------ kimlik
// Herkes tarayıcıya özel anonim bir kimlikle başlar. Telefonla üye olan ya da giriş yapan cihaz bunun yerine
// sunucunun verdiği, o cihaza özel ve kapatılabilir bir oturum anahtarıyla bağlanır.
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const me = {
  userId: storage.get('safskor.userId') || uid(),
  session: storage.get('safskor.session', null),
  nick: storage.get('safskor.nick') || `Taraftar${Math.floor(1000 + Math.random() * 9000)}`,
  team: storage.get('safskor.team', null),
  account: null, // { phone (maskeli), name, devices } — telefonla üye olduysa
  ref: null, // kendi davet kodu
  invites: 0, // davet bağlantısıyla üye olanlar
  uid: null, // sunucunun verdiği herkese açık kimlik (sohbette "Sen" ayrımı ve özel mesajlar için)
};
storage.set('safskor.userId', me.userId);
storage.set('safskor.nick', me.nick);

// ------------------------------------------------------------------ davet bağlantısı (?ref=kod)
// Davetle gelen ziyaretçinin davet edeni hatırlanır (ilk gelen bağlantı geçerli); üye olunca davet edene yazılır.
// Adres çubuğundan kaldırılır ki paylaşılan sayfa adresleri ve kanonik adres temiz kalsın.
{
  const q = new URLSearchParams(location.search);
  const ref = (q.get('ref') || '').toLowerCase();
  if (/^[a-z0-9]{4,12}$/.test(ref) && !storage.get('safskor.ref', null)) storage.set('safskor.ref', ref);
  if (q.has('ref')) {
    q.delete('ref');
    history.replaceState(history.state, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  }
}

export const app = {
  me,
  // her bağlanmada güncel kimlik gönderilir (giriş/çıkış sonrası yeniden bağlanınca da doğru olsun)
  socket: io({ auth: (cb) => cb({ session: me.session, userId: me.userId, nick: me.nick, teamId: me.team?.id ?? null }) }),
  provider: null,
  matches: [],
  view: null, // aktif görünümün temizleme fonksiyonu
  ranks: {}, // en az bir arkadaşını üye yapanların rütbesi: herkese açık kimlik -> rütbe
};

/** Davet rütbeleri: bağlantınla üye olan arkadaş sayısına göre (sunucudaki RANKS ile aynı) */
export const RANKS = [
  { key: 'taraftar', min: 0, name: 'Taraftar', icon: '⚽', perk: null },
  { key: 'tribun', min: 3, name: 'Tribün Üyesi', icon: '🎟️', perk: 'Adının yanında rütben görünür' },
  { key: 'lider', min: 10, name: 'Tribün Lideri', icon: '🚩', perk: 'Maç için kendi özel odanı açarsın' },
  { key: 'efsane', min: 25, name: 'Efsane', icon: '👑', perk: 'Maç sohbetinde bir mesajı herkese sabitlersin' },
];
export const rankByKey = (k) => RANKS.find((r) => r.key === k) ?? RANKS[0];
export const rankOf = (n) => RANKS.reduce((cur, r) => (n >= r.min ? r : cur), RANKS[0]);
/** kendi rütben en az verilen seviyede mi */
export const myRankAtLeast = (k) => RANKS.indexOf(rankOf(me.invites)) >= RANKS.findIndex((r) => r.key === k);
/** Kendi davet bağlantın: verilen sayfa (varsayılan ana sayfa) + ?ref=kod */
export function inviteUrl(path = '/') {
  return `https://safskor.com${path}${me.ref ? `?ref=${me.ref}` : ''}`;
}
/** Sohbet ve sıralamada isim yanındaki rütbe (Taraftar için gösterilmez) */
export function rankBadge(key) {
  const r = rankByKey(key);
  if (r.key === 'taraftar') return null;
  return h('span.rank-badge', { class: `rk-${r.key}`, title: `${r.name}: en az ${r.min} arkadaşını Safskor'a üye yaptı` }, `${r.icon} ${r.name}`);
}

// ------------------------------------------------------------------ üst bar
const nickBtn = document.getElementById('nickBtn');
const conn = document.getElementById('conn');
function drawNick() {
  mount(nickBtn, teamBadge(me.team), h('span', {}, me.nick));
}
drawNick();
nickBtn.onclick = () => editNick();

export function editNick() {
  let teams = null;
  let picked = me.team;
  const input = h('input.input', { value: me.nick, maxlength: 20, minlength: 2, autocomplete: 'nickname', 'aria-label': 'Takma ad' });
  const list = h('div.team-list', { role: 'radiogroup', 'aria-label': 'Favori takım' });
  const drawTeams = () => {
    if (!teams) return mount(list, h('p.muted.small', {}, 'Takımlar yükleniyor…'));
    mount(
      list,
      teams.map((t) => {
        const on = picked?.id === t.id;
        // seçili takıma tekrar dokunmak seçimi kaldırır
        return h('button.team-opt', { type: 'button', role: 'radio', class: on ? 'on' : '', 'aria-checked': String(on), onclick: () => ((picked = on ? null : t), drawTeams()) }, h('img.team-logo', { src: t.logo, alt: '' }), h('span', {}, t.name));
      }),
    );
  };
  app.socket.emit('teams:list', {}, (r) => {
    teams = r?.teams ?? [];
    if (picked && !teams.some((t) => t.id === picked.id)) picked = null;
    drawTeams();
  });
  openSheet((close) => {
    const save = (e) => {
      e.preventDefault();
      app.socket.emit('profile:set', { nick: input.value, teamId: picked?.id ?? null }, (r) => {
        if (!r?.ok) return toast(r?.error || 'Kaydedilemedi', 'err');
        me.nick = r.nick;
        me.team = r.team ?? null;
        storage.set('safskor.nick', me.nick);
        storage.set('safskor.team', me.team);
        drawNick();
        app.onProfile?.();
        close();
        toast('Profilin güncellendi');
      });
    };
    drawTeams();
    return [
      h('div.sheet-head', {}, h('h2', {}, 'Profilin'), h('button.x', { onclick: close, 'aria-label': 'Kapat' }, '✕')),
      h(
        'form.form',
        { onsubmit: save },
        h('label', {}, 'Takma ad', input),
        h('p.muted.small', { style: { margin: '-4px 0 0' } }, 'Sohbette ve önerilerde bu adla görüneceksin.'),
        h('div.field', { role: 'group', 'aria-label': 'Favori takımın' }, h('span', {}, 'Favori takımın (dokunarak seç, tekrar dokunursan kaldırılır)'), list),
        h('button.btn', { type: 'submit' }, 'Kaydet'),
      ),
      inviteBox(),
      accountBox(input),
    ];
  });
}

// ------------------------------------------------------------------ arkadaş davet et ve rütbeler
function inviteBox() {
  const n = me.invites;
  const url = inviteUrl();
  const cur = rankOf(n);
  const next = RANKS[RANKS.indexOf(cur) + 1] ?? null;
  const shareLink = async () => {
    const text = 'Maçları Safskor\'da canlı takip ediyorum, oyuncuları puanlıyor, taktik öneriyoruz. Sen de gel:';
    if (navigator.share) {
      try {
        return await navigator.share({ title: 'Safskor', text, url });
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Davet bağlantın kopyalandı');
    } catch {
      prompt('Davet bağlantını kopyala:', url);
    }
  };
  const pct = next ? ((n - cur.min) / (next.min - cur.min)) * 100 : 100;
  return h(
    'div.invite',
    {},
    h('h3', {}, '🤝 Arkadaşını davet et, rütbe atla'),
    h('div.invite-rank', {}, h('span.invite-rank-ic', {}, cur.icon), h('div', {}, h('small', {}, 'Rütben'), h('b', {}, cur.name)), h('div.invite-n', {}, h('b', {}, n), h('small', {}, 'üye getirdin'))),
    next
      ? [h('div.invite-bar', {}, h('i', { style: { width: `${Math.max(4, pct)}%` } })), h('p.small', {}, `${next.icon} ${next.name} için ${next.min - n} arkadaşın daha üye olmalı.`)]
      : h('p.small', {}, 'En yüksek rütbedesin!'),
    h('button.btn.invite-btn', { type: 'button', onclick: shareLink, disabled: !me.ref }, me.ref ? 'Davet bağlantını paylaş' : 'Bağlantı hazırlanıyor…'),
    h('p.muted.small.invite-url', {}, url),
    h(
      'ul.rank-list',
      {},
      RANKS.slice(1).map((r) => h('li', { class: n >= r.min ? 'on' : '' }, h('span.rl-ic', {}, r.icon), h('div', {}, h('b', {}, `${r.name} · ${r.min} üye`), h('span', {}, r.perk)), h('span.rl-ok', {}, n >= r.min ? '✓' : ''))),
    ),
  );
}

// ------------------------------------------------------------------ üyelik (telefon + isim + şifre)
// SMS doğrulaması henüz yok: kullanıcı 6 haneli bir şifre seçer, başka cihazda numara + şifreyle girer.
function accountBox(nickInput) {
  const box = h('div.acct');
  const field = (label, attrs) => h('label', {}, label, h('input.input', attrs));
  const val = (el) => el.querySelector('input').value;
  const phoneAttrs = { type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '0532 123 45 67', maxlength: 20 };
  const pinAttrs = { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6 };
  const send = (ev, payload) => new Promise((resolve) => app.socket.timeout(8000).emit(ev, payload, (err, r) => resolve(err ? { ok: false, error: 'Sunucu yanıt vermedi.' } : r)));

  const drawAccount = (changing = false) => {
    const n = me.account.devices ?? 1;
    const oldPin = field('Mevcut şifre', { ...pinAttrs, autocomplete: 'current-password' });
    const newPin = field('Yeni şifre (6 haneli)', { ...pinAttrs, autocomplete: 'new-password' });
    const changePin = async (e) => {
      e.preventDefault();
      const r = await send('account:pin', { old: val(oldPin), pin: val(newPin) });
      if (!r?.ok) return toast(r?.error || 'Şifre değiştirilemedi', 'err');
      me.account = r.account;
      drawAccount();
      toast('Şifren değişti, diğer cihazlardaki oturumlar kapatıldı');
    };
    const logoutOthers = async () => {
      if (!confirm('Bu cihaz dışındaki tüm cihazlarda oturumun kapatılsın mı?')) return;
      const r = await send('account:logout-others', {});
      if (!r?.ok) return toast(r?.error || 'İşlem başarısız', 'err');
      me.account = r.account;
      drawAccount();
      toast('Diğer cihazlardaki oturumlar kapatıldı');
    };
    const pinDel = field('Şifren', { ...pinAttrs, autocomplete: 'current-password' });
    const deleteAccount = async (e) => {
      e.preventDefault();
      if (!confirm('Hesabın kalıcı olarak silinsin mi? Telefon numaran, şifren, özel mesajların ve tüm cihazlardaki oturumların silinir. Bu geri alınamaz.')) return;
      const r = await send('account:delete', { pin: val(pinDel) });
      if (!r?.ok) return toast(r?.error || 'Hesap silinemedi', 'err');
      resetIdentity();
      toast('Hesabın silindi');
      setTimeout(() => location.reload(), 1200);
    };
    if (changing === 'delete') {
      mount(
        box,
        h('h3', {}, 'Hesabı sil'),
        h('p.muted.small', {}, 'Telefon numaran, şifren, özel mesajların, davet kodun ve tüm cihazlardaki oturumların kalıcı olarak silinir. Sohbet mesajların ve oyların maçın kaydında kalır ama adın "Silinmiş üye" olur.'),
        h('form.form', { onsubmit: deleteAccount }, pinDel, h('div.acct-row', {}, h('button.btn.danger', { type: 'submit' }, 'Hesabımı kalıcı olarak sil'), h('button.btn.ghost', { type: 'button', onclick: () => drawAccount() }, 'Vazgeç'))),
      );
      return;
    }
    mount(
      box,
      h('h3', {}, 'Hesabın'),
      h('p.muted.small', {}, `${me.account.phone} numarasıyla üyesin. Başka bir cihazda bu numara ve şifrenle girersen her şeyin seninle gelir.`),
      h('p.acct-devices', { class: n > 1 ? 'warn' : '' }, n > 1 ? `Hesabın şu an ${n} cihazda açık. Tanımadığın bir cihaz varsa diğer cihazlardan çıkış yap ve şifreni değiştir.` : 'Hesabın şu an yalnızca bu cihazda açık.'),
      changing
        ? h('form.form', { onsubmit: changePin }, oldPin, newPin, h('div.acct-row', {}, h('button.btn', { type: 'submit' }, 'Şifreyi değiştir'), h('button.btn.ghost', { type: 'button', onclick: () => drawAccount() }, 'Vazgeç')))
        : h(
            'div.acct-row',
            {},
            h('button.btn.ghost', { type: 'button', onclick: () => drawAccount(true) }, 'Şifreyi değiştir'),
            n > 1 && h('button.btn.ghost', { type: 'button', onclick: logoutOthers }, 'Diğer cihazlardan çıkış yap'),
            h('button.btn.ghost', { type: 'button', onclick: logout }, 'Çıkış yap'),
          ),
      !changing && h('button.link-btn.acct-del', { type: 'button', onclick: () => drawAccount('delete') }, 'Hesabımı sil'),
    );
  };

  const draw = (mode) => {
    if (me.account) return drawAccount();
    const login = mode === 'login';
    const phone = field('Cep numarası', phoneAttrs);
    const pin = field(login ? 'Şifre' : 'Şifre belirle (6 haneli)', { ...pinAttrs, autocomplete: login ? 'current-password' : 'new-password', placeholder: login ? 'Şifren' : '6 haneli sayı' });
    const submit = async (e) => {
      e.preventDefault();
      const r = await send(login ? 'account:login' : 'account:register', { phone: val(phone), pin: val(pin), name: nickInput.value, ref: login ? undefined : storage.get('safskor.ref', null) });
      if (!r?.ok) return toast(r?.error || 'İşlem başarısız', 'err');
      setSession(r.session);
      if (login) {
        // sayfa yenilenince tüm veriler hesaptan gelir
        storage.set('safskor.nick', r.nick);
        storage.set('safskor.team', r.team);
        location.reload();
        return;
      }
      // hesaba bağlanan eski tarayıcı kimliği artık tek başına bir işe yaramaz; tarayıcıdan da kaldırılır
      me.userId = uid();
      storage.set('safskor.userId', me.userId);
      me.account = r.account;
      me.nick = r.nick;
      storage.set('safskor.nick', me.nick);
      drawNick();
      drawAccount();
      toast('Üyeliğin oluşturuldu');
    };
    mount(
      box,
      h('h3', {}, login ? 'Giriş yap' : 'Üye ol'),
      h('p.muted.small', {}, login ? 'Daha önce üye olduysan numaran ve şifrenle gir.' : 'Siteden çıkıp girince ya da başka cihazda adın, takımın, tahminlerin ve mesajların kaybolmasın. İsim olarak yukarıdaki takma adın kullanılır.'),
      h('form.form', { onsubmit: submit }, phone, pin, h('button.btn', { type: 'submit' }, login ? 'Giriş yap' : 'Üye ol')),
      h('button.link-btn', { type: 'button', onclick: () => draw(login ? 'register' : 'login') }, login ? 'Hesabın yok mu? Üye ol' : 'Zaten üye misin? Giriş yap'),
    );
  };
  draw('register');
  return box;
}

function setSession(session) {
  me.session = session ?? null;
  storage.set('safskor.session', me.session);
}

/** Bu cihazda yeni bir anonim kimlikle baştan başlar (çıkış ya da kapatılmış oturum) */
function resetIdentity() {
  setSession(null);
  me.userId = uid();
  me.nick = `Taraftar${Math.floor(1000 + Math.random() * 9000)}`;
  me.team = null;
  me.account = null;
  storage.set('safskor.userId', me.userId);
  storage.set('safskor.nick', me.nick);
  storage.set('safskor.team', null);
  drawNick();
}

async function logout() {
  if (!confirm('Çıkış yapılsın mı? Tekrar girmek için numaran ve şifren gerekecek.')) return;
  // oturum sunucuda da kapatılır; bu cihazın anahtarı bir daha işe yaramaz
  await new Promise((resolve) => app.socket.timeout(4000).emit('account:logout', {}, () => resolve()));
  resetIdentity();
  location.reload();
}

// Bu cihazın oturumu kapatıldıysa (başka cihazdan çıkış yapıldı, şifre değişti ya da süresi doldu)
// sunucu bağlantıyı reddeder: yeni anonim kimlikle devam edilir, hesaba tekrar girmek için numara + şifre gerekir.
app.socket.on('connect_error', (err) => {
  if (err?.message !== 'session_expired') return;
  resetIdentity();
  toast('Oturumun kapandı. Tekrar giriş yapmak için adına dokun.');
  app.socket.connect();
});

// Başka sekmede giriş ya da çıkış yapılırsa bu sekme de aynı kimliğe geçsin
window.addEventListener('storage', (e) => {
  if (e.key === 'safskor.session' && storage.get('safskor.session', null) !== me.session) location.reload();
});

app.socket.on('connect', () => {
  conn.className = 'conn on';
  conn.title = 'Canlı bağlantı';
  route(); // yeniden bağlanınca odaya tekrar katıl
});
app.socket.on('disconnect', (reason) => {
  conn.className = 'conn off';
  conn.title = 'Bağlantı koptu, yeniden deneniyor…';
  // sunucu bağlantıyı kendisi kestiyse (ör. bu cihazın oturumu kapatıldı) yeniden dene; oturum geçersizse connect_error gelir
  if (reason === 'io server disconnect') app.socket.connect();
});
app.socket.on('profile', (p) => {
  me.account = p?.account ?? null;
  me.ref = p?.ref ?? null;
  me.invites = p?.invites ?? 0;
  if (p?.uid && p.uid !== me.uid) {
    me.uid = p.uid;
    app.onProfile?.();
  }
  const team = p?.team ?? null;
  if (JSON.stringify(team) === JSON.stringify(me.team)) return;
  me.team = team;
  storage.set('safskor.team', team);
  drawNick();
});
app.socket.on('hello', (d) => {
  app.matches = d.matches;
  app.clubs = d.clubs || [];
  app.tomorrow = d.tomorrow ?? null;
  app.yesterday = d.yesterday ?? null;
  app.ranks = d.ranks ?? {};
  setProvider(d.provider);
  app.onMatches?.();
});
// gün dönünce sunucu önce null gönderir (liste yenilenene kadar "yükleniyor")
// biri rütbe atladı: açık sohbet yeniden çizilir
app.socket.on('ranks', (map) => {
  app.ranks = map ?? {};
  app.onProfile?.();
});
// bağlantınla biri üye oldu
app.socket.on('invites', (d) => {
  const was = me.invites;
  me.invites = d?.count ?? me.invites;
  if (me.invites <= was) return;
  const r = rankOf(me.invites);
  toast(r !== rankOf(was) ? `Tebrikler! Yeni rütben: ${r.icon} ${r.name}` : 'Davet bağlantınla bir arkadaşın üye oldu 🤝');
  app.onProfile?.();
});

app.socket.on('tomorrow', (list) => {
  app.tomorrow = list ?? null;
  app.onMatches?.();
});
app.socket.on('yesterday', (list) => {
  app.yesterday = list ?? null;
  app.onMatches?.();
});
app.socket.on('standings', (t) => {
  app.standings = t;
  app.onStandings?.();
});
app.socket.on('matches', (d) => {
  app.matches = d.matches;
  app.clubs = d.clubs || [];
  setProvider(d.provider);
  app.onMatches?.();
});

function setProvider(p) {
  app.provider = p;
  const b = document.getElementById('banner');
  if (p?.demo) {
    b.hidden = false;
    b.textContent = p.error
      ? `Demo modu: futbol API'sinden veri alınamadı (${p.error}). Simüle edilmiş canlı maçlar gösteriliyor.`
      : 'Demo modu: API anahtarı tanımlı değil. Simüle edilmiş canlı maçlar gösteriliyor; gerçek veriler için sunucuya API_FOOTBALL_KEY ekleyin.';
  } else if (p?.stale) {
    b.hidden = false;
    const at = p.quota?.resetsAt ? new Date(p.quota.resetsAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
    b.textContent = `Günlük veri kotası doldu; son alınan skorlar gösteriliyor. Veriler ${at ? `saat ${at}'te` : 'yarın'} yeniden güncellenecek.`;
  } else b.hidden = true;
}

// ------------------------------------------------------------------ yönlendirme
// Adresler (Google her birini ayrı sayfa olarak görür): / bugün, /yarin, /dun, /puan-durumu,
// /mac/<id>/<ev-deplasman>. Eski #/ bağlantıları (paylaşılmış linkler) yeni adreslere çevrilir.
const root = document.getElementById('app');
let current = '';
const TITLES = {
  '/': 'Safskor · Canlı Skor ve Taraftar Platformu',
  '/yarin': 'Yarının Maçları ve Başlama Saatleri · Safskor',
  '/dun': 'Dünün Maç Sonuçları · Safskor',
  '/puan-durumu': 'Süper Lig Puan Durumu · Safskor',
  '/gizlilik': 'Gizlilik Politikası ve KVKK Aydınlatma Metni · Safskor',
};
const APP_PATH = /^\/($|yarin$|dun$|puan-durumu$|gizlilik$|mac\/)/;

function fromHash(hash) {
  const m = hash.match(/^#\/m\/([\w-]+)/);
  if (m) return `/mac/${m[1]}`;
  if (hash.startsWith('#/yarin')) return '/yarin';
  if (hash.startsWith('#/puan')) return '/puan-durumu';
  return '/';
}
if (location.hash.startsWith('#/')) history.replaceState(null, '', fromHash(location.hash));

export function navigate(path) {
  if (path !== location.pathname) history.pushState(null, '', path);
  route();
}

function route() {
  // bilinmeyen adres: sunucu 404 döner, burada "sayfa bulunamadı" gösterilir
  const path = APP_PATH.test(location.pathname) ? location.pathname : '/404';
  if (path === current && app.socket.connected && app.view?.rejoin) return app.view.rejoin();
  current = path;
  app.view?.destroy?.();
  app.onMatches = null;
  app.onStandings = null;
  closeSheet();
  window.scrollTo(0, 0);
  const m = path.match(/^\/mac\/([\w-]+)/);
  const tab = path === '/yarin' ? 'tomorrow' : path === '/dun' ? 'yesterday' : path === '/puan-durumu' ? 'table' : 'today';
  if (path === '/gizlilik') app.view = renderPrivacy(root);
  else if (path === '/404') app.view = renderNotFound(root);
  else app.view = m ? renderMatch(root, decodeURIComponent(m[1])) : renderLobby(root, tab);
  if (!m && path !== '/404') document.title = TITLES[path] ?? TITLES['/'];
  // masaüstü üst menü: Puan durumu kendi düğmesinde, diğer maç sayfaları Maçlar'da
  const table = path === '/puan-durumu';
  document.querySelector('.home-link')?.classList.toggle('active', !table && path !== '/gizlilik' && path !== '/404');
  document.querySelector('.table-link')?.classList.toggle('active', table);
}

// site içi bağlantılar sayfayı yeniden yüklemeden açılır (yeni sekmede açma vb. tarayıcıya bırakılır)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !APP_PATH.test(url.pathname)) return;
  e.preventDefault();
  navigate(url.pathname);
});
window.addEventListener('popstate', route);
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/')) return;
  history.replaceState(null, '', fromHash(location.hash));
  route();
});
initDm(document.getElementById('dmBtn'));
if (!app.socket.connected) route();
// Android uygulaması ve ana ekrana ekleme için: bağlantı yokken çevrimdışı sayfası gösterilir
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

export { mount, h };
