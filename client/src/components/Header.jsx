import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand">
          Saf<span>Skor</span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav__link is-active' : 'nav__link')}>
            Maçlar
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className="nav__link">
              Moderasyon
            </NavLink>
          )}
          {user ? (
            <div className="nav__user">
              <Link to={`/uye/${user.id}`} className="nav__name">
                {user.username}
              </Link>
              <button className="btn btn--ghost btn--sm" onClick={logout}>
                Çıkış
              </button>
            </div>
          ) : (
            <div className="nav__user">
              <Link to="/giris" className="nav__link">
                Giriş
              </Link>
              <Link to="/kayit" className="btn btn--primary btn--sm">
                Kayıt ol
              </Link>
            </div>
          )}
        </nav>
      </div>
      {user?.isBanned && (
        <div className="banner-banned">Hesabınız banlandı. Sohbet ve puanlama devre dışı.</div>
      )}
    </header>
  );
}
