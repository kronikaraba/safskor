import { app } from './app.js';
import { h, mount, crest, storage, roundText, minuteText, dayText, icon, matchHref } from './util.js';
import { openTeam } from './team.js';

const FILTERS = [
  ['all', 'Tümü', () => true],
  ['live', 'Canlı', (m) => m.status === 'LIVE' || m.status === 'HT'],
  ['upcoming', 'Yaklaşan', (m) => m.status === 'SCHEDULED'],
];
const isLive = (m) => m.status === 'LIVE' || m.status === 'HT';
const hasStarted = (m) => m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';

const TABS = [
  ['yesterday', 'Dün', '/dun', 'Dünün maç sonuçları'],
  ['today', 'Bugün', '/', 'Bugünün maçları ve canlı skorlar'],
  ['tomorrow', 'Yarın', '/yarin', 'Yarının maçları'],
  ['table', 'Puan durumu', '/puan-durumu', 'Süper Lig puan durumu'],
];
const hhmm = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
// günler İstanbul saatine göre (yurt dışındaki ziyaretçide de "bugün" sitenin bugünü)
const istDay = (offset) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const dayFmt = (iso, opts) => new Date(`${iso}T12:00:00+03:00`).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', ...opts });
/** Tarih seçicideki günler: 7 gün geri, 7 gün ileri. Dün, bugün ve yarının kendi sayfası var */
const PICK_DAYS = Array.from({ length: 15 }, (_, i) => i - 7);
const DAY_PATH = { '-1': '/dun', 0: '/', 1: '/yarin' };
const calIcon = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return s;
};

/** tab: 'yesterday' (dünün maçları), 'today' (bugünün maçları), 'tomorrow' (yarının maçları), 'table' (puan durumu) */
export function renderLobby(root, tab = 'today') {
  let filter = storage.get('safskor.filter', 'all');
  if (!FILTERS.some((f) => f[0] === filter)) filter = 'all'; // kaldırılan "Biten" filtresi seçili kaldıysa
  let pickDate = null; // tarih seçiciden seçilen gün (dün/bugün/yarın dışında)
  let stripOpen = false;
  const dayCache = new Map(); // tarih -> maç listesi (null: alınamadı)
  let nextDay; // bugün maç yoksa sıradaki maç günü { date, matches } (undefined: sorulmadı, null: bulunamadı)
  let featuredId = null; // sağ sütunda gösterilen maç
  app.socket.emit('lobby:join');

  const chips = h('div.chips', { role: 'tablist' });
  const list = h('div.lobby-list');
  const clubs = h('section.panel.big4', { 'aria-label': 'Büyük 4' });
  const featured = h('div');
  const dateEl = h('div.lobby-date');
  const strip = h('div.date-strip', { hidden: true });
  const tabLinks = TABS.map(([key, label, href]) =>
    h('a.day-tab', { href, class: key === tab ? 'active' : '', 'aria-current': key === tab ? 'page' : null, onclick: () => pickDate && ((pickDate = null), refreshTabs(), drawList()) }, label),
  );
  function refreshTabs() {
    tabLinks.forEach((a, i) => {
      const on = !pickDate && TABS[i][0] === tab;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  const side = h('aside.lobby-side', {}, featured);
  const lobby = h(
    'div.lobby',
    {},
    h(
      'section.lobby-main',
      {},
      h('h1.sr-only', {}, TABS.find((t) => t[0] === tab)?.[3]),
      h(
        'div.lobby-head',
        {},
        h('nav.day-tabs', { 'aria-label': 'Maç günü' }, tabLinks),
        dateEl,
        strip,
        tab === 'today' ? chips : null,
      ),
      list,
    ),
    side,
  );
  mount(root, lobby);

  // Masaüstünde (Sofascore düzeni) solda maç listesi, sağda öne çıkan maç
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
    // Maç tarihine göre: en yakın maç önce, maçı olmayan sona
    const at = (c) => Date.parse(clubMatch(c)?.kickoff) || Infinity;
    mount(clubs, h('div.big4-grid', {}, [...cs].sort((a, b) => at(a) - at(b)).map(clubTile)));
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
      { href: matchHref(m), class: m.status.toLowerCase(), 'aria-label': `${c.name}: ${m.home.name} - ${m.away.name}, ${when}` },
      top,
      h('div.club-match', {}, crest(m.home, 'xs'), h('span.club-mid', {}, started ? `${m.score.home}-${m.score.away}` : time), crest(m.away, 'xs')),
      h('span.club-when', {}, when),
    );
  }

  // ---------------------------------------------------------------- tarih seçici
  /** Görünen gün: seçilen tarih ya da sekmenin günü */
  const shownDay = () => pickDate ?? istDay(tab === 'yesterday' ? -1 : tab === 'tomorrow' ? 1 : 0);
  function drawDateBtn() {
    const day = shownDay();
    const off = PICK_DAYS.find((o) => istDay(o) === day);
    const name = off === 0 ? 'Bugün' : off === -1 ? 'Dün' : off === 1 ? 'Yarın' : dayFmt(day, { weekday: 'long' });
    mount(
      dateEl,
      h(
        'button.date-btn',
        { type: 'button', 'aria-expanded': String(stripOpen), 'aria-label': 'Tarih seç', onclick: () => ((stripOpen = !stripOpen), drawStrip()) },
        calIcon(),
        h('span', {}, `${name} · ${dayFmt(day, { day: 'numeric', month: 'long' })}`),
        h('span.date-caret', {}, stripOpen ? '▴' : '▾'),
      ),
    );
  }
  function drawStrip() {
    drawDateBtn();
    strip.hidden = !stripOpen;
    if (!stripOpen) return;
    const cur = shownDay();
    mount(
      strip,
      PICK_DAYS.map((o) => {
        const d = istDay(o);
        const top = o === 0 ? 'Bugün' : o === -1 ? 'Dün' : o === 1 ? 'Yarın' : dayFmt(d, { weekday: 'short' });
        const attrs = { class: d === cur ? 'on' : '', 'aria-current': d === cur ? 'date' : null };
        const body = [h('span', {}, top), h('b', {}, dayFmt(d, { day: 'numeric' })), h('span', {}, dayFmt(d, { month: 'short' }))];
        // dün, bugün ve yarın kendi adreslerine gider; diğer günler bu sayfada açılır
        if (DAY_PATH[o]) return h('a.date-day', { ...attrs, href: DAY_PATH[o], onclick: () => ((stripOpen = false), pickDate && ((pickDate = null), refreshTabs(), drawList())) }, body);
        return h('button.date-day', { ...attrs, type: 'button', onclick: () => pick(d) }, body);
      }),
    );
    strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function pick(d) {
    pickDate = d;
    stripOpen = false;
    strip.hidden = true;
    refreshTabs();
    drawList();
  }
  function drawDay() {
    drawDateBtn();
    const label = dayFmt(pickDate, { day: 'numeric', month: 'long', weekday: 'long' });
    if (!dayCache.has(pickDate)) {
      const d = pickDate;
      mount(list, h('div.empty', {}, `${label} maçları yükleniyor…`));
      app.socket.timeout(10000).emit('day:get', { date: d }, (err, r) => {
        dayCache.set(d, !err && r?.ok ? r.matches : null);
        if (r?.demo) dayCache.set(d, 'demo');
        if (pickDate === d) drawList();
      });
      return;
    }
    const all = dayCache.get(pickDate);
    if (all === 'demo') return mount(list, h('div.empty', {}, 'Demo modunda başka günlerin maçları gösterilmiyor.'));
    if (!all) {
      dayCache.delete(pickDate); // bir dahaki açılışta yeniden dene
      return mount(list, h('div.empty', {}, `${label} maçları şu an alınamıyor. Biraz sonra tekrar dene.`));
    }
    if (!all.length) return mount(list, h('div.empty', {}, `${label} takip edilen liglerde maç yok.`));
    const past = pickDate < istDay(0);
    mount(list, h('p.muted.small.list-note', {}, past ? 'Maç odaları açık: sohbet, puanlar ve yorumlar duruyor.' : 'Maç odasına girip skor tahminini şimdiden yapabilirsin.'), groups(all));
  }

  function drawList() {
    chips.hidden = !!pickDate;
    if (pickDate) return drawDay();
    if (tab === 'tomorrow') return drawTomorrow();
    if (tab === 'yesterday') return drawYesterday();
    if (tab === 'table') return drawTable();
    drawDateBtn();
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
    if (!all.length && app.provider) return emptyToday();
    if (!shown.length) {
      mount(list, h('div.empty', {}, all.length ? 'Bu filtrede maç yok.' : 'Maçlar yükleniyor…'));
      return;
    }
    mount(list, groups(shown));
  }

  function groups(ms) {
    const by = new Map();
    for (const m of ms) {
      const key = m.competition.name || 'Diğer';
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(m);
    }
    // Süper Lig her zaman ilk, Premier League ikinci; diğerleri geldiği sırada
    const rank = (xs) => ({ 203: 0, 39: 1 })[xs[0].competition.id] ?? 2;
    return [...by.entries()].sort((a, b) => rank(a[1]) - rank(b[1])).map(([name, xs]) => compSection(name, xs));
  }

  // ---------------------------------------------------------------- bugün maç yoksa
  // Ekran boş kalmasın (Bat'ın isteği): sıradaki maç gününün maçları ve dünün sonuçları gösterilir.
  function emptyToday() {
    chips.hidden = true;
    if (app.tomorrow?.length) nextDay = { date: istDay(1), matches: app.tomorrow };
    else if (nextDay === undefined && app.tomorrow) {
      nextDay = 'loading';
      app.socket.timeout(15000).emit('day:next', {}, (err, r) => {
        nextDay = !err && r?.next?.matches?.length ? r.next : null;
        drawList();
        drawFeatured();
      });
    }
    const dayName = (d) => {
      const off = PICK_DAYS.find((o) => istDay(o) === d);
      return `${off === 1 ? 'Yarın' : dayFmt(d, { weekday: 'long' })} · ${dayFmt(d, { day: 'numeric', month: 'long' })}`;
    };
    const parts = [
      h('div.day-empty', {}, h('b', {}, 'Bugün takip edilen liglerde maç yok'), h('span', {}, 'Sıradaki maçlar aşağıda: odaya gir, skor tahminini şimdiden yap.')),
    ];
    if (nextDay === 'loading' || (nextDay === undefined && !app.tomorrow)) parts.push(h('p.muted.small.list-note', {}, 'Sıradaki maçlar yükleniyor…'));
    else if (nextDay) parts.push(h('h2.day-sep', {}, h('span', {}, 'Sıradaki maçlar'), h('b', {}, dayName(nextDay.date))), groups(nextDay.matches));
    if (app.yesterday?.length) parts.push(h('h2.day-sep', {}, h('span', {}, 'Dünün sonuçları'), h('b', {}, dayName(istDay(-1)).replace(/^[^·]+/, 'Dün '))), groups(app.yesterday));
    mount(list, parts);
  }

  // ---------------------------------------------------------------- yarının maçları
  function drawTomorrow() {
    drawDateBtn();
    const all = app.tomorrow;
    if (!all?.length) {
      const text = app.provider?.demo ? 'Demo modunda yarının maçları gösterilmiyor.' : all ? 'Yarın takip edilen liglerde maç yok.' : 'Yarının maçları yükleniyor…';
      return mount(list, h('div.empty', {}, text));
    }
    mount(list, h('p.muted.small.list-note', {}, 'Maç odasına girip skor tahminini şimdiden yapabilirsin.'), groups(all));
  }

  // ---------------------------------------------------------------- dünün maçları
  function drawYesterday() {
    drawDateBtn();
    const all = app.yesterday;
    if (!all?.length) {
      const text = app.provider?.demo ? 'Demo modunda dünün maçları gösterilmiyor.' : all ? 'Dün takip edilen liglerde maç yok.' : 'Dünün maçları yükleniyor…';
      return mount(list, h('div.empty', {}, text));
    }
    mount(list, h('p.muted.small.list-note', {}, 'Maç odaları açık: sohbet, puanlar ve yorumlar duruyor.'), groups(all));
  }

  // ---------------------------------------------------------------- puan durumu
  let tableAsked = false;
  function drawTable() {
    const t = app.standings;
    if (!t) {
      if (!tableAsked) {
        tableAsked = true;
        app.socket.timeout(8000).emit('standings:get', {}, (err, r) => {
          if (!err && r?.ok && r.standings) app.standings = r.standings;
          drawList();
        });
      }
      mount(dateEl);
      return mount(list, h('div.empty', {}, tableAsked && app.socket.connected && !app.provider?.demo ? 'Puan durumu yükleniyor…' : 'Puan durumu şu an alınamıyor.'));
    }
    const season = `${t.league.season}/${String(t.league.season + 1).slice(2)}`;
    mount(dateEl, `${season} sezonu`);
    const mine = app.me.team?.id;
    const zones = new Map();
    const rows = t.rows.map((r) => {
      const z = zoneOf(r.description);
      if (z) zones.set(z.key, z);
      // satıra basınca takım profili açılır
      const open = () => openTeam(r.team);
      return h(
        'tr.st-link',
        {
          class: [z ? `z-${z.key}` : '', r.team.id === mine ? 'mine' : ''].join(' ').trim(),
          tabindex: '0',
          'aria-label': `${r.team.name} takım profili`,
          onclick: open,
          onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()),
        },
        h('td.st-rank', {}, r.rank),
        h('td.st-team', {}, h('span', {}, crest(r.team, 'sm'), h('b', {}, r.team.name))),
        h('td', {}, r.played),
        h('td.st-w', {}, r.win),
        h('td.st-w', {}, r.draw),
        h('td.st-w', {}, r.lose),
        h('td.st-g', {}, `${r.goalsFor}:${r.goalsAgainst}`),
        h('td', {}, r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff),
        h('td.st-pts', {}, r.points),
      );
    });
    mount(
      list,
      h(
        'section.comp-card.st',
        {},
        h(
          'header.comp-head',
          {},
          t.league.logo ? h('img', { src: t.league.logo, alt: '' }) : h('span.comp-dot'),
          h('div.comp-name', {}, h('b', {}, t.league.name), h('span', {}, `${t.league.country ? `${t.league.country} · ` : ''}${season}`)),
        ),
        h(
          'div.st-wrap',
          {},
          h(
            'table.st-table',
            {},
            h(
              'thead',
              {},
              h('tr', {}, h('th.st-rank', { title: 'Sıra' }, '#'), h('th.st-team', {}, 'Takım'), h('th', { title: 'Oynanan' }, 'O'), h('th.st-w', { title: 'Galibiyet' }, 'G'), h('th.st-w', { title: 'Beraberlik' }, 'B'), h('th.st-w', { title: 'Mağlubiyet' }, 'M'), h('th.st-g', { title: 'Atılan:yenilen gol' }, 'Gol'), h('th', { title: 'Averaj' }, 'Av'), h('th.st-pts', { title: 'Puan' }, 'P')),
            ),
            h('tbody', {}, rows),
          ),
        ),
        zones.size ? h('div.st-legend', {}, [...zones.values()].map((z) => h('span', { class: `z-${z.key}` }, h('i'), z.label))) : null,
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
    const live = isLive(m);
    const started = hasStarted(m);
    const state =
      m.status === 'LIVE' ? `${m.minute ?? ''}${m.extra ? '+' + m.extra : ''}'` : m.status === 'HT' ? 'İY' : m.status === 'FT' ? 'MS' : m.status === 'POSTPONED' ? 'Ert.' : '';
    const lead = (side) => started && m.score[side] > m.score[side === 'home' ? 'away' : 'home'];
    return h(
      'a.mrow',
      { href: matchHref(m), class: live ? 'live' : '', 'aria-label': `${m.home.name} - ${m.away.name}` },
      h('div.mrow-time', {}, h('span', {}, hhmm(m.kickoff)), h('span.mrow-state', { class: m.status.toLowerCase() }, state)),
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
  }

  /** Öne çıkan maçlar: odadaki taraftar sayısı çoktan aza; eşitse canlılar, yaklaşanlar, bitenler */
  function picks() {
    const order = (m) => (isLive(m) ? 0 : m.status === 'SCHEDULED' ? 1 : 2);
    const time = (m) => Date.parse(m.kickoff) || 0;
    // bugün maç yoksa sağ sütunda sıradaki maç gününün maçları öne çıkar
    const src = app.matches?.length ? app.matches : nextDay?.matches || [];
    return [...src]
      .sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0) || order(a) - order(b) || (order(a) === 2 ? time(b) - time(a) : time(a) - time(b)))
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
    const href = matchHref(m);
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
            h('div.feat-score', { class: isLive(m) ? 'live' : '' }, started ? `${m.score.home} - ${m.score.away}` : hhmm(m.kickoff)),
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

  drawClubs();
  drawList();
  drawSide();
  app.onMatches = draw;
  app.onStandings = () => tab === 'table' && drawList();
  return {
    destroy() {
      wide.removeEventListener('change', onResize);
      app.socket.emit('lobby:leave');
    },
    rejoin() {
      app.socket.emit('lobby:join');
    },
  };
}

/** API-Football bölge açıklamasını Türkçe etikete ve renge çevirir */
function zoneOf(d) {
  if (!d) return null;
  const q = /qualif|play-?off|elem/i.test(d) ? ' elemesi' : '';
  if (/champions league/i.test(d)) return { key: q ? 'ucl-q' : 'ucl', label: `Şampiyonlar Ligi${q}` };
  if (/europa league/i.test(d)) return { key: q ? 'uel-q' : 'uel', label: `Avrupa Ligi${q}` };
  if (/conference league/i.test(d)) return { key: q ? 'uecl-q' : 'uecl', label: `Konferans Ligi${q}` };
  if (/relegation/i.test(d)) return { key: 'rel', label: 'Küme düşme' };
  return null;
}
