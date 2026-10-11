import { app } from './app.js';
import { h, mount, crest, statusPill, kickoffText, storage } from './util.js';

const FILTERS = [
  ['all', 'Tümü', () => true],
  ['live', 'Canlı', (m) => m.status === 'LIVE' || m.status === 'HT'],
  ['upcoming', 'Yaklaşan', (m) => m.status === 'SCHEDULED'],
  ['done', 'Biten', (m) => m.status === 'FT' || m.status === 'POSTPONED'],
];

export function renderLobby(root) {
  let filter = storage.get('safskor.filter', 'all');
  app.socket.emit('lobby:join');

  const chips = h('div.chips', { role: 'tablist' });
  const list = h('div');
  mount(
    root,
    h('div.lobby-head', {}, h('div', {}, h('h1', {}, 'Bugünün maçları'), h('p.muted.small', {}, 'Bir maç odasına gir: canlı sohbet et, oyuncuları puanla, taktik öner.')), chips),
    list,
  );

  // Telefonda Sofascore/Mackolik tarzı sıkı liste, geniş ekranda kartlar
  const compact = window.matchMedia('(max-width: 640px)');
  const onResize = () => draw();
  compact.addEventListener('change', onResize);

  function draw() {
    const all = app.matches || [];
    mount(
      chips,
      FILTERS.map(([key, label, fn]) =>
        h(
          'button.chip',
          { class: [key === filter ? 'active' : '', key === 'live' && all.some(fn) ? 'has-live' : ''].join(' ').trim(), role: 'tab', 'aria-selected': String(key === filter), onclick: () => ((filter = key), storage.set('safskor.filter', key), draw()) },
          label,
          h('span.count', {}, all.filter(fn).length),
        ),
      ),
    );
    const fn = FILTERS.find((f) => f[0] === filter)?.[2] ?? (() => true);
    const shown = all.filter(fn);
    if (!shown.length) {
      mount(list, h('div.empty', {}, all.length ? 'Bu filtrede maç yok.' : app.provider ? 'Bugün takip edilen liglerde maç yok.' : 'Maçlar yükleniyor…'));
      return;
    }
    const groups = new Map();
    for (const m of shown) {
      const key = m.competition.name || 'Diğer';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    if (compact.matches) {
      mount(list, [...groups.entries()].map(([name, ms]) => compSection(name, ms)));
      return;
    }
    mount(
      list,
      [...groups.entries()].map(([name, ms]) =>
        h(
          'section.comp',
          {},
          h('h2.comp-title', {}, ms[0].competition.logo && h('img', { src: ms[0].competition.logo, alt: '' }), name, ms[0].competition.country && h('span', { style: { fontWeight: 400 } }, `· ${ms[0].competition.country}`)),
          h('div.grid', {}, ms.map(card)),
        ),
      ),
    );
  }

  function compSection(name, ms) {
    const c = ms[0].competition;
    return h(
      'section.comp-card',
      {},
      h(
        'header.comp-head',
        {},
        c.logo ? h('img', { src: c.logo, alt: '' }) : h('span.comp-dot'),
        h('div.comp-name', {}, h('b', {}, name), c.country && h('span', {}, c.country)),
        h('span.comp-count', {}, ms.length),
      ),
      ms.map(row),
    );
  }

  function row(m) {
    const live = m.status === 'LIVE' || m.status === 'HT';
    const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
    const state =
      m.status === 'LIVE' ? `${m.minute ?? ''}${m.extra ? '+' + m.extra : ''}'` : m.status === 'HT' ? 'İY' : m.status === 'FT' ? 'MS' : m.status === 'POSTPONED' ? 'Ert.' : '-';
    const lead = (side) => started && m.score[side] > m.score[side === 'home' ? 'away' : 'home'];
    return h(
      'a.mrow',
      { href: `#/m/${m.id}`, class: live ? 'live' : '', 'aria-label': `${m.home.name} - ${m.away.name}` },
      h('div.mrow-time', {}, h('span', {}, kickoffText(m.kickoff)), h('span.mrow-state', { class: m.status.toLowerCase() }, state)),
      h(
        'div.mrow-teams',
        {},
        h('div.mrow-team', { class: lead('home') ? 'lead' : '' }, crest(m.home, 'sm'), h('span', {}, m.home.name)),
        h('div.mrow-team', { class: lead('away') ? 'lead' : '' }, crest(m.away, 'sm'), h('span', {}, m.away.name)),
      ),
      h('div.mrow-score', {}, started && [h('b', {}, m.score.home), h('b', {}, m.score.away)]),
      h('div.mrow-side', {}, m.viewers ? h('span.mrow-fans', { title: `${m.viewers} taraftar odada` }, `👥 ${m.viewers}`) : h('span.mrow-go', { 'aria-hidden': 'true' }, '›')),
    );
  }

  function card(m) {
    const live = m.status === 'LIVE' || m.status === 'HT';
    const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
    return h(
      'a.mcard',
      { href: `#/m/${m.id}`, class: live ? 'live' : '', 'aria-label': `${m.home.name} - ${m.away.name}` },
      h('div.team', {}, crest(m.home), h('span.name', {}, m.home.name)),
      h('div.mid', {}, h('div.score', {}, started ? `${m.score.home} - ${m.score.away}` : 'vs'), statusPill(m)),
      h('div.team', {}, crest(m.away), h('span.name', {}, m.away.name)),
      h(
        'div.mcard-foot',
        {},
        h('span', {}, m.competition.round || kickoffText(m.kickoff)),
        h('span', {}, m.viewers ? `👥 ${m.viewers} taraftar odada` : live ? 'Odaya ilk sen gir' : ''),
      ),
    );
  }

  draw();
  app.onMatches = draw;
  return {
    destroy() {
      compact.removeEventListener('change', onResize);
      app.socket.emit('lobby:leave');
    },
    rejoin() {
      app.socket.emit('lobby:join');
    },
  };
}
