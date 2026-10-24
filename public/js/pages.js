import { h, mount } from './util.js';

// Gizlilik politikası / KVKK aydınlatma metni ve "sayfa bulunamadı" ekranı.
// İletişim adresi yazılınca metinde görünür (Play Store ve KVKK başvuruları için gerekli).
const CONTACT = '';

export function renderPrivacy(root) {
  const p = (...c) => h('p', {}, ...c);
  const li = (...c) => h('li', {}, ...c);
  mount(
    root,
    h(
      'article.doc',
      {},
      h('h1', {}, 'Gizlilik Politikası ve KVKK Aydınlatma Metni'),
      h('p.muted', {}, 'Son güncelleme: 24 Ekim 2026'),
      p('Safskor (safskor.com ve Safskor Android uygulaması), 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusu olarak kişisel verilerini aşağıda anlatıldığı şekilde işler.'),

      h('h2', {}, 'Hangi verileri topluyoruz'),
      h(
        'ul',
        {},
        li('Üye olmadan: tarayıcına özel rastgele bir kimlik (yalnızca senin cihazında saklanır), seçtiğin takma ad ve tuttuğun takım.'),
        li('Telefonla üye olursan: cep telefonu numaran, ismin, şifrenin geri çevrilemez özeti (şifrenin kendisi saklanmaz) ve hesabının açık olduğu cihaz oturumları.'),
        li('Sitede yaptıkların: sohbet mesajları, yorumlar, beğeniler, oyuncu puanları, anket oyları, skor tahminleri, taktik ve değişiklik önerileri, özel mesajlar ve davet kodun.'),
        li('Güvenlik için: hatalı şifre denemelerinde IP adresin kısa süre (en fazla 10 dakika) sunucu belleğinde tutulur.'),
      ),

      h('h2', {}, 'Neden işliyoruz'),
      p('Maç odalarını, puanlamayı, tahminleri ve hesabını çalıştırmak, hesabını başkalarına karşı korumak ve kötüye kullanımı önlemek için. Hukuki sebep: sözleşmenin kurulması ve ifası ile meşru menfaat (KVKK md. 5/2-c ve 5/2-f).'),
      p('Reklam ya da takip çerezi kullanmıyoruz. Verilerini satmıyor, pazarlama için kimseyle paylaşmıyoruz. SMS ya da reklam mesajı göndermiyoruz.'),

      h('h2', {}, 'Nerede saklanıyor, kimlere aktarılıyor'),
      p('Veriler, sitenin barındırıldığı Render.com sunucularında (Frankfurt, Almanya) saklanır; bu, KVKK md. 9 kapsamında yurt dışına aktarım sayılır. Maç verileri API-Football\'dan alınır; oraya kişisel verin gönderilmez. Oyuncu ve takım görselleri media.api-sports.io adresinden yüklendiği için bu sunucu IP adresini görebilir.'),
      p('Sohbet mesajların, yorumların ve takma adın maç odasındaki herkese görünür. Özel mesajları yalnızca sen ve karşı taraf görür.'),

      h('h2', {}, 'Ne kadar saklıyoruz'),
      p('Hesap bilgilerin hesabını silene kadar saklanır. Bir cihazdaki oturum 180 gün kullanılmazsa kendiliğinden kapanır. Sohbet, puan ve tahminler maçın kaydı olarak tutulur.'),

      h('h2', {}, 'Hesabını ve verilerini silmek'),
      p('Adına dokun → "Hesabımı sil" → şifreni yaz. Telefon numaran, şifren, özel mesajların, davet kodun ve tüm oturumların hemen ve kalıcı olarak silinir. Sohbet mesajların, yorumların ve oyların maçın kaydında kalır ama adın "Silinmiş üye" olarak değişir.'),
      p('Üye değilsen tarayıcının site verilerini silmen yeterli; senin olduğunu gösteren başka bir bilgi tutmuyoruz.'),

      h('h2', {}, 'Hakların'),
      p('KVKK md. 11 uyarınca verilerinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltilmesini ya da silinmesini isteme, aktarıldığı kişileri öğrenme ve itiraz etme hakların var.'),
      CONTACT ? p('Başvuruların ve soruların için: ', h('a', { href: `mailto:${CONTACT}`, style: { color: 'var(--accent)' } }, CONTACT)) : null,
      p('Hizmet 13 yaşından küçükler için tasarlanmamıştır.'),
    ),
  );
  window.scrollTo(0, 0);
  return {};
}

export function renderNotFound(root) {
  document.title = 'Sayfa bulunamadı · Safskor';
  mount(
    root,
    h(
      'div.notfound',
      {},
      h('div.big', {}, '404'),
      h('h1', {}, 'Bu sayfa bulunamadı'),
      h('p', {}, 'Adres yanlış yazılmış ya da sayfa kaldırılmış olabilir.'),
      h('a.btn', { href: '/' }, 'Bugünün maçlarına git'),
    ),
  );
  return {};
}
