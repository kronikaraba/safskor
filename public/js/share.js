// Paylaşılabilir taraftar kartı: tarayıcıda tuvale çizilir (hikâye 1080x1920, kare 1080x1080).
import { h, toast, openSheet, colorFor, crestUrl, roundText } from './util.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const C = { bg: '#0b0f14', surface: '#121821', border: '#253043', text: '#e8eef5', muted: '#8d9aab', accent: '#0089fe', gold: '#ffc542' };

const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src))
    imgCache.set(
      src,
      new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = src;
      }),
    );
  return imgCache.get(src);
}

/**
 * card: { match, nick, team, activity: card:get yanıtı (puanlar, tahmin, taktik, değişiklik, anket, yorumlar, sohbet sayısı) }
 */
export function openShare(card) {
  let format = 'story';
  const canvas = h('canvas.share-canvas', { 'aria-label': 'Taraftar kartı önizlemesi' });
  let drawing = Promise.resolve();
  const sheet = openSheet((close) => {
    drawing = drawCard(canvas, card, format);
    const fmtBtn = (key, label) => h('button', { class: format === key ? 'active' : '', onclick: () => ((format = key), sheet.redraw()) }, label);
    return [
      h('div.sheet-head', {}, h('h2', {}, 'Taraftar kartın'), h('button.x', { onclick: close, 'aria-label': 'Kapat' }, '✕')),
      h('div.seg', { style: { marginBottom: '10px' } }, fmtBtn('story', 'Hikâye 9:16'), fmtBtn('square', 'Kare 1:1')),
      h('div.share-preview', { class: format }, canvas),
      h('button.btn', { style: { width: '100%', marginTop: '12px' }, onclick: async () => (await drawing, share(canvas, card)) }, navigator.share ? '📤 Paylaş' : '⬇️ Resmi indir'),
    ];
  });
}
async function share(canvas, card) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return toast('Resim oluşturulamadı', 'err');
  const name = `safskor-${card.match.home.short}-${card.match.away.short}.png`.replace(/[^\w.-]+/g, '');
  const file = new File([blob], name, { type: 'image/png' });
  const text = `${card.match.home.name} ${card.match.score.home}-${card.match.score.away} ${card.match.away.name} · Safskor`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Safskor taraftar kartım', text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Kart indirildi');
}

/** Kullanıcının işlemlerinden kart bölümleri: { icon, label, color, lines, joined } */
function sections(card, img) {
  const a = card.activity ?? {};
  const out = [];
  const ratings = a.ratings ?? [];
  const best = ratings.find((r) => !r.coach);
  if (best) out.push({ icon: img.trophy || '🏆', label: 'Maçın adamım', color: C.gold, big: true, lines: [`${best.name} · ${best.score}`] });
  if (ratings.length) out.push({ icon: img.rate || '⭐', label: `Puanlarım · ${ratings.length} kişi`, joined: true, lines: [ratings.map((r) => `${r.coach ? 'TD ' : ''}${r.name} ${r.score}`).join(' · ')] });
  const p = a.prediction;
  if (p) {
    const pts = p.points != null ? ` · ${p.points} puan` : '';
    out.push({ icon: '🎯', label: 'Skor tahminim', color: C.accent, big: true, lines: [`${p.home}-${p.away}${pts}${p.xi?.length && p.points != null ? ` · İlk 11: ${p.xiHits}/11` : ''}`] });
  }
  if (a.tactics?.length)
    out.push({ icon: img.tactic || '📋', label: 'Taktik önerim', lines: a.tactics.map((t) => `${t.team}: ${t.formation} · ${t.style}${t.note ? ` · “${t.note}”` : ''}`) });
  if (a.subs?.length)
    out.push({
      icon: img.sub || '🔁',
      label: 'Değişiklik isteklerim',
      lines: a.subs.map((x) => `${x.own ? '' : 'Destek: '}${x.team} ↑ ${x.inName} ↓ ${x.outName} (${x.votes} oy)`),
    });
  if (a.polls?.length) out.push({ icon: img.poll || '📊', label: 'Anket oylarım', lines: a.polls.map((q) => `${q.question} → ${q.answer}`) });
  const cm = a.comments ?? [];
  if (cm.length || a.chat) {
    const label = ['Yorumlarım', cm.length ? `${cm.length} yorum` : null, a.chat ? `${a.chat} sohbet mesajı` : null].filter(Boolean).join(' · ');
    out.push({ icon: '💬', label, lines: cm.length ? cm.map((c) => `${c.about}: “${c.text}”`) : [`Maç odasında ${a.chat} mesaj yazdım`] });
  }
  if (!out.length) out.push({ icon: '⚽', label: 'Maçı Safskor’da', color: C.accent, big: true, lines: ['taraftarla birlikte izledim'] });
  return out;
}

/** Metni verilen genişliğe sığacak satırlara böler (en fazla max satır, taşarsa …) */
function wrap(x, text, width, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const t = cur ? `${cur} ${words[i]}` : words[i];
    if (x.measureText(t).width <= width || !cur) {
      cur = t;
      continue;
    }
    lines.push(cur);
    cur = words[i];
    if (lines.length === max) return (lines[max - 1] = fit(x, `${lines[max - 1]} ${words.slice(i).join(' ')}`, width)), lines;
  }
  if (cur) lines.push(cur);
  if (lines.length > max) lines.length = max;
  return lines.map((l) => fit(x, l, width));
}

async function drawCard(canvas, card, format) {
  const W = 1080;
  const H = format === 'story' ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  const m = card.match;
  const [logo, hc, ac, tb, trophy, rate, tactic, sub, poll] = await Promise.all([
    loadImg('/img/logo.png'),
    loadImg(crestUrl(m.home.logo)),
    loadImg(crestUrl(m.away.logo)),
    loadImg(crestUrl(card.team?.logo)),
    loadImg('/img/icons/haftalik-siralama-kupa.png'),
    loadImg('/img/icons/puanla.png'),
    loadImg('/img/icons/taktik-oner.png'),
    loadImg('/img/icons/degisiklik-talebi.png'),
    loadImg('/img/icons/anketler.png'),
  ]);
  const secs = sections(card, { trophy, rate, tactic, sub, poll });
  const story = format === 'story';
  // çok işlem varsa üst kısım sıkışır, bölümlere yer açılır
  const busy = secs.reduce((n, sc) => n + sc.lines.length, 0) > 3;

  // zemin
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a2442');
  g.addColorStop(0.45, C.bg);
  g.addColorStop(1, '#070a0e');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, H * 0.08, 10, W / 2, H * 0.08, W * 0.8);
  glow.addColorStop(0, 'rgba(0,137,254,0.28)');
  glow.addColorStop(1, 'rgba(0,137,254,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  let y = story ? (busy ? 100 : 150) : busy ? 40 : 70;

  // logo
  if (logo) {
    const lh = story ? (busy ? 76 : 92) : busy ? 52 : 70;
    const lw = (logo.width / logo.height) * lh;
    x.drawImage(logo, (W - lw) / 2, y, lw, lh);
    y += lh + (story ? (busy ? 60 : 90) : busy ? 34 : 40);
  }

  // lig satırı
  x.textAlign = 'center';
  x.fillStyle = C.muted;
  x.font = `600 ${story ? 36 : busy ? 26 : 30}px ${FONT}`;
  x.fillText(fit(x, [m.competition.name, roundText(m.competition.round)].filter(Boolean).join(' · '), W - 160), W / 2, y);
  y += story ? (busy ? 50 : 70) : busy ? 30 : 50;

  // skor tabelası (yoğun kartta daha alçak)
  const boxH = story ? (busy ? 340 : 520) : busy ? 190 : 400;
  roundRect(x, 60, y, W - 120, boxH, 40);
  x.fillStyle = 'rgba(18,24,33,0.92)';
  x.fill();
  x.strokeStyle = C.border;
  x.lineWidth = 3;
  x.stroke();
  const crestS = story ? (busy ? 160 : 200) : busy ? 96 : 150;
  const cy = y + (story ? (busy ? 45 : 70) : busy ? 20 : 50);
  drawCrest(x, hc, m.home, W * 0.22, cy + crestS / 2, crestS);
  drawCrest(x, ac, m.away, W * 0.78, cy + crestS / 2, crestS);
  x.fillStyle = C.text;
  x.font = `700 ${story ? 40 : busy ? 26 : 34}px ${FONT}`;
  x.fillText(fit(x, m.home.name, 300), W * 0.22, cy + crestS + (busy && !story ? 38 : 70));
  x.fillText(fit(x, m.away.name, 300), W * 0.78, cy + crestS + (busy && !story ? 38 : 70));
  const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
  x.font = `800 ${story ? (busy ? 130 : 150) : busy ? 84 : 120}px ${FONT}`;
  x.fillText(started ? `${m.score.home}-${m.score.away}` : 'vs', W / 2, cy + crestS / 2 + (story ? 46 : busy ? 28 : 42));
  x.fillStyle = m.status === 'FT' ? C.muted : '#ff8994';
  x.font = `700 ${story ? 34 : busy ? 24 : 28}px ${FONT}`;
  x.fillText(m.status === 'FT' ? 'MAÇ SONU' : m.status === 'HT' ? 'DEVRE ARASI' : m.status === 'LIVE' ? `CANLI ${m.minute ?? ''}'` : '', W / 2, cy + crestS / 2 + (story ? 110 : busy ? 70 : 100));
  y += boxH + (story ? (busy ? 40 : 70) : busy ? 22 : 40);

  // işlem bölümleri: sığana kadar yazı küçülür ve bölüm başına satır azalır
  const footY = H - (story ? 170 : 60);
  const room = footY - (story ? 90 : 62) - y;
  const gap = story ? 18 : 12;
  const textW = W - 120 - 200;
  let plan = null;
  for (const [scale, maxLines] of [[1, 5], [1, 4], [0.92, 4], [0.92, 3], [0.85, 3], [0.85, 2], [0.78, 2], [0.72, 2], [0.78, 1], [0.72, 1], [0.66, 1], [0.6, 1]]) {
    const f = (n) => Math.round(n * scale * (story ? 1 : 0.86));
    const sz = { label: f(28), big: f(44), line: f(32), lh: f(42), pad: f(24), icon: f(64) };
    let total = 0;
    const laid = secs.map((sc) => {
      x.font = `${sc.big ? 800 : 600} ${sc.big ? sz.big : sz.line}px ${FONT}`;
      let rows = [];
      if (sc.joined) rows = wrap(x, sc.lines[0], textW, maxLines);
      else {
        for (const [i, l] of sc.lines.entries()) {
          const cap = maxLines - rows.length;
          const left = sc.lines.length - i;
          if (cap <= 0) break;
          // son satır ve hâlâ girdi var: bu girdinin sonuna kalanların sayısı eklenir ("… +2")
          if (cap === 1 && left > 1) {
            const more = `  +${left - 1}`;
            rows.push(fit(x, l, textW - x.measureText(more).width) + more);
            break;
          }
          rows.push(...wrap(x, l, textW, Math.min(2, left > 1 ? cap - 1 : cap)));
        }
      }
      const hgt = sz.pad * 2 + sz.label + 10 + rows.length * (sc.big ? sz.big * 1.2 : sz.lh);
      total += hgt + gap;
      return { sc, rows, hgt };
    });
    plan = { sz, laid };
    if (total - gap <= room) break;
  }
  // hâlâ sığmıyorsa sondaki bölümler düşer
  let used = 0;
  const shown = plan.laid.filter((l) => (used += l.hgt + gap) - gap <= room);
  const { sz } = plan;
  for (const { sc, rows, hgt } of shown) {
    roundRect(x, 60, y, W - 120, hgt, 28);
    x.fillStyle = 'rgba(25,33,45,0.9)';
    x.fill();
    x.textAlign = 'left';
    const ix = 92;
    const iy = y + (hgt - sz.icon) / 2;
    if (typeof sc.icon === 'string') {
      x.font = `${Math.round(sz.icon * 0.8)}px ${FONT}`;
      x.fillStyle = C.text;
      x.fillText(sc.icon, ix, iy + sz.icon * 0.78);
    } else x.drawImage(sc.icon, ix, iy, sz.icon, sz.icon);
    const tx = 92 + sz.icon + 32;
    let ty = y + sz.pad + sz.label;
    x.fillStyle = C.muted;
    x.font = `600 ${sz.label}px ${FONT}`;
    x.fillText(fit(x, sc.label, textW), tx, ty);
    ty += 10;
    x.fillStyle = sc.color || C.text;
    x.font = `${sc.big ? 800 : 600} ${sc.big ? sz.big : sz.line}px ${FONT}`;
    for (const r of rows) {
      ty += sc.big ? sz.big * 1.2 : sz.lh;
      x.fillText(r, tx, ty - (sc.big ? sz.big * 0.22 : sz.lh * 0.25));
    }
    y += hgt + gap;
  }

  // taraftar imzası
  x.textAlign = 'center';
  x.font = `700 ${story ? 40 : 32}px ${FONT}`;
  const nickW = x.measureText(card.nick).width;
  const badge = story ? 44 : 34;
  const startX = W / 2 - (nickW + (card.team ? badge + 16 : 0)) / 2;
  if (card.team) {
    if (tb) x.drawImage(tb, startX, footY - badge + 8, badge, badge);
    else {
      x.fillStyle = card.team.color || colorFor(card.team.name);
      x.beginPath();
      x.arc(startX + badge / 2, footY - badge / 2 + 8, badge / 2.4, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.fillStyle = C.text;
  x.textAlign = 'left';
  x.fillText(card.nick, startX + (card.team ? badge + 16 : 0), footY);
  x.textAlign = 'center';
  x.fillStyle = C.muted;
  x.font = `500 ${story ? 30 : 24}px ${FONT}`;
  x.fillText(location.host || 'safskor', W / 2, footY + (story ? 60 : 40));
}

function drawCrest(x, img, team, cx, cy, size) {
  if (img) {
    const r = Math.min(size / img.width, size / img.height);
    x.drawImage(img, cx - (img.width * r) / 2, cy - (img.height * r) / 2, img.width * r, img.height * r);
    return;
  }
  x.fillStyle = team.color || colorFor(team.name);
  x.beginPath();
  x.arc(cx, cy, size / 2.2, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.font = `800 ${size / 3.6}px ${FONT}`;
  x.fillText(team.short, cx, cy + size / 10);
}

function roundRect(x, l, t, w, hh, r) {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + hh, r);
  x.arcTo(l + w, t + hh, l, t + hh, r);
  x.arcTo(l, t + hh, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

function fit(x, text, max) {
  if (x.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
