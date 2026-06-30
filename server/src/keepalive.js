import { config } from './config.js';

// Render ücretsiz plan: 15 dk istek gelmezse servis uyur, sonraki ilk istek
// 30-60 sn bekler ("Maçlar yükleniyor..." uzun sürer). Servis ayaktayken kendi
// /api/health adresine düzenli ping atarak (Render için bu "inbound" trafik
// sayılır) uykuya geçmesini engelleriz.
export function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!config.isProd || !url) return;

  const base = url.replace(/\/$/, '');
  const ping = () => {
    fetch(`${base}/api/health`).catch(() => {
      /* geçici hata önemsiz */
    });
  };

  // 15 dk'lık uyku eşiğinin güvenle altında: 10 dk'da bir.
  setInterval(ping, 10 * 60 * 1000).unref?.();
  console.log('[keepalive] etkin →', `${base}/api/health`);
}
