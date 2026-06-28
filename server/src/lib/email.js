import { config } from '../config.js';

/**
 * Şifre sıfırlama e-postası gönderir (Resend API).
 * RESEND_API_KEY tanımlı değilse e-posta gönderilmez; bağlantı log'a yazılır
 * (yerel geliştirmede test için).
 */
export async function sendResetEmail(to, resetUrl) {
  if (!config.resend.apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[email] RESEND_API_KEY yok. Sıfırlama bağlantısı:', resetUrl);
    return { sent: false };
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#14171a">
      <h2 style="color:#1976d2">SafSkor — Şifre sıfırlama</h2>
      <p>Hesabın için şifre sıfırlama isteği aldık. Yeni şifre belirlemek için aşağıdaki bağlantıya tıkla:</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#1976d2;color:#fff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600;display:inline-block">
          Şifremi sıfırla
        </a>
      </p>
      <p style="color:#5d6470;font-size:13px">Bu bağlantı 1 saat geçerlidir. İsteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
      <p style="color:#98a0ab;font-size:12px">${resetUrl}</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resend.from,
      to,
      subject: 'SafSkor — Şifre sıfırlama',
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error('[email] Resend hatası:', res.status, detail);
    return { sent: false };
  }
  return { sent: true };
}
