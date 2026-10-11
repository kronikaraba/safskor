// Küçük DOM yardımcıları. Kullanıcı verisi her zaman textContent ile yazılır (XSS yok).

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Taraftar ikonu (şeffaf PNG), emoji yerine */
export function icon(name, cls = '') {
  return h(`img.fan-icon${cls ? '.' + cls : ''}`, { src: `/img/icons/${name}.png`, alt: '', 'aria-hidden': 'true', draggable: 'false' });
}

export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const storage = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

export function minuteText(m) {
  if (m.status === 'LIVE') return `${m.minute ?? ''}${m.extra ? '+' + m.extra : ''}'`;
  if (m.status === 'HT') return 'Devre arası';
  if (m.status === 'FT') return 'Maç sonu';
  if (m.status === 'POSTPONED') return 'Ertelendi';
  return kickoffText(m.kickoff);
}

export function kickoffText(iso) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${time}`;
}

/** API-Football tur adlarını Türkçeleştirir ("Regular Season - 6" → "6. Hafta") */
export function roundText(r) {
  if (!r) return '';
  let x;
  if ((x = r.match(/^Regular Season\s*-\s*(\d+)/i))) return `${x[1]}. Hafta`;
  if ((x = r.match(/^(?:Group Stage|League Stage)\s*-\s*(\d+)/i))) return `Lig Aşaması · ${x[1]}. Maç`;
  if ((x = r.match(/^Group\s+([A-Z])\s*-\s*(\d+)/i))) return `${x[1]} Grubu · ${x[2]}. Maç`;
  if ((x = r.match(/^(\d+)(?:st|nd|rd|th) (?:Qualifying )?Round/i))) return `${x[1]}. Tur`;
  const map = {
    'round of 32': 'Son 32', 'round of 16': 'Son 16', 'quarter-finals': 'Çeyrek Final', 'semi-finals': 'Yarı Final',
    final: 'Final', 'knockout round play-offs': 'Play-off', 'play-offs': 'Play-off', preliminary: 'Ön Eleme',
  };
  return map[r.toLowerCase()] ?? r;
}

/** Başlamamış maç için gün etiketi: Bugün / Yarın / 12 Eki */
export function dayText(iso) {
  const d = new Date(iso);
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Bugün';
  t.setDate(t.getDate() + 1);
  if (d.toDateString() === t.toDateString()) return 'Yarın';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function statusPill(m) {
  const cls = m.status === 'LIVE' ? 'live' : m.status === 'HT' ? 'ht' : m.status === 'FT' ? 'ft' : '';
  return h('span.status', { class: cls }, minuteText(m));
}

export function crest(team, size = '') {
  if (team.logo) {
    return h('span.crest.has-img', { class: size }, h('img', { src: team.logo, alt: '', loading: 'lazy' }));
  }
  return h('span.crest', { class: size, '--c': team.color || colorFor(team.name), title: team.name }, team.short);
}

/** Favori takım rozeti (14px): arma ya da takım rengi */
export function teamBadge(team) {
  if (!team) return null;
  if (team.logo) return h('img.tbadge', { src: team.logo, alt: '', title: team.name, loading: 'lazy' });
  return h('span.tbadge.dot', { '--c': team.color || colorFor(team.name), title: team.name });
}

/** API-Football armasının aynı kökenden adresi (tuvale çizilebilsin diye) */
export function crestUrl(logo) {
  const m = /media\.api-sports\.io\/football\/(teams|leagues)\/(\d+)\.png$/.exec(logo || '');
  return m ? `/img/crest/${m[1]}/${m[2]}.png` : null;
}

export function colorFor(s) {
  let x = 0;
  for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(x) % 360} 65% 62%)`;
}

export function ratingClass(r) {
  if (r == null) return '';
  return r >= 7.5 ? 'hi' : r >= 6.5 ? 'mid' : r < 6 ? 'lo' : '';
}

export function ratingPill(r, extra = '') {
  return h('span.rating-pill', { class: `${ratingClass(r)} ${extra}`.trim() }, r == null ? '–' : Number(r).toFixed(1));
}

export function timeText(ts) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function toast(text, kind = '') {
  const box = document.getElementById('toasts');
  const el = h('div.toast', { class: kind }, text);
  box.append(el);
  setTimeout(() => el.remove(), kind === 'goal' ? 6000 : 3500);
}

let sheetClose = null;
let sheetSeq = 0;
export function openSheet(render) {
  const id = ++sheetSeq;
  const back = document.getElementById('sheet');
  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true' });
  const draw = () => mount(sheet, render(closeSheet));
  draw();
  mount(back, sheet);
  back.hidden = false;
  // dikkat: onclick'ten false dönmek tıklamayı iptal eder (form gönderilmez); bu yüzden değer döndürme
  back.onclick = (e) => {
    if (e.target === back) closeSheet();
  };
  const onKey = (e) => e.key === 'Escape' && closeSheet();
  document.addEventListener('keydown', onKey);
  sheetClose = () => document.removeEventListener('keydown', onKey);
  // yalnızca bu sayfa hâlâ açıksa yeniden çiz
  return { redraw: () => id === sheetSeq && !back.hidden && draw() };
}
export function closeSheet() {
  const back = document.getElementById('sheet');
  back.hidden = true;
  back.replaceChildren();
  sheetClose?.();
  sheetClose = null;
}

export const POS_TR = { G: 'Kaleci', D: 'Defans', M: 'Orta saha', F: 'Forvet' };
