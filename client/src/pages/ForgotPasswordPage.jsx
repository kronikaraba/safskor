import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page container">
      <div className="auth-wrap">
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Şifremi unuttum</h1>
        {sent ? (
          <>
            <p className="muted small" style={{ marginBottom: 18 }}>
              Bu e-posta kayıtlıysa, şifre sıfırlama bağlantısı gönderildi. Gelen kutunu
              (ve spam klasörünü) kontrol et. Bağlantı 1 saat geçerlidir.
            </p>
            <div className="form__hint">
              <Link to="/giris">Giriş sayfasına dön</Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 18 }}>
              Hesabının e-postasını gir; sana şifre sıfırlama bağlantısı gönderelim.
            </p>
            <form className="form" onSubmit={submit}>
              {error && <div className="error-box">{error}</div>}
              <div className="form__row">
                <label>E-posta</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <button className="btn btn--primary" disabled={busy}>
                {busy ? 'Gönderiliyor...' : 'Sıfırlama bağlantısı gönder'}
              </button>
            </form>
            <div className="form__hint">
              <Link to="/giris">Giriş yap</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
