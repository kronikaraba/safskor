import { io } from '/vendor/socket.io.esm.min.js';
import { h, mount, storage, openSheet, closeSheet, toast, teamBadge } from './util.js';
import { renderLobby } from './lobby.js';
import { renderMatch } from './match.js';
import { renderLeaderboard } from './leaderboard.js';

// ------------------------------------------------------------------ kimlik
// Hesap sistemi yok (MVP): tarayıcıya özel anonim kimlik + takma ad.
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const me = {
  userId: storage.get('safskor.userId') || uid(),
  nick: storage.get('safskor.nick') || `Taraftar${Math.floor(1000 + Math.random() * 9000)}`,
  team: storage.get('safskor.team', null),
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
  let query = '';
  let picked = me.team;
  const input = h('input.input', { value: me.nick, maxlength: 20, minlength: 2, autocomplete: 'nickname', 'aria-label': 'Takma ad' });
  const search = h('input.input', { type: 'search', placeholder: 'Takım ara…', 'aria-label': 'Takım ara', autocomplete: 'off' });
  const list = h('div.team-list', { role: 'listbox', 'aria-label': 'Favori takım' });
  const chosen = h('div.team-chosen');
  const norm = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const drawTeams = () => {
    mount(chosen, picked ? [teamBadge(picked), h('b', {}, picked.name), h('button.btn.ghost.sm', { type: 'button', onclick: () => ((picked = null), drawTeams()) }, 'Kaldır')] : h('span.muted.small', {}, 'Henüz favori takım seçmedin.'));
    if (!teams) return mount(list, h('p.muted.small', {}, 'Takımlar yükleniyor…'));
    const q = norm(query.trim());
    const shown = teams.filter((t) => !q || norm(t.name).includes(q) || norm(t.short).includes(q)).slice(0, 60);
    mount(
      list,
      shown.length
        ? shown.map((t) =>
            h('button.team-opt', { type: 'button', role: 'option', class: picked?.id === t.id ? 'on' : '', 'aria-selected': String(picked?.id === t.id), onclick: () => ((picked = t), drawTeams()) }, teamBadge(t), h('span', {}, t.name)),
          )
        : h('p.muted.small', {}, 'Takım bulunamadı. Liste, sitede maçı görünen takımlardan oluşur.'),
    );
  };
  search.oninput = () => ((query = search.value), drawTeams());
  app.socket.emit('teams:list', {}, (r) => {
    teams = r?.teams ?? [];
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
        h('div.field', { role: 'group', 'aria-label': 'Favori takımın' }, h('span', {}, 'Favori takımın'), chosen, search, list),
        h('button.btn', { type: 'submit' }, 'Kaydet'),
      ),
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
  document.querySelector('.rank-link')?.classList.toggle('active', hash.startsWith('#/siralama'));
}

window.addEventListener('hashchange', route);
if (!app.socket.connected) route();

export { mount, h };
