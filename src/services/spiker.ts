// Safskor Yorum (sitenin otomatik yorumcusu): maç sohbetine maç öncesi, maç içi (gol, kırmızı kart, kaçan penaltı, değişiklik, dakika notları) ve
// sonrası, maç, futbolcular ve hocalar hakkında net ve keskin yorumlar yazar.
// Sohbette Safskor logosu ve "otomatik" etiketiyle görünür; üye gibi gösterilmez. Yorumlar gerçek veriye dayanır (kadro, olaylar,
// istatistik, puan durumu, taraftar oyları); olmayan bir şeyi uydurmaz. API'ye ek istek atmaz.
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
        `${team(m, s)} bu maça ${out.length} eksikle çıkıyor: ${out.slice(0, 3).map((a) => a.name).join(', ')}. ${coachOf(m, s)} kadro kurarken saç baş yolar`,
        `${out.length} oyuncu yok, ${team(m, s)} revir gibi 🏥 ${out.slice(0, 2).map((a) => a.name).join(' ve ')} olmadan bu takımın ağırlığı yarıya iner`,
      ], m.id + s + 'abs')]);
    else if (sus) takes.push([52, `${sus.name} cezalı, ${team(m, s)} onun yokluğunu bu akşam çok hissedecek. yerine oynayan için büyük fırsat, büyük sınav`]);
    else if (out.length) takes.push([38, `${out.map((a) => a.name).join(' ve ')} yok. ${team(m, s)} için küçük gibi görünen ama maçın kaderini değiştirebilecek bir eksik`]);

    const f = formOf(pv.last?.[s] ?? [], m[s].id);
    if (f.length >= 4) {
      const l = [...f].filter((c) => c === 'L').length, w = [...f].filter((c) => c === 'W').length;
      if (!w) takes.push([57, `${team(m, s)} son ${f.length} maçta hiç kazanamadı. ${coachOf(m, s)} için bu maç artık sadece maç değil, koltuk maçı`]);
      else if (l >= 3) takes.push([55, `${team(m, s)} son ${f.length} maçta ${l} yenilgi aldı. bu akşam da puan bırakırsa ${coachOf(m, s)} için sular iyice ısınır 🔥`]);
      else if (w >= 4) takes.push([45, `${team(m, s)} son ${f.length} maçta ${w} galibiyetle geliyor. form grafiği yukarı, rakip bunu durdurmak için iyi bir plan bulmalı`]);
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
    if (dom) takes.push([54, `aralarındaki son ${h2h.length} maçta ${team(m, dom)} ${dom === 'home' ? hw : aw} kez kazandı. bu eşleşmede psikolojik üstünlük çok net, ${team(m, other(dom))} bu laneti bozabilir mi göreceğiz`]);
    else if (d >= h2h.length / 2) takes.push([40, `bu iki takım son ${h2h.length} maçta ${d} kez berabere kaldı. birbirini çok iyi tanıyan iki ekip, ilk golü atan maçı alır`]);
  }
  const c = pv.chances;
  if (c) {
    const fav: Side = c.home >= c.away ? 'home' : 'away';
    if (c[fav] >= 50) takes.push([36, `istatistikler ${team(m, fav)} diyor (%${c[fav]}). ama ${team(m, other(fav))} tam da böyle maçlarda sürpriz yapmayı sever ⚡`]);
    else takes.push([30, `istatistik modeli bile karar veremedi: %${c.home} - %${c.draw} - %${c.away}. tam yazı tura maçı`]);
  }
  // muhtemel 11'den son maçın yıldızı
  const stars = (['home', 'away'] as Side[]).flatMap((s) => (pv.xi?.[s]?.startXI ?? []).map((p) => ({ p, s, r: p.stats?.rating ?? 0 })));
  const star = stars.length ? stars.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  if (star && star.r >= 7.6) takes.push([42, `${star.p.name} son maçında ${fmt1(star.r)} reyting aldı. ${team(m, star.s)} bu akşam da topu ona verirse rakip savunma zor bir gece geçirir`]);
  if (pv.referee) {
    const ref = pv.referee.split(',')[0].trim();
    takes.push([12, pick([`maçın hakemi ${ref}. derbi havası varsa kartlar erken çıkar, oyuncular ilk 15 dakika ayağını çekmeli`, `bu akşamın hakemi ${ref}. iyi hakem fark edilmeyen hakemdir, umarım maçtan sonra adını konuşmayız`], m.id + 'ref')]);
  }
  return takes;
}

/** Maç öncesi (odaya ilk girişte) */
export function preMatch(m: Match, table: Standings | null, _fan: SpikerFan, pv: Omit<MatchPreview, 'table'> | null = null): BotSay[] {
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
  takes.push(...previewTakes(m, pv));
  takes.push([10, pick([`${m.home.name} evinde oynuyor. bu maçtan 3 puan çıkaramazsa iç sahada kimse ondan korkmaz`, `bu maçın favorisi kağıt üstünde belli ama kağıt üstünde maç kazanan görmedim`], m.id + 'gen')]);
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

// ------------------------------------------------------------------ maç içi

/** Başlama vuruşu */
export function kickoff(m: Match): BotSay[] {
  const big = BIG.has(m.home.name) && BIG.has(m.away.name);
  return top([[10, pick(big
    ? ['derbi başladı 🔥 ilk 15 dakika kimin daha aç olduğunu gösterecek, ayak çeken kaybeder', 've başladı. bu maçta ikinci şans yok, ilk hatayı yapan bedelini ağır öder']
    : [`başladı. ${m.home.name} evinde ilk dakikadan basmazsa bu maç çok uzun olur`, `top yuvarlandı. ${m.away.name} için plan belli: kapan, bekle, tek kontrada vur`, 'maç başladı, şimdi lafı bırakıp sahaya bakma zamanı 👀'], m.id + 'ko')]], 1);
}

/** İkinci yarı başlangıcı */
export function secondHalf(m: Match): BotSay[] {
  const { home: hs, away: as } = m.score;
  if (hs === as)
    return top([[10, pick([`ikinci yarı başladı, skor ${hs}-${as}. ilk değişikliği doğru yapan hoca maçı alır`, 'ikinci 45 başladı. bu maçta bir taraf mutlaka risk almak zorunda, beraberlik ikisine de yetmez'], m.id + '2h')]], 1);
  const lead: Side = hs > as ? 'home' : 'away';
  return top([[10, pick([`ikinci yarı başladı. ${team(m, other(lead))} ilk 10 dakikada gol bulamazsa bu maç kapanır`, `${team(m, lead)} önde başlıyor ikinci yarıya. geriye yaslanırsa kendi mezarını kazar`], m.id + '2h')]], 1);
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
    const score = `${sc.home}-${sc.away}`;
    const goalsBy = e.type === 'own_goal' || !e.player ? 0 : m.events.filter((x) => isGoal(x) && x.type !== 'own_goal' && x.player === e.player && (m.events.indexOf(x) <= m.events.indexOf(e))).length;
    let t: string;
    if (e.type === 'own_goal') t = pick([`${p} kendi kalesine attı 😬 ${team(m, s)} bu golü hediye paketinde aldı. ${score}`, `kendi kalesine gol! ${p} için kabus gibi bir an. ${coachOf(m, other(e.side))} kenarda başını tutuyor`], seed);
    else if (goalsBy === 3) t = `HAT-TRICK 🎩 ${p} bu akşam durdurulamaz. ${team(m, o)} savunması onu hâlâ bulamadı, ${score}`;
    else if (goalsBy === 2) t = pick([`${p} yine sahnede, bu akşamki ikinci golü ⚽⚽ bu forvet bugün başka bir seviyede`, `${p} doymuyor, ikinci golünü attı. ${team(m, o)} savunması bu adamı tek bir dakika bile tutamadı`], seed);
    else if (late && mine === theirs) t = pick([`${minuteOf(e)} dakikada beraberlik golü 🔥 ${p}, ${team(m, s)} pes etmedi. ${coachOf(m, o)} kazandığını sanıyordu`, `son dakikalarda ${p}! ${score}. bu golün tribündeki sesi deprem gibi gelmiştir`], seed);
    else if (late && mine === theirs + 1) t = pick([`${minuteOf(e)} dakika, ${p} ve ${team(m, s)} öne geçti 🔥 bu golün bedeli 3 puan olabilir`, `${p} son nefeste vurdu! ${score}. ${team(m, o)} için tam bir kabus`], seed);
    else if (e.type === 'penalty') t = pick([`${p} penaltıda affetmedi, ${score}. soğukkanlılık bu`, `penaltı golü, ${p} kaleciyi ters köşeye yatırdı. ${score}`], seed);
    else if (mine === 1 && theirs === 0) t = pick([`kilit açıldı ⚽ ${p} ${minuteOf(e)} dakikada attı, ${team(m, s)} önde. ${team(m, o)} artık oyunu açmak zorunda, maç şimdi başlıyor`, `${p}! ${team(m, s)} önde, ${score}. ${coachOf(m, o)} planını çöpe atıp yeniden düşünmek zorunda`], seed);
    else if (mine === theirs) t = pick([`${team(m, s)} cevap verdi! ${p} skoru eşitledi, ${score}. her şey yeniden başlıyor`, `${p} ile beraberlik geldi. ${team(m, o)} önde olmanın keyfini çok kısa yaşadı`], seed);
    else if (mine === theirs + 1 && theirs > 0) t = pick([`geri dönüş 🔥 ${p} attı ve ${team(m, s)} öne geçti, ${score}. bu takım bugün karakter gösteriyor`, `${p}! ${team(m, s)} yeniden önde. ${team(m, o)} savunması bu akşam dağınık`], seed);
    else if (mine - theirs >= 3) t = pick([`fark ${mine - theirs} oldu, ${score}. bu artık maç değil antrenman. ${coachOf(m, o)} için gece çok uzun`, `${p} de attı, ${score}. ${team(m, o)} sahada yok, tamamen teslim oldu`], seed);
    else if (mine - theirs === 2) t = pick([`${p} farkı ikiye çıkardı, ${score}. ${team(m, s)} fişi çekiyor`, `ikinci darbe! ${p} ile ${score}. ${team(m, o)} için dönüş artık çok zor`], seed);
    else if (theirs - mine >= 2) t = pick([`şeref golü geldi, ${score}. ${team(m, s)} çok geç uyandı`, `${p} attı ama skor hâlâ ${score}. bu gol ancak teselli`], seed);
    else t = `${p} attı, ${score}. ${team(m, s)} maça ortak oldu, kalan dakikalarda her şey olabilir`;
    if (e.related && goalsBy < 2 && e.type === 'goal' && !late) t += `. ${e.related} pası da altın değerinde 👌`;
    return [{ nick: BOT_NICK, text: t }];
  }
  if (e.type === 'red') {
    const s = e.side, p = e.player ?? 'bir oyuncu';
    const t = e.minute <= 30
      ? pick([`${p} ${minuteOf(e)} dakikada kırmızı gördü 🟥 ${team(m, s)} maçın büyük bölümünü 10 kişi oynayacak. ${coachOf(m, s)} tüm planı yeniden kurmak zorunda`, `erken kırmızı! ${p} takımını yaktı. bu kadar erken 10 kişi kalmak affedilmez`], m.id + e.id)
      : late
        ? `${p} son dakikalarda kırmızı gördü. maç zaten kopmak üzereydi, bu kart sinirlerin bittiğini gösteriyor`
        : pick([`${p} kırmızı gördü 🟥 ${team(m, s)} 10 kişi. ${team(m, other(s))} şimdi bastırmazsa bu fırsatı bir daha bulamaz`, `kırmızı kart! ${p} takımını zor durumda bıraktı. bu kart maçın kırılma anı olabilir`], m.id + e.id);
    return [{ nick: BOT_NICK, text: t }];
  }
  if (e.type === 'missed_penalty') {
    const p = e.player ?? 'penaltıcı';
    return [{ nick: BOT_NICK, text: pick([`${p} penaltıyı kaçırdı 😬 böyle fırsat bu maçta bir daha gelmeyebilir`, `penaltı kaçtı! ${p} bu akşam yastığa başını koyunca bu anı düşünecek`], m.id + e.id) }];
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
    if (outR != null && outR < 6.3) return [{ nick: BOT_NICK, text: pick([`${off} çıktı, doğru karar. ${fmt1(outR)} reytingle bugün sahada yoktu, ${inn} için çıta çok alçak`, `${coachOf(m, s)} sonunda gördü: ${off} oyundan alındı. ${fmt1(outR)} reyting, bu değişiklik 20 dakika önce yapılmalıydı`], m.id + e.id) }];
    if (mine < theirs) return [{ nick: BOT_NICK, text: pick([`${coachOf(m, s)} hamlesini yaptı: ${inn} girdi, ${off} çıktı. geride olan takım için bu değişiklik ${e.minute >= 70 ? 'geç bile kaldı' : 'tam zamanında'}`, `${inn} oyunda. ${coachOf(m, s)} skoru çevirmek için kartlarını açıyor, şimdi ya hep ya hiç`], m.id + e.id) }];
    if (mine > theirs && e.minute >= 70) return [{ nick: BOT_NICK, text: `${coachOf(m, s)} skoru korumaya geçti: ${off} çıktı, ${inn} girdi. öne geçip geri yaslanan çok takım gördük, sonu hep iyi bitmedi` }];
    if (mine === theirs) return [{ nick: BOT_NICK, text: `${coachOf(m, s)} ${inn} ile kazanmak için risk alıyor. beraberlik kimseye yetmiyor, cesur hamle` }];
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
    if (pos && pos[s] >= 62 && mine <= theirs) takes.push([60, `${min}. dakika, ${team(m, s)} %${pos[s]} topla oynuyor ama skor ${hs}-${as}. topa sahip olmak gol atmak değil, bu takım pas ustası ama vuruş çırağı`]);
    if (shots && sot && shots[s] >= 8 && sot[s] <= 1) takes.push([58, `${team(m, s)} ${shots[s]} şut çekti, kaleyi bulan sadece ${sot[s]}. bu bitiricilikle sabaha kadar oynasalar gol çıkmaz`]);
    if (xg && xg[s] - xg[other(s)] >= 1 && mine <= theirs) takes.push([62, `gol beklentisi ${team(m, s)} ${fmt1(xg[s])}, rakip ${fmt1(xg[other(s)])}. skor ise ${hs}-${as}. futbolda adalet yok`]);
  }
  if (mark === 70) {
    if (hs === as) takes.push([30, `son ${Math.max(5, 90 - min)} dakika, skor ${hs}-${as}. şimdi hocaların maçı başlıyor, kenardan ilk doğru hamleyi yapan 3 puanı alır`]);
    else {
      const lead: Side = hs > as ? 'home' : 'away';
      takes.push([30, `${min}. dakika, ${team(m, lead)} önde. ${team(m, other(lead))} şimdi her şeyini ortaya koymazsa bu maç bitti`]);
    }
  } else if (hs === 0 && as === 0) takes.push([25, `${min} dakika geçti, iki takım da birbirini kokluyor. bu tempoyla gol ancak bir hatadan gelir`]);
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
  // son dakika golü maçı kazandırdıysa ya da beraberliği getirdiyse (farkı azaltan gol değil)
  if (last && last.minute >= 85 && Math.abs(hs - as) <= 1 && (!winner || winner === goalSide(last))) {
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
    takes.push([62, pick([`maçın en iyisi bence ${best.p.name}. ${fmt1(best.r)} reytingle sahanın patronuydu`, `${best.p.name} bu akşam başka bir ligdeydi, ${fmt1(best.r)} reyting. ${team(m, best.s)} ona ne kadar teşekkür etse az`, `${fmt1(best.r)} reytingle ${best.p.name}. sahada 22 kişi vardı ama bu maçı o oynadı`], m.id + 'best')]);
    const full = rated.filter((x) => x.min >= 60);
    const worst = full.length ? full.reduce((a, b) => (b.r < a.r ? b : a)) : null;
    if (worst && worst.r < 6.2) takes.push([57, pick([`${worst.p.name} bugün sahada yoktu. ${fmt1(worst.r)} reyting her şeyi anlatıyor, ${coachOf(m, worst.s)} bu oyuncuyla bir konuşma yapmalı`, `${worst.p.name} için unutulacak bir gece, ${fmt1(worst.r)} reyting. ${team(m, worst.s)} bu performansla bir yere gidemez`, `${fmt1(worst.r)} reyting ve ${worst.p.name}. formayı hak eden başka biri varsa haftaya o oynamalı`], m.id + 'worst')]);
  }
  if (!winner && hs === 0) takes.push([20, '90 dakika, sıfır gol. iki takım da bu maçın çabuk unutulmasını ister 😴']);
  else if (winner) takes.push([15, pick([`${team(m, winner)} 3 puanı aldı ama ${team(m, other(winner))} tarafında ciddi sorular var. ${coachOf(m, other(winner))} bu hafta rahat değil`, `${team(m, winner)} işini yaptı, 3 puan cepte. ${team(m, other(winner))} ise yine aynı hataları yapıp yine kaybetti`, `${m.home.short} ${hs}-${as} ${m.away.short}. ${coachOf(m, winner)} bu maçı kazanmayı bildi, rakip hoca ise kenarda izlemekle yetindi`], m.id + 'end')]);
  else takes.push([15, pick([`${hs}-${as}, iki takım da birbirini yenemedi. bu sonuç iki hocayı da tam kurtarmaz`, `beraberlik, ${hs}-${as}. iki takım da kazanmak için yeterince cesur değildi`], m.id + 'end')]);
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
  return [{ nick: BOT_NICK, text: `taraftar maçın adamını seçti: ${names.get(best[0])}, ${best[1].count} oyla ${fmt1(best[1].avg)} ortalama. bence de tartışmasız ⭐` }];
}
