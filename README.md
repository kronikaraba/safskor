# Safskor — Canlı Futbol Taraftar Platformu (MVP)

Canlı maçlar için etkileşimli taraftar platformu. **Video veya yayın yok**; yalnızca futbol API'lerinden gelen canlı veriler (skor, dakika, kadrolar, oyuncu istatistikleri, maç olayları) gösterilir. Taraftarlar maç odalarında gerçek zamanlı sohbet eder, oyuncuları 10 üzerinden puanlar, taktik önerir, oyuncu değişikliği talep eder ve anketlerde oy kullanır.

## Hızlı başlangıç

```bash
npm install
cp .env.example .env      # isteğe bağlı; anahtar yoksa demo veriyle çalışır
npm start                 # http://localhost:3000
```

Geliştirme için `npm run dev` (dosya değişince yeniden başlar). Üretim için `npm run build && npm run start:prod`.

Node.js 20 veya üstü gerekir.

## Özellikler

| Ekran | İçerik |
|---|---|
| **Maç listesi** | Bugünün maçları lige göre gruplu; Canlı / Yaklaşan / Biten filtresi; canlı dakika, skor ve odadaki taraftar sayısı gerçek zamanlı güncellenir. |
| **Özet** | Skor tabelası, golcüler, olay zaman çizelgesi (gol, asist, penaltı, kart, değişiklik, VAR), "taraftarın nabzı" kartı. |
| **Kadrolar** | Saha üzerinde güncel 11 (dizilişe göre), yedekler, teknik direktör; API puanı ve taraftar ortalaması (★) yan yana. Oyuncuya dokununca istatistik kartı ve 0-10 puanlama açılır. |
| **İstatistik** | Topla oynama, xG, şut, isabetli şut, korner, faul, ofsayt, kart, kurtarış, pas, pas isabeti. |
| **Puanla** | Topluluk puanları listesi, takım bazında taraftar ortalaması, **Taraftarın Maçın Adamı** (az oyla öne geçmeyi engelleyen Bayes ortalaması). |
| **Taktik** | Takım seçip diziliş + oyun anlayışı + not öner. Öneriler otomatik olarak **taraftar taktik anketine** dönüşür (diziliş ve oyun anlayışı dağılımı); notlar beğeniyle sıralanır. |
| **Değişiklik** | Sahadan çıkacak / yedekten girecek oyuncuyu seçip talep et; diğer taraftarlar destekler. Teknik direktör aynı değişikliği yaparsa "✅ yaptı" etiketi çıkar. |
| **Anketler** | Her maça otomatik anketler (Kim kazanır?, Kaç gol olur?, Hakem yönetimi) + taraftarların açtığı anketler (maç başına kişi başı 3). Oy değiştirilebilir. |
| **Sohbet** | Maç odası sohbeti; hızlı tezahürat butonları; goller, kartlar, değişiklikler, devre arası ve maç sonu sohbete otomatik düşer; gol olunca bildirim çıkar. Masaüstünde sağ sütunda, mobilde sekme olarak. |

Arayüz koyu temalı ve mobil uyumludur; derleme adımı olmayan saf JavaScript modülleriyle yazılmıştır.

## Mimari

```
src/
  index.ts                 Express + Socket.IO sunucusu, REST uçları, gerçek zamanlı olaylar, doğrulama ve hız sınırı
  config.ts                Ortam değişkenleri
  types.ts                 Sağlayıcıdan bağımsız maç modeli + FootballProvider arayüzü
  providers/
    apiFootball.ts         API-Football (api-sports.io v3) adaptörü
    demo.ts                Demo sağlayıcı: canlı maçları dakika dakika simüle eder
    index.ts               Sağlayıcı seçimi + hata olursa demoya düşen FallbackProvider
  services/
    matchService.ts        Sağlayıcıyı yoklar, önbellekler, değişiklikleri olay olarak yayar
    fanStore.ts            SQLite: sohbet, puanlar, anketler, taktik önerileri, değişiklik talepleri
public/
  index.html, styles.css
  js/app.js                Socket bağlantısı, anonim kimlik, yönlendirme
  js/lobby.js              Maç listesi
  js/match.js              Maç detay ekranı ve tüm taraftar etkileşimleri
scripts/smoke.mjs          Uçtan uca test (iki istemciyle tüm etkileşimleri dener)
```

**Gerçek zamanlı akış:** `MatchService` sağlayıcıyı yoklar; yalnızca içinde taraftar olan maçların detayı çekilir (API kotasını korur). Değişen veri Socket.IO ile ilgili odaya (`match:<id>`) itilir. Taraftar oyları her değişiklikte toplanıp odaya yayınlanır.

### Yeni bir futbol API'si eklemek

`src/types.ts` içindeki `FootballProvider` arayüzünü uygulayın (`listMatches`, `getMatch`, `pollMs`), veriyi normalize `Match` modeline dönüştürün ve `src/providers/index.ts` içindeki `createProvider` fonksiyonuna ekleyin. Arayüzün geri kalanı değişmez.

## API anahtarı ve güvenlik

- Anahtar yalnızca sunucuda, `.env` dosyasında (`API_FOOTBALL_KEY`) tutulur; tarayıcıya hiçbir zaman gönderilmez. `.env` git'e eklenmez, `.env.example` şablondur.
- `DATA_PROVIDER=auto` (varsayılan): anahtar varsa API-Football, yoksa demo. API hata verirse (geçersiz anahtar, kota, ağ) otomatik demoya düşer ve 5 dakika sonra gerçek API'yi tekrar dener. Arayüzde demo modu bandı görünür.
- Tüm kullanıcı girdileri sunucuda doğrulanır (puan 0-10, oyuncu gerçekten o maçın kadrosunda mı, çıkacak oyuncu sahada mı vb.), metinler kırpılır ve arayüzde yalnızca `textContent` ile basılır. Sohbet ve işlemler için hız sınırı, temel güvenlik başlıkları ve CSP vardır.
- **Kota yönetimi:** Varsayılanlar API-Football ücretsiz planına (günde 100 istek) göre ayarlıdır. Bugünün maç listesi tek istekle alınır: canlı ya da 30 dk içinde başlayacak maç varken 20 dakikada bir, yoksa 2 saatte bir. Maç detayı yalnızca içinde taraftar olan maçlar için çekilir (canlıyken 10 dakikada bir, maç öncesi 15-60 dakikada bir, bitmiş maçta bir kez). API'nin bildirdiği kalan hak `API_RESERVE`'e (5) inince istek atılmaz ve son gerçek veri gösterilir; arayüzde bir bant bunu belirtir. Hak 00:00 UTC'de (03:00 TSİ) yenilenir.
- **Plan uyumu:** Bazı ücretsiz API-Football hesapları yalnızca geçmiş sezonları kapsar. Plan bugünün maçlarını vermezse site demo veriye geçer ve 6 saatte bir tekrar dener (boşuna istek harcamaz).

## Yayına alma (Render)

Uygulama Socket.IO ve SQLite kullandığı için sürekli çalışan bir Node sunucusu ister; yalnızca sunucusuz (serverless) çalışan servisler uygun değildir. Depodaki `render.yaml` ile Render'da tek tıkla yayına alınır:

1. Kodu bir GitHub deposuna gönderin.
2. Render'da GitHub ile oturum açın, **New → Blueprint** seçip bu depoyu bağlayın (veya `https://render.com/deploy?repo=<depo-adresi>` bağlantısını açın).
3. `API_FOOTBALL_KEY` sorulursa anahtarı girin; boş bırakırsanız site demo veriyle açılır. **Apply** deyin.
4. Birkaç dakika sonra site `https://safskor-xxxx.onrender.com` gibi bir adreste yayında olur. Sonraki her `git push` otomatik yeniden yayınlanır.

**Plan:** `render.yaml` ücretsiz planı kullanır: site 15 dakika ziyaretçi gelmezse uyur ve ilk açılış yaklaşık 1 dakika sürer; sohbet, puan ve anket verileri yeniden başlatmada sıfırlanır. Kalıcı veri için dosyadaki açıklamaya göre Starter planı ve disk ekleyin (aylık ücretli).

Docker kullanan başka bir servis (Fly.io, Railway, kendi sunucunuz) için depoda `Dockerfile` da var: `docker build -t safskor . && docker run -p 3000:3000 -v safskor-data:/data safskor`.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | 3000 | Sunucu portu |
| `DATA_PROVIDER` | auto | `auto`, `demo` veya `api-football` |
| `API_FOOTBALL_KEY` | — | API-Football anahtarı |
| `API_FOOTBALL_BASE_URL` | https://v3.football.api-sports.io | RapidAPI için `https://api-football-v1.p.rapidapi.com/v3` |
| `API_FOOTBALL_LEAGUES` | 203,39,140,2 | Takip edilen lig kimlikleri (boş = bugünün tüm maçları) |
| `LIST_POLL_MS` / `LIST_IDLE_POLL_MS` | 1200000 / 7200000 | Liste yoklama: canlı/yaklaşan maç varken / yokken |
| `DETAIL_POLL_MS` | 600000 | İzlenen canlı maçın detay yoklama aralığı |
| `API_DAILY_LIMIT` / `API_RESERVE` | 100 / 5 | Günlük istek hakkı ve boşta tutulacak yedek |
| `DEMO_TICK_MS` | 4000 | Demo modunda bir oyun dakikasının süresi (ms) |
| `DB_PATH` | ./data/safskor.db | SQLite dosyası |

## Test

```bash
npm start                                  # bir terminalde
BASE=http://localhost:3000 npm run smoke   # diğerinde
```

## MVP sınırlamaları ve sonraki adımlar

- Hesap sistemi yok: her tarayıcıya anonim bir kimlik ve değiştirilebilir takma ad atanır. Oy tekrarını engelleme bu kimliğe dayanır; üretimde gerçek oturum açma (ör. e-posta / Google) eklenmeli.
- Tek sunucu süreci varsayılır. Yatay ölçek için Socket.IO Redis adaptörü ve SQLite yerine PostgreSQL önerilir.
- Sohbet moderasyonu (küfür filtresi, raporlama, susturma) henüz yok.
- API-Football'da değişiklik olaylarında oyuna giren/çıkan alanlarının sırası dönemlere göre farklılık gösterebilir; gerçek veriyle doğrulanmalı.
