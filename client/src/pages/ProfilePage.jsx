import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { formatDateTime, messageTime } from '../lib/format.js';
import { getFavTeams, toggleFavTeam } from '../lib/prefs.js';
import { SUGGESTION_TYPE_MAP } from '../lib/suggestionTypes.js';

export default function ProfilePage() {
  const { id } = useParams();
  const { user, updateUser } = useAuth();
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

  const isOwn = user && Number(user.id) === Number(profile.id);
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
          <div style={{ flex: 1 }}>
            {isOwn ? (
              <UsernameEditor
                profile={profile}
                onChange={(username) => {
                  setProfile((p) => ({ ...p, username }));
                  updateUser({ username });
                }}
              />
            ) : (
              <div className="profile__name">
                {profile.username}
                {profile.role === 'admin' && <span className="tag tag--admin">admin</span>}
              </div>
            )}
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

      {isOwn && <FavTeams />}

      <div className="profile__section">
        <div className="section-title">Son öneriler</div>
        {profile.recentSuggestions?.length ? (
          <div className="panel">
            {profile.recentSuggestions.map((s, i) => {
              const t = SUGGESTION_TYPE_MAP[s.type] || { label: s.type, icon: '•' };
              return (
                <Link to={`/match/${s.matchId}`} className="admin-row" key={i} style={{ textDecoration: 'none' }}>
                  <div className="admin-row__main">
                    <div>
                      <span className="suggest-type">
                        {t.icon} {t.label}
                      </span>{' '}
                      {s.team && <span className="badge badge--team">{s.team}</span>}
                    </div>
                    <div className="suggest-row__content">{s.content}</div>
                    <div className="muted small">{messageTime(s.createdAt)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <Empty>Henüz öneri yok.</Empty>
        )}
      </div>
    </div>
  );
}

function UsernameEditor({ profile, onChange }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(profile.username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const name = value.trim();
    if (name === profile.username) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post('/users/me', { username: name });
      onChange(user.username);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="profile__name">
        {profile.username}
        {profile.role === 'admin' && <span className="tag tag--admin">admin</span>}
        <button className="fav-btn" onClick={() => setEditing(true)} style={{ marginTop: 0 }}>
          ✎ Düzenle
        </button>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          className="select"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          style={{ maxWidth: 200 }}
        />
        <button className="btn btn--sm btn--primary" onClick={save} disabled={busy}>
          Kaydet
        </button>
        <button
          className="btn btn--sm"
          onClick={() => {
            setValue(profile.username);
            setEditing(false);
            setError('');
          }}
        >
          İptal
        </button>
      </div>
      {error && <div className="error-box small" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function FavTeams() {
  const [teams, setTeams] = useState(getFavTeams());
  const remove = (team) => {
    toggleFavTeam(team);
    setTeams(getFavTeams());
  };
  return (
    <div className="profile__section">
      <div className="section-title">Favori takımların</div>
      {teams.length ? (
        <div className="fav-chips">
          {teams.map((t) => (
            <span className="fav-chip" key={t.id}>
              ⭐ {t.name}
              <button className="fav-chip__x" onClick={() => remove(t)} title="Çıkar" aria-label="Çıkar">
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <Empty>Henüz favori takımın yok. Bir maç sayfasında takıma “☆ Favori ekle” diyebilirsin.</Empty>
      )}
    </div>
  );
}
