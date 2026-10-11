import { io } from '/vendor/socket.io.esm.min.js';
import { h, mount, storage, openSheet, closeSheet, toast, teamBadge } from './util.js';
import { renderLobby } from './lobby.js';
import { renderMatch } from './match.js';
import { renderLeaderboard } from './leaderboard.js';
import { initDm } from './dm.js';

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
  uid: null, // sunucunun verdiği herkese açık kimlik (sohbette "Sen" ayrımı ve özel mesajlar için)
};
storage.set('safskor.userId', me.userId);
storage.set('safskor.nick', me.nick);

export const app = {
  me,
  // her bağlanmada güncel kimlik gönderilir (giriş/çıkış sonrası yeniden bağlanınca da doğru olsun)
  socket: io({ auth: (cb) => cb({ session: me.session, userId: me.userId, nick: me.nick, teamId: me.team?.id ?? null }) }),
  provider: null,
  matches: [],
  view: null, // aktif görünümün temizleme fonksiyonu
};

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
        h('p.muted.small', { style: { margin: '-4px 0 0' } }, 'Sohbette, önerilerde ve sıralamada bu adla görüneceksin.'),
        h('div.field', { role: 'group', 'aria-label': 'Favori takımın' }, h('span', {}, 'Favori takımın (dokunarak seç, tekrar dokunursan kaldırılır)'), list),
        h('button.btn', { type: 'submit' }, 'Kaydet'),
      ),
      accountBox(input),
    ];
  });
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
    );
  };

  const draw = (mode) => {
    if (me.account) return drawAccount();
    const login = mode === 'login';
    const phone = field('Cep numarası', phoneAttrs);
    const pin = field(login ? 'Şifre' : 'Şifre belirle (6 haneli)', { ...pinAttrs, autocomplete: login ? 'current-password' : 'new-password', placeholder: login ? 'Şifren' : '6 haneli sayı' });
    const submit = async (e) => {
      e.preventDefault();
      const r = await send(login ? 'account:login' : 'account:register', { phone: val(phone), pin: val(pin), name: nickInput.value });
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
  app.tomorrow = d.tomorrow || [];
  setProvider(d.provider);
  app.onMatches?.();
});
app.socket.on('tomorrow', (list) => {
  app.tomorrow = list || [];
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
// Adresler (Google her birini ayrı sayfa olarak görür): / bugün, /yarin, /puan-durumu, /siralama,
// /mac/<id>/<ev-deplasman>. Eski #/ bağlantıları (paylaşılmış linkler) yeni adreslere çevrilir.
const root = document.getElementById('app');
let current = '';
const TITLES = {
  '/': 'Safskor · Canlı Skor ve Taraftar Platformu',
  '/yarin': 'Yarının Maçları ve Başlama Saatleri · Safskor',
  '/puan-durumu': 'Süper Lig Puan Durumu · Safskor',
  '/siralama': 'Haftalık Skor Tahmini Sıralaması · Safskor',
};
const APP_PATH = /^\/($|yarin$|puan-durumu$|siralama$|mac\/)/;

function fromHash(hash) {
  const m = hash.match(/^#\/m\/([\w-]+)/);
  if (m) return `/mac/${m[1]}`;
  if (hash.startsWith('#/siralama')) return '/siralama';
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
  const path = APP_PATH.test(location.pathname) ? location.pathname : '/';
  if (path === current && app.socket.connected && app.view?.rejoin) return app.view.rejoin();
  current = path;
  app.view?.destroy?.();
  app.onMatches = null;
  app.onStandings = null;
  closeSheet();
  window.scrollTo(0, 0);
  const m = path.match(/^\/mac\/([\w-]+)/);
  const rank = path === '/siralama';
  const tab = path === '/yarin' ? 'tomorrow' : path === '/puan-durumu' ? 'table' : 'today';
  app.view = m ? renderMatch(root, decodeURIComponent(m[1])) : rank ? renderLeaderboard(root) : renderLobby(root, tab);
  if (!m) document.title = TITLES[path] ?? TITLES['/'];
  document.querySelector('.rank-link')?.classList.toggle('active', rank);
  document.querySelector('.home-link')?.classList.toggle('active', !rank);
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

export { mount, h };
