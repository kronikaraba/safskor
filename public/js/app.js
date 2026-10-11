import { io } from '/vendor/socket.io.esm.min.js';
import { h, mount, storage, openSheet, closeSheet, toast, teamBadge } from './util.js';
import { renderLobby } from './lobby.js';
import { renderMatch } from './match.js';
import { renderLeaderboard } from './leaderboard.js';
import { initDm } from './dm.js';

// ------------------------------------------------------------------ kimlik
// Hesap sistemi yok (MVP): tarayıcıya özel anonim kimlik + takma ad.
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const me = {
  userId: storage.get('safskor.userId') || uid(),
  nick: storage.get('safskor.nick') || `Taraftar${Math.floor(1000 + Math.random() * 9000)}`,
  team: storage.get('safskor.team', null),
  account: null, // { phone (maskeli), name } — telefonla üye olduysa
  uid: null, // sunucunun verdiği herkese açık kimlik (sohbette "Sen" ayrımı ve özel mesajlar için)
};
storage.set('safskor.userId', me.userId);
storage.set('safskor.nick', me.nick);

export const app = {
  me,
  socket: io({ auth: { userId: me.userId, nick: me.nick, teamId: me.team?.id ?? null } }),
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
        app.socket.auth.nick = me.nick;
        app.socket.auth.teamId = me.team?.id ?? null;
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
// SMS doğrulaması henüz yok: kullanıcı 4-6 haneli bir şifre seçer, başka cihazda numara + şifreyle girer.
function accountBox(nickInput) {
  const box = h('div.acct');
  const field = (label, attrs) => h('label', {}, label, h('input.input', attrs));
  const phoneAttrs = { type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '0532 123 45 67', maxlength: 20 };
  const pinAttrs = { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, placeholder: '4-6 haneli sayı' };
  const draw = (mode) => {
    if (me.account) {
      return mount(
        box,
        h('h3', {}, 'Hesabın'),
        h('p.muted.small', {}, `${me.account.phone} numarasıyla üyesin. Başka bir cihazda bu numara ve şifrenle girersen her şeyin seninle gelir.`),
        h('button.btn.ghost', { type: 'button', onclick: logout }, 'Çıkış yap'),
      );
    }
    const login = mode === 'login';
    const phone = field('Cep numarası', phoneAttrs);
    const pin = field(login ? 'Şifre' : 'Şifre belirle', { ...pinAttrs, autocomplete: login ? 'current-password' : 'new-password' });
    const submit = (e) => {
      e.preventDefault();
      const payload = { phone: phone.querySelector('input').value, pin: pin.querySelector('input').value, name: nickInput.value };
      app.socket.emit(login ? 'account:login' : 'account:register', payload, (r) => {
        if (!r?.ok) return toast(r?.error || 'İşlem başarısız', 'err');
        if (login) {
          // hesabın kimliğine geç: sayfa yenilenince tüm veriler o hesaptan gelir
          storage.set('safskor.userId', r.userId);
          storage.set('safskor.nick', r.nick);
          storage.set('safskor.team', r.team);
          location.reload();
          return;
        }
        me.account = r.account;
        me.nick = r.nick;
        storage.set('safskor.nick', me.nick);
        app.socket.auth.nick = me.nick;
        drawNick();
        draw();
        toast('Üyeliğin oluşturuldu');
      });
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

function logout() {
  if (!confirm('Çıkış yapılsın mı? Tekrar girmek için numaran ve şifren gerekecek.')) return;
  storage.set('safskor.userId', uid());
  storage.set('safskor.nick', `Taraftar${Math.floor(1000 + Math.random() * 9000)}`);
  storage.set('safskor.team', null);
  location.reload();
}

app.socket.on('connect', () => {
  conn.className = 'conn on';
  conn.title = 'Canlı bağlantı';
  route(); // yeniden bağlanınca odaya tekrar katıl
});
app.socket.on('disconnect', () => {
  conn.className = 'conn off';
  conn.title = 'Bağlantı koptu, yeniden deneniyor…';
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
  app.socket.auth.teamId = team?.id ?? null;
  drawNick();
});
app.socket.on('hello', (d) => {
  app.matches = d.matches;
  setProvider(d.provider);
  app.onMatches?.();
});
app.socket.on('matches', (d) => {
  app.matches = d.matches;
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
const root = document.getElementById('app');
let current = '';

function route() {
  const hash = location.hash || '#/';
  if (hash === current && app.socket.connected && app.view?.rejoin) return app.view.rejoin();
  current = hash;
  app.view?.destroy?.();
  app.onMatches = null;
  closeSheet();
  window.scrollTo(0, 0);
  const m = hash.match(/^#\/m\/([\w-]+)/);
  app.view = m ? renderMatch(root, m[1]) : hash.startsWith('#/siralama') ? renderLeaderboard(root) : renderLobby(root);
  const rank = hash.startsWith('#/siralama');
  document.querySelector('.rank-link')?.classList.toggle('active', rank);
  document.querySelector('.home-link')?.classList.toggle('active', !rank);
}

window.addEventListener('hashchange', route);
initDm(document.getElementById('dmBtn'));
if (!app.socket.connected) route();

export { mount, h };
