import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/giris'), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page container">
      <div className="auth-wrap">
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Yeni şifre belirle</h1>
        {!token ? (
          <>
            <p className="muted small" style={{ marginBottom: 18 }}>
              Sıfırlama bağlantısı geçersiz. Lütfen yeniden şifre sıfırlama isteyin.
            </p>
            <div className="form__hint">
              <Link to="/sifremi-unuttum">Şifremi unuttum</Link>
            </div>
          </>
        ) : done ? (
          <>
            <p className="muted small" style={{ marginBottom: 18 }}>
              Şifren güncellendi. Giriş sayfasına yönlendiriliyorsun…
            </p>
            <div className="form__hint">
              <Link to="/giris">Giriş yap</Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 18 }}>
              Yeni şifreni belirle.
            </p>
            <form className="form" onSubmit={submit}>
              {error && <div className="error-box">{error}</div>}
              <div className="form__row">
                <label>Yeni şifre</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <span className="muted small">En az 6 karakter</span>
              </div>
              <div className="form__row">
                <label>Yeni şifre (tekrar)</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <button className="btn btn--primary" disabled={busy}>
                {busy ? 'Güncelleniyor...' : 'Şifreyi güncelle'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
