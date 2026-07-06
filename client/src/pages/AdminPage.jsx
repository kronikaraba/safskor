import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { messageTime, formatDateTime } from '../lib/format.js';

const TABS = [
  { key: 'matches', label: 'Maçlar' },
  { key: 'messages', label: 'Mesajlar' },
  { key: 'suggestions', label: 'Öneriler' },
  { key: 'users', label: 'Kullanıcılar' },
  { key: 'log', label: 'Kayıt' },
];

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('matches');

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
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Yönetim</h1>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Moderasyon (mesaj silme, susturma, banlama) ve manuel maç yönetimi: API'de olmayan maçları
        elle ekle, kadro gir, durum/skor güncelle, gol/kart işle.
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
      {tab === 'matches' && <MatchesPanel />}
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

// --- Manuel maçlar ---

const STATUS_OPTIONS = [
  { value: 'NS', label: 'Planlandı' },
  { value: '1H', label: '1. yarı' },
  { value: 'HT', label: 'Devre arası' },
  { value: '2H', label: '2. yarı' },
  { value: 'ET', label: 'Uzatma' },
  { value: 'P', label: 'Penaltılar' },
  { value: 'FT', label: 'Bitti' },
  { value: 'PST', label: 'Ertelendi' },
  { value: 'CANC', label: 'İptal' },
];

const EVENT_OPTIONS = [
  { value: 'goal', label: 'Gol' },
  { value: 'yellow_card', label: 'Sarı kart' },
  { value: 'red_card', label: 'Kırmızı kart' },
  { value: 'substitution', label: 'Değişiklik' },
];

// "7 Arda Güler F" → { number: 7, name: 'Arda Güler', pos: 'F' }
// Baş rakam = numara (ops.), son tek harf G/D/M/F = pozisyon (ops.), kalanı isim.
function parseLineup(text, isStarter) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tokens = line.split(/\s+/);
      let number = null;
      if (/^\d{1,2}$/.test(tokens[0])) number = Number(tokens.shift());
      let pos = null;
      if (tokens.length > 1 && /^[GDMF]$/i.test(tokens[tokens.length - 1])) {
        pos = tokens.pop().toUpperCase();
      }
      const name = tokens.join(' ');
      return name ? { name, number, pos, isStarter } : null;
    })
    .filter(Boolean);
}

/**
 * Futbol API kill-switch: askıdayken sunucu API-Football'a hiç istek atmaz
 * (kota harcanmaz); üyeler yalnızca elle eklenen maçları görür.
 */
function ApiSwitchPanel() {
  const [suspended, setSuspended] = useState(null); // null = yükleniyor
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/admin/settings')
      .then((r) => setSuspended(!!r.footballApiSuspended))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = async () => {
    const next = !suspended;
    if (
      next &&
      !window.confirm(
        'Futbol API askıya alınsın mı? Üyeler yalnızca elle eklenen maçları görür.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/admin/settings/football-api', { suspended: next });
      setSuspended(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel__head">
        <span>
          API-Football{' '}
          {suspended === null ? (
            <span className="muted small">· kontrol ediliyor…</span>
          ) : suspended ? (
            <span className="small" style={{ color: 'var(--live)' }}>· askıda</span>
          ) : (
            <span className="muted small">· etkin</span>
          )}
        </span>
        {suspended !== null && (
          <button className="btn btn--sm" onClick={toggle} disabled={busy}>
            {suspended ? "API'yi etkinleştir" : "API'yi askıya al"}
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        Askıdayken sunucu API-Football'a istek atmaz (kota harcanmaz); ana sayfada yalnızca elle
        eklenen maçlar görünür.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

function MatchesPanel() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { matches } = await api.get('/admin/matches');
      setMatches(matches);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <ApiSwitchPanel />
      <CreateMatchForm onCreated={load} />
      <div className="panel">
        <div className="panel__head">
          <span>Eklenen maçlar</span>
          <button className="btn btn--sm" onClick={load}>
            Yenile
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox>{error}</ErrorBox>
        ) : matches.length === 0 ? (
          <Empty>Henüz manuel maç yok.</Empty>
        ) : (
          matches.map((m) => <ManageMatch key={m.id} match={m} onChange={load} />)
        )}
      </div>
    </>
  );
}

const EMPTY_FORM = {
  competition: '',
  stage: '',
  homeName: '',
  awayName: '',
  kickoff: '',
  venue: '',
  homeXI: '',
  homeSubs: '',
  awayXI: '',
  awaySubs: '',
};

function CreateMatchForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    if (!form.competition.trim() || !form.homeName.trim() || !form.awayName.trim() || !form.kickoff) {
      setError('Turnuva, iki takım adı ve başlangıç saati zorunlu.');
      return;
    }
    setBusy(true);
    try {
      const lineups = {
        home: [...parseLineup(form.homeXI, true), ...parseLineup(form.homeSubs, false)],
        away: [...parseLineup(form.awayXI, true), ...parseLineup(form.awaySubs, false)],
      };
      await api.post('/admin/matches', {
        competition: form.competition,
        stage: form.stage,
        homeName: form.homeName,
        awayName: form.awayName,
        kickoff: new Date(form.kickoff).toISOString(),
        venue: form.venue,
        lineups,
      });
      setForm(EMPTY_FORM);
      setOk('Maç eklendi.');
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="panel__head">
        <span>Yeni maç ekle</span>
      </div>
      <div style={{ display: 'grid', gap: 8, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="select" placeholder="Turnuva / lig *" value={form.competition} onChange={set('competition')} style={{ flex: '1 1 200px' }} />
          <input className="select" placeholder="Aşama (ops. — ör. Yarı final)" value={form.stage} onChange={set('stage')} style={{ flex: '1 1 160px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="select" placeholder="Ev sahibi *" value={form.homeName} onChange={set('homeName')} style={{ flex: '1 1 160px' }} />
          <input className="select" placeholder="Deplasman *" value={form.awayName} onChange={set('awayName')} style={{ flex: '1 1 160px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="select" type="datetime-local" value={form.kickoff} onChange={set('kickoff')} style={{ flex: '1 1 200px' }} />
          <input className="select" placeholder="Stat (ops.)" value={form.venue} onChange={set('venue')} style={{ flex: '1 1 160px' }} />
        </div>

        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Kadro: her satıra bir oyuncu. Biçim: <code>No İsim Pozisyon</code> (ör. <code>7 Arda Güler F</code>).
          Numara ve pozisyon (G/D/M/F) opsiyonel.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <div className="muted small" style={{ marginBottom: 4 }}>Ev sahibi — İlk 11</div>
            <textarea className="select" rows={6} value={form.homeXI} onChange={set('homeXI')} style={{ width: '100%', fontFamily: 'monospace' }} />
            <div className="muted small" style={{ margin: '6px 0 4px' }}>Ev sahibi — Yedekler</div>
            <textarea className="select" rows={3} value={form.homeSubs} onChange={set('homeSubs')} style={{ width: '100%', fontFamily: 'monospace' }} />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <div className="muted small" style={{ marginBottom: 4 }}>Deplasman — İlk 11</div>
            <textarea className="select" rows={6} value={form.awayXI} onChange={set('awayXI')} style={{ width: '100%', fontFamily: 'monospace' }} />
            <div className="muted small" style={{ margin: '6px 0 4px' }}>Deplasman — Yedekler</div>
            <textarea className="select" rows={3} value={form.awaySubs} onChange={set('awaySubs')} style={{ width: '100%', fontFamily: 'monospace' }} />
          </div>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}
        {ok && <div className="muted small" style={{ color: 'var(--ok, green)' }}>{ok}</div>}
        <div>
          <button className="btn" disabled={busy}>
            {busy ? 'Ekleniyor...' : 'Maçı ekle'}
          </button>
        </div>
      </div>
    </form>
  );
}

function ManageMatch({ match, onChange }) {
  const [status, setStatus] = useState(match.status);
  const [minute, setMinute] = useState(match.minute ?? '');
  const [homeScore, setHomeScore] = useState(match.homeScore ?? '');
  const [awayScore, setAwayScore] = useState(match.awayScore ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/admin/matches/${match.id}`, {
        status,
        minute: minute === '' ? null : Number(minute),
        homeScore: homeScore === '' ? null : Number(homeScore),
        awayScore: awayScore === '' ? null : Number(awayScore),
      });
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${match.homeName} - ${match.awayName} maçı silinsin mi?`)) return;
    try {
      await api.post(`/admin/matches/${match.id}/delete`);
      onChange?.();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="admin-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="admin-row__main">
        <div>
          <strong>
            {match.homeName} - {match.awayName}
          </strong>{' '}
          <span className="muted small">
            · {match.competition}
            {match.stage ? ` · ${match.stage}` : ''} · {formatDateTime(match.kickoff)} ·{' '}
            <code>#{match.id}</code>
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input className="select" style={{ width: 70 }} placeholder="Dk" value={minute} onChange={(e) => setMinute(e.target.value)} />
        <input className="select" style={{ width: 56 }} placeholder="Ev" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} />
        <span>-</span>
        <input className="select" style={{ width: 56 }} placeholder="Dep" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} />
        <button className="btn btn--sm" onClick={save} disabled={busy}>
          Kaydet
        </button>
        <button className="btn btn--sm btn--danger" onClick={remove}>
          Sil
        </button>
      </div>

      <EventsEditor match={match} onChange={onChange} />
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

const EVENT_LABEL = { goal: 'Gol', yellow_card: 'Sarı', red_card: 'Kırmızı', substitution: 'Değişiklik' };

function EventsEditor({ match, onChange }) {
  const [side, setSide] = useState('home');
  const [type, setType] = useState('goal');
  const [minute, setMinute] = useState('');
  const [player, setPlayer] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!player.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/matches/${match.id}/events`, {
        side,
        type,
        minute: minute === '' ? null : Number(minute),
        player,
      });
      setPlayer('');
      setMinute('');
      onChange?.();
    } catch {
      /* yok say */
    } finally {
      setBusy(false);
    }
  };

  const del = async (eventId) => {
    try {
      await api.post(`/admin/matches/${match.id}/events/${eventId}/delete`);
      onChange?.();
    } catch {
      /* yok say */
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border, #eee)', paddingTop: 8 }}>
      <div className="muted small" style={{ marginBottom: 6 }}>
        Olaylar
      </div>
      {match.events?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
          {match.events.map((ev) => (
            <div key={ev.id} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="muted">{ev.minute != null ? `${ev.minute}'` : '—'}</span>
              <span>{EVENT_LABEL[ev.type] || ev.type}</span>
              <span>· {ev.side === 'home' ? match.homeName : match.awayName}</span>
              <span>· {ev.player || '?'}</span>
              <button className="btn btn--sm btn--danger" style={{ padding: '0 6px' }} onClick={() => del(ev.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="select" value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="home">{match.homeName}</option>
          <option value="away">{match.awayName}</option>
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {EVENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input className="select" style={{ width: 60 }} placeholder="Dk" value={minute} onChange={(e) => setMinute(e.target.value)} />
        <input className="select" placeholder="Oyuncu" value={player} onChange={(e) => setPlayer(e.target.value)} style={{ flex: '1 1 120px' }} />
        <button className="btn btn--sm" onClick={add} disabled={busy}>
          Ekle
        </button>
      </div>
    </div>
  );
}
