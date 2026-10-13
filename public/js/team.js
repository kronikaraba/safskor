// Takım profili: takıma basınca açılan sayfa (künye, teknik direktör, lig sırası, son 5 ve sıradaki maçlar).
import { app } from './app.js';
import { h, crest, openSheet, closeSheet, matchHref, minuteText, roundText } from './util.js';

const cache = new Map(); // takım kimliği -> son alınan profil (sayfa açıkken anında göster, arkadan tazele)
const isLive = (m) => m.status === 'LIVE' || m.status === 'HT';
const started = (m) => m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
const hhmm = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const day = (iso) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });

/** team: { id, name, short, logo, color } (maç ya da puan durumundaki takım) */
export function openTeam(team) {
  if (!team?.id) return;
  let profile = cache.get(team.id) ?? null;
  let error = null;
  const sheet = openSheet((close) => view(team, profile, error, close));
  app.socket.timeout(12000).emit('team:get', { teamId: team.id }, (err, r) => {
    if (!err && r?.ok) cache.set(team.id, (profile = r.profile));
    else error = r?.error || 'Takım bilgisi şu an alınamıyor.';
    sheet.redraw();
  });
}

function view(team, p, error, close) {
  const t = p?.team ?? team;
  const sub = [t.country, t.founded && `Kuruluş ${t.founded}`].filter(Boolean).join(' · ');
  const head = h(
    'div.sheet-head.tp-head',
    {},
    crest(t, 'md'),
    h('div', {}, h('h2', {}, t.name), sub && h('div.muted.small', {}, sub)),
    h('button.x', { onclick: close, 'aria-label': 'Kapat' }, '✕'),
  );
  if (!p) return [head, h('p.muted', {}, error || 'Takım bilgileri yükleniyor…')];
  const v = t.venue;
  const info = [
    p.coach && ['Teknik direktör', p.coach.name],
    v && ['Stadyum', [v.name, v.city && v.city !== v.name ? ` (${v.city})` : '', v.capacity ? ` · ${v.capacity.toLocaleString('tr-TR')} kişilik` : ''].join('')],
  ].filter(Boolean);
  const st = p.standing;
  return [
    head,
    info.length ? h('dl.tp-info', {}, info.map(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])) : null,
    st && [
      h('div.tp-h', {}, h('b', {}, st.league)),
      h(
        'div.kv.tp-kv',
        {},
        kv(`${st.rank}.`, 'Sıra'),
        kv(st.points, 'Puan'),
        kv(`${st.win}-${st.draw}-${st.lose}`, 'G-B-M'),
        kv(st.played, 'Oynanan'),
        kv(`${st.goalsFor}:${st.goalsAgainst}`, 'Gol'),
        kv(st.goalsDiff > 0 ? `+${st.goalsDiff}` : st.goalsDiff, 'Averaj'),
      ),
    ],
    h('div.tp-h', {}, h('b', {}, 'Son 5 maç'), h('span.tp-form', {}, [...p.last].reverse().map((m) => badge(result(m, t.id))))),
    p.last.length ? h('div.tp-list', {}, p.last.map((m) => row(m, t.id))) : h('p.muted.small', {}, 'Maç bilgisi yok.'),
    p.next.length ? [h('div.tp-h', {}, h('b', {}, 'Sıradaki maçlar')), h('div.tp-list', {}, p.next.map((m) => row(m, t.id)))] : null,
  ];
}

const kv = (v, label) => h('div', {}, h('b', {}, v), h('span', {}, label));

/** G (galibiyet), B (beraberlik), M (mağlubiyet); maç bitmediyse null */
function result(m, id) {
  if (m.status !== 'FT') return null;
  const [mine, theirs] = m.home.id === id ? [m.score.home, m.score.away] : [m.score.away, m.score.home];
  return mine > theirs ? 'G' : mine < theirs ? 'M' : 'B';
}
const RES_TITLE = { G: 'Galibiyet', B: 'Beraberlik', M: 'Mağlubiyet' };
const badge = (r) => (r ? h('span.tp-res', { class: `r-${r}`, title: RES_TITLE[r] }, r) : null);

function row(m, id) {
  const home = m.home.id === id;
  const opp = home ? m.away : m.home;
  const live = isLive(m);
  const res = result(m, id);
  const comp = [m.competition.name, roundText(m.competition.round)].filter(Boolean).join(' · ');
  // demo profilindeki uydurma geçmiş maçların adresi yok
  return h(
    m.id ? 'a.tp-row' : 'div.tp-row',
    // aynı maçın sayfasındayken de sayfa kapanıp maça dönülsün
    { href: m.id ? matchHref(m) : null, class: live ? 'live' : '', 'aria-label': `${m.home.name} - ${m.away.name}`, onclick: m.id ? () => closeSheet() : null },
    h('div.tp-when', {}, h('span', {}, day(m.kickoff)), h('span.tp-state', {}, live ? minuteText(m) : m.status === 'FT' ? 'MS' : m.status === 'POSTPONED' ? 'Ert.' : hhmm(m.kickoff))),
    h('div.tp-mid', {}, h('div.tp-opp', {}, crest(opp, 'sm'), h('b', {}, opp.name), h('span.tp-ha', {}, home ? 'Ev' : 'Dep.')), h('div.tp-comp', {}, comp)),
    h('div.tp-score', {}, started(m) ? `${m.score.home}-${m.score.away}` : ''),
    badge(res) ?? h('span.tp-res.none'),
  );
}
