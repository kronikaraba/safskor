import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { messageTime, formatDateTime } from '../lib/format.js';

const TABS = [
  { key: 'messages', label: 'Mesajlar' },
  { key: 'suggestions', label: 'Öneriler' },
  { key: 'users', label: 'Kullanıcılar' },
  { key: 'log', label: 'Kayıt' },
];

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('messages');

  if (!user) return <Navigate to="/giris" replace />;
  if (user.role !== 'admin') {
    return (
      <div className="page container">
        <ErrorBox>Bu sayfa için yetkiniz yok.</ErrorBox>
      </div>
    );
  }

  return (
    <div className="page container">
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Moderasyon</h1>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Admin yalnızca moderasyon yapar: mesaj silme, susturma, banlama. Maç/skor/oyuncu verisi
        API'den gelir, elle girilmez.
      </p>
      <div className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'messages' && <MessagesPanel />}
      {tab === 'suggestions' && <SuggestionsPanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'log' && <LogPanel />}
    </div>
  );
}

function SearchBar({ value, onChange, onSubmit }) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: 6 }}>
      <input
        className="select"
        placeholder="Ara..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button className="btn btn--sm">Ara</button>
    </form>
  );
}

function MessagesPanel() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const { messages } = await api.get(`/admin/messages${q}`);
      setMessages(messages);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id) => {
    if (!window.confirm('Mesaj silinsin mi?')) return;
    try {
      await api.post(`/admin/messages/${id}/delete`);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isDeleted: true, content: null } : m))
      );
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="panel">
      <div className="panel__head">
        <span>Son mesajlar</span>
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : messages.length === 0 ? (
        <Empty>Mesaj yok.</Empty>
      ) : (
        messages.map((m) => (
          <div className="admin-row" key={m.id}>
            <div className="admin-row__main">
              <div>
                <strong>{m.username}</strong>{' '}
                <span className="muted small">
                  · {m.room} · {messageTime(m.createdAt)}
                </span>
              </div>
              <div className={m.isDeleted ? 'muted' : ''}>
                {m.isDeleted ? <em>silindi</em> : m.content}
              </div>
            </div>
            <div className="admin-row__actions">
              {!m.isDeleted && (
                <button className="btn btn--sm btn--danger" onClick={() => remove(m.id)}>
                  Sil
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SuggestionsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { suggestions } = await api.get('/admin/suggestions');
      setItems(suggestions);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id) => {
    if (!window.confirm('Öneri silinsin mi?')) return;
    try {
      await api.post(`/admin/suggestions/${id}/delete`);
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, isDeleted: true, content: null } : s)));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="panel">
      <div className="panel__head">
        <span>Son öneriler</span>
        <button className="btn btn--sm" onClick={load}>
          Yenile
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : items.length === 0 ? (
        <Empty>Oneri yok.</Empty>
      ) : (
        items.map((s) => (
          <div className="admin-row" key={s.id}>
            <div className="admin-row__main">
              <div>
                <strong>{s.username}</strong>{' '}
                <span className="muted small">
                  · {s.type} · mac {s.matchId} · {s.voteCount} oy · {messageTime(s.createdAt)}
                </span>
              </div>
              <div className={s.isDeleted ? 'muted' : ''}>
                {s.isDeleted ? <em>silindi</em> : s.content}
              </div>
            </div>
            <div className="admin-row__actions">
              {!s.isDeleted && (
                <button className="btn btn--sm btn--danger" onClick={() => remove(s.id)}>
                  Sil
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const { users } = await api.get(`/admin/users${q}`);
      setUsers(users);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (path, body) => {
    setError('');
    try {
      const { user } = await api.post(path, body);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
    } catch (e) {
      setError(e.message);
    }
  };

  const mute = (u) => {
    const minutes = window.prompt(`${u.username} kaç dakika susturulsun?`, '30');
    if (!minutes) return;
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Geçersiz süre.');
      return;
    }
    act(`/admin/users/${u.id}/mute`, { minutes: n });
  };

  return (
    <div className="panel">
      <div className="panel__head">
        <span>Kullanıcılar</span>
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : users.length === 0 ? (
        <Empty>Kullanıcı yok.</Empty>
      ) : (
        users.map((u) => (
          <div className="admin-row" key={u.id}>
            <div className="admin-row__main">
              <div>
                <strong>{u.username}</strong> <span className="muted small">· {u.email}</span>{' '}
                {u.role === 'admin' && <span className="tag tag--admin">admin</span>}
                {u.isBanned && <span className="tag tag--banned">banli</span>}
                {u.isMuted && <span className="tag tag--muted">susturulmuş</span>}
              </div>
              <div className="muted small">Kayıt: {formatDateTime(u.createdAt)}</div>
            </div>
            {u.role !== 'admin' && (
              <div className="admin-row__actions">
                {u.isMuted ? (
                  <button className="btn btn--sm" onClick={() => act(`/admin/users/${u.id}/unmute`)}>
                    Susturmayı kaldır
                  </button>
                ) : (
                  <button className="btn btn--sm" onClick={() => mute(u)}>
                    Sustur
                  </button>
                )}
                {u.isBanned ? (
                  <button className="btn btn--sm" onClick={() => act(`/admin/users/${u.id}/unban`)}>
                    Banı kaldır
                  </button>
                ) : (
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      if (window.confirm(`${u.username} banlansın mı?`)) {
                        act(`/admin/users/${u.id}/ban`);
                      }
                    }}
                  >
                    Banla
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

const ACTION_LABEL = {
  delete_message: 'Mesaj silindi',
  delete_suggestion: 'Öneri silindi',
  mute: 'Susturuldu',
  unmute: 'Susturma kaldırıldı',
  ban: 'Banlandı',
  unban: 'Ban kaldırıldı',
};

function LogPanel() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/admin/log')
      .then(({ log }) => setLog(log))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (log.length === 0) return <Empty>Henüz moderasyon işlemi yok.</Empty>;

  return (
    <div className="panel">
      {log.map((l) => (
        <div className="admin-row" key={l.id}>
          <div className="admin-row__main">
            <div>
              <strong>{ACTION_LABEL[l.action] || l.action}</strong>{' '}
              {l.targetUsername && <span className="muted">· {l.targetUsername}</span>}
            </div>
            <div className="muted small">
              {l.adminUsername} · {formatDateTime(l.createdAt)}
              {l.meta?.minutes ? ` · ${l.meta.minutes} dk` : ''}
              {l.reason ? ` · ${l.reason}` : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
