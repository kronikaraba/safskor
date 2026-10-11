// Özel mesajlar (DM): üst bardaki zarf düğmesi, konuşma listesi ve birebir konuşma penceresi.
// Kullanıcılar birbirini yalnızca sunucunun verdiği herkese açık kimlikle (uid) tanır.
import { app } from './app.js';
import { h, mount, openSheet, closeSheet, toast, teamBadge, colorFor, timeText } from './util.js';

let btn = null;
let unread = 0;
/** Açık pencere: { kind: 'inbox', list } ya da { kind: 'chat', peer, messages, list, input, drawHead } */
let view = null;

export function initDm(el) {
  btn = el;
  btn.onclick = openInbox;
  drawBtn();
  app.socket.on('dm:unread', (d) => {
    unread = d?.count ?? 0;
    drawBtn();
  });
  app.socket.on('dm:new', onNew);
}

const send = (ev, payload) =>
  new Promise((resolve) =>
    app.socket.timeout(8000).emit(ev, payload, (err, r) => {
      if (err) r = { ok: false, error: 'Sunucu yanıt vermedi.' };
      if (!r?.ok) toast(r?.error || 'İşlem başarısız', 'err');
      resolve(r);
    }),
  );

const isOpen = (v) => v && view === v && v.list.isConnected;

function drawBtn() {
  mount(btn, mailIcon(), unread ? h('span.dm-badge', {}, unread > 99 ? '99+' : unread) : null);
  btn.setAttribute('aria-label', unread ? `Özel mesajlar, ${unread} okunmamış` : 'Özel mesajlar');
}

function onNew({ message, peer }) {
  const fromMe = message.from === app.me.uid;
  const other = fromMe ? message.to : message.from;
  if (view?.kind === 'chat' && view.peer.uid === other && isOpen(view)) {
    addMessage(view, message);
    if (!fromMe) app.socket.emit('dm:read', { with: other }, () => {});
    return;
  }
  if (view?.kind === 'inbox' && isOpen(view)) loadInbox();
  if (fromMe) return;
  const t = toast(`Yeni mesaj · ${peer?.nick ?? 'Taraftar'}: ${message.text}`, 'dm');
  if (t && peer) t.onclick = () => (t.remove(), openDm(peer));
}

// ------------------------------------------------------------------ konuşma listesi
export function openInbox() {
  const list = h('div.dm-threads', {}, h('p.muted.small', {}, 'Yükleniyor…'));
  view = { kind: 'inbox', list };
  openSheet((close) => [
    h('div.sheet-head', {}, h('h2', {}, 'Özel mesajlar'), h('button.x', { onclick: close, 'aria-label': 'Kapat' }, '✕')),
    list,
    h('p.muted.small.dm-hint', {}, 'Maç sohbetinde birinin adına dokunarak ona özel mesaj atabilirsin.'),
  ]);
  loadInbox();
}

async function loadInbox() {
  const v = view;
  const r = await send('dm:threads', {});
  if (!r?.ok || !isOpen(v)) return;
  mount(v.list, r.threads.length ? r.threads.map(threadRow) : h('p.muted.small', {}, 'Henüz özel mesajın yok.'));
}

function threadRow(t) {
  const mine = t.last.from === app.me.uid;
  return h(
    'button.dm-thread',
    { type: 'button', class: t.unread ? 'unread' : '', onclick: () => openDm(t) },
    avatar(t.nick),
    h('span.dm-tx', {}, h('b', {}, teamBadge(t.team), t.nick), h('span', {}, (mine ? 'Sen: ' : '') + t.last.text)),
    h('span.dm-meta', {}, h('span', {}, shortTime(t.last.createdAt)), t.unread ? h('span.dm-badge', {}, t.unread) : null),
  );
}

// ------------------------------------------------------------------ birebir konuşma
/** peer: { uid, nick, team } — sohbetteki bir mesajdan ya da konuşma listesinden */
export function openDm(peer) {
  if (!peer?.uid || peer.uid === app.me.uid) return;
  const list = h('div.dm-list', { 'aria-live': 'polite' }, h('p.muted.small', {}, 'Yükleniyor…'));
  const input = h('input.input', { maxlength: 500, placeholder: 'Mesaj yaz…', 'aria-label': 'Özel mesaj', autocomplete: 'off', enterkeyhint: 'send' });
  const head = h('div.sheet-head.dm-head');
  const v = { kind: 'chat', peer: { blocked: false, ...peer }, messages: null, list, input };
  v.drawHead = () =>
    mount(
      head,
      h('button.dm-back', { type: 'button', onclick: openInbox, 'aria-label': 'Konuşmalara dön' }, '‹'),
      avatar(v.peer.nick),
      h('div.dm-peer', {}, h('h2', {}, teamBadge(v.peer.team), v.peer.nick), h('div.muted.small', {}, v.peer.blocked ? 'Engelledin, sana mesaj atamaz' : 'Özel mesaj')),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => toggleBlock(v) }, v.peer.blocked ? 'Engeli kaldır' : 'Engelle'),
      h('button.x', { onclick: closeSheet, 'aria-label': 'Kapat' }, '✕'),
    );
  view = v;
  const submit = async (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    const r = await send('dm:send', { to: v.peer.uid, text });
    if (!r?.ok) return;
    if (input.value === text) input.value = '';
    addMessage(v, r.message);
  };
  openSheet(() => [head, list, h('form.cm-form.dm-form', { onsubmit: submit }, input, h('button.btn', { type: 'submit' }, 'Gönder'))]);
  v.drawHead();
  send('dm:history', { with: v.peer.uid }).then((r) => {
    if (!r?.ok || !isOpen(v)) return;
    v.peer = r.peer;
    v.messages = r.messages;
    v.drawHead();
    drawMessages(v);
  });
  if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
}

async function toggleBlock(v) {
  const block = !v.peer.blocked;
  if (block && !confirm(`${v.peer.nick} engellensin mi? Sana özel mesaj atamayacak.`)) return;
  const r = await send('dm:block', { uid: v.peer.uid, block });
  if (!r?.ok) return;
  v.peer.blocked = r.blocked;
  if (isOpen(v)) v.drawHead();
  toast(r.blocked ? `${v.peer.nick} engellendi` : `${v.peer.nick} için engel kaldırıldı`);
}

function addMessage(v, m) {
  if (!v.messages || v.messages.some((x) => x.id === m.id)) return;
  v.messages.push(m);
  if (isOpen(v)) drawMessages(v);
}

function drawMessages(v) {
  mount(
    v.list,
    v.messages.length
      ? v.messages.map((m) => {
          const mine = m.from === app.me.uid;
          return h('div.msg', { class: mine ? 'me' : '' }, h('div.bubble', {}, m.text), h('span.time', { title: new Date(m.createdAt).toLocaleString('tr-TR') }, shortTime(m.createdAt)));
        })
      : h('p.muted.small', {}, `${v.peer.nick} ile henüz mesajlaşmadın. İlk mesajı sen yaz!`),
  );
  requestAnimationFrame(() => (v.list.scrollTop = v.list.scrollHeight));
}

// ------------------------------------------------------------------ yardımcılar
function avatar(nick) {
  return h('span.dm-av', { '--c': colorFor(nick), 'aria-hidden': 'true' }, (nick || '?').slice(0, 1).toLocaleUpperCase('tr-TR'));
}

/** Bugünse saat, değilse gün ve ay */
function shortTime(ts) {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString() ? timeText(ts) : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function mailIcon() {
  const el = h('span.dm-ic', { 'aria-hidden': 'true' });
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>';
  return el;
}
