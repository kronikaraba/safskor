import { app, editNick } from './app.js';
import { h, mount, crest, statusPill, minuteText, ratingPill, timeText, toast, openSheet, colorFor, POS_TR, kickoffText, roundText, dayText, teamBadge, icon } from './util.js';
import { openShare } from './share.js';

const TABS = [
  ['chat', 'Sohbet'],
  ['summary', 'Özet'],
  ['lineups', 'Kadrolar'],
  ['predict', 'Tahmin'],
  ['fan', 'Taraftar'],
];
// Taraftar sekmesinin alt bölümleri: [anahtar, etiket, ikon]
const FAN_TABS = [
  ['ratings', 'Puanla', 'oyuncu-kupasi'],
  ['tactics', 'Taktik', 'taktik-oner'],
  ['subs', 'Değişiklik', 'degisiklik-talebi'],
  ['polls', 'Anketler', 'anketler'],
];

const EV_ICON = { goal: '⚽', penalty: '⚽', own_goal: '⚽', missed_penalty: '❌', yellow: '🟨', red: '🟥', sub: '🔁', var: '📺' };
const QUICK = ['⚽ Goool!', '🔥 Bastır!', '👏 Helal olsun', '😤 Hakem!', '🧤 Kaleci döktürdü', '🔁 Değişiklik şart'];

export function renderMatch(root, matchId) {
  const s = {
    match: null,
    fan: null,
    mine: null,
    meta: { formations: [], styles: [] },
    chat: [],
    presence: 0,
    // maça her girişte önce sohbet; masaüstünde sohbet sağ sütunda hep açık olduğundan özet
    tab: isNarrow() ? 'chat' : 'summary',
    fanTab: 'ratings',
    side: { lineups: 'home', tactics: 'home', subs: 'home' },
    unread: 0,
    tacticDraft: {},
  };

  const board = h('div');
  const tabs = h('nav.tabs', { role: 'tablist' });
  const body = h('div');
  const chatCol = h('aside.chat-col');
  mount(
    root,
    h('a.back', { href: '#/' }, '← Tüm maçlar'),
    h('div.match-layout', {}, h('div', {}, board, tabs, body), chatCol),
  );
  mount(body, h('div.empty', {}, 'Maç odası yükleniyor…'));

  const send = (ev, payload) =>
    new Promise((resolve) =>
      app.socket.timeout(8000).emit(ev, payload, (err, r) => {
        if (err) r = { ok: false, error: 'Sunucu yanıt vermedi.' };
        if (!r?.ok) toast(r?.error || 'İşlem başarısız', 'err');
        resolve(r);
      }),
    );

  // ---------------------------------------------------------------- socket
  function join() {
    app.socket.emit('match:join', { matchId }, (r) => {
      if (!r?.ok) {
        mount(body, h('div.empty', {}, r?.error || 'Maç bulunamadı.', h('br'), h('a', { href: '#/', style: { color: 'var(--accent)' } }, 'Maç listesine dön')));
        return;
      }
      s.match = r.match;
      s.fan = r.fan;
      s.mine = r.mine;
      s.meta = r.meta;
      s.chat = r.chat;
      drawBoard();
      drawTabs();
      drawBody();
      drawChat();
    });
  }

  const handlers = {
    match: (m) => {
      if (m.id !== matchId) return;
      const prev = s.match;
      s.match = m;
      drawBoard(prev && (prev.score.home !== m.score.home || prev.score.away !== m.score.away));
      refreshBody();
    },
    'fan:state': (f) => {
      if (f.matchId !== matchId) return;
      s.fan = f;
      refreshBody();
    },
    'fan:mine': (f) => {
      if (f.matchId !== matchId) return;
      s.mine = f;
      refreshBody();
    },
    presence: (p) => {
      if (p.matchId !== matchId) return;
      s.presence = p.count;
      drawPresence();
    },
    'chat:message': (msg) => {
      if (msg.matchId !== matchId) return;
      s.chat.push(msg);
      if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
      appendChat(msg);
      if (msg.kind === 'system' && /GOL/.test(msg.text)) toast(msg.text, 'goal');
      if (isNarrow() && s.tab !== 'chat' && msg.kind === 'user') {
        s.unread++;
        drawTabs();
      }
    },
  };
  for (const [ev, fn] of Object.entries(handlers)) app.socket.on(ev, fn);

  // ---------------------------------------------------------------- skor tabelası
  const presenceEl = h('span');
  function drawPresence() {
    presenceEl.textContent = `👥 ${s.presence || 1} taraftar odada`;
  }

  function drawBoard(flash = false) {
    const m = s.match;
    if (!m) return;
    const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
    const scorers = (side) =>
      m.events
        .filter((e) => e.side === side && ['goal', 'penalty', 'own_goal'].includes(e.type))
        .map((e) => `${e.player ?? ''} ${e.minute}'${e.type === 'penalty' ? ' (P)' : e.type === 'own_goal' ? ' (KK)' : ''}`);
    const board_ = h(
      'section.scoreboard',
      { '--hc': m.home.color || 'transparent', '--ac': m.away.color || 'transparent' },
      h('div.sb-comp', {}, [m.competition.name, roundText(m.competition.round)].filter(Boolean).join(' · ')),
      h(
        'div.sb-main',
        {},
        h('div.sb-team', {}, crest(m.home, 'lg'), h('span.name', {}, m.home.name), h('div.sb-scorers', {}, scorers('home').map((t) => h('div', {}, t)))),
        h(
          'div.sb-center',
          {},
          h('div.sb-score', { class: flash ? 'flash' : '' }, started ? `${m.score.home} - ${m.score.away}` : kickoffText(m.kickoff)),
          started || m.status === 'POSTPONED' ? statusPill(m) : h('span.status', {}, dayText(m.kickoff)),
        ),
        h('div.sb-team', {}, crest(m.away, 'lg'), h('span.name', {}, m.away.name), h('div.sb-scorers', {}, scorers('away').map((t) => h('div', {}, t)))),
      ),
      h('div.sb-foot', {}, m.venue && h('span', {}, `🏟️ ${m.venue}`), presenceEl),
    );
    mount(board, board_);
    drawPresence();
    document.title = `${m.home.short} ${started ? `${m.score.home}-${m.score.away}` : 'vs'} ${m.away.short} · ${minuteText(m)} · Safskor`;
  }

  // ---------------------------------------------------------------- sekmeler
  function drawTabs() {
    mount(
      tabs,
      TABS.map(([key, label]) =>
        h(
          'button.tab',
          {
            class: `${key === s.tab ? 'active' : ''} ${key === 'chat' ? 'chat-tab' : ''}`,
            role: 'tab',
            'aria-selected': String(key === s.tab),
            onclick: () => setTab(key),
          },
          label,
          key === 'chat' && s.unread ? h('span.badge', {}, s.unread > 99 ? '99+' : s.unread) : null,
        ),
      ),
    );
  }

  function setTab(key) {
    // alt bölüm anahtarları (ör. 'tactics') Taraftar sekmesinde o bölümü açar
    if (FAN_TABS.some(([k]) => k === key)) {
      s.fanTab = key;
      key = 'fan';
    }
    s.tab = key;
    if (key === 'chat') s.unread = 0;
    drawTabs();
    drawBody();
    chatCol.classList.toggle('show', key === 'chat');
    if (key === 'chat') {
      scrollChat();
    }
  }

  // Her sekme bir {el, update} döndürür; update yalnızca sonuçları yeniler, formlardaki girdiyi korur.
  let current = null;
  function drawBody() {
    if (!s.match) return;
    if (s.tab === 'chat' && isNarrow()) {
      mount(body);
      chatCol.classList.add('show');
      current = null;
      return;
    }
    if (s.tab === 'chat') s.tab = 'summary';
    chatCol.classList.remove('show');
    const view = { summary: Summary, predict: Predict, lineups: Lineups, fan: Fan }[s.tab] ?? Summary;
    current = view();
    mount(body, current.el);
    current.update();
  }
  function refreshBody() {
    current?.update();
    playerSheet?.redraw();
  }

  const sideToggle = (key, onChange) => {
    const m = s.match;
    return h(
      'div.seg',
      {},
      ['home', 'away'].map((side) =>
        h(
          'button',
          { class: s.side[key] === side ? 'active' : '', onclick: () => ((s.side[key] = side), onChange()) },
          h('span.dot', { '--c': m[side].color || colorFor(m[side].name) }),
          m[side].short,
        ),
      ),
    );
  };

  // --- Özet: olay akışı + istatistikler
  function Summary() {
    const el = h('div.stack');
    const stats = Stats();
    return {
      el,
      update() {
        const m = s.match;
        const evs = [...m.events].sort((a, b) => b.minute - a.minute || (b.extra ?? 0) - (a.extra ?? 0));
        const rows = [];
        if (m.status === 'FT') rows.push(h('li.tl-sep', {}, h('span', {}, `Maç sonu · ${m.score.home}-${m.score.away}`)));
        let prevSecond = false;
        for (const e of evs) {
          const second = e.minute > 45;
          if (prevSecond && !second) rows.push(h('li.tl-sep', {}, h('span', {}, 'Devre arası')));
          prevSecond = second;
          rows.push(eventRow(e, m));
        }
        mount(
          el,
          h(
            'div.card',
            {},
            h('h3', {}, 'Maç olayları', h('span.muted', {}, minuteText(m))),
            evs.length ? h('ul.timeline', {}, rows) : h('p.muted', {}, m.status === 'SCHEDULED' ? `Maç ${kickoffText(m.kickoff)}'de başlayacak. Bu sırada taktik önerini yap ve anketlere katıl!` : 'Henüz önemli bir olay yok.'),
          ),
          m.stats.length ? (stats.update(), stats.el) : null,
          fanSnapshot(),
        );
      },
    };
  }

  function eventRow(e, m) {
    const goal = ['goal', 'penalty', 'own_goal'].includes(e.type);
    const text =
      e.type === 'sub'
        ? [h('span.who', {}, `↑ ${e.related ?? ''}`), h('span.sub', {}, `↓ ${e.player ?? ''}`)]
        : [
            h('span.who', {}, e.player || (e.type === 'var' ? 'VAR' : '')),
            h('span.sub', {}, e.type === 'goal' && e.related ? `Asist: ${e.related}` : e.type === 'penalty' ? 'Penaltı' : e.type === 'own_goal' ? 'Kendi kalesine' : e.type === 'var' ? e.detail : e.type === 'missed_penalty' ? 'Kaçan penaltı' : ''),
          ];
    const ev = h('div.tl-ev', { class: `${e.side} ${goal ? 'goal' : ''}` }, h('span.ic', {}, EV_ICON[e.type] ?? '•'), h('div', {}, text.map((t, i) => (i ? [h('br'), t] : t))));
    return h('li.tl-row', {}, e.side === 'home' ? ev : h('div'), h('div.tl-min', {}, `${e.minute}${e.extra ? '+' + e.extra : ''}'`), e.side === 'away' ? ev : h('div'));
  }

  function fanSnapshot() {
    const f = s.fan;
    if (!f) return null;
    const best = topRated(1)[0];
    const winner = f.polls.find((p) => p.question.startsWith('Maçı kim kazanır'));
    return h(
      'div.card',
      {},
      h('h3', {}, 'Taraftarın nabzı'),
      best ? motm(best) : h('p.muted.small', {}, 'Henüz oyuncu puanı yok. "Taraftar" sekmesinden ilk puanı sen ver!'),
      winner && winner.total ? pollResult(winner) : null,
      h('div.pick', {}, s.match.status === 'FT' && h('button.btn.sm', { onclick: openCard }, '📤 Kartımı paylaş'), s.match.status === 'SCHEDULED' && h('button.btn.sm', { onclick: () => setTab('predict') }, '🎯 Skor tahmini yap'), h('button.btn.ghost.sm', { onclick: () => setTab('tactics') }, icon('taktik-oner'), 'Taktik öner'), h('button.btn.ghost.sm', { onclick: () => setTab('subs') }, icon('degisiklik-talebi'), 'Değişiklik iste'), h('button.btn.ghost.sm', { onclick: () => setTab('polls') }, icon('anketler'), 'Anketler')),
    );
  }

  // --- Tahmin: skor + isteğe bağlı ilk 11 (maç başlayınca kilitlenir, bitince puanlanır)
  function Predict() {
    const el = h('div.stack');
    const main = h('div.card');
    const extra = h('div');
    let draft = null;
    let mode = '';
    let savedJson = '';
    const isOpen = () => s.match.status === 'SCHEDULED' && Date.now() < Date.parse(s.match.kickoff);
    const initDraft = () => {
      const p = s.mine?.prediction;
      const side = p?.xiSide ?? (app.me.team?.id === s.match.away.id ? 'away' : 'home');
      draft = { home: p?.home ?? 0, away: p?.away ?? 0, xiSide: side, xi: new Set(p?.xiSide === side ? p.xi : []), xiOpen: Boolean(p?.xi?.length) };
    };
    const stepper = (key, label) =>
      h(
        'div.stepper',
        { role: 'group', 'aria-label': label },
        h('button', { type: 'button', 'aria-label': `${label} azalt`, onclick: () => ((draft[key] = Math.max(0, draft[key] - 1)), drawForm()) }, '−'),
        h('b', { 'aria-live': 'polite' }, draft[key]),
        h('button', { type: 'button', 'aria-label': `${label} artır`, onclick: () => ((draft[key] = Math.min(20, draft[key] + 1)), drawForm()) }, '+'),
      );
    const toggleXi = (id) => {
      if (draft.xi.has(id)) draft.xi.delete(id);
      else if (draft.xi.size >= 11) return toast('En fazla 11 oyuncu seçebilirsin', 'err');
      else draft.xi.add(id);
      drawForm();
    };
    const submit = async () => {
      if (draft.xi.size && draft.xi.size !== 11) return toast(`İlk 11 için tam 11 oyuncu seç (${draft.xi.size}/11) ya da seçimi temizle`, 'err');
      const r = await send('prediction:set', { home: draft.home, away: draft.away, xiSide: draft.xiSide, xi: [...draft.xi] });
      if (r?.ok) toast('🎯 Tahminin kaydedildi');
    };
    const drawForm = () => {
      const m = s.match;
      if (!draft) initDraft();
      const p = s.mine?.prediction;
      const l = m.lineups?.[draft.xiSide];
      const order = { G: 0, D: 1, M: 2, F: 3 };
      const squad = l ? [...l.startXI, ...l.subs].sort((a, b) => (order[a.pos] ?? 2) - (order[b.pos] ?? 2) || (a.number ?? 99) - (b.number ?? 99)) : [];
      mount(
        main,
        h('h3', {}, 'Skor tahminin', h('span.muted', {}, `${kickoffText(m.kickoff)}'de kilitlenir`)),
        h(
          'div.pred-score',
          {},
          h('div.pred-team', {}, crest(m.home), h('span', {}, m.home.short)),
          stepper('home', m.home.name),
          h('span.pred-sep', {}, '–'),
          stepper('away', m.away.name),
          h('div.pred-team', {}, crest(m.away), h('span', {}, m.away.short)),
        ),
        l
          ? h(
              'details.pred-xi',
              { open: draft.xiOpen || null, ontoggle: (e) => (draft.xiOpen = e.target.open) },
              h('summary', {}, 'İlk 11 tahmini (isteğe bağlı)', h('span.count', { class: draft.xi.size === 11 ? 'full' : '' }, `${draft.xi.size}/11`)),
              h('p.muted.small', {}, 'Doğru bildiğin her oyuncu +1 puan. Bir takım seç ve 11 oyuncu işaretle.'),
              h(
                'div.seg',
                {},
                ['home', 'away'].map((side) =>
                  h('button', { type: 'button', class: draft.xiSide === side ? 'active' : '', onclick: () => ((draft.xiSide = side), draft.xi.clear(), drawForm()) }, h('span.dot', { '--c': m[side].color || colorFor(m[side].name) }), m[side].short),
                ),
              ),
              h(
                'div.xi-grid',
                {},
                squad.map((pl) =>
                  h('button.xi-opt', { type: 'button', class: draft.xi.has(pl.id) ? 'on' : '', 'aria-pressed': String(draft.xi.has(pl.id)), onclick: () => toggleXi(pl.id) }, h('span.num', {}, pl.number ?? ''), h('span.nm', {}, pl.name), h('small', {}, POS_TR[pl.pos] ?? '')),
                ),
              ),
              draft.xi.size ? h('button.btn.ghost.sm', { type: 'button', onclick: () => (draft.xi.clear(), drawForm()) }, 'Seçimi temizle') : null,
            )
          : h('p.muted.small', {}, 'Kadrolar açıklanınca (genelde maçtan ~1 saat önce) ilk 11 tahmini de yapabileceksin.'),
        h('button.btn', { style: { width: '100%' }, onclick: submit }, p ? 'Tahminimi güncelle' : 'Tahmini kaydet'),
        p ? h('p.muted.small', { style: { margin: '8px 0 0', textAlign: 'center' } }, `Kayıtlı tahminin: ${p.home}-${p.away}${p.xi?.length ? ' · ilk 11 seçili' : ''}`) : null,
        h('p.muted.small', { style: { margin: '6px 0 0', textAlign: 'center' } }, 'Tam skor 3 puan · doğru sonuç 1 puan · ', h('a', { href: '#/siralama', style: { color: 'var(--accent)' } }, 'haftalık sıralama')),
      );
    };
    const drawLocked = () => {
      const m = s.match;
      const p = s.mine?.prediction;
      const ft = m.status === 'FT';
      const line = (a, b) => h('div.pred-line', {}, h('span', {}, a), h('b', {}, b));
      mount(
        main,
        h('h3', {}, 'Tahminin', h('span.muted', {}, ft ? 'Maç bitti' : 'Kilitlendi 🔒')),
        !p
          ? h('p.muted', {}, ft ? 'Bu maç için tahmin yapmamıştın.' : 'Maç başladı; bu maç için tahmin yapmadın. Sıradaki maçları kaçırma!')
          : h(
              'div.pred-result',
              {},
              line('Skor tahminin', `${p.home}-${p.away}`),
              ft && p.points != null
                ? [
                    line('Maç sonucu', `${m.score.home}-${m.score.away}`),
                    line(p.exact ? '🎯 Tam skor' : p.resultOk ? '✅ Doğru sonuç' : '❌ Sonuç tutmadı', `+${p.exact ? 3 : p.resultOk ? 1 : 0}`),
                    p.xi?.length ? line(`👕 İlk 11: ${p.xiHits}/11 doğru`, `+${p.xiHits}`) : null,
                    h('div.pred-total', {}, h('span', {}, 'Toplam'), h('b', {}, `${p.points} puan`)),
                  ]
                : h('p.muted.small', {}, ft ? 'Puanın hesaplanıyor…' : 'Maç bitince puanın burada görünecek.'),
            ),
        ft ? h('div.pick', { style: { marginTop: '12px' } }, h('button.btn.sm', { onclick: openCard }, '📤 Kartımı paylaş'), h('a.btn.ghost.sm', { href: '#/siralama' }, icon('oyuncu-kupasi'), 'Sıralama')) : null,
      );
    };
    const drawExtra = () => {
      const m = s.match;
      const st = s.fan?.predictions;
      const pct = (n) => (st.total ? Math.round((n / st.total) * 100) : 0);
      mount(
        extra,
        st?.total
          ? h(
              'div.card',
              {},
              h('h3', {}, 'Taraftarlar ne diyor?', h('span.muted', {}, `${st.total} tahmin`)),
              fbar(`${m.home.short} kazanır`, pct(st.result.home), `${pct(st.result.home)}%`),
              fbar('Beraberlik', pct(st.result.draw), `${pct(st.result.draw)}%`),
              fbar(`${m.away.short} kazanır`, pct(st.result.away), `${pct(st.result.away)}%`),
              h('div.muted.small', { style: { marginTop: '12px' } }, 'En çok tahmin edilen skorlar'),
              h('div.pick', {}, st.top.map((x) => h('span.chip', {}, `${x.home}-${x.away} · ${x.count}`))),
            )
          : h('div.card', {}, h('p.muted', { style: { margin: 0 } }, isOpen() ? 'Henüz kimse tahmin yapmadı. İlk sen ol!' : 'Bu maç için tahmin yapılmadı.')),
      );
    };
    mount(el, main, extra);
    return {
      el,
      update() {
        const now = isOpen() ? 'open' : s.match.status;
        // açık formda yalnızca kilit durumu değişince yeniden çiz (seçimler korunur)
        const saved = JSON.stringify(s.mine?.prediction ?? null);
        if (now !== mode || now !== 'open' || saved !== savedJson) {
          mode = now;
          savedJson = saved;
          if (now === 'open') drawForm();
          else drawLocked();
        }
        drawExtra();
      },
    };
  }

  function openCard() {
    const m = s.match;
    const all = m.lineups ? ['home', 'away'].flatMap((side) => [...m.lineups[side].startXI, ...m.lineups[side].subs]) : [];
    const best = Object.entries(s.mine?.ratings ?? {}).sort((a, b) => b[1] - a[1])[0];
    const pl = best && all.find((x) => x.id === best[0]);
    const p = s.mine?.prediction;
    openShare({
      match: m,
      nick: app.me.nick,
      team: app.me.team,
      motm: pl ? { name: pl.name, score: best[1] } : null,
      prediction: p ? { home: p.home, away: p.away, points: p.points } : null,
    });
  }

  // --- Kadrolar: saha + yedekler
  function Lineups() {
    const el = h('div.stack');
    const draw = () => {
      const m = s.match;
      if (!m.lineups) {
        mount(el, h('div.card', {}, h('p.muted', {}, 'Kadrolar henüz açıklanmadı. Genelde maçtan yaklaşık 1 saat önce yayınlanır.')));
        return;
      }
      const side = s.side.lineups;
      const team = m[side];
      const l = m.lineups[side];
      const marks = playerMarks(m, side);
      const color = team.color || colorFor(team.name);
      mount(
        el,
        h(
          'div.card',
          {},
          h('h3', {}, sideToggle('lineups', draw), h('span.muted', {}, `${l.formation ?? ''}${l.coach ? ` · TD: ${l.coach}` : ''}`)),
          h('p.muted.small', { style: { margin: '0 0 10px' } }, 'Sahadaki güncel 11. Bir oyuncuya dokun: istatistiklerini gör ve 10 üzerinden puanla. ★ = taraftar ortalaması.'),
          pitch(currentXI(m, side), color, marks, side),
        ),
        h(
          'div.card',
          {},
          h('h3', {}, 'Yedekler'),
          h('ul.plist', {}, l.subs.map((p) => playerRow(p, side, marks))),
        ),
      );
    };
    return { el, update: draw };
  }

  function pitch(players, color, marks, side) {
    const withGrid = players.every((p) => p.grid && /^\d+:\d+$/.test(p.grid));
    let rows;
    if (withGrid) {
      rows = new Map();
      for (const p of players) {
        const [r] = p.grid.split(':').map(Number);
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(p);
      }
      for (const arr of rows.values()) arr.sort((a, b) => Number(a.grid.split(':')[1]) - Number(b.grid.split(':')[1]));
    } else {
      const order = { G: 1, D: 2, M: 3, F: 4 };
      rows = new Map();
      for (const p of players) {
        const r = order[p.pos] ?? 3;
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(p);
      }
    }
    const keys = [...rows.keys()].sort((a, b) => a - b);
    const nodes = [];
    keys.forEach((r, i) => {
      const arr = rows.get(r);
      const y = 91 - (i / Math.max(1, keys.length - 1)) * 80;
      arr.forEach((p, j) => {
        const x = ((j + 1) / (arr.length + 1)) * 100;
        const mk = marks.get(p.id) ?? {};
        const fan = s.fan?.ratings[p.id];
        nodes.push(
          h(
            'button.pp',
            { class: mk.red ? 'out' : mk.in != null ? 'sub-in' : '', style: { left: `${x}%`, top: `${y}%` }, onclick: () => openPlayer(p, side), 'aria-label': `${p.name} puanla` },
            h('span.shirt', { '--c': color }, p.number ?? '', h('span.marks', {}, markIcons(mk))),
            h('span.pname', {}, shortName(p.name)),
            h('span.rt', {}, p.stats?.rating != null ? h('span', {}, p.stats.rating.toFixed(1)) : null, fan ? h('span.fan', {}, `★${fan.avg.toFixed(1)}`) : null),
          ),
        );
      });
    });
    return h('div.pitch', {}, nodes);
  }

  function playerRow(p, side, marks) {
    const mk = marks.get(p.id) ?? {};
    const fan = s.fan?.ratings[p.id];
    return h(
      'li',
      { style: { cursor: 'pointer' }, onclick: () => openPlayer(p, side), tabindex: 0, onkeydown: (e) => e.key === 'Enter' && openPlayer(p, side) },
      h('span.num', {}, p.number ?? ''),
      h('span.pn', {}, p.name, ' ', markIcons(mk), h('small', {}, [POS_TR[p.pos] ?? '', mk.in ? `${mk.in}' oyuna girdi` : ''].filter(Boolean).join(' · '))),
      p.stats?.rating != null ? ratingPill(p.stats.rating) : null,
      fan ? ratingPill(fan.avg, 'fan') : null,
    );
  }

  function markIcons(mk) {
    const out = [];
    for (let i = 0; i < (mk.goals ?? 0); i++) out.push('⚽');
    if (mk.yellow) out.push('🟨');
    if (mk.red) out.push('🟥');
    if (mk.out) out.push('🔻');
    if (mk.in) out.push('🔺');
    return out.join('');
  }

  // --- Taraftar: puanla, taktik, değişiklik, anketler tek sekmede
  function Fan() {
    const el = h('div.stack');
    const nav = h('nav.subtabs', { role: 'tablist' });
    const holder = h('div');
    let inner = null;
    const show = () => {
      mount(
        nav,
        FAN_TABS.map(([key, label, ic]) =>
          h(
            'button',
            { class: key === s.fanTab ? 'active' : '', role: 'tab', 'aria-selected': String(key === s.fanTab), onclick: () => ((s.fanTab = key), show()) },
            icon(ic),
            h('span', {}, label),
          ),
        ),
      );
      inner = ({ ratings: Ratings, tactics: Tactics, subs: Subs, polls: Polls }[s.fanTab] ?? Ratings)();
      mount(holder, inner.el);
      inner.update();
    };
    mount(el, nav, holder);
    show();
    return { el, update: () => inner?.update() };
  }

  // --- İstatistik (Özet içinde)
  function Stats() {
    const el = h('div');
    return {
      el,
      update() {
        const m = s.match;
        const hc = m.home.color || colorFor(m.home.name);
        const ac = m.away.color || colorFor(m.away.name);
        const rows = m.stats.map((st) => {
          const total = st.home + st.away || 1;
          const better = st.key === 'fouls' || st.key === 'yellow' || st.key === 'red' || st.key === 'offsides' ? (st.home < st.away ? 'home' : st.away < st.home ? 'away' : '') : st.home > st.away ? 'home' : st.away > st.home ? 'away' : '';
          const fmt = (v) => `${v}${st.unit ?? ''}`;
          return h(
            'div.stat',
            {},
            h('div.stat-head', {}, h('b', { class: better === 'home' ? 'win' : '' }, fmt(st.home)), h('span.lbl', {}, st.label), h('b', { class: better === 'away' ? 'win' : '' }, fmt(st.away))),
            h('div.bars', {}, h('span', {}, h('i', { '--c': hc, style: { width: `${(st.home / total) * 100}%` } })), h('span', {}, h('i', { '--c': ac, style: { width: `${(st.away / total) * 100}%` } }))),
          );
        });
        mount(
          el,
          h(
            'div.card',
            {},
            h('h3', {}, h('span', {}, h('span.dot', { '--c': hc }), ' ', m.home.short), 'Maç istatistikleri', h('span', {}, m.away.short, ' ', h('span.dot', { '--c': ac }))),
            rows.length ? rows : h('p.muted', {}, 'İstatistikler maç başlayınca görünecek.'),
          ),
        );
      },
    };
  }

  // --- Puanla: topluluk puanları
  function Ratings() {
    const el = h('div.stack');
    return {
      el,
      update() {
        const m = s.match;
        if (!m.lineups) return mount(el, h('div.card', {}, h('p.muted', {}, 'Kadrolar açıklanınca oyuncuları puanlayabileceksin.')));
        const locked = m.status === 'SCHEDULED' || m.status === 'POSTPONED';
        const teamAvg = (side) => {
          const ids = played(m, side).map((p) => p.id);
          const rs = ids.map((id) => s.fan?.ratings[id]).filter(Boolean);
          const votes = rs.reduce((a, r) => a + r.count, 0);
          return votes ? rs.reduce((a, r) => a + r.avg * r.count, 0) / votes : null;
        };
        const ha = teamAvg('home');
        const aa = teamAvg('away');
        const best = topRated(1)[0];
        const all = ['home', 'away'].flatMap((side) => played(m, side).map((p) => ({ p, side })));
        all.sort((a, b) => (s.fan?.ratings[b.p.id]?.avg ?? -1) - (s.fan?.ratings[a.p.id]?.avg ?? -1) || (b.p.stats?.rating ?? 0) - (a.p.stats?.rating ?? 0));
        const myCount = Object.keys(s.mine?.ratings ?? {}).length;
        mount(
          el,
          !locked &&
            h(
              'div.card.share-cta',
              {},
              h('div', {}, h('b', {}, 'Taraftar kartını paylaş'), h('div.muted.small', {}, 'Skor, maçın adamın ve tahminin tek görselde.')),
              h('button.btn.sm', { onclick: openCard }, '📤 Paylaş'),
            ),
          best ? motm(best) : null,
          h(
            'div.team-avg',
            {},
            h('div', {}, h('span.muted.small', {}, `${m.home.short} taraftar ortalaması`), h('b', {}, ha != null ? ha.toFixed(1) : '–')),
            h('div', {}, h('span.muted.small', {}, `${m.away.short} taraftar ortalaması`), h('b', {}, aa != null ? aa.toFixed(1) : '–')),
          ),
          h(
            'div.card',
            {},
            h('h3', {}, 'Topluluk puanları', h('span.muted', {}, locked ? 'Maç başlayınca açılır' : `${myCount} oyuncuyu puanladın`)),
            h('p.muted.small', { style: { margin: '0 0 6px' } }, 'Gri: API puanı · Sarı: taraftar ortalaması (oy sayısı). Puanlamak için oyuncuya dokun.'),
            h(
              'ul.plist',
              {},
              all.map(({ p, side }) => {
                const fan = s.fan?.ratings[p.id];
                const mine = s.mine?.ratings[p.id];
                return h(
                  'li',
                  { style: { cursor: 'pointer' }, onclick: () => openPlayer(p, side), tabindex: 0, onkeydown: (e) => e.key === 'Enter' && openPlayer(p, side) },
                  h('span.dot', { '--c': m[side].color || colorFor(m[side].name) }),
                  h('span.pn', {}, p.name, h('small', {}, `${m[side].short} · ${POS_TR[p.pos] ?? ''}${mine != null ? ` · Senin puanın: ${mine}` : ''}`)),
                  ratingPill(p.stats?.rating),
                  h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, ratingPill(fan?.avg, 'fan'), h('small.muted', { style: { fontSize: '10.5px' } }, fan ? `${fan.count} oy` : '')),
                );
              }),
            ),
          ),
        );
      },
    };
  }

  // --- Taktik önerileri ve taktik anketi
  function Tactics() {
    const el = h('div.stack');
    const formCard = h('div.card');
    const results = h('div.stack');
    const drawForm = () => {
      const m = s.match;
      const side = s.side.tactics;
      const prev = s.mine?.tactics?.[side];
      const d = (s.tacticDraft[side] ??= { formation: prev?.formation ?? m.lineups?.[side]?.formation ?? '4-3-3', style: prev?.style ?? 'Dengeli', note: prev?.note ?? '' });
      if (!s.meta.formations.includes(d.formation)) d.formation = s.meta.formations[0];
      const note = h('textarea.input', { rows: 2, maxlength: 200, placeholder: 'Örn: Sol kanattan bindirme yapılmalı, 10 numara daha önde oynamalı…' });
      note.value = d.note;
      note.oninput = () => (d.note = note.value);
      const pickRow = (list, key) =>
        h(
          'div.pick',
          {},
          list.map((v) => h('button.chip', { type: 'button', class: d[key] === v ? 'active' : '', onclick: () => ((d[key] = v), drawForm()) }, v)),
        );
      mount(
        formCard,
        h('h3', {}, h('span.h-ic', {}, icon('taktik-oner'), 'Taktik önerin'), sideToggle('tactics', () => (drawForm(), drawResults()))),
        h(
          'form.form',
          {
            onsubmit: async (e) => {
              e.preventDefault();
              const r = await send('tactic:submit', { side, formation: d.formation, style: d.style, note: d.note });
              if (r?.ok) toast(prev ? 'Önerin güncellendi' : 'Önerin taraftar anketine eklendi');
            },
          },
          h('label', {}, `Diziliş${m.lineups?.[side]?.formation ? ` (sahada: ${m.lineups[side].formation})` : ''}`, pickRow(s.meta.formations, 'formation')),
          h('label', {}, 'Oyun anlayışı', pickRow(s.meta.styles, 'style')),
          h('label', {}, 'Notun (isteğe bağlı)', note),
          h('button.btn', { type: 'submit' }, prev ? 'Önerimi güncelle' : 'Öneriyi gönder'),
        ),
      );
    };
    const drawResults = () => {
      const m = s.match;
      const side = s.side.tactics;
      const t = s.fan?.tactics?.[side];
      const mine = s.mine?.tactics?.[side];
      const likes = new Set(s.mine?.tacticLikes ?? []);
      mount(
        results,
        h(
          'div.card',
          {},
          h('h3', {}, `${m[side].name} için taraftar taktik anketi`, h('span.muted', {}, `${t?.total ?? 0} öneri`)),
          !t?.total
            ? h('p.muted', {}, 'Henüz öneri yok. İlk taktiği sen öner!')
            : [
                h('div.muted.small', {}, 'Diziliş tercihi'),
                t.formations.map((x) => fbar(x.value, x.pct, `${x.pct}% · ${x.count}`, mine?.formation === x.value)),
                h('div.muted.small', { style: { marginTop: '12px' } }, 'Oyun anlayışı'),
                t.styles.map((x) => fbar(x.value, x.pct, `${x.pct}% · ${x.count}`, mine?.style === x.value)),
              ],
        ),
        t?.notes?.length
          ? h(
              'div.card',
              {},
              h('h3', {}, 'Öne çıkan taktik notları'),
              t.notes.map((n) =>
                h(
                  'div.req',
                  {},
                  h('div.swap', {}, n.note, h('small', {}, `${n.nick} · ${n.formation} · ${n.style}`)),
                  h('button.vote-btn', { class: likes.has(n.id) ? 'on' : '', onclick: () => send('tactic:like', { id: n.id }), 'aria-pressed': String(likes.has(n.id)) }, `👍 ${n.likes}`),
                ),
              ),
            )
          : null,
      );
    };
    mount(el, formCard, results);
    drawForm();
    return { el, update: drawResults };
  }

  // --- Oyuncu değişikliği talepleri
  function Subs() {
    const el = h('div.stack');
    const formCard = h('div.card');
    const results = h('div.stack');
    const draft = { out: '', in: '' };
    const drawForm = () => {
      const m = s.match;
      const side = s.side.subs;
      const open = m.status === 'LIVE' || m.status === 'HT';
      if (!m.lineups) return mount(formCard, h('p.muted', {}, 'Kadrolar açıklanınca değişiklik talep edebileceksin.'));
      const { pitch: onP, bench } = squadState(m, side);
      const sel = (list, key, ph) => {
        const el = h('select.input', { required: true, onchange: (e) => (draft[key] = e.target.value) }, h('option', { value: '' }, ph), list.map((p) => h('option', { value: p.id }, `${p.number ?? ''} ${p.name}${p.stats?.rating != null ? ` (${p.stats.rating.toFixed(1)})` : ''}`)));
        el.value = list.some((p) => p.id === draft[key]) ? draft[key] : '';
        return el;
      };
      mount(
        formCard,
        h('h3', {}, h('span.h-ic', {}, icon('degisiklik-talebi'), 'Değişiklik talep et'), sideToggle('subs', () => ((draft.out = draft.in = ''), drawForm(), drawResults()))),
        !open
          ? h('p.muted', {}, m.status === 'FT' ? 'Maç bitti; talepler aşağıda arşivlendi.' : 'Değişiklik talepleri maç başlayınca açılır.')
          : h(
              'form.form',
              {
                onsubmit: async (e) => {
                  e.preventDefault();
                  if (!draft.out || !draft.in) return toast('İki oyuncuyu da seç', 'err');
                  const r = await send('sub:request', { side, outId: draft.out, inId: draft.in });
                  if (r?.ok) {
                    toast('Talebin oylamaya açıldı');
                    draft.out = draft.in = '';
                    drawForm();
                  }
                },
              },
              h('div.row2', {}, h('label', {}, '🔻 Çıksın', sel(onP, 'out', 'Sahadaki oyuncu')), h('label', {}, '🔺 Girsin', sel(bench, 'in', 'Yedek oyuncu'))),
              h('button.btn', { type: 'submit' }, 'Talep et'),
            ),
      );
    };
    const drawResults = () => {
      const m = s.match;
      if (!m.lineups) return mount(results);
      const side = s.side.subs;
      const list = s.fan?.subs?.[side] ?? [];
      const voted = new Set(s.mine?.subVotes ?? []);
      const own = new Set(s.mine?.subOwn ?? []);
      const max = Math.max(1, ...list.map((x) => x.votes));
      const { pitch: onP } = squadState(m, side);
      mount(
        results,
        h(
          'div.card',
          {},
          h('h3', {}, `${m[side].name} taraftarı ne istiyor?`, h('span.muted', {}, `${list.length} talep`)),
          !list.length
            ? h('p.muted', {}, 'Henüz talep yok.')
            : list.map((r) => {
                const made = m.events.some((e) => e.type === 'sub' && e.side === side && e.playerId === r.outId && e.relatedId === r.inId);
                const gone = !onP.some((p) => p.id === r.outId);
                return h(
                  'div',
                  {},
                  h(
                    'div.req',
                    {},
                    h(
                      'div.swap',
                      {},
                      h('span.out', {}, `🔻 ${r.outName}`),
                      '  ',
                      h('span.in', {}, `🔺 ${r.inName}`),
                      h('small', {}, `${r.nick} önerdi`, made ? h('span.done-tag', {}, ' · ✅ Teknik direktör bu değişikliği yaptı!') : gone ? ' · oyuncu artık sahada değil' : ''),
                    ),
                    own.has(r.id)
                      ? h('span.vote-btn.on.own', { title: 'Senin talebin, desteğin sayıldı' }, `✓ ${r.votes}`)
                      : h('button.vote-btn', { class: voted.has(r.id) ? 'on' : '', onclick: () => send('sub:vote', { id: r.id }), 'aria-pressed': String(voted.has(r.id)) }, `${voted.has(r.id) ? '✓ ' : '+ '}${r.votes}`),
                  ),
                  h('div.fbar-track', { style: { height: '4px', marginTop: '-4px', marginBottom: '6px' } }, h('i', { style: { width: `${(r.votes / max) * 100}%` } })),
                );
              }),
        ),
      );
    };
    mount(el, formCard, results);
    drawForm();
    let lastEvents = s.match.events.length;
    return {
      el,
      update() {
        // sahadaki oyuncular değiştiyse (yeni değişiklik / kart) formu yenile
        if (s.match.events.length !== lastEvents || !formCard.querySelector('form')) {
          lastEvents = s.match.events.length;
          drawForm();
        }
        drawResults();
      },
    };
  }

  // --- Anketler
  function Polls() {
    const el = h('div.stack');
    const list = h('div.card');
    const drawList = () => {
      const polls = s.fan?.polls ?? [];
      mount(list, h('h3', {}, h('span.h-ic', {}, icon('anketler'), 'Anketler'), h('span.muted', {}, 'Oy verdikten sonra fikrini değiştirebilirsin')), polls.map((p) => pollCard(p)));
    };
    mount(el, list);
    return { el, update: drawList };
  }

  function pollCard(p) {
    const mine = s.mine?.polls?.[p.id];
    const voted = mine != null;
    return h(
      'div.poll',
      {},
      h('div.poll-q', {}, h('span', {}, p.question), h('span.muted.small', {}, `${p.total} oy${p.kind === 'user' && p.nick ? ` · ${p.nick}` : ''}`)),
      p.options.map((o, i) => {
        const pct = p.total ? Math.round((o.votes / p.total) * 100) : 0;
        return h(
          'button.poll-opt',
          { class: mine === i ? 'mine' : '', onclick: () => send('poll:vote', { pollId: p.id, option: i }), 'aria-pressed': String(mine === i) },
          h('span.fill', { style: { width: voted ? `${pct}%` : '0%' } }),
          h('span.lbl', {}, h('span', {}, mine === i ? `✓ ${o.label}` : o.label), voted ? h('span.pct', {}, `${pct}%`) : null),
        );
      }),
    );
  }

  function pollResult(p) {
    return h(
      'div',
      { style: { margin: '6px 0 12px' } },
      h('div.muted.small', {}, `${p.question} (${p.total} oy)`),
      p.options.map((o) => fbar(o.label, p.total ? Math.round((o.votes / p.total) * 100) : 0, `${p.total ? Math.round((o.votes / p.total) * 100) : 0}%`, s.mine?.polls?.[p.id] === p.options.indexOf(o))),
    );
  }

  function fbar(label, pct, right, mine) {
    return h('div.fbar', { class: mine ? 'mine' : '' }, h('div.fbar-head', {}, h('span', {}, mine ? `✓ ${label}` : label), h('span', {}, right)), h('div.fbar-track', {}, h('i', { style: { width: `${pct}%` } })));
  }

  function motm({ p, side, fan }) {
    return h(
      'div.motm',
      {},
      icon('oyuncu-kupasi', 'trophy'),
      h('div', {}, h('div.muted.small', {}, 'Taraftarın maçın adamı'), h('b', {}, p.name), h('div.muted.small', {}, `${s.match[side].name} · ${fan.count} oy`)),
      h('span.big', {}, fan.avg.toFixed(1)),
    );
  }

  function topRated(n) {
    const m = s.match;
    if (!m?.lineups || !s.fan) return [];
    const all = ['home', 'away'].flatMap((side) => played(m, side).map((p) => ({ p, side, fan: s.fan.ratings[p.id] }))).filter((x) => x.fan);
    // az oylu oyuncuların öne geçmemesi için basit Bayes ortalaması
    const score = (x) => (x.fan.avg * x.fan.count + 6 * 2) / (x.fan.count + 2);
    return all.sort((a, b) => score(b) - score(a)).slice(0, n);
  }

  // ---------------------------------------------------------------- oyuncu kartı
  let playerSheet = null;
  function openPlayer(p, side) {
    playerSheet = openSheet((close) => {
      const m = s.match;
      const fresh = [...(m.lineups?.[side]?.startXI ?? []), ...(m.lineups?.[side]?.subs ?? [])].find((x) => x.id === p.id) ?? p;
      const st = fresh.stats ?? {};
      const fan = s.fan?.ratings[p.id];
      const mine = s.mine?.ratings[p.id];
      const locked = m.status === 'SCHEDULED' || m.status === 'POSTPONED';
      return [
        h(
          'div.sheet-head',
          {},
          h('span.crest', { '--c': m[side].color || colorFor(m[side].name) }, fresh.number ?? ''),
          h('div', {}, h('h2', {}, fresh.name), h('div.muted.small', {}, `${m[side].name} · ${POS_TR[fresh.pos] ?? ''}`)),
          h('button.x', { onclick: close, 'aria-label': 'Kapat' }, '✕'),
        ),
        h(
          'div.kv',
          {},
          kv(st.rating != null ? st.rating.toFixed(1) : '–', 'API puanı'),
          kv(fan ? fan.avg.toFixed(1) : '–', `Taraftar (${fan?.count ?? 0} oy)`),
          kv(st.minutes ?? 0, 'Dakika'),
          kv(st.goals ?? 0, 'Gol'),
          kv(st.assists ?? 0, 'Asist'),
          kv(`${st.shots ?? 0} / ${st.passes ?? 0}`, 'Şut / Pas'),
        ),
        h('div', {}, h('b', {}, 'Senin puanın'), mine != null ? h('span.muted.small', {}, ` · şu an ${mine}, değiştirebilirsin`) : null),
        locked
          ? h('p.muted', {}, 'Puanlama maç başlayınca açılır.')
          : h(
              'div.score-pick',
              { role: 'radiogroup', 'aria-label': '0 ile 10 arası puan' },
              Array.from({ length: 11 }, (_, i) =>
                h('button', { class: mine === i ? 'on' : '', role: 'radio', 'aria-checked': String(mine === i), onclick: () => send('rating:set', { playerId: p.id, score: i }) }, i),
              ),
            ),
      ];
    });
  }
  const kv = (v, label) => h('div', {}, h('b', {}, v), h('span', {}, label));

  // ---------------------------------------------------------------- sohbet
  const chatList = h('div.chat-list', { 'aria-live': 'polite' });
  const chatInput = h('input.input', { maxlength: 280, placeholder: 'Mesaj yaz…', 'aria-label': 'Sohbet mesajı', autocomplete: 'off', enterkeyhint: 'send' });
  const chatHead = h('div.chat-head');
  function drawChat() {
    const typing = document.activeElement === chatInput;
    mount(
      chatCol,
      h(
        'div.chat',
        {},
        chatHead,
        chatList,
        // telefonda ekranın altına yapışan alt kısım: hızlı tepkiler + yazı kutusu
        h(
          'div.chat-foot',
          {},
          h('div.chat-quick', {}, QUICK.map((q) => h('button', { type: 'button', onclick: () => sendChat(q) }, q))),
          h(
            'form.chat-form',
            { onsubmit: (e) => (e.preventDefault(), sendChat(chatInput.value)) },
            chatInput,
            h('button.btn', { type: 'submit' }, 'Gönder'),
          ),
        ),
      ),
    );
    mount(chatHead, h('b', {}, '💬 Maç odası sohbeti'), h('button.btn.ghost.sm', { onclick: editNick, title: 'Takma adını değiştir' }, app.me.nick));
    mount(chatList, s.chat.length ? s.chat.map(chatMsg) : h('p.muted.small', { style: { textAlign: 'center' } }, 'Sohbeti ilk sen başlat!'));
    scrollChat(true);
    if (typing) chatInput.focus({ preventScroll: true }); // yeniden çizim yazmayı kesmesin
  }
  async function sendChat(text) {
    if (!text.trim()) return;
    const r = await send('chat:send', { text });
    if (r?.ok && text === chatInput.value) chatInput.value = '';
  }
  function chatMsg(msg) {
    if (msg.kind === 'system') return h('div.msg.sys', { class: /GOL|gol/.test(msg.text) ? 'goal' : '' }, h('div.bubble', {}, msg.text));
    const mine = msg.userId === app.me.userId;
    return h(
      'div.msg',
      { class: mine ? 'me' : '' },
      h('div.who', { '--nc': colorFor(msg.nick) }, teamBadge(msg.team), mine ? 'Sen' : msg.nick, msgTime(msg)),
      h('div.bubble', {}, msg.text),
    );
  }
  // Telefonda sohbet ayrı bir kaydırma kutusu değil, sayfanın kendisi kayar (her yerden sürüklenebilsin)
  const pageScroll = () => isNarrow();
  /** Mesaj üstünde maç dakikası; üstüne gelince (masaüstü) ya da basılı tutunca (telefon) saat görünür */
  function msgTime(msg) {
    const clock = timeText(msg.createdAt);
    const label = msg.minute || clock;
    const el = h('span.time', { title: clock }, label);
    if (!msg.minute) return el;
    let timer = null;
    const show = () => (el.textContent = clock, el.classList.add('clock'));
    const hide = () => (el.textContent = label, el.classList.remove('clock'));
    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      timer = setTimeout(() => {
        show();
        setTimeout(hide, 2500);
      }, 350);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => clearTimeout(timer));
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // uzun basışta menü açılmasın
    return el;
  }

  function appendChat(msg) {
    const el = document.documentElement;
    const nearBottom = pageScroll()
      ? window.innerHeight + window.scrollY >= el.scrollHeight - 160
      : chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 80;
    if (chatList.firstChild?.tagName === 'P') chatList.replaceChildren();
    chatList.append(chatMsg(msg));
    while (chatList.childElementCount > 300) chatList.firstChild.remove();
    if (nearBottom || msg.userId === app.me.userId) scrollChat();
  }
  function scrollChat() {
    requestAnimationFrame(() => {
      if (!pageScroll()) chatList.scrollTop = chatList.scrollHeight;
      else if (s.tab === 'chat') window.scrollTo(0, document.documentElement.scrollHeight);
    });
  }

  // ---------------------------------------------------------------- yardımcılar
  const onResize = () => {
    if (!isNarrow() && s.tab === 'chat') setTab('summary');
  };
  window.addEventListener('resize', onResize);

  join();
  app.onProfile = () => s.match && drawChat();

  return {
    destroy() {
      app.onProfile = null;
      app.socket.emit('match:leave');
      for (const [ev, fn] of Object.entries(handlers)) app.socket.off(ev, fn);
      window.removeEventListener('resize', onResize);
      document.title = 'Safskor · Canlı Taraftar Platformu';
    },
    rejoin: join,
  };
}

function isNarrow() {
  return window.matchMedia('(max-width: 920px)').matches;
}

function shortName(n) {
  const parts = n.split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : n;
}

/** Oyuncu başına olay işaretleri: gol, kart, giriş/çıkış dakikası */
function playerMarks(m, side) {
  const marks = new Map();
  const get = (id) => (marks.has(id) ? marks.get(id) : marks.set(id, {}).get(id));
  for (const e of m.events) {
    if (e.side !== side) continue;
    if ((e.type === 'goal' || e.type === 'penalty') && e.playerId) get(e.playerId).goals = (get(e.playerId).goals ?? 0) + 1;
    if (e.type === 'yellow' && e.playerId) get(e.playerId).yellow = true;
    if (e.type === 'red' && e.playerId) get(e.playerId).red = true;
    if (e.type === 'sub') {
      if (e.playerId) get(e.playerId).out = e.minute;
      if (e.relatedId) get(e.relatedId).in = e.minute;
    }
  }
  return marks;
}

/** Sahadaki güncel 11: oyuna giren, çıkan oyuncunun saha konumunu alır; kırmızı görenler soluk gösterilir */
function currentXI(m, side) {
  const l = m.lineups[side];
  const xi = l.startXI.map((p) => ({ ...p }));
  for (const e of m.events) {
    if (e.side !== side || e.type !== 'sub') continue;
    const i = xi.findIndex((p) => p.id === e.playerId);
    const inn = l.subs.find((p) => p.id === e.relatedId);
    if (i >= 0 && inn) xi[i] = { ...inn, grid: xi[i].grid, pos: inn.pos ?? xi[i].pos };
  }
  return xi;
}

/** Sahadaki oyuncular ve oyuna girebilecek yedekler (sunucudaki kuralla aynı) */
function squadState(m, side) {
  const l = m.lineups[side];
  const all = [...l.startXI, ...l.subs];
  const on = new Set(l.startXI.map((p) => p.id));
  const gone = new Set();
  for (const e of m.events) {
    if (e.side !== side) continue;
    if (e.type === 'sub') {
      if (e.playerId) on.delete(e.playerId), gone.add(e.playerId);
      if (e.relatedId) on.add(e.relatedId);
    }
    if (e.type === 'red' && e.playerId) on.delete(e.playerId), gone.add(e.playerId);
  }
  return { pitch: all.filter((p) => on.has(p.id)), bench: l.subs.filter((p) => !on.has(p.id) && !gone.has(p.id)) };
}

/** Maçta süre almış oyuncular (puanlanabilir olanlar) */
function played(m, side) {
  const l = m.lineups[side];
  const cameIn = new Set(m.events.filter((e) => e.side === side && e.type === 'sub').map((e) => e.relatedId));
  return [...l.startXI, ...l.subs.filter((p) => cameIn.has(p.id) || (p.stats?.minutes ?? 0) > 0)];
}
