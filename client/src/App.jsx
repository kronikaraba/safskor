import { Routes, Route } from 'react-router-dom';
import Header from './components/Header.jsx';
import HomePage from './pages/HomePage.jsx';
import MatchPage from './pages/MatchPage.jsx';
import PlayerPage from './pages/PlayerPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
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
          <Route path="/admin" element={<AdminPage />} />
          <Route
            path="*"
            element={
              <div className="page container">
                <div className="empty">Sayfa bulunamadi.</div>
              </div>
            }
          />
        </Routes>
      )}
    </div>
  );
}
