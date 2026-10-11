import type { MatchSummary, Standings } from './types.js';

/**
 * Arama motorları için sayfa başlıkları, açıklamalar, kanonik adresler, yapılandırılmış veri ve site haritası.
 * Uygulama tek sayfa (SPA) olarak çalışır; sunucu her adres için index.html'deki <!--seo--> bloğunu o sayfaya
 * özel etiketlerle değiştirir. Böylece Google ve link önizlemeleri JS çalıştırmadan doğru başlığı görür.
 */

/** Kanonik site adresi (Search Console'daki alan adı) */
export const SITE = (process.env.SITE_URL || 'https://safskor.com').replace(/\/+$/, '');
const SITE_NAME = 'Safskor';
const DEFAULT_TITLE = 'Safskor · Canlı Skor ve Taraftar Platformu';

const TR: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** "Fenerbahçe" → "fenerbahce" (adres için) */
export function slug(s: string) {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (c) => TR[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function matchPath(m: Pick<MatchSummary, 'id' | 'home' | 'away'>) {
  return `/mac/${encodeURIComponent(m.id)}/${slug(m.home.name)}-${slug(m.away.name)}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');

const dateTr = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export interface Page {
  title: string;
  description: string;
  path: string;
  jsonld?: object[];
  noindex?: boolean;
}

const WEBSITE_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  alternateName: 'Safskor Canlı Skor',
  url: `${SITE}/`,
  inLanguage: 'tr-TR',
};

export const PAGES: Record<string, Page> = {
  '/': {
    title: DEFAULT_TITLE,
    description:
      'Bugünün maçları canlı skor: Süper Lig, Premier Lig, La Liga ve Şampiyonlar Ligi. Maç odasında taraftarlarla sohbet et, oyuncuları puanla, skor tahmini yap.',
    path: '/',
    jsonld: [WEBSITE_LD],
  },
  '/yarin': {
    title: 'Yarının Maçları ve Başlama Saatleri · Safskor',
    description: 'Yarın oynanacak Süper Lig, Premier Lig, La Liga ve Avrupa maçları, başlama saatleri. Maç odasına gir, skor tahminini şimdiden yap.',
    path: '/yarin',
  },
  '/puan-durumu': {
    title: 'Süper Lig Puan Durumu · Safskor',
    description: 'Trendyol Süper Lig güncel puan durumu: sıralama, oynanan maç, galibiyet, beraberlik, mağlubiyet, averaj ve puanlar.',
    path: '/puan-durumu',
  },
  '/siralama': {
    title: 'Haftalık Skor Tahmini Sıralaması · Safskor',
    description: 'Safskor haftalık skor tahmini yarışması. Tam skoru bil 3 puan, doğru sonuç 1 puan, ilk 11 tahmininde her doğru oyuncu +1 puan.',
    path: '/siralama',
  },
};

export function standingsPage(t: Standings | null): Page {
  const p = PAGES['/puan-durumu'];
  if (!t) return p;
  const season = `${t.league.season}/${String(t.league.season + 1).slice(2)}`;
  const top = t.rows
    .slice(0, 3)
    .map((r) => `${r.rank}. ${r.team.name} ${r.points} puan`)
    .join(', ');
  return { ...p, title: `Süper Lig Puan Durumu ${season} · Safskor`, description: `Trendyol Süper Lig ${season} güncel puan durumu. ${top}. Galibiyet, beraberlik, mağlubiyet ve averajlar.` };
}

export function matchPage(m: MatchSummary): Page {
  const vs = `${m.home.name} - ${m.away.name}`;
  const comp = m.competition.name || 'Maç';
  const started = m.status !== 'SCHEDULED' && m.status !== 'POSTPONED';
  const score = `${m.home.name} ${m.score.home}-${m.score.away} ${m.away.name}`;
  const title =
    m.status === 'FT' ? `${score} Maç Sonucu · Safskor` : started ? `${score} Canlı Skor · Safskor` : `${vs} Canlı Skor ve Taraftar Sohbeti · Safskor`;
  const when = dateTr(m.kickoff);
  const description =
    m.status === 'FT'
      ? `${score} (${comp}, ${when}) maç sonucu, goller, kartlar, kadrolar ve oyuncu puanları. Taraftar yorumlarını oku.`
      : `${vs} maçı (${comp}, ${when}) canlı skor, maç olayları, kadrolar ve oyuncu puanları. Taraftarlarla sohbet et, skor tahminini yap.`;
  const team = (t: MatchSummary['home']) => ({ '@type': 'SportsTeam', name: t.name, ...(t.logo ? { logo: t.logo } : {}) });
  const event = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: vs,
    sport: 'Soccer',
    startDate: m.kickoff,
    eventStatus: m.status === 'POSTPONED' ? 'https://schema.org/EventPostponed' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    homeTeam: team(m.home),
    awayTeam: team(m.away),
    competitor: [team(m.home), team(m.away)],
    ...(m.venue ? { location: { '@type': 'Place', name: m.venue } } : {}),
    superEvent: { '@type': 'SportsEvent', name: comp },
    url: SITE + matchPath(m),
  };
  return { title, description, path: matchPath(m), jsonld: [event] };
}

/** Bilinmeyen maç adresi: indekslenmesin (eski ya da yanlış kimlik) */
export function unknownMatchPage(path: string): Page {
  return { title: `Maç · ${SITE_NAME}`, description: PAGES['/'].description, path, noindex: true };
}

/** index.html'deki <!--seo--> ... <!--/seo--> bloğunun yerine konacak etiketler */
export function seoHead(p: Page): string {
  const url = SITE + p.path;
  const tags = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    p.noindex ? `<meta name="robots" content="noindex" />` : `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="tr_TR" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:image" content="${SITE}/img/og.jpg" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Safskor logosu: Maçı taraftarlarla canlı yaşa" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(p.jsonld ?? []).map((x) => `<script type="application/ld+json">${json(x)}</script>`),
  ];
  return tags.map((t) => `  ${t}`).join('\n');
}

export function renderPage(template: string, p: Page) {
  return template.replace(/[ \t]*<!--seo-->[\s\S]*?<!--\/seo-->/, `  <!--seo-->\n${seoHead(p)}\n  <!--/seo-->`);
}

export function robotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`;
}

/** Site haritası: sabit sayfalar + bugünün, yarının ve Büyük 4'ün bilinen maçları */
export function sitemapXml(matches: MatchSummary[]) {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const urls: { loc: string; freq: string; prio: string; mod: string }[] = [
    { loc: '/', freq: 'always', prio: '1.0', mod: now },
    { loc: '/yarin', freq: 'hourly', prio: '0.8', mod: now },
    { loc: '/puan-durumu', freq: 'daily', prio: '0.8', mod: now },
    { loc: '/siralama', freq: 'daily', prio: '0.5', mod: now },
  ];
  for (const m of matches) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const live = m.status === 'LIVE' || m.status === 'HT';
    urls.push({ loc: matchPath(m), freq: live ? 'always' : m.status === 'FT' ? 'daily' : 'hourly', prio: '0.7', mod: now });
  }
  const body = urls
    .map((u) => `  <url><loc>${esc(SITE + u.loc)}</loc><lastmod>${u.mod}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
