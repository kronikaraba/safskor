# SafSkor

Futbol **canlı skor + topluluk** sitesi. Tüm maç / takım / oyuncu / skor / kadro / diziliş / lig /
istatistik verileri **gerçek bir API'den** ([API-Football / api-sports.io](https://www.api-football.com))
çekilir — mock veri yoktur. Üstüne kullanıcı topluluğu eklenir: maç sohbeti, oyuncu sohbeti, canlı
oyuncu puanlama ve maç önerileri.

> Tasarım bilinçli olarak **sade ve profesyonel**: nötr renkler, ince çizgiler, bol boşluk, temiz
> tipografi. Abartılı kart/gradient/animasyon yoktur — gerçek bir canlı skor uygulaması gibi.

---

## Özellikler

- **Kayıt / giriş** (JWT + bcrypt). Banlı/susturulmuş durum arayüze yansır.
- **Maç listesi**: canlı, yaklaşan ve bitmiş maçlar; tarihe göre gezinme ve lige göre filtre.
- **Maç detayı**: skor, durum/dakika, maç olayları (gol/kart/değişiklik), **puan durumu** ve
  **saha üzerinde diziliş görünümü** (gerçek formation + ilk 11 + yedekler, forma renkleriyle).
- **Saha görünümünde renkli puan rozetleri**: her oyuncunun canlı topluluk puanı, oyuncu düğümünün
  üzerinde renk kodlu (yeşil → turuncu → kırmızı) gösterilir.
- **Genel maç sohbeti** (her maç için) — gerçek zamanlı (Socket.IO).
- **Oyuncuya özel maç sohbeti** (her oyuncu için ayrı oda).
- **Canlı oyuncu puanlama (1–10)**: ortalama anlık güncellenir; **maç bitince puanlama kapanır**.
- **Maç önerileri + oylama**: üyeler maça oyuncu değişikliği / taktik / diziliş / genel önerisi
  ekler, birbirlerini oylar ("öneriyorum"); en çok oy alanlar **"En Çok Önerilenler"** bölümünde
  üste çıkar. Canlı güncellenir; maç bitince öneri/oylama kapanır.
- **Geçmiş**: eski maçlarda sohbet geçmişi, puan ortalamaları ve öneriler görüntülenebilir.
- **Admin = yalnızca moderasyon**: mesaj/öneri silme, kullanıcı susturma (süreli), banlama.
  Admin maç/takım/oyuncu/skor/lig verisi **girmez** — o veriler yalnızca API'den gelir.

## Teknolojiler

- **Sunucu:** Node.js + Express + Socket.IO, veritabanı olarak yerleşik `node:sqlite` (native derleme yok).
- **İstemci:** React + Vite + React Router.
- **Veri:** API-Football (api-sports.io) v3 REST API (cache + istek limiti koruması ile).

---

## Kurulum

### 1) Gereksinim

- **Node.js 22+** (yerleşik `node:sqlite` için; geliştirme Node 24 ile yapıldı).

### 2) Ücretsiz API anahtarı al

API-Football **ücretsiz** anahtarı: <https://dashboard.api-football.com/register>
(E-posta ile kayıt → panelden API key). Ücretsiz plan: **günde 100 istek**.

### 3) `.env` dosyasını oluştur

`server/.env.example` dosyasını `server/.env` olarak kopyala ve doldur:

```powershell
# Windows PowerShell
Copy-Item server/.env.example server/.env
```

```bash
# macOS / Linux
cp server/.env.example server/.env
```

`server/.env` içinde en azından şunları ayarla:

```
API_FOOTBALL_KEY=buraya_anahtarini_yapistir
JWT_SECRET=uzun-rastgele-bir-deger
```

### 4) Bağımlılıkları kur

```bash
npm run setup      # kök + server + client bağımlılıklarını kurar
```

### 5) Geliştirme modunda çalıştır

```bash
npm run dev        # server: http://localhost:4000  |  client: http://localhost:5173
```

Tarayıcıda **http://localhost:5173** adresini aç.

> API anahtarı tanımlı değilse uygulama çöküp mock veri üretmez; bunun yerine
> "API-Football anahtarı yapılandırılmamış" şeklinde temiz bir uyarı gösterir.

---

## Admin (moderatör) yapma

İki yol var:

- **Önceden:** `server/.env` içinde `ADMIN_EMAILS=senin@eposta.com` ayarla, sonra o e-posta ile kayıt ol.
- **Sonradan:** önce normal kayıt ol, ardından:

  ```bash
  npm --prefix server run make-admin -- senin@eposta.com
  ```

Admin olunca üst menüde **"Moderasyon"** sekmesi çıkar.

---

## Üretim (production)

```bash
npm run build      # React istemcisini server/.. /client/dist içine derler
npm start          # sunucu hem API'yi hem derlenmiş istemciyi 4000 portunda servis eder
```

Sonra **http://localhost:4000** (tek port). `NODE_ENV=production` ayarlamanız önerilir.

---

## API-Football ücretsiz katman notları

- **Günde 100 istek.** İstemci cache + sunucu kuyruk/throttle ile korunur; canlı maçlarda yenileme
  bilinçli olarak seyrek tutulur (30–40 sn). Kişisel/demo kullanım için yeterlidir, ancak 7/24 canlı
  polling'e uygun değildir. Limit dolarsa uygulama veri uydurmaz, temiz bir uyarı gösterir.
- Ücretsiz katmanda gelenler: maçlar + **canlı skorlar**, **diziliş (formation + ilk 11 + yedekler)**,
  **maç olayları** (gol/kart/değişiklik), **puan durumu** ve istatistikler.
- **Puan durumu** yalnızca lig formatındaki turnuvalarda doludur; bazı kupa/eleme formatlarında
  (örn. Dünya Kupası grup tabloları) boş gelebilir — bu durumda uydurma yapılmaz, "puan durumu yok" denir.
- **Diziliş** genelde maça ~1 saat kala açıklanır; öncesinde saha görünümü "diziliş henüz yok" gösterir.
- Oyuncu puanlama ve oyuncuya özel sohbet, dizilişteki gerçek oyuncu kimlikleri üzerinden çalışır.

---

## Proje yapısı

```
safskor/
├─ server/                       # Express + Socket.IO API
│  └─ src/
│     ├─ index.js                # uygulama girişi (API + üretimde istemci servisi)
│     ├─ config.js, db.js        # yapılandırma + SQLite şema
│     ├─ auth/                   # kayıt/giriş, JWT, middleware
│     ├─ football/               # API-Football istemcisi, cache, normalize (fixtures/lineups), REST
│     ├─ chat/ ratings/          # sohbet geçmişi + puan ortalaması REST uçları
│     ├─ suggestions/            # maç önerileri + oylama REST uçları
│     ├─ moderation/             # admin moderasyon uçları (yalnızca moderasyon)
│     ├─ realtime/               # Socket.IO: sohbet odaları + canlı puanlama
│     ├─ store/                  # SQLite veri erişimi (users, messages, ratings, moderation)
│     └─ scripts/make-admin.js   # bir kullanıcıyı admin yapar
└─ client/                       # React + Vite arayüz
   └─ src/
      ├─ pages/                  # Ana sayfa, Maç, Oyuncu, Giriş, Kayıt, Admin
      ├─ components/             # Header, MatchRow/List, Pitch (saha dizilişi), Chat, Rating, Events, Standings, Suggestions
      ├─ hooks/useMatchRatings   # canlı puan aboneliği
      ├─ context/AuthContext     # oturum durumu
      └─ lib/                    # api, socket, biçimleme yardımcıları
```

## Nasıl çalışır (kısaca)

- **Puanlama açık/kapalı:** sunucu, puan gönderiminde maçın API durumunu (cache'ten) kontrol eder;
  maç canlı değilse puanı reddeder ve istemciye "kapandı" sinyali gönderir. Ortalamalar her zaman okunabilir.
- **Sohbet odaları:** `match:{maçId}` (genel) ve `player:{maçId}:{oyuncuId}` (oyuncuya özel). Mesajlar
  SQLite'ta saklanır; eski maçlarda da görüntülenir.
- **Öneriler:** maç başına öneri + oy SQLite'ta tutulur; oylar değiştikçe `suggestions:{maçId}` odasına
  canlı yayınlanır ve liste "en çok önerilen" sırasına göre yeniden dizilir. Maç bitince yazma/oylama kapanır.
- **Moderasyon:** admin mesaj silince oda canlı güncellenir; ban/susturma anında sohbet/puanlamayı engeller.
