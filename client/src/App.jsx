import { Routes, Route, Link } from 'react-router-dom';
import Header from './components/Header.jsx';
import HomePage from './pages/HomePage.jsx';
import MatchPage from './pages/MatchPage.jsx';
import PlayerPage from './pages/PlayerPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { Loading } from './components/ui.jsx';

export default function App() {
  const { loading } = useAuth();

  return (
    <div className="app">
      <Header />
      {loading ? (
        <div className="page container">
          <Loading />
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/match/:id" element={<MatchPage />} />
          <Route path="/match/:id/player/:playerId" element={<PlayerPage />} />
          <Route path="/giris" element={<LoginPage />} />
          <Route path="/kayit" element={<RegisterPage />} />
          <Route path="/sifremi-unuttum" element={<ForgotPasswordPage />} />
          <Route path="/sifre-sifirla" element={<ResetPasswordPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route
            path="*"
            element={
              <div className="page container">
                <div className="not-found">
                  <div className="not-found__code num">404</div>
                  <p className="muted">Aradığın sayfa bulunamadı.</p>
                  <Link to="/" className="btn btn--primary">
                    Maçlara dön
                  </Link>
                </div>
              </div>
            }
          />
        </Routes>
      )}
    </div>
  );
}
