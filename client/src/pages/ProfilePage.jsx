import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { formatDateTime } from '../lib/format.js';

export default function ProfilePage() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get(`/users/${id}`)
      .then(({ profile }) => {
        if (active) setProfile(profile);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page container">
        <Loading text="Profil yükleniyor..." />
      </div>
    );
  }
  if (error) {
    return (
      <div className="page container">
        <Link to="/" className="back-link">
          ‹ Maçlar
        </Link>
        <ErrorBox>{error}</ErrorBox>
      </div>
    );
  }
  if (!profile) return null;

  const initial = (profile.username || '?').charAt(0).toLocaleUpperCase('tr');

  return (
    <div className="page container">
      <Link to="/" className="back-link">
        ‹ Maçlar
      </Link>

      <div className="profile">
        <div className="profile__head">
          <div className="profile__avatar" aria-hidden>
            {initial}
          </div>
          <div>
            <div className="profile__name">
              {profile.username}
              {profile.role === 'admin' && <span className="tag tag--admin">admin</span>}
            </div>
            <div className="muted small">Üyelik: {formatDateTime(profile.createdAt)}</div>
          </div>
        </div>

        <div className="profile__stats">
          <div className="profile__stat">
            <div className="profile__stat-num num">{profile.stats.ratings}</div>
            <div className="muted small">Puanlama</div>
          </div>
          <div className="profile__stat">
            <div className="profile__stat-num num">{profile.stats.suggestions}</div>
            <div className="muted small">Öneri</div>
          </div>
          <div className="profile__stat">
            <div className="profile__stat-num num">{profile.stats.messages}</div>
            <div className="muted small">Mesaj</div>
          </div>
        </div>
      </div>
    </div>
  );
}
