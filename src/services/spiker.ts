// Safskor botları: maç sohbetine maç öncesi ve sonrası, sosyal medyadaki taraftar havasında kısa yorumlar yazar.
// Her mesaj sohbette "bot" rozetiyle görünür; adları da bot olduklarını söyler, gerçek üye gibi davranmazlar.
// Yalnızca zaten çekilmiş maç verisini ve sitedeki taraftar verisini kullanır; API'ye ek istek atmaz.
import type { Match, MatchEvent, MatchSummary, Side, Standings } from '../types.js';

/** Bot hesapları: her biri kendi tarzında yazar */
export const BOTS = { tribun: 'TribünBot', istat: 'İstatistikBot', yorum: 'YorumcuBot' } as const;
export type BotSay = { nick: string; text: string };

/** Fan verisinden botların kullandığı özet (hepsi gerçek sayılar) */
export interface SpikerFan {
  ratings: Record<string, { avg: number; count: number }>;
  polls: { key: string | null; total: number; options: { label: string; votes: number }[] }[];
  predictions: { total: number; exact: number; top: { home: number; away: number; count: number }[] };
}

/** Aynı maçta hep aynı, maçtan maça değişen kalıp seçimi */
function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return list[Math.abs(h) % list.length];
}

// "21:45'te", "20:00'de": saat okunuşuna göre bulunma eki
const ONES = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'];
const TENS: Record<number, string> = { 0: 'da', 10: 'da', 20: 'de', 30: 'da', 40: 'ta', 50: 'de' };
const numLoc = (n: number) => (n % 10 ? ONES[n % 10] : TENS[n % 60] ?? 'de');

function whenText(kickoff: string, now = new Date()): string {
  const d = new Date(kickoff);
  const ymd = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const [hh, mm] = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).split(':').map(Number);
  const dayWord =
    ymd(d) === ymd(now) ? 'bugün'
    : ymd(d) === ymd(new Date(now.getTime() + 86_400_000)) ? 'yarın'
    : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Istanbul' });
  return `${dayWord} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}'${numLoc(mm ? mm : hh)}`;
}

const tag = (m: MatchSummary) => `#${m.home.short}v${m.away.short}`.replace(/[^#\p{L}\p{N}]/gu, '');
const scoreLine = (m: MatchSummary) => `${m.home.short} ${m.score.home}-${m.score.away} ${m.away.short}`;
const BIG = new Set(['Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor']);
const isDerby = (m: MatchSummary) => BIG.has(m.home.name) && BIG.has(m.away.name);
const FORM: Record<string, string> = { W: 'G', D: 'B', L: 'M' };
const formText = (f?: string) => (f ? [...f.slice(-5)].map((c) => FORM[c] ?? '').join(' ') : '');

/** İlk girişte: maç havası, (varsa) tablo, taraftara soru */
export function preMatch(m: Match, table: Standings | null, fan: SpikerFan, now = new Date()): BotSay[] {
  const H = m.home.name, A = m.away.name, when = whenText(m.kickoff, now), t = tag(m);
  const out: BotSay[] = [
    {
      nick: BOTS.tribun,
      text: isDerby(m)
        ? pick(
            [
              `derbi bu derbi, gerisi teferruat 🔥🔥 ${H} - ${A} ${when} başlıyor ${t}`,
              `DERBİ GÜNÜ 🔥 ${H} - ${A} ${when} başlıyor, kimse sakin kalamaz ${t}`,
            ],
            m.id,
          )
        : pick(
            [
              `maç günü geldi çattı 🔥 ${H} - ${A} ${when} başlıyor, hazır mıyız? ${t}`,
              `${H} - ${A} ${when} oynanıyor arkadaşlar, bi şeyler olacak gibi hissediyorum 👀 ${t}`,
              `sayaç çalışıyor ⏳ ${H} - ${A} ${when} başlıyor, tribünler şimdiden ısınsın ${t}`,
            ],
            m.id,
          ),
    },
  ];

  const row = (id: string) => table?.rows.find((r) => r.team.id === id);
  const h = row(m.home.id), a = row(m.away.id);
  if (h && a) {
    let text = `📊 maç öncesi tablo: ${H} ${h.rank}. sırada ${h.points} puan, ${A} ${a.rank}. sırada ${a.points} puan.`;
    if (h.form && a.form) text += ` son maçlar: ${m.home.short} ${formText(h.form)} | ${m.away.short} ${formText(a.form)}`;
    out.push({ nick: BOTS.istat, text });
  }

  const p = fan.predictions;
  out.push({
    nick: BOTS.yorum,
    text:
      p.total >= 3 && p.top[0]
        ? `${p.total} kişi skor tahminini yaptı bile, en çok ${p.top[0].home}-${p.top[0].away} denmiş 👀 siz ne diyorsunuz?`
        : pick(
            [
              'sizce bu maçı kim alır? 🤔 tahminlerinizi Taraftar sekmesinden yapın, tam skoru bilen 3 puan',
              'ilk golü kim atar sizce? yazın bakalım, maç sonu kim bildi bakarız 👇',
              'skor tahmini yapmayan kaldı mı? 🎯 tam skor 3 puan, doğru sonuç 1 puan',
            ],
            m.id + 'q',
          ),
  });
  return out;
}

/** İlk 11'ler açıklanınca (maç başlamadan) */
export function lineupsOut(m: Match): BotSay[] {
  const l = m.lineups;
  if (!l || !l.home.startXI.length || !l.away.startXI.length) return [];
  const f = (side: Side) => (l[side].formation ? ` ${l[side].formation}` : '');
  const out: BotSay[] = [{ nick: BOTS.istat, text: `📋 ilk 11'ler geldi: ${m.home.name}${f('home')}, ${m.away.name}${f('away')}. detaylar Kadrolar sekmesinde` }];
  const fw = (side: Side) => l[side].startXI.find((p) => p.pos === 'F')?.name;
  const hf = fw('home'), af = fw('away');
  out.push({
    nick: BOTS.yorum,
    text:
      hf && af
        ? `${m.home.short} hücumda ${hf}, ${m.away.short} tarafında ${af} var. ilk gol kimden gelir? ⚽`
        : pick(['kadrolara baktım da sürpriz isim var mı sizce? hocaların tercihleri hakkında ne düşünüyorsunuz 👇', 'ilk 11ler belli oldu, beğendiniz mi? 👀'], m.id + 'xi'),
  });
  return out;
}

/** Başlamaya az kala (liste yenilenirken) */
export function kickoffSoon(m: MatchSummary): BotSay[] {
  return [{ nick: BOTS.tribun, text: pick([`son dakikalar ⏳ ${m.home.name} - ${m.away.name} birazdan başlıyor, herkes yerini alsın 🔥 ${tag(m)}`, `az kaldı az 🔥 ${m.home.short} - ${m.away.short} için geri sayım bitiyor ${tag(m)}`], m.id + 'soon') }];
}

/** Devre arası */
export function halfTime(m: Match): BotSay[] {
  const { home: hs, away: as } = m.score;
  const lead = hs === as ? null : hs > as ? m.home.name : m.away.name;
  return [
    {
      nick: BOTS.tribun,
      text: lead
        ? `ilk yarı ${scoreLine(m)} bitti, ${lead} önde ama daha 45 dakika var 😮‍💨 ${tag(m)}`
        : hs === 0
          ? `ilk yarı golsüz bitti 😴 ikinci yarıda biraz hareket istiyoruz ${tag(m)}`
          : `ilk yarı ${scoreLine(m)}, maç tam ayar gidiyor 🔥 ${tag(m)}`,
    },
    { nick: BOTS.yorum, text: pick(['devre arası sorusu: ikinci yarıda kim oyuna girmeli? değişiklik önerilerini Taraftar sekmesinden yapabilirsiniz 🔁', 'ilk yarının en iyisi kimdi sizce? 👇'], m.id + 'ht') },
  ];
}

const minuteOf = (e: MatchEvent) => `${e.minute}${e.extra ? `+${e.extra}` : ''}'`;

/** Maç sonu: tepki, rakamlar (varsa), soru */
export function fullTime(m: Match, fan: SpikerFan): BotSay[] {
  const { home: hs, away: as } = m.score, t = tag(m), sc = scoreLine(m);
  const W = hs > as ? m.home.name : m.away.name;
  const out: BotSay[] = [
    {
      nick: BOTS.tribun,
      text:
        hs === as
          ? hs === 0 ? `golsüz beraberlik 😐 ${sc}, iki taraf da pek memnun değildir herhalde ${t}` : `puanlar paylaşıldı 🤝 ${sc} ${t}`
          : Math.abs(hs - as) >= 3 ? `${W} resmen şov yaptı 🔥 ${sc} ${t}`
          : pick([`ve maç bitti! ${W} 3 puanı aldı 👏 ${sc} ${t}`, `bitti bitti 🏁 kazanan ${W}, ${sc} ${t}`], m.id + 'ft'),
    },
  ];

  const parts: string[] = [];
  const goals = m.events
    .filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
    .map((e) => `${e.player ?? '?'} ${minuteOf(e)}${e.type === 'penalty' ? ' (pen.)' : e.type === 'own_goal' ? ' (k.k.)' : ''}`);
  if (goals.length) parts.push(`goller: ${goals.join(', ')}.`);
  const stat = (k: string) => m.stats.find((s) => s.key === k);
  const pos = stat('possession'), sot = stat('shotsOnTarget');
  if (pos) parts.push(`topla oynama %${pos.home}-%${pos.away}.`);
  if (sot) parts.push(`isabetli şut ${sot.home}-${sot.away}.`);
  const winner = fan.polls.find((p) => p.key === 'winner');
  if (winner && winner.total >= 3) parts.push(`ankette ${winner.total} kişiden ${winner.options[hs > as ? 0 : hs === as ? 1 : 2]?.votes ?? 0} kişi bildi.`);
  const p = fan.predictions;
  if (p.total) parts.push(p.exact ? `${p.total} skor tahmininden ${p.exact} tanesi tam isabet 🎯` : `${p.total} skor tahmini vardı, tam skoru bilen çıkmadı.`);
  if (parts.length) out.push({ nick: BOTS.istat, text: `📊 maç sonu rakamlar: ${parts.join(' ')}` });

  out.push({
    nick: BOTS.yorum,
    text: pick(['sizce maçın adamı kim? puanlarınızı Taraftar sekmesinden verin ⭐', 'maç bitti, sıra sizde 💬 en çok kim göz doldurdu?', 'bu maçı tek kelimeyle anlatın 👇'], m.id + 'q2'),
  });
  return out;
}

/** Taraftar oylarıyla maçın adamı (en az 3 oy alan oyuncular arasında en yüksek ortalama) */
export function manOfTheMatch(m: Match, fan: SpikerFan): BotSay[] {
  const names = new Map<string, string>();
  for (const side of ['home', 'away'] as Side[]) {
    const l = m.lineups?.[side];
    for (const p of [...(l?.startXI ?? []), ...(l?.subs ?? [])]) names.set(p.id, `${p.name} (${side === 'home' ? m.home.short : m.away.short})`);
  }
  const best = Object.entries(fan.ratings)
    .filter(([id, r]) => names.has(id) && r.count >= 3)
    .sort((a, b) => b[1].avg - a[1].avg || b[1].count - a[1].count)[0];
  if (!best) return [];
  return [{ nick: BOTS.istat, text: `⭐ taraftarın seçtiği maçın adamı: ${names.get(best[0])}, ${best[1].count} oyla ${best[1].avg.toFixed(1).replace('.', ',')} ortalama` }];
}
