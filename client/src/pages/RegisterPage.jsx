import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(username.trim(), email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page container">
      <div className="auth-wrap">
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Kayıt ol</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          SafSkor topluluğu: maçları takip et, sohbete katıl, oyuncuları puanla.
        </p>
        <form className="form" onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <div className="form__row">
            <label>Kullanıcı adı</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <span className="muted small">3-20 karakter; harf, rakam ve _</span>
          </div>
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
          <div className="form__row">
            <label>Şifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <span className="muted small">En az 6 karakter</span>
          </div>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Kaydolunuyor...' : 'Kayıt ol'}
          </button>
        </form>
        <div className="form__hint">
          Zaten hesabın var mı? <Link to="/giris">Giriş yap</Link>
        </div>
      </div>
    </div>
  );
}
