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
 * card: { match, nick, team, activity: card:get yanıtı (puanlar, tahmin, taktik, değişiklik, anket, yorumlar, sohbet mesajları, beğeniler) }
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
  const tl = [
    ...(a.tactics ?? []).map((t) => `${t.team}: ${t.formation} · ${t.style}${t.note ? ` · “${t.note}”` : ''}`),
    ...(a.tacticLikes ?? []).map((t) => `Beğendim: ${t.team} ${t.formation} · ${t.style} (${t.nick})`),
  ];
  if (tl.length) out.push({ icon: img.tactic || '📋', label: a.tactics?.length ? 'Taktik önerim' : 'Beğendiğim taktikler', lines: tl });
  if (a.subs?.length)
    out.push({
      icon: img.sub || '🔁',
      label: 'Değişiklik isteklerim',
      lines: a.subs.map((x) => `${x.own ? '' : 'Destek: '}${x.team} ↑ ${x.inName} ↓ ${x.outName} (${x.votes} oy)`),
    });
  if (a.polls?.length) out.push({ icon: img.poll || '📊', label: 'Anket oylarım', lines: a.polls.map((q) => `${q.question} → ${q.answer}`) });
  const cm = a.comments ?? [];
  if (cm.length) out.push({ icon: '💬', label: 'Yorumlarım', lines: cm.map((c) => `${c.about}: “${c.text}”`) });
  const chat = a.chat ?? [];
  if (chat.length) out.push({ icon: '🗨️', label: 'Sohbette yazdıklarım', lines: chat.map((c) => (c.replyTo ? `↩ ${c.replyTo}: “${c.text}”` : `“${c.text}”`)) });
  const likes = a.chatLikes ?? [];
  if (likes.length) out.push({ icon: '❤️', label: 'Beğendiğim mesajlar', lines: likes.map((c) => `${c.nick}: “${c.text}”`) });
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
  const nLines = secs.reduce((n, sc) => n + sc.lines.length, 0);
  // çok işlem varsa üst kısım sıkışır, bölümlere yer açılır; hikâyede çok kalabalıksa tabela en kısa hâline iner
  const busy = nLines > 3;
  const dense = story && nLines > 8;
  const L = story
    ? dense
      ? { top: 70, logo: 60, logoGap: 40, lg: 30, lgGap: 40, box: 250, crest: 120, cOff: 30, name: 32, nameGap: 48, score: 110, scoreOff: 38, st: 28, stOff: 88, after: 30 }
      : busy
        ? { top: 100, logo: 76, logoGap: 60, lg: 36, lgGap: 50, box: 340, crest: 160, cOff: 45, name: 40, nameGap: 70, score: 130, scoreOff: 46, st: 34, stOff: 110, after: 40 }
        : { top: 150, logo: 92, logoGap: 90, lg: 36, lgGap: 70, box: 430, crest: 200, cOff: 70, name: 40, nameGap: 70, score: 150, scoreOff: 46, st: 34, stOff: 110, after: 70 }
    : busy
      ? { top: 40, logo: 52, logoGap: 34, lg: 26, lgGap: 30, box: 190, crest: 96, cOff: 20, name: 26, nameGap: 38, score: 84, scoreOff: 28, st: 24, stOff: 70, after: 22 }
      : { top: 70, logo: 70, logoGap: 40, lg: 30, lgGap: 50, box: 400, crest: 150, cOff: 50, name: 34, nameGap: 70, score: 120, scoreOff: 42, st: 28, stOff: 100, after: 40 };

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

  let y = L.top;

  // logo
  if (logo) {
    const lw = (logo.width / logo.height) * L.logo;
    x.drawImage(logo, (W - lw) / 2, y, lw, L.logo);
    y += L.logo + L.logoGap;
  }

  // lig satırı
  x.textAlign = 'center';
  x.fillStyle = C.muted;
  x.font = `600 ${L.lg}px ${FONT}`;
  x.fillText(fit(x, [m.competition.name, roundText(m.competition.round)].filter(Boolean).join(' · '), W - 160), W / 2, y);
  y += L.lgGap;

  // skor tabelası
  roundRect(x, 60, y, W - 120, L.box, 40);
  x.fillStyle = 'rgba(18,24,33,0.92)';
  x.fill();
  x.strokeStyle = C.border;
  x.lineWidth = 3;
  x.stroke();
  const cy = y + L.cOff;
  drawCrest(x, hc, m.home, W * 0.22, cy + L.crest / 2, L.crest);
  drawCrest(x, ac, m.away, W * 0.78, cy + L.crest / 2, L.crest);
  x.fillStyle = C.text;
  x.font = `700 ${L.name}px ${FONT}`;
  x.fillText(fit(x, m.home.name, 300), W * 0.22, cy + L.crest + L.nameGap);
  x.fillText(fit(x, m.away.name, 300), W * 0.78, cy + L.crest + L.nameGap);
  const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
  x.font = `800 ${L.score}px ${FONT}`;
  x.fillText(started ? `${m.score.home}-${m.score.away}` : 'vs', W / 2, cy + L.crest / 2 + L.scoreOff);
  x.fillStyle = m.status === 'FT' ? C.muted : '#ff8994';
  x.font = `700 ${L.st}px ${FONT}`;
  x.fillText(m.status === 'FT' ? 'MAÇ SONU' : m.status === 'HT' ? 'DEVRE ARASI' : m.status === 'LIVE' ? `CANLI ${m.minute ?? ''}'` : '', W / 2, cy + L.crest / 2 + L.stOff);
  y += L.box + L.after;

  // işlem bölümleri tek panelde: önce yazı küçülür, en son bölüm başına satır azalır (kalanlar "+N" olur)
  const footY = H - (story ? (dense ? 140 : 170) : 60);
  const room = footY - (story ? 80 : 56) - y;
  const textW = W - 120 - 72;
  const PLANS = [[1, 6], [0.92, 6], [0.85, 6], [0.8, 5], [0.75, 5], [0.72, 4], [0.68, 4], [0.66, 3], [0.62, 3], [0.6, 2], [0.56, 2], [0.56, 1], [0.5, 1]];
  let plan = null;
  for (const [scale, maxLines] of PLANS) {
    const f = (n) => Math.round(n * scale * (story ? 1 : 0.86));
    const sz = { label: f(27), big: f(42), line: f(31), lh: f(41), icon: f(40), head: f(46), sep: f(30), pad: f(30) };
    const laid = secs.map((sc) => {
      x.font = `${sc.big ? 800 : 600} ${sc.big ? sz.big : sz.line}px ${FONT}`;
      let rows = [];
      if (sc.joined) rows = wrap(x, sc.lines[0], textW, maxLines);
      else
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
      return { sc, rows, hgt: sz.head + rows.length * (sc.big ? sz.big * 1.25 : sz.lh) };
    });
    const total = sz.pad * 2 + laid.reduce((n, l) => n + l.hgt, 0) + sz.sep * (laid.length - 1);
    plan = { sz, laid, total };
    if (total <= room) break;
  }
  const { sz } = plan;
  // en küçük planda bile sığmıyorsa sondaki bölümler düşer
  let laid = plan.laid;
  let total = plan.total;
  while (total > room && laid.length > 1) {
    total -= laid[laid.length - 1].hgt + sz.sep;
    laid = laid.slice(0, -1);
  }
  roundRect(x, 60, y, W - 120, total, 32);
  x.fillStyle = 'rgba(22,29,40,0.92)';
  x.fill();
  x.strokeStyle = C.border;
  x.lineWidth = 2;
  x.stroke();
  let ty = y + sz.pad;
  laid.forEach(({ sc, rows, hgt }, i) => {
    if (i) {
      x.strokeStyle = 'rgba(141,154,171,0.18)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(96, ty + sz.sep / 2);
      x.lineTo(W - 96, ty + sz.sep / 2);
      x.stroke();
      ty += sz.sep;
    }
    const top = ty;
    // başlık satırı: ikon + etiket
    x.textAlign = 'left';
    const iy = top + (sz.head - sz.icon) / 2 - sz.icon * 0.12;
    if (typeof sc.icon === 'string') {
      x.font = `${Math.round(sz.icon * 0.82)}px ${FONT}`;
      x.fillStyle = C.text;
      x.fillText(sc.icon, 96, iy + sz.icon * 0.8);
    } else x.drawImage(sc.icon, 96, iy, sz.icon, sz.icon);
    x.fillStyle = C.muted;
    x.font = `700 ${sz.label}px ${FONT}`;
    x.fillText(fit(x, sc.label.toLocaleUpperCase('tr-TR'), textW - sz.icon - 16), 96 + sz.icon + 16, top + sz.head / 2 + sz.label * 0.25);
    let ry = top + sz.head;
    x.fillStyle = sc.color || C.text;
    x.font = `${sc.big ? 800 : 600} ${sc.big ? sz.big : sz.line}px ${FONT}`;
    for (const r of rows) {
      const rh = sc.big ? sz.big * 1.25 : sz.lh;
      x.fillText(r, 96, ry + rh * 0.72);
      ry += rh;
    }
    ty = top + hgt;
  });

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
