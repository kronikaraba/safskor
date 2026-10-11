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
 * card: { match, nick, team, motm: {name, score} | null, prediction: {home, away, points} | null }
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

async function drawCard(canvas, card, format) {
  const W = 1080;
  const H = format === 'story' ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  const m = card.match;
  const [logo, hc, ac, tb, trophy] = await Promise.all([
    loadImg('/img/logo.png'),
    loadImg(crestUrl(m.home.logo)),
    loadImg(crestUrl(m.away.logo)),
    loadImg(crestUrl(card.team?.logo)),
    loadImg('/img/icons/haftalik-siralama-kupa.png'),
  ]);

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

  const story = format === 'story';
  let y = story ? 150 : 70;

  // logo
  if (logo) {
    const lh = story ? 92 : 70;
    const lw = (logo.width / logo.height) * lh;
    x.drawImage(logo, (W - lw) / 2, y, lw, lh);
    y += lh + (story ? 90 : 40);
  }

  // lig satırı
  x.textAlign = 'center';
  x.fillStyle = C.muted;
  x.font = `600 ${story ? 36 : 30}px ${FONT}`;
  x.fillText(fit(x, [m.competition.name, roundText(m.competition.round)].filter(Boolean).join(' · '), W - 160), W / 2, y);
  y += story ? 70 : 50;

  // skor tabelası
  const boxH = story ? 520 : 400;
  roundRect(x, 60, y, W - 120, boxH, 40);
  x.fillStyle = 'rgba(18,24,33,0.92)';
  x.fill();
  x.strokeStyle = C.border;
  x.lineWidth = 3;
  x.stroke();
  const crestS = story ? 200 : 150;
  const cy = y + (story ? 70 : 50);
  drawCrest(x, hc, m.home, W * 0.22, cy + crestS / 2, crestS);
  drawCrest(x, ac, m.away, W * 0.78, cy + crestS / 2, crestS);
  x.fillStyle = C.text;
  x.font = `700 ${story ? 40 : 34}px ${FONT}`;
  x.fillText(fit(x, m.home.name, 300), W * 0.22, cy + crestS + 70);
  x.fillText(fit(x, m.away.name, 300), W * 0.78, cy + crestS + 70);
  const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
  x.font = `800 ${story ? 150 : 120}px ${FONT}`;
  x.fillText(started ? `${m.score.home}-${m.score.away}` : 'vs', W / 2, cy + crestS / 2 + (story ? 52 : 42));
  x.fillStyle = m.status === 'FT' ? C.muted : '#ff8994';
  x.font = `700 ${story ? 34 : 28}px ${FONT}`;
  x.fillText(m.status === 'FT' ? 'MAÇ SONU' : m.status === 'HT' ? 'DEVRE ARASI' : m.status === 'LIVE' ? `CANLI ${m.minute ?? ''}'` : '', W / 2, cy + crestS / 2 + (story ? 120 : 100));
  y += boxH + (story ? 70 : 40);

  // kart satırları
  const lines = [];
  if (card.motm) lines.push([trophy || '🏆', 'Maçın adamım', `${card.motm.name} · ${card.motm.score}`, C.gold]);
  if (card.prediction) {
    const p = card.prediction;
    lines.push(['🎯', 'Skor tahminim', `${p.home}-${p.away}${p.points != null ? ` · ${p.points} puan` : ''}`, C.accent]);
  }
  if (!lines.length) lines.push(['⚽', 'Maçı Safskor’da', 'taraftarla birlikte izledim', C.accent]);
  const rowH = story ? 150 : 115;
  for (const [ic, label, value, color] of lines.slice(0, story ? 3 : 2)) {
    roundRect(x, 60, y, W - 120, rowH - 24, 30);
    x.fillStyle = 'rgba(25,33,45,0.9)';
    x.fill();
    x.textAlign = 'left';
    x.font = `${story ? 56 : 46}px ${FONT}`;
    if (typeof ic === 'string') x.fillText(ic, 100, y + (rowH - 24) / 2 + (story ? 20 : 16));
    else {
      const sz = story ? 72 : 58;
      x.drawImage(ic, 96, y + (rowH - 24 - sz) / 2, sz, sz);
    }
    x.fillStyle = C.muted;
    x.font = `600 ${story ? 30 : 26}px ${FONT}`;
    x.fillText(label, 190, y + (story ? 52 : 40));
    x.fillStyle = color;
    x.font = `800 ${story ? 46 : 38}px ${FONT}`;
    x.fillText(fit(x, value, W - 300), 190, y + (story ? 104 : 82));
    y += rowH;
  }

  // taraftar imzası
  x.textAlign = 'center';
  const footY = H - (story ? 170 : 60);
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
