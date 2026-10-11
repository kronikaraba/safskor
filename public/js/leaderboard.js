import { app } from './app.js';
import { h, mount, teamBadge, icon } from './util.js';

const DAY = 86_400_000;
/** Pazartesi başlangıçlı hafta anahtarı (Türkiye saati), sunucudaki weekKey ile aynı */
function weekKey(ts) {
  const day = Math.floor((ts + 3 * 3_600_000) / DAY);
  return new Date((day - ((new Date(day * DAY).getUTCDay() + 6) % 7)) * DAY).toISOString().slice(0, 10);
}
const fmtDay = (ts) => new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });

export function renderLeaderboard(root) {
  let week = weekKey(Date.now());
  const head = h('div');
  const body = h('div');
  mount(root, h('a.back', { href: '/' }, '← Tüm maçlar'), head, body);

  function load() {
    mount(body, h('div.empty', {}, 'Sıralama yükleniyor…'));
    app.socket.timeout(8000).emit('leaderboard:get', { week }, (err, r) => {
      if (err || !r?.ok) return mount(body, h('div.empty', {}, 'Sıralama alınamadı. Bağlantını kontrol et.'));
      draw(r);
    });
  }

  function draw(r) {
    const start = Date.parse(`${r.week}T00:00:00+03:00`);
    const current = r.week === weekKey(Date.now());
    const left = r.endsAt - Date.now();
    const shift = (n) => ((week = weekKey(start + n * 7 * DAY + DAY)), load());
    mount(
      head,
      h(
        'div.lb-head',
        {},
        h('div', {}, h('h1.h-ic', {}, icon('haftalik-siralama-kupa', 'lg'), 'Haftalık tahmin sıralaması'), h('p.muted.small', {}, `${fmtDay(start)} – ${fmtDay(r.endsAt - 1)}${current ? ` · ${resetText(left)}` : ''}`)),
        h(
          'div.seg',
          {},
          h('button', { onclick: () => shift(-1), 'aria-label': 'Önceki hafta' }, '‹ Önceki'),
          h('button', { onclick: () => shift(1), disabled: current, 'aria-label': 'Sonraki hafta' }, 'Sonraki ›'),
        ),
      ),
      h('div.lb-rules.muted.small', {}, 'Tam skor 3 puan · doğru sonuç (1/X/2) 1 puan · ilk 11 tahmininde doğru bilinen her oyuncu +1 puan. Tahminler maç başlayınca kilitlenir.'),
    );
    if (!r.rows.length) {
      mount(body, h('div.empty', {}, current ? 'Bu hafta henüz tahmin yok. Başlamamış bir maçta Taraftar > Anketler bölümünden ilk tahmini sen yap!' : 'Bu hafta tahmin yapılmamış.'));
      return;
    }
    mount(
      body,
      h(
        'div.card.lb',
        {},
        h('h3', {}, 'Sıralama', h('span.muted', {}, `${r.players} taraftar`)),
        h('ol.lb-list', {}, r.rows.map(lbRow), r.me ? [h('li.lb-gap', {}, '⋯'), lbRow(r.me)] : null),
      ),
    );
  }

  load();
  return {
    rejoin: load,
    destroy() {},
  };
}

/** Sıralama satırı; ana sayfadaki özet kartı da kullanır */
export function lbRow(x) {
  return h(
    'li.lb-row',
    { class: `${x.me ? 'me' : ''} ${x.rank <= 3 ? `top${x.rank}` : ''}` },
    h('span.lb-rank', {}, x.rank <= 3 ? h('span.lb-medal', { title: `${x.rank}.` }, icon('haftalik-siralama-madalya'), h('b', {}, x.rank)) : x.rank),
    h('span.lb-name', {}, teamBadge(x.team), h('b', {}, x.nick), x.me ? h('span.lb-you', {}, 'Sen') : null),
    h('span.lb-n.muted', { title: 'Tahmin sayısı' }, `${x.predictions} tahmin`),
    h('span.lb-pts', {}, h('b', {}, x.points), h('small', {}, 'puan')),
  );
}

function resetText(ms) {
  const hrs = Math.max(0, Math.floor(ms / 3_600_000));
  const d = Math.floor(hrs / 24);
  return `Pazartesi 00:00'da sıfırlanır (${d ? `${d} gün ` : ''}${hrs % 24} saat kaldı)`;
}
