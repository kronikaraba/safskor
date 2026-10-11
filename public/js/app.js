import { io } from '/vendor/socket.io.esm.min.js';
import { h, mount, storage, openSheet, closeSheet, toast } from './util.js';
import { renderLobby } from './lobby.js';
import { renderMatch } from './match.js';

// ------------------------------------------------------------------ kimlik
// Hesap sistemi yok (MVP): tarayıcıya özel anonim kimlik + takma ad.
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const me = {
  userId: storage.get('safskor.userId') || uid(),
  nick: storage.get('safskor.nick') || `Taraftar${Math.floor(1000 + Math.random() * 9000)}`,
};
storage.set('safskor.userId', me.userId);
storage.set('safskor.nick', me.nick);

export const app = {
  me,
  socket: io({ auth: { userId: me.userId, nick: me.nick } }),
  provider: null,
  matches: [],
  view: null, // aktif görünümün temizleme fonksiyonu
};

// ------------------------------------------------------------------ üst bar
const nickBtn = document.getElementById('nickBtn');
const conn = document.getElementById('conn');
nickBtn.textContent = me.nick;
nickBtn.onclick = () => editNick();

export function editNick() {
  openSheet((close) => {
    const input = h('input.input', { value: me.nick, maxlength: 20, minlength: 2, autocomplete: 'nickname', 'aria-label': 'Takma ad' });
    const save = (e) => {
      e.preventDefault();
      app.socket.emit('profile:set', { nick: input.value }, (r) => {
        if (!r?.ok) return toast(r?.error || 'Kaydedilemedi', 'err');
        me.nick = r.nick;
        storage.set('safskor.nick', me.nick);
        nickBtn.textContent = me.nick;
        app.socket.auth.nick = me.nick;
        close();
        toast('Takma adın güncellendi');
      });
    };
    setTimeout(() => input.select(), 30);
    return [
      h('div.sheet-head', {}, h('h2', {}, 'Takma adın'), h('button.x', { onclick: close, 'aria-label': 'Kapat' }, '✕')),
      h('p.muted.small', {}, 'Sohbette ve önerilerde bu adla görüneceksin.'),
      h('form.form', { onsubmit: save }, input, h('button.btn', { type: 'submit' }, 'Kaydet')),
    ];
  });
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
      ? `Demo modu: futbol API'sine ulaşılamadı (${p.error}). Simüle edilmiş canlı maçlar gösteriliyor.`
      : 'Demo modu: API anahtarı tanımlı değil. Simüle edilmiş canlı maçlar gösteriliyor; gerçek veriler için sunucuya API_FOOTBALL_KEY ekleyin.';
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
  app.view = m ? renderMatch(root, m[1]) : renderLobby(root);
}

window.addEventListener('hashchange', route);
if (!app.socket.connected) route();

export { mount, h };
