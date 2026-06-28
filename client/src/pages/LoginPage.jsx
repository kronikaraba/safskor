import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(identifier.trim(), password);
      navigate(location.state?.from || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page container">
      <div className="auth-wrap">
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Giriş yap</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          Sohbete katılmak ve oyunculara puan vermek için giriş yap.
        </p>
        <form className="form" onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form__row">
            <label>Kullanıcı adı veya e-posta</label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="form__row">
            <label>Şifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Giriş yapılıyor...' : 'Giriş yap'}
          </button>
        </form>
        <div className="form__hint">
          <Link to="/sifremi-unuttum">Şifremi unuttum</Link>
        </div>
        <div className="form__hint" style={{ marginTop: 6 }}>
          Hesabın yok mu? <Link to="/kayit">Kayıt ol</Link>
        </div>
      </div>
    </div>
  );
}
