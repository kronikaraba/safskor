// Safskor Yorum (sitenin otomatik yorumcusu): maç sohbetine maç öncesi, maç içi (gol, kırmızı kart, kaçan penaltı, değişiklik, dakika notları) ve
// sonrası, tribündeki fanatik taraftar ağzıyla net ve keskin yorumlar yazar (Bat'ın isteği: "fanatik taraftar yazmış gibi").
// Sohbette Safskor logosu ve adıyla görünür; üye gibi gösterilmez. Yorumlar gerçek veriye dayanır (kadro, olaylar,
// istatistik, puan durumu, taraftar oyları); olmayan bir şeyi uydurmaz. Soru sormaz, küfür ve hakaret etmez. API'ye ek istek atmaz.
import type { Match, MatchEvent, MatchPreview, MatchSummary, Player, Side, Standings } from '../types.js';

export const BOT_NICK = 'Safskor Yorum';
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
/** Golün kimin hanesine yazıldığı: olayın tarafı (kendi kalesine golde de lehine gol yazılan takım; sohbet ve tabela da böyle gösterir) */
const goalSide = (e: MatchEvent): Side => e.side;
const BIG = new Set(['Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor']);
const fmt1 = (n: number) => n.toFixed(1).replace('.', ',');
const up = (s: string) => s.toLocaleUpperCase('tr-TR');

function formationTake(m: Match, s: Side): string | null {
  const f = m.lineups?.[s].formation;
  if (!f) return null;
  const c = coachOf(m, s), t = team(m, s);
  if (/^[35]-/.test(f)) return `${c} ${f} ile çıkıyor. üçlü savunma mı, bu maçta mı! kanat bekleri 60. dakikada biterse ${t} arkada delik deşik olur, şimdiden yazıyorum`;
  if (f === '4-4-2') return `${c} yine 4-4-2. 2026 yılındayız hocam! orta sahada sayıca ezilirsek topu bir daha göremeyiz`;
  if (f === '4-3-3') return `${c} 4-3-3 ile saldır dedi, işte bu! ${t} kanatlardan yüklenirse bu maç ilk yarıda biter 🔥`;
  if (f.startsWith('4-2-3-1')) return `${c} yine 4-2-3-1, ezber futbol. bu akşam 10 numara oynamazsa ${t} da oynamaz, net`;
  if (f.startsWith('4-1-4-1')) return `${c} 4-1-4-1 ile kapandı. bu diziliş kazanmak için değil kaybetmemek için. korkak futbolla şampiyonluk gelmez`;
  return `${c} ${f} dedi. tutarsa dahi ilan ederiz, tutmazsa maçtan sonra ilk hesap sorulacak isim o`;
}

function strikerTake(m: Match): string | null {
  const fw = (s: Side) => m.lineups?.[s].startXI.find((p) => p.pos === 'F');
  const s = pick<Side>(['home', 'away'], m.id + 'fw'), p = fw(s);
  return p
    ? pick([
        `bu akşam bütün yük ${p.name} omzunda. atarsa kral, atamazsa forma ona ağır gelir. ortası yok`,
        `${p.name} sahada. ${team(m, s)} forması giyen her forvet bu maçta kendini kanıtlar ya da yedek kulübesini boylar`,
      ], m.id + 'fwt')
    : null;
}

/** Takımın son maçlarından G/B/M dizisi (en eski solda) */
function formOf(list: MatchSummary[], teamId: string): string {
  return [...list]
    .slice(0, 5)
    .reverse()
    .map((x) => {
      const [a, b] = x.home.id === teamId ? [x.score.home, x.score.away] : [x.score.away, x.score.home];
      return a > b ? 'W' : a < b ? 'L' : 'D';
    })
    .join('');
}

/** Maç öncesi bilgilerinden (eksikler, aralarındaki maçlar, form, muhtemel 11) yorumlar */
function previewTakes(m: Match, pv: Omit<MatchPreview, 'table'> | null): Take[] {
  if (!pv) return [];
  const takes: Take[] = [];
  for (const s of ['home', 'away'] as Side[]) {
    const out = (pv.absent?.[s] ?? []).filter((a) => a.kind !== 'doubt');
    const sus = out.find((a) => a.kind === 'suspension');
    if (out.length >= 3)
      takes.push([58, pick([
        `${team(m, s)} ${out.length} eksikle çıkıyor: ${out.slice(0, 3).map((a) => a.name).join(', ')}. kadro revir gibi 🏥 bu maçta bahane yok ama mazeret çok`,
        `${out.length} eksik! ${out.slice(0, 2).map((a) => a.name).join(' ve ')} yok. ${coachOf(m, s)} kenardan değil sahaya kendisi çıksa yeridir`,
      ], m.id + s + 'abs')]);
    else if (sus) takes.push([52, `${sus.name} cezalı. en lazım olduğu maçta yoksun kardeşim! ${team(m, s)} bu akşam onun yokluğunu her dakika hissedecek`]);
    else if (out.length) takes.push([38, `${out.map((a) => a.name).join(' ve ')} yok. küçük eksik deyip geçmeyin, derbi gibi maçlar böyle detaylarda kaybedilir`]);

    const f = formOf(pv.last?.[s] ?? [], m[s].id);
    if (f.length >= 4) {
      const l = [...f].filter((c) => c === 'L').length, w = [...f].filter((c) => c === 'W').length;
      if (!w) takes.push([57, `${team(m, s)} son ${f.length} maçta tek galibiyet alamadı. YETER ARTIK! ${coachOf(m, s)} bu akşam kazanamazsa bavulunu hazırlasın`]);
      else if (l >= 3) takes.push([55, `son ${f.length} maçta ${l} yenilgi. bu ${team(m, s)} formasına yakışmıyor. bu akşam ya ayağa kalkarsın ya da tribün sana sırtını döner`]);
      else if (w >= 4) takes.push([45, `${team(m, s)} son ${f.length} maçta ${w} galibiyetle geliyor, takım uçuyor ✈️ önüne kim çıkarsa ezer geçer`]);
    }
  }
  const h2h = pv.h2h ?? [];
  if (h2h.length >= 4) {
    let hw = 0, aw = 0, d = 0;
    for (const x of h2h) {
      const [a, b] = x.home.id === m.home.id ? [x.score.home, x.score.away] : [x.score.away, x.score.home];
      if (a > b) hw++;
      else if (a < b) aw++;
      else d++;
    }
    const dom: Side | null = hw >= h2h.length * 0.6 ? 'home' : aw >= h2h.length * 0.6 ? 'away' : null;
    if (dom) takes.push([54, `son ${h2h.length} maçın ${dom === 'home' ? hw : aw} tanesi ${team(m, dom)}. bu eşleşmenin babası belli 👑 ${team(m, other(dom))} bu akşam da boyun eğecek`]);
    else if (d >= h2h.length / 2) takes.push([40, `bu iki takım son ${h2h.length} maçta ${d} kez berabere. birbirlerini ezbere biliyorlar, ilk golü atan maçı koparır`]);
  }
  const c = pv.chances;
  if (c) {
    const fav: Side = c.home >= c.away ? 'home' : 'away';
    if (c[fav] >= 50) takes.push([36, `istatistik %${c[fav]} ile ${team(m, fav)} diyor. kağıt üstünde maç kazanılmıyor, ${team(m, other(fav))} bu akşam o kağıdı yırtıp atabilir ⚡`]);
    else takes.push([30, `istatistik bile karar veremedi: %${c.home} - %${c.draw} - %${c.away}. bu maçı bilgisayar değil yürek kazanır`]);
  }
  // muhtemel 11'den son maçın yıldızı
  const stars = (['home', 'away'] as Side[]).flatMap((s) => (pv.xi?.[s]?.startXI ?? []).map((p) => ({ p, s, r: p.stats?.rating ?? 0 })));
  const star = stars.length ? stars.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  if (star && star.r >= 7.6) takes.push([42, `${star.p.name} son maçta ${fmt1(star.r)} reyting aldı, adam yanıyor 🔥 topu ona verin, gerisini o halleder`]);
  if (pv.referee) {
    const ref = pv.referee.split(',')[0].trim();
    takes.push([12, pick([`hakem ${ref}. düdüğü cebinde tutsun, oyunu biz izlemeye geldik, onu değil`, `bu akşamın hakemi ${ref}. maçtan sonra adını konuşuyorsak bilin ki bir şeyler ters gitti`], m.id + 'ref')]);
  }
  return takes;
}

/** Maç öncesi (odaya ilk girişte) */
export function preMatch(m: Match, table: Standings | null, _fan: SpikerFan, pv: Omit<MatchPreview, 'table'> | null = null): BotSay[] {
  const row = (s: Side) => table?.rows.find((r) => r.team.id === m[s].id);
  const h = row('home'), a = row('away');
  const takes: (Take | null)[] = [];
  if (BIG.has(m.home.name) && BIG.has(m.away.name))
    takes.push([60, pick([
      `DERBİ GÜNÜ 🔥 bu maçta form yok, tablo yok, bahane yok. sahada ölümüne mücadele istiyoruz, gerisi teferruat bile değil`,
      `derbi kaybedilmez, bu kadar basit. ${m.home.short} - ${m.away.short} maçında 90 dakika ayak çeken formayı bıraksın gitsin`,
    ], m.id)]);
  if (h && a) {
    const gap = Math.abs(h.rank - a.rank);
    const [fav, und] = h.rank < a.rank ? ['home', 'away'] as const : ['away', 'home'] as const;
    if (gap >= 6) takes.push([50, `aradaki ${gap} sıra farkı kâğıt üstünde. ${team(m, fav)} bu maçı cebinde sanarsa ${team(m, und)} burnunu sürtür, rehavete yer yok ⚡`]);
    else if (gap <= 2) takes.push([45, `${h.points} puana ${a.points} puan, iki takım burun buruna. bu akşam kaybeden haftayı tribünün öfkesiyle geçirir`]);
    for (const [s, r] of [['home', h], ['away', a]] as const) {
      const f = (r.form ?? '').slice(-5);
      const losses = [...f].filter((c) => c === 'L').length, wins = [...f].filter((c) => c === 'W').length;
      if (losses >= 3) takes.push([55, `son 5 maçta ${losses} yenilgi. ${team(m, s)} böyle oynayacaksa ${coachOf(m, s)} bu akşamdan sonra koltuğunda oturamaz 🔥`]);
      else if (wins >= 4) takes.push([40, `${team(m, s)} son 5 maçta ${wins} galibiyet aldı. bu takım şu an kimseyi dinlemiyor, önüne geleni yıkıyor`]);
    }
  }
  takes.push(...previewTakes(m, pv));
  takes.push([10, pick([
    `${m.home.name} kendi evinde. kendi sahanda puan bırakırsan kimse senden korkmaz, bu akşam 3 puan şart`,
    `favori kâğıt üstünde belli ama kâğıt üstünde maç kazanan görmedim. sahada yürek konuşacak`,
  ], m.id + 'gen')]);
  return top(takes, 3);
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
  if (red) takes.push([70, `${red.player ? `${red.player} kırmızıyı gördü, ` : 'kırmızı kart çıktı, '}${team(m, red.side)} 10 kişi. bu sorumsuzluk affedilmez, ikinci yarı ${team(m, red.side)} için çile olacak`]);
  const pos = stat(m, 'possession'), sot = stat(m, 'shotsOnTarget');
  for (const s of ['home', 'away'] as Side[]) {
    const mine = s === 'home' ? hs : as, theirs = s === 'home' ? as : hs;
    if (pos && pos[s] >= 60 && mine <= theirs) takes.push([60, `${team(m, s)} %${pos[s]} topla oynuyor ve skor ${hs}-${as}. pas pas pas, sonuç SIFIR. bu tiki taka değil, uyku ilacı`]);
    if (sot && sot[s] === 0) takes.push([55, `${team(m, s)} 45 dakikada kaleyi bir kez bile bulamadı. ${coachOf(m, s)} soyunma odasında bardak kırmazsa ikinci yarı da aynı rezalet`]);
  }
  const scorers = evs.filter((e) => isGoal(e) && e.type !== 'own_goal' && e.player);
  if (scorers.length) {
    const g = scorers[scorers.length - 1];
    takes.push([45, `${g.player} bu ilk yarının tek adamı 👑 ${minuteOf(g)} dakikadaki o golü atacak başka kimse yoktu sahada`]);
  }
  if (hs === 0 && as === 0 && !red) takes.push([30, `45 dakikada tek heyecan yok 😴 iki takım da kazanmak için değil, kaybetmemek için oynuyor. bilet parası helal değil`]);
  else if (hs !== as) {
    const lead: Side = hs > as ? 'home' : 'away';
    takes.push([25, `${team(m, lead)} önde ama bu iş bitmedi. ${team(m, other(lead))} ikinci yarı bu silik oyunu sürdürürse fark açılır, ${coachOf(m, other(lead))} hemen hamle yapmalı`]);
  } else takes.push([25, `${hs}-${as}, maç bıçak sırtında. ilk hatayı yapan yanar, iki savunma da bu akşam güven vermiyor`]);
  return top(takes, 2);
}

// ------------------------------------------------------------------ maç içi

/** Başlama vuruşu */
export function kickoff(m: Match): BotSay[] {
  const big = BIG.has(m.home.name) && BIG.has(m.away.name);
  return top([[10, pick(big
    ? ['DERBİ BAŞLADI 🔥 ilk 15 dakika kimin daha aç olduğunu gösterecek. ayak çeken, topa korkarak giden bu formayı hak etmiyor', 've başladı! bu maçta ikinci şans yok. 90 dakika ölümüne, gerisi lafta kalır']
    : [`başladı! ${m.home.name} kendi evinde ilk dakikadan basacak, başka yolu yok`, `top yuvarlandı. ${m.away.name} kapanıp kontra bekleyecek, ${m.home.name} bu duvarı yıkamazsa yanar`, 'maç başladı, laf bitti. şimdi sahada konuşma zamanı 👀'], m.id + 'ko')]], 1);
}

/** İkinci yarı başlangıcı */
export function secondHalf(m: Match): BotSay[] {
  const { home: hs, away: as } = m.score;
  if (hs === as)
    return top([[10, pick([`ikinci yarı başladı, ${hs}-${as}. bu maçta beraberlik iki takıma da yenilgi, cesaret eden kazanır`, 'ikinci 45 başladı. hocalar artık korkmayı bıraksın, bu maçı risk alan kazanır'], m.id + '2h')]], 1);
  const lead: Side = hs > as ? 'home' : 'away';
  return top([[10, pick([`ikinci yarı başladı. ${team(m, other(lead))} ilk 10 dakikada gol bulamazsa bu maç tabuta girer`, `${team(m, lead)} önde başlıyor ikinci yarıya. geriye yaslanırsa kendi mezarını kendi kazar, saldırmaya devam`], m.id + '2h')]], 1);
}

/** Olaydan sonraki skor (olaylar sırayla) */
function scoreAfter(m: Match, e: MatchEvent) {
  const sc = { home: 0, away: 0 };
  for (const x of m.events) {
    if (isGoal(x)) sc[goalSide(x)]++;
    if (x.id === e.id) break;
  }
  return sc;
}

/** Maç içi olaya anlık yorum: gol, kırmızı kart, kaçan penaltı, değişiklik (geride ya da berabereyken) */
export function liveEvent(m: Match, e: MatchEvent): BotSay[] {
  const seed = m.id + e.id;
  const late = e.minute >= 85;
  if (isGoal(e)) {
    const s = goalSide(e), o = other(s);
    const sc = scoreAfter(m, e);
    const mine = sc[s], theirs = sc[o];
    const p = e.player ?? (e.type === 'own_goal' ? 'o oyuncu' : 'golcü');
    const P = up(p);
    const score = `${sc.home}-${sc.away}`;
    const goalsBy = e.type === 'own_goal' || !e.player ? 0 : m.events.filter((x) => isGoal(x) && x.type !== 'own_goal' && x.player === e.player && (m.events.indexOf(x) <= m.events.indexOf(e))).length;
    let t: string;
    if (e.type === 'own_goal') t = pick([`${p} kendi ağlarına gönderdi 🤦 ${team(m, s)} bu golü hediye paketinde aldı, ${score}. böyle savunmayla nereye`, `KENDİ KALESİNE! ${p} için kabus. ${team(m, other(s))} kendi kendini yaktı, ${score}`], seed);
    else if (goalsBy === 3) t = `HAT-TRICK 🎩🎩🎩 ${P}! bu adam bu akşam başka gezegenden gelmiş. ${team(m, o)} savunması hâlâ arıyor, ${score}`;
    else if (goalsBy === 2) t = pick([`${P} YİNE! ⚽⚽ bu akşamki ikinci golü. bu forvete altın heykel dikin`, `${p} doymuyor, ikinci golünü de attı! ${team(m, o)} savunması bu adamı tek dakika tutamadı, rezalet`], seed);
    else if (late && mine === theirs) t = pick([`${minuteOf(e)} DAKİKA! ${P}! ${team(m, s)} pes etmedi, yıkılmadı 🔥 ${coachOf(m, o)} maçı bitti sanıyordu`, `son dakikada ${P}! ${score}. bu golün tribündeki sesi deprem gibi gelmiştir, ayakta alkış`], seed);
    else if (late && mine === theirs + 1) t = pick([`${minuteOf(e)} dakika ve ${P}!!! ${team(m, s)} öne geçti 🔥🔥 bu gol 3 puan, bu gol şampiyonluk kokusu`, `${P} son nefeste vurdu! ${score}. ${team(m, o)} için tam bir kabus, ağlasınlar`], seed);
    else if (e.type === 'penalty') t = pick([`${p} penaltıda affetmedi, ${score}. buz gibi soğukkanlılık, kaleci yanlış köşede kaldı 🧊`, `penaltı GOL! ${p} topu ağlara gömdü, ${score}. işte golcü budur`], seed);
    else if (mine === 1 && theirs === 0) t = pick([`GOOOL! ${P} ${minuteOf(e)} dakikada kilidi kırdı ⚽ ${team(m, s)} önde. şimdi bas bas bas, bırakma`, `${P}!!! ${team(m, s)} önde, ${score}. ${coachOf(m, o)} kenarda donup kaldı, planı çöpe gitti`], seed);
    else if (mine === theirs) t = pick([`${team(m, s)} cevabını verdi! ${P} eşitledi, ${score}. bu takım yıkılmaz, maç yeniden başlıyor 🔥`, `${p} ile beraberlik! ${team(m, o)} önde olmanın keyfini 5 dakika bile süremedi`], seed);
    else if (mine === theirs + 1 && theirs > 0) t = pick([`GERİ DÖNÜŞ 🔥 ${P} attı ve ${team(m, s)} öne geçti, ${score}. karakter budur, forma budur`, `${P}! ${team(m, s)} yeniden önde. ${team(m, o)} savunması paramparça`], seed);
    else if (mine - theirs >= 3) t = pick([`fark ${mine - theirs} oldu, ${score}. bu maç değil, ders 📚 ${coachOf(m, o)} bu akşam uyuyamaz`, `${p} de attı, ${score}. ${team(m, o)} sahada yok, beyaz bayrağı çoktan çekmiş`], seed);
    else if (mine - theirs === 2) t = pick([`${P} farkı ikiye çıkardı, ${score}. ${team(m, s)} fişi çekiyor, bu maç bitti 🔌`, `ikinci darbe! ${p} ile ${score}. ${team(m, o)} için dönüş artık hayal`], seed);
    else if (theirs - mine >= 2) t = pick([`şeref golü, ${score}. ${team(m, s)} uyandı ama çok geç, tren çoktan kaçtı`, `${p} attı ama skor hâlâ ${score}. bu gol kimseyi kandırmasın, sadece teselli`], seed);
    else t = `${P} attı, ${score}! ${team(m, s)} maça ortak oldu, tribün ayakta. kalan dakikalarda her şey olur`;
    if (e.related && goalsBy < 2 && e.type === 'goal' && !late) t += `. ${e.related} pası da tablo gibi 👌`;
    return [{ nick: BOT_NICK, text: t }];
  }
  if (e.type === 'red') {
    const s = e.side, p = e.player ?? 'bir oyuncu';
    const t = e.minute <= 30
      ? pick([`${p} ${minuteOf(e)} dakikada KIRMIZI 🟥 takımını yaktı! ${team(m, s)} maçın büyük kısmını 10 kişi oynayacak, bu sorumsuzluğun hesabı sorulmalı`, `erken kırmızı! ${p} ne yaptığını bilmiyor. bu kadar erken 10 kişi kalmak affedilmez`], m.id + e.id)
      : late
        ? `${p} son dakikalarda kırmızıyı gördü 🟥 sinirler tamamen bozuk, bu takım kafayı kaybetmiş`
        : pick([`${p} KIRMIZI 🟥 ${team(m, s)} 10 kişi! ${team(m, other(s))} şimdi bastırmazsa bu fırsatı bir daha bulamaz, üstlerine çullanın`, `kırmızı kart! ${p} takımını ortada bıraktı. maç burada kırılır`], m.id + e.id);
    return [{ nick: BOT_NICK, text: t }];
  }
  if (e.type === 'missed_penalty') {
    const p = e.player ?? 'penaltıcı';
    return [{ nick: BOT_NICK, text: pick([`${p} penaltıyı kaçırdı 😤 böyle fırsat bir daha gelmez! o topa bu kadar gevşek vurulmaz`, `PENALTI KAÇTI! ${p} bu akşam yastığa başını koyunca bu anı düşünecek. affı yok`], m.id + e.id) }];
  }
  if (e.type === 'sub' && e.minute >= 46) {
    const s = e.side;
    const sc = scoreAfter(m, e);
    const mine = sc[s], theirs = sc[other(s)];
    const out = [...(m.lineups?.[s].startXI ?? []), ...(m.lineups?.[s].subs ?? [])].find((p) => p.id === e.playerId || p.name === e.player);
    const outR = out ? ratingOf(out) : null;
    const inn = e.related ?? 'yeni oyuncu', off = e.player ?? 'oyuncu';
    // yalnızca takımın ikinci yarıdaki ilk değişikliği yorumlanır (her değişikliğe yorum sohbeti boğar)
    const first = m.events.find((x) => x.type === 'sub' && x.side === s && x.minute >= 46)?.id === e.id;
    if (!first) return [];
    if (outR != null && outR < 6.3) return [{ nick: BOT_NICK, text: pick([`${off} çıktı, ÇOK ŞÜKÜR. ${fmt1(outR)} reytingle sahada turist gibiydi, ${inn} ondan kötü oynayamaz`, `${coachOf(m, s)} sonunda uyandı, ${off} kenara. ${fmt1(outR)} reyting, bu değişiklik 20 dakika önce yapılmalıydı`], m.id + e.id) }];
    if (mine < theirs) return [{ nick: BOT_NICK, text: pick([`${coachOf(m, s)} hamlesini yaptı: ${inn} girdi, ${off} çıktı. geride olan takımda bu değişiklik ${e.minute >= 70 ? 'çok geç, kimi kandırıyoruz' : 'şart, şimdi ya hep ya hiç'}`, `${inn} oyunda. ${coachOf(m, s)} son kozunu oynuyor, bu da tutmazsa hesabı maçtan sonra verir`], m.id + e.id) }];
    if (mine > theirs && e.minute >= 70) return [{ nick: BOT_NICK, text: `${coachOf(m, s)} skoru korumaya geçti: ${off} çıktı, ${inn} girdi. otobüsü kaleye çekip son dakikada yiyen çok takım gördük, dikkat` }];
    if (mine === theirs) return [{ nick: BOT_NICK, text: `${coachOf(m, s)} ${inn} ile kazanmaya oynuyor, işte bu! beraberlik bize yetmez, cesaret istiyoruz` }];
  }
  return [];
}

/** Dakika notları (30. ve 70. dakika): eldeki istatistik ve skora göre */
export function midGame(m: Match, mark: 30 | 70): BotSay[] {
  const { home: hs, away: as } = m.score;
  const takes: (Take | null)[] = [];
  const pos = stat(m, 'possession'), shots = stat(m, 'shots'), sot = stat(m, 'shotsOnTarget'), xg = stat(m, 'xg');
  // not, maç odası geç açıldıysa 30./70. dakikadan sonra yazılabilir: metin gerçek dakikayı söyler
  const min = Math.max(mark, m.minute ?? mark);
  for (const s of ['home', 'away'] as Side[]) {
    const mine = s === 'home' ? hs : as, theirs = s === 'home' ? as : hs;
    if (pos && pos[s] >= 62 && mine <= theirs) takes.push([60, `${min}. dakika, ${team(m, s)} %${pos[s]} topla oynuyor, skor ${hs}-${as}. topu sevmekle gol atılmıyor, kaleye vurun artık`]);
    if (shots && sot && shots[s] >= 8 && sot[s] <= 1) takes.push([58, `${team(m, s)} ${shots[s]} şut çekti, kaleyi bulan ${sot[s]}. bu bitiricilikle sabaha kadar oynasalar gol çıkmaz, tribün çıldırdı`]);
    if (xg && xg[s] - xg[other(s)] >= 1 && mine <= theirs) takes.push([62, `gol beklentisi ${team(m, s)} ${fmt1(xg[s])}, rakip ${fmt1(xg[other(s)])}. skor ise ${hs}-${as}. futbolda adalet yok kardeşim`]);
  }
  if (mark === 70) {
    if (hs === as) takes.push([30, `son ${Math.max(5, 90 - min)} dakika, ${hs}-${as}. şimdi yürek konuşur, kenardan ilk doğru hamleyi yapan 3 puanı alır`]);
    else {
      const lead: Side = hs > as ? 'home' : 'away';
      takes.push([30, `${min}. dakika, ${team(m, lead)} önde. ${team(m, other(lead))} şimdi her şeyini ortaya koymazsa bu maç bitti, tabutun son çivisi çakılıyor`]);
    }
  } else if (hs === 0 && as === 0) takes.push([25, `${min} dakika geçti, tek kurşun yok. iki takım da birbirini kokluyor, bu tempoyla gol ancak hatadan gelir 😴`]);
  return top(takes, 1);
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
    takes.push([80, `${team(m, winner)} rakibini sahadan sildi 🔥 ${m.home.short} ${hs}-${as} ${m.away.short}. ${team(m, other(winner))} adına utanç gecesi, ${coachOf(m, other(winner))} bunu açıklayamaz`]);
  if (winner) {
    const l = other(winner);
    if (pos && sot && pos[l] > pos[winner] && sot[l] > sot[winner])
      takes.push([75, `skor ${team(m, winner)} dedi ama oyunu ${team(m, l)} oynadı. %${pos[l]} topla oynayıp ${sot[l]} isabetli şutla kaybetmek... futbol bazen zalim`]);
  } else if (pos && sot) {
    const dom: Side = pos.home >= pos.away ? 'home' : 'away';
    if (pos[dom] >= 58 && sot[dom] > sot[other(dom)])
      takes.push([70, `${team(m, dom)} %${pos[dom]} topla oynadı, ${sot[dom]} isabetli şut çekti, yine 1 puan. bu takımın derdi oyun değil, golcü. transfer şart`]);
  }
  const last = goals[goals.length - 1];
  // son dakika golü maçı kazandırdıysa ya da beraberliği getirdiyse (farkı azaltan gol değil)
  if (last && last.minute >= 85 && Math.abs(hs - as) <= 1 && (!winner || winner === goalSide(last))) {
    const s = goalSide(last);
    takes.push([
      78,
      winner === s
        ? `${minuteOf(last)} dakikada ${last.player ?? 'gelen gol'}! ${team(m, s)} maçı son nefeste kopardı 🔥 bu takım ölmeden ölmez`
        : `${minuteOf(last)} dakikada gelen golle ${team(m, s)} 1 puanı söküp aldı. ${last.player ?? 'golü atan'} bu gecenin kahramanı`,
    ]);
  }
  const og = goals.find((e) => e.type === 'own_goal');
  if (og) takes.push([60, `${og.player ?? 'o oyuncu'} kendi kalesine attı. bu gece uyku yok, o anı bin kere izleyecek 🤦`]);
  const red = m.events.find((e) => e.type === 'red');
  if (red) takes.push([65, `${red.player ? `${red.player} kırmızıyı gördü,` : 'kırmızı kartla'} maç orada koptu. ${team(m, red.side)} adına affedilmeyecek bir sorumsuzluk`]);
  const brace = [...goals.filter((e) => e.type !== 'own_goal' && e.player).reduce((mp, e) => mp.set(e.player!, (mp.get(e.player!) ?? 0) + 1), new Map<string, number>())].find(([, n]) => n >= 2);
  if (brace) takes.push([72, `${up(brace[0])} ${brace[1]} golle gecenin kralı 👑 böyle bir forvet varken ${coachOf(m, m.events.find((e) => e.player === brace[0])!.side)} rahat uyur`]);
  if (winner) {
    const l = other(winner);
    const firstSub = m.events.find((e) => e.type === 'sub' && e.side === l);
    if (firstSub && firstSub.minute >= 70) takes.push([58, `${coachOf(m, l)} geride olmasına rağmen ilk değişikliği ${minuteOf(firstSub)} dakikada yaptı. neyi bekledin hocam, maçın bitmesini mi. affedilmez`]);
  }
  // API reytingleri (açılan maçlarda gelir): en iyi ve en kötü
  const rated = (['home', 'away'] as Side[]).flatMap((s) =>
    (m.lineups?.[s].startXI ?? []).concat(m.lineups?.[s].subs ?? []).map((p) => ({ p, s, r: ratingOf(p), min: p.stats?.minutes ?? 0 })),
  ).filter((x) => x.r != null && x.min >= 45) as { p: Player; s: Side; r: number; min: number }[];
  const spread = rated.length ? Math.max(...rated.map((x) => x.r)) - Math.min(...rated.map((x) => x.r)) : 0;
  if (spread >= 1) {
    const best = rated.reduce((a, b) => (b.r > a.r ? b : a));
    takes.push([62, pick([`maçın adamı tartışmasız ${best.p.name}. ${fmt1(best.r)} reytingle sahanın patronuydu 👑`, `${best.p.name} bu akşam başka ligdeydi, ${fmt1(best.r)} reyting. ${team(m, best.s)} bu adama heykel dikmeli`, `${fmt1(best.r)} reyting, ${best.p.name}. sahada 22 kişi vardı ama bu maçı tek başına o oynadı`], m.id + 'best')]);
    const full = rated.filter((x) => x.min >= 60);
    const worst = full.length ? full.reduce((a, b) => (b.r < a.r ? b : a)) : null;
    if (worst && worst.r < 6.2) takes.push([57, pick([`${worst.p.name} bugün sahada yoktu, ${fmt1(worst.r)} reyting. bu performansla o formayı bir daha giymemeli`, `${worst.p.name} için unutulacak bir gece, ${fmt1(worst.r)} reyting. ${team(m, worst.s)} böyle oyuncularla bir yere varamaz`, `${fmt1(worst.r)} reyting ve ${worst.p.name}. kenarda formayı hak eden biri varsa haftaya o oynasın, bu kadar net`], m.id + 'worst')]);
  }
  if (!winner && hs === 0) takes.push([20, '90 dakika, sıfır gol 😴 iki takım da bu maçı bir an önce unutmak ister, biz de']);
  else if (winner) takes.push([15, pick([`${team(m, winner)} 3 puanı aldı, helal olsun 💪 ${team(m, other(winner))} tarafında ise ciddi bir hesaplaşma lazım`, `${team(m, winner)} işini yaptı, 3 puan cepte. ${team(m, other(winner))} yine aynı hataları yaptı, yine kaybetti. bu film çok tanıdık`, `${m.home.short} ${hs}-${as} ${m.away.short}. ${coachOf(m, winner)} kazanmayı bildi, rakip hoca kenarda sadece izledi`], m.id + 'end')]);
  else takes.push([15, pick([`${hs}-${as}, kazanan yok. iki takım da yenmek için yeterince istemedi, bu sonuç kimseyi kurtarmaz`, `beraberlik, ${hs}-${as}. cesaret yoksa 3 puan da yok, bu kadar basit`], m.id + 'end')]);
  return top(takes, 4);
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
  return [{ nick: BOT_NICK, text: `tribün kararını verdi: maçın adamı ${names.get(best[0])}, ${best[1].count} oyla ${fmt1(best[1].avg)} ortalama ⭐ itirazı olan yok` }];
}
