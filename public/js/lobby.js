import { app } from './app.js';
import { h, mount, crest, kickoffText, storage, roundText, minuteText, dayText, icon } from './util.js';
import { lbRow } from './leaderboard.js';

const FILTERS = [
  ['all', 'Tümü', () => true],
  ['live', 'Canlı', (m) => m.status === 'LIVE' || m.status === 'HT'],
  ['upcoming', 'Yaklaşan', (m) => m.status === 'SCHEDULED'],
  ['done', 'Biten', (m) => m.status === 'FT' || m.status === 'POSTPONED'],
];
const isLive = (m) => m.status === 'LIVE' || m.status === 'HT';
const hasStarted = (m) => m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';

export function renderLobby(root) {
  let filter = storage.get('safskor.filter', 'all');
  let featuredId = null; // sağ sütunda gösterilen maç
  let board = null; // haftalık sıralama özeti
  app.socket.emit('lobby:join');

  const chips = h('div.chips', { role: 'tablist' });
  const list = h('div.lobby-list');
  const clubs = h('section.panel.big4', { 'aria-label': 'Büyük 4' });
  const featured = h('div');
  const ranks = h('div');
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  const side = h('aside.lobby-side', {}, featured, ranks);
  const lobby = h(
    'div.lobby',
    {},
    h(
      'section.lobby-main',
      {},
      h('div.lobby-head', {}, h('div', {}, h('h1', {}, 'Bugünün maçları'), h('p.muted.small', {}, 'Bir maç odasına gir: canlı sohbet et, oyuncuları puanla, taktik öner.')), h('span.lobby-date', {}, `Bugün · ${today}`), chips),
      list,
    ),
    side,
  );
  mount(root, lobby);

  // Masaüstünde (Sofascore düzeni) solda maç listesi, sağda öne çıkan maç ve haftalık sıralama
  const wide = window.matchMedia('(min-width: 921px)');
  const onResize = () => (drawClubs(), drawSide());
  wide.addEventListener('change', onResize);

  function draw() {
    drawClubs();
    drawList();
    drawFeatured();
  }

  // ---------------------------------------------------------------- Büyük 4 (masaüstünde sağ sütunun başında, dar ekranda listenin üstünde)
  function drawClubs() {
    const cs = app.clubs || [];
    if (!cs.length) return clubs.remove();
    if (wide.matches) side.prepend(clubs);
    else lobby.prepend(clubs);
    mount(clubs, h('div.big4-grid', {}, cs.map(clubTile)));
  }

  /** Takımın gösterilecek maçı: bugünkü (canlı > yaklaşan > biten), yoksa sıradaki, o da yoksa son maçı */
  function clubMatch(c) {
    const ids = new Set(c.ids);
    const todays = (app.matches || []).filter((m) => ids.has(m.home.id) || ids.has(m.away.id));
    const today = todays.find(isLive) || todays.find((m) => m.status === 'SCHEDULED') || todays[todays.length - 1];
    if (today) return today;
    const ahead = c.next && Date.parse(c.next.kickoff) + 150 * 60_000 > Date.now();
    return (ahead && c.next) || c.last || c.next || null;
  }

  function clubTile(c) {
    const m = clubMatch(c);
    const top = h('div.club-top', {}, crest(c, 'md'), h('b', {}, c.name));
    if (!m) return h('div.club.none', {}, top, h('span.club-when', {}, 'Maç bilgisi yok'));
    const started = hasStarted(m);
    const time = new Date(m.kickoff).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const isToday = dayText(m.kickoff) === 'Bugün';
    const when =
      m.status === 'LIVE' ? `Canlı · ${minuteText(m)}` : m.status === 'HT' ? 'Devre arası' : m.status === 'POSTPONED' ? 'Ertelendi' : m.status === 'FT' ? (isToday ? 'Maç sonu' : `MS · ${dayText(m.kickoff)}`) : dayText(m.kickoff);
    return h(
      'a.club',
      { href: `#/m/${m.id}`, class: m.status.toLowerCase(), 'aria-label': `${c.name}: ${m.home.name} - ${m.away.name}, ${when}` },
      top,
      h('div.club-match', {}, crest(m.home, 'xs'), h('span.club-mid', {}, started ? `${m.score.home}-${m.score.away}` : time), crest(m.away, 'xs')),
      h('span.club-when', {}, when),
    );
  }

  function drawList() {
    const all = app.matches || [];
    mount(
      chips,
      FILTERS.map(([key, label, fn]) =>
        h(
          'button.chip',
          { class: [key === filter ? 'active' : '', key === 'live' && all.some(fn) ? 'has-live' : ''].join(' ').trim(), role: 'tab', 'aria-selected': String(key === filter), onclick: () => ((filter = key), storage.set('safskor.filter', key), drawList()) },
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
    mount(list, [...groups.entries()].map(([name, ms]) => compSection(name, ms)));
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
    const live = isLive(m);
    const started = hasStarted(m);
    const state =
      m.status === 'LIVE' ? `${m.minute ?? ''}${m.extra ? '+' + m.extra : ''}'` : m.status === 'HT' ? 'İY' : m.status === 'FT' ? 'MS' : m.status === 'POSTPONED' ? 'Ert.' : '';
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

  // ---------------------------------------------------------------- sağ sütun (yalnızca geniş ekran)
  function drawSide() {
    if (!wide.matches) return;
    drawFeatured();
    drawRanks();
    if (!board) loadRanks();
  }

  /** Öne çıkan maçlar: önce canlılar (en kalabalık oda önce), sonra yaklaşanlar, sonra bitenler */
  function picks() {
    const order = (m) => (isLive(m) ? 0 : m.status === 'SCHEDULED' ? 1 : 2);
    const time = (m) => Date.parse(m.kickoff) || 0;
    return [...(app.matches || [])]
      .sort((a, b) => order(a) - order(b) || (order(a) === 0 ? (b.viewers ?? 0) - (a.viewers ?? 0) : 0) || (order(a) === 2 ? time(b) - time(a) : time(a) - time(b)))
      .slice(0, 5);
  }

  function drawFeatured() {
    if (!wide.matches) return;
    const ms = picks();
    if (!ms.length) return mount(featured);
    const i = Math.max(0, ms.findIndex((x) => x.id === featuredId));
    const m = ms[i];
    featuredId = m.id;
    const started = hasStarted(m);
    const href = `#/m/${m.id}`;
    const show = (id) => ((featuredId = id), drawFeatured());
    mount(
      featured,
      h(
        'section.panel.feat',
        {},
        h(
          'a.feat-comp',
          { href },
          m.competition.logo ? h('img', { src: m.competition.logo, alt: '' }) : h('span.comp-dot'),
          h('span', {}, h('b', {}, m.competition.name), roundText(m.competition.round) && h('span.muted', {}, roundText(m.competition.round))),
        ),
        h(
          'a.feat-main',
          { href, 'aria-label': `${m.home.name} - ${m.away.name} maç odası` },
          h('div.feat-team', {}, crest(m.home, 'lg'), h('span', {}, m.home.name)),
          h(
            'div.feat-mid',
            {},
            h('div.feat-score', { class: isLive(m) ? 'live' : '' }, started ? `${m.score.home} - ${m.score.away}` : kickoffText(m.kickoff)),
            h('div.feat-state', { class: m.status.toLowerCase() }, started || m.status === 'POSTPONED' ? minuteText(m) : dayText(m.kickoff)),
          ),
          h('div.feat-team', {}, crest(m.away, 'lg'), h('span', {}, m.away.name)),
        ),
        h(
          'div.feat-foot',
          {},
          h('span.muted.small', {}, m.viewers ? `👥 ${m.viewers} taraftar odada` : isLive(m) ? 'Odaya ilk sen gir' : m.venue ? `🏟️ ${m.venue}` : ''),
          h('a.btn', { href }, 'Maç odasına gir'),
        ),
        ms.length > 1 &&
          h(
            'div.feat-nav',
            {},
            h('button', { type: 'button', onclick: () => show(ms[(i - 1 + ms.length) % ms.length].id) }, '‹ Önceki'),
            h(
              'div.feat-dots',
              {},
              ms.map((x, j) => h('button', { type: 'button', class: j === i ? 'on' : '', 'aria-label': `${x.home.name} - ${x.away.name}`, onclick: () => show(x.id) })),
            ),
            h('button', { type: 'button', onclick: () => show(ms[(i + 1) % ms.length].id) }, 'Sonraki ›'),
          ),
      ),
    );
  }

  function loadRanks() {
    app.socket.timeout(8000).emit('leaderboard:get', {}, (err, r) => {
      if (err || !r?.ok) return;
      board = r;
      drawRanks();
    });
  }

  function drawRanks() {
    if (!wide.matches) return;
    const head = h('div.panel-head', {}, h('h2.h-ic', {}, icon('haftalik-siralama-kupa'), 'Haftalık sıralama'), h('a.panel-link', { href: '#/siralama' }, 'Tümü ›'));
    if (!board) return mount(ranks, h('section.panel.side-rank', {}, head, h('p.muted.small', {}, 'Sıralama yükleniyor…')));
    const top = board.rows.slice(0, 5);
    const mine = board.me ?? board.rows.find((x) => x.me);
    mount(
      ranks,
      h(
        'section.panel.side-rank',
        {},
        head,
        top.length
          ? h('ol.lb-list', {}, top.map(lbRow), mine && !top.includes(mine) ? [h('li.lb-gap', {}, '⋯'), lbRow(mine)] : null)
          : h('p.muted.small', {}, 'Bu hafta henüz tahmin yok. Başlamamış bir maçta Taraftar > Anketler bölümünden ilk tahmini sen yap!'),
        h('p.muted.small.side-rules', {}, "Tam skor 3 puan · doğru sonuç 1 puan · ilk 11'de doğru bilinen her oyuncu +1 puan."),
      ),
    );
  }

  drawClubs();
  drawList();
  drawSide();
  app.onMatches = draw;
  return {
    destroy() {
      wide.removeEventListener('change', onResize);
      app.socket.emit('lobby:leave');
    },
    rejoin() {
      app.socket.emit('lobby:join');
      if (wide.matches) loadRanks();
    },
  };
}
