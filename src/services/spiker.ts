// YorumcuBot: maç sohbetine maç öncesi ve sonrası, maç, futbolcular ve hocalar hakkında net ve keskin yorumlar yazar.
// Sohbette "bot" rozetiyle görünür; adı da bot olduğunu söyler. Yorumlar gerçek veriye dayanır (kadro, olaylar,
// istatistik, puan durumu, taraftar oyları); olmayan bir şeyi uydurmaz. API'ye ek istek atmaz.
import type { Match, MatchEvent, Player, Side, Standings } from '../types.js';

export const BOT_NICK = 'YorumcuBot';
export type BotSay = { nick: string; text: string };

/** Fan verisinden botun kullandığı özet (hepsi gerçek sayılar) */
export interface SpikerFan {
  ratings: Record<string, { avg: number; count: number }>;
}

/** Aynı maçta hep aynı, maçtan maça değişen kalıp seçimi */
function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return list[Math.abs(h) % list.length];
}

/** Aday yorumlardan öncelikli olanları seçer (yüksek puan önce), en fazla n tane */
type Take = [number, string];
const top = (takes: (Take | null | false | undefined)[], n: number): BotSay[] =>
  (takes.filter(Boolean) as Take[])
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map(([, text]) => ({ nick: BOT_NICK, text }));

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const team = (m: Match, s: Side) => m[s].name;
const coachOf = (m: Match, s: Side) => m.lineups?.[s].coach || `${m[s].short} hocası`;
const stat = (m: Match, key: string) => m.stats.find((x) => x.key === key);
const minuteOf = (e: MatchEvent) => `${e.minute}${e.extra ? `+${e.extra}` : ''}.`;
const isGoal = (e: MatchEvent) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal';
/** Golün kimin hanesine yazıldığı (kendi kalesine gol rakibe) */
const goalSide = (e: MatchEvent): Side => (e.type === 'own_goal' ? other(e.side) : e.side);
const BIG = new Set(['Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor']);
const fmt1 = (n: number) => n.toFixed(1).replace('.', ',');

function formationTake(m: Match, s: Side): string | null {
  const f = m.lineups?.[s].formation;
  if (!f) return null;
  const c = coachOf(m, s), t = team(m, s);
  if (/^[35]-/.test(f)) return `${c} ${f} ile çıkıyor. üçlü savunma cesur tercih, kanat bekleri yorulursa ${t} arkada çok boşluk verir`;
  if (f === '4-4-2') return `${c} klasik 4-4-2 dedi, bu maçta risk almak istemiyor. orta saha sayıca az kalırsa ${t} topu hiç göremez`;
  if (f === '4-3-3') return `${c} 4-3-3 ile hücum diyor. ${t} bugün kanatlardan oynayamazsa bu diziliş kendi ayağına sıkılan kurşun olur`;
  if (f.startsWith('4-2-3-1')) return `${c} yine 4-2-3-1, sürpriz yok. ${t} için her şey 10 numaranın gününde olmasına bağlı`;
  if (f.startsWith('4-1-4-1')) return `${c} 4-1-4-1 ile kapanıyor. bu dizilişle ${t} kazanmayı değil kaybetmemeyi düşünüyor`;
  return `${c} ${f} ile çıkıyor, ilginç bir tercih. tutarsa dahi, tutmazsa ilk hedef olur`;
}

function strikerTake(m: Match): string | null {
  const fw = (s: Side) => m.lineups?.[s].startXI.find((p) => p.pos === 'F');
  const s = pick<Side>(['home', 'away'], m.id + 'fw'), p = fw(s);
  return p ? `${team(m, s)} hücumu tamamen ${p.name} üzerine kurulu. o bugün kayıpsa takım da kayıp` : null;
}

/** Maç öncesi (odaya ilk girişte) */
export function preMatch(m: Match, table: Standings | null, _fan: SpikerFan): BotSay[] {
  const row = (s: Side) => table?.rows.find((r) => r.team.id === m[s].id);
  const h = row('home'), a = row('away');
  const takes: (Take | null)[] = [];
  if (BIG.has(m.home.name) && BIG.has(m.away.name))
    takes.push([60, pick(['derbide form durumu sıfırlanır. bu akşam kim daha çok isterse o kazanır, gerisi hikaye 🔥', 'derbi haftası tablo konuşmaz. bu maçı kaybeden hoca pazartesi çok soru duyar'], m.id)]);
  if (h && a) {
    const gap = Math.abs(h.rank - a.rank);
    const [fav, und] = h.rank < a.rank ? ['home', 'away'] as const : ['away', 'home'] as const;
    if (gap >= 6) takes.push([50, `tabloda ${gap} sıra fark var ama bu tür maçlarda tablo konuşmaz. ${team(m, und)} için kaybedecek hiçbir şey yok, ${team(m, fav)} rehavete kapılırsa yanar ⚡`]);
    else if (gap <= 2) takes.push([45, `sıralamada kafa kafaya iki takım (${h.points} - ${a.points} puan). bu maçı kaybeden haftaya çok konuşulur`]);
    for (const [s, r] of [['home', h], ['away', a]] as const) {
      const f = (r.form ?? '').slice(-5);
      const losses = [...f].filter((c) => c === 'L').length, wins = [...f].filter((c) => c === 'W').length;
      if (losses >= 3) takes.push([55, `${team(m, s)} son 5 maçta ${losses} kez kaybetti. bu akşam da puan bırakırsa ${coachOf(m, s)} için sular iyice ısınır 🔥`]);
      else if (wins >= 4) takes.push([40, `${team(m, s)} son 5 maçta ${wins} galibiyet aldı. şu an bu takımı durdurmak kolay değil`]);
    }
  }
  takes.push([10, pick([`${m.home.name} evinde oynuyor. bu maçtan 3 puan çıkaramazsa iç sahada kimse ondan korkmaz`, `bu maçın favorisi kağıt üstünde belli ama kağıt üstünde maç kazanan görmedim`], m.id + 'gen')]);
  return top(takes, 2);
}

function lineupsTakes(m: Match): Take[] {
  if (!m.lineups?.home.startXI.length || !m.lineups?.away.startXI.length) return [];
  const s = pick<Side>(['home', 'away'], m.id + 'f');
  return [formationTake(m, s), strikerTake(m)].filter(Boolean).map((t, i) => [35 - i, t as string]);
}

/** İlk 11'ler açıklanınca (maç başlamadan) */
export function lineupsOut(m: Match): BotSay[] {
  return top(lineupsTakes(m), 2);
}

/** Devre arası */
export function halfTime(m: Match): BotSay[] {
  const { home: hs, away: as } = m.score;
  const takes: (Take | null)[] = [];
  const evs = m.events.filter((e) => e.minute <= 45);
  const red = evs.find((e) => e.type === 'red');
  if (red) takes.push([70, `${red.player ? `${red.player} kırmızı gördü ve ` : 'kırmızı kart '}${team(m, red.side)} takımını 10 kişi bıraktı. ikinci yarı ${team(m, red.side)} için çok uzun olacak`]);
  const pos = stat(m, 'possession'), sot = stat(m, 'shotsOnTarget');
  for (const s of ['home', 'away'] as Side[]) {
    const mine = s === 'home' ? hs : as, theirs = s === 'home' ? as : hs;
    if (pos && pos[s] >= 60 && mine <= theirs) takes.push([60, `${team(m, s)} %${pos[s]} topla oynuyor ama skor tabelasında karşılığı yok. pas pas pas, sonuç sıfır. kısır bir hakimiyet`]);
    if (sot && sot[s] === 0) takes.push([55, `${team(m, s)} 45 dakikada kaleyi bir kez bile bulamadı. ${coachOf(m, s)} soyunma odasında sesini yükseltmezse ikinci yarı da aynı film`]);
  }
  const scorers = evs.filter((e) => isGoal(e) && e.type !== 'own_goal' && e.player);
  if (scorers.length) {
    const g = scorers[scorers.length - 1];
    takes.push([45, `${g.player} bugün sahanın en tehlikeli adamı. ${minuteOf(g)} dakikadaki o golü başka kim atardı`]);
  }
  if (hs === 0 && as === 0 && !red) takes.push([30, '45 dakikalık uyku hapı 😴 iki hoca da kazanmayı değil kaybetmemeyi oynuyor']);
  else if (hs !== as) {
    const lead: Side = hs > as ? 'home' : 'away';
    takes.push([25, `${team(m, lead)} önde ama bu oyunla maçı kapatmak zor. ikinci yarı ${team(m, other(lead))} baskı kurar, ${coachOf(m, other(lead))} değişikliği erken yapmalı`]);
  } else takes.push([25, `${hs}-${as} ve maç tam ayar. ilk hata yapan kaybeder, iki savunma da bugün güven vermiyor`]);
  return top(takes, 2);
}

const ratingOf = (p: Player) => (typeof p.stats?.rating === 'number' ? p.stats.rating : null);

/** Maç sonu */
export function fullTime(m: Match, _fan: SpikerFan): BotSay[] {
  const { home: hs, away: as } = m.score;
  const takes: (Take | null)[] = [];
  const winner: Side | null = hs === as ? null : hs > as ? 'home' : 'away';
  const pos = stat(m, 'possession'), sot = stat(m, 'shotsOnTarget');
  const goals = m.events.filter(isGoal);

  if (winner && Math.abs(hs - as) >= 3)
    takes.push([80, `${team(m, winner)} rakibini sahadan sildi 🔥 ${m.home.short} ${hs}-${as} ${m.away.short}. ${coachOf(m, other(winner))} için bu skoru açıklamak hiç kolay olmayacak`]);
  if (winner) {
    const l = other(winner);
    if (pos && sot && pos[l] > pos[winner] && sot[l] > sot[winner])
      takes.push([75, `skor ${team(m, winner)} dedi ama oyunu ${team(m, l)} oynadı. %${pos[l]} topla oynayıp ${sot[l]} isabetli şut çekip kaybetmek... futbol bazen acımasız`]);
  } else if (pos && sot) {
    const dom: Side = pos.home >= pos.away ? 'home' : 'away';
    if (pos[dom] >= 58 && sot[dom] > sot[other(dom)])
      takes.push([70, `${team(m, dom)} %${pos[dom]} topla oynadı, ${sot[dom]} isabetli şut çekti ve yine 1 puan. bu takımın derdi oyun değil bitiricilik`]);
  }
  const last = goals[goals.length - 1];
  if (last && last.minute >= 85 && Math.abs(hs - as) <= 1) {
    const s = goalSide(last);
    takes.push([
      78,
      winner === s
        ? `${minuteOf(last)} dakikada ${last.player ?? 'gelen gol'}! ${team(m, s)} maçı son nefeste kopardı, rakip hocanın elinde sadece sorular kaldı`
        : `${minuteOf(last)} dakikada gelen golle ${team(m, s)} 1 puanı kurtardı. ${last.player ?? 'golü atan'} bu gecenin kahramanı`,
    ]);
  }
  const og = goals.find((e) => e.type === 'own_goal');
  if (og) takes.push([60, `${og.player ?? 'o oyuncu'} kendi kalesine attı. bu gece uyku zor 😬`]);
  const red = m.events.find((e) => e.type === 'red');
  if (red) takes.push([65, `${red.player ? `${red.player} kırmızı gördü ve` : 'kırmızı kartla'} maçın dengesi orada bozuldu. ${team(m, red.side)} adına affedilmeyecek bir an`]);
  const brace = [...goals.filter((e) => e.type !== 'own_goal' && e.player).reduce((mp, e) => mp.set(e.player!, (mp.get(e.player!) ?? 0) + 1), new Map<string, number>())].find(([, n]) => n >= 2);
  if (brace) takes.push([72, `${brace[0]} ${brace[1]} golle gecenin tek yıldızı. böyle bir forvet varken ${coachOf(m, m.events.find((e) => e.player === brace[0])!.side)} rahat uyur`]);
  if (winner) {
    const l = other(winner);
    const firstSub = m.events.find((e) => e.type === 'sub' && e.side === l);
    if (firstSub && firstSub.minute >= 70) takes.push([58, `${coachOf(m, l)} geride olmasına rağmen ilk değişikliği ${minuteOf(firstSub)} dakikada yaptı. bu kadar beklemek affedilmez`]);
  }
  // API reytingleri (açılan maçlarda gelir): en iyi ve en kötü
  const rated = (['home', 'away'] as Side[]).flatMap((s) =>
    (m.lineups?.[s].startXI ?? []).concat(m.lineups?.[s].subs ?? []).map((p) => ({ p, s, r: ratingOf(p), min: p.stats?.minutes ?? 0 })),
  ).filter((x) => x.r != null && x.min >= 45) as { p: Player; s: Side; r: number; min: number }[];
  const spread = rated.length ? Math.max(...rated.map((x) => x.r)) - Math.min(...rated.map((x) => x.r)) : 0;
  if (spread >= 1) {
    const best = rated.reduce((a, b) => (b.r > a.r ? b : a));
    takes.push([62, `maçın en iyisi bence ${best.p.name}. ${fmt1(best.r)} reytingle sahanın patronuydu`]);
    const full = rated.filter((x) => x.min >= 60);
    const worst = full.length ? full.reduce((a, b) => (b.r < a.r ? b : a)) : null;
    if (worst && worst.r < 6.2) takes.push([57, `${worst.p.name} bugün sahada yoktu. ${fmt1(worst.r)} reyting her şeyi anlatıyor, ${coachOf(m, worst.s)} bu oyuncuyla bir konuşma yapmalı`]);
  }
  if (!winner && hs === 0) takes.push([20, '90 dakika, sıfır gol. iki takım da bu maçın çabuk unutulmasını ister 😴']);
  else if (winner) takes.push([15, `${team(m, winner)} 3 puanı aldı ama ${team(m, other(winner))} tarafında ciddi sorular var. ${coachOf(m, other(winner))} bu hafta rahat değil`]);
  else takes.push([15, `${hs}-${as}, iki takım da birbirini yenemedi. bu sonuç iki hocayı da tam kurtarmaz`]);
  return top(takes, 3);
}

/** Taraftar oylarıyla maçın adamı (en az 3 oy alan oyuncular arasında en yüksek ortalama) */
export function manOfTheMatch(m: Match, fan: SpikerFan): BotSay[] {
  const names = new Map<string, string>();
  for (const s of ['home', 'away'] as Side[]) {
    const l = m.lineups?.[s];
    for (const p of [...(l?.startXI ?? []), ...(l?.subs ?? [])]) names.set(p.id, p.name);
  }
  const best = Object.entries(fan.ratings)
    .filter(([id, r]) => names.has(id) && r.count >= 3)
    .sort((a, b) => b[1].avg - a[1].avg || b[1].count - a[1].count)[0];
  if (!best) return [];
  return [{ nick: BOT_NICK, text: `taraftar maçın adamını seçti: ${names.get(best[0])}, ${best[1].count} oyla ${fmt1(best[1].avg)} ortalama. bence de tartışmasız ⭐` }];
}
