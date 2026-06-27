import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { messageTime } from '../lib/format.js';
import { Loading, Empty } from './ui.jsx';
import {
  SUGGESTION_TYPES,
  SUGGESTION_TYPE_MAP,
  TACTIC_OPTIONS,
  FORMATION_OPTIONS,
} from '../lib/suggestionTypes.js';

export default function Suggestions({ matchId, canSuggest }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('top'); // 'top' | 'new'
  const [type, setType] = useState('degisiklik');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Oneri secimleri (elle yazma yok)
  const [lineup, setLineup] = useState(null);
  const [playerOut, setPlayerOut] = useState('');
  const [playerIn, setPlayerIn] = useState('');
  const [tactic, setTactic] = useState('');
  const [formation, setFormation] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/suggestions/${matchId}`)
      .then(({ suggestions }) => {
        if (active) setItems(suggestions);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [matchId, user?.id]);

  // Oyuncu degisikligi onerisi icin diziliş (kadro) cek.
  useEffect(() => {
    let active = true;
    api
      .get(`/football/matches/${matchId}/lineups`)
      .then((res) => {
        if (active) setLineup(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [matchId]);

  useEffect(() => {
    const socket = getSocket();
    const mid = Number(matchId);
    socket.emit('suggestion:join', mid);
    const onNew = (s) => {
      if (Number(s.matchId) !== mid) return;
      setItems((prev) => (prev.some((x) => x.id === s.id) ? prev : [s, ...prev]));
    };
    const onVote = ({ suggestionId, voteCount }) =>
      setItems((prev) => prev.map((x) => (x.id === suggestionId ? { ...x, voteCount } : x)));
    const onDeleted = ({ id }) => setItems((prev) => prev.filter((x) => x.id !== id));
    socket.on('suggestion:new', onNew);
    socket.on('suggestion:vote', onVote);
    socket.on('suggestion:deleted', onDeleted);
    return () => {
      socket.emit('suggestion:leave', mid);
      socket.off('suggestion:new', onNew);
      socket.off('suggestion:vote', onVote);
      socket.off('suggestion:deleted', onDeleted);
    };
  }, [matchId, user?.id]);

  // Kadrosu olan takimlar (ev sahibi + deplasman).
  const teams = useMemo(() => {
    if (!lineup) return [];
    return ['home', 'away']
      .map((side) => lineup[side])
      .filter((t) => t && (t.startXI?.length || t.substitutes?.length));
  }, [lineup]);

  const hasLineup = teams.length > 0;

  const sorted = useMemo(() => {
    const arr = [...items];
    if (sort === 'top') arr.sort((a, b) => b.voteCount - a.voteCount || b.id - a.id);
    else arr.sort((a, b) => b.id - a.id);
    return arr;
  }, [items, sort]);

  // Secimlerden oneri metnini olustur.
  const buildContent = useCallback(() => {
    if (type === 'degisiklik') {
      if (!playerOut || !playerIn) return null;
      return `${playerOut} çıksın, ${playerIn} girsin`;
    }
    if (type === 'taktik') return tactic || null;
    if (type === 'dizilis') return formation ? `${formation} dizilişe geç` : null;
    return null;
  }, [type, playerOut, playerIn, tactic, formation]);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      const content = buildContent();
      if (!content) {
        setError('Lütfen önerini seçimlerle tamamla.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const { suggestion } = await api.post(`/suggestions/${matchId}`, { type, content });
        setItems((prev) => (prev.some((x) => x.id === suggestion.id) ? prev : [suggestion, ...prev]));
        setPlayerOut('');
        setPlayerIn('');
        setTactic('');
        setFormation('');
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [buildContent, type, matchId]
  );

  const vote = useCallback(
    async (s) => {
      if (!user) {
        setError('Oy vermek için giriş yapın.');
        return;
      }
      setError('');
      // iyimser guncelleme
      setItems((prev) =>
        prev.map((x) =>
          x.id === s.id ? { ...x, voted: !x.voted, voteCount: x.voteCount + (x.voted ? -1 : 1) } : x
        )
      );
      try {
        const { voted, voteCount } = await api.post(`/suggestions/${matchId}/${s.id}/vote`);
        setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, voted, voteCount } : x)));
      } catch (err) {
        // geri al
        setItems((prev) =>
          prev.map((x) => (x.id === s.id ? { ...x, voted: s.voted, voteCount: s.voteCount } : x))
        );
        setError(err.message);
      }
    },
    [user, matchId]
  );

  const remove = useCallback(async (id) => {
    if (!window.confirm('Öneri silinsin mi?')) return;
    try {
      await api.post(`/admin/suggestions/${id}/delete`);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const canPost = user && !user.isBanned && !user.isMuted && canSuggest;
  const preview = buildContent();

  return (
    <div>
      {canPost ? (
        <form className="panel suggest-form" onSubmit={submit}>
          <div className="suggest-form__row">
            <select
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Öneri türü"
            >
              {SUGGESTION_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.icon} {t.label}
                </option>
              ))}
            </select>

            {type === 'degisiklik' &&
              (hasLineup ? (
                <>
                  <select
                    className="select suggest-form__grow"
                    value={playerOut}
                    onChange={(e) => setPlayerOut(e.target.value)}
                    aria-label="Çıkacak oyuncu"
                  >
                    <option value="">Çıkacak oyuncu…</option>
                    {teams.map((t) => (
                      <optgroup key={`out-${t.teamId}`} label={t.teamName}>
                        {(t.startXI || []).map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.number ? `${p.number}. ` : ''}
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <select
                    className="select suggest-form__grow"
                    value={playerIn}
                    onChange={(e) => setPlayerIn(e.target.value)}
                    aria-label="Girecek oyuncu"
                  >
                    <option value="">Girecek oyuncu…</option>
                    {teams.map((t) => (
                      <optgroup key={`in-${t.teamId}`} label={t.teamName}>
                        {(t.substitutes || []).map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.number ? `${p.number}. ` : ''}
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </>
              ) : (
                <span className="suggest-form__grow muted small" style={{ alignSelf: 'center' }}>
                  Diziliş henüz açıklanmadı; oyuncu değişikliği önerisi için kadro gerekli.
                </span>
              ))}

            {type === 'taktik' && (
              <select
                className="select suggest-form__grow"
                value={tactic}
                onChange={(e) => setTactic(e.target.value)}
                aria-label="Taktik"
              >
                <option value="">Taktik seç…</option>
                {TACTIC_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}

            {type === 'dizilis' && (
              <select
                className="select suggest-form__grow"
                value={formation}
                onChange={(e) => setFormation(e.target.value)}
                aria-label="Diziliş"
              >
                <option value="">Diziliş seç…</option>
                {FORMATION_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}

            <button className="btn btn--primary" disabled={busy || !preview}>
              Öner
            </button>
          </div>
          {preview && (
            <div className="suggest-form__preview muted small">Önerin: “{preview}”</div>
          )}
        </form>
      ) : (
        <div className="notice-box" style={{ marginBottom: 12 }}>
          {!user ? (
            <>
              <Link to="/giris" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Giriş yap
              </Link>{' '}
              ve maça öneri ekle; en çok önerilenler birlikte öne çıkar.
            </>
          ) : user.isBanned ? (
            'Hesabınız banlandı.'
          ) : user.isMuted ? (
            'Susturuldunuz, öneri gönderemezsiniz.'
          ) : (
            'Maç bitti, öneri ve oylama kapandı. Aşağıda verilen öneriler ve oylar görüntüleniyor.'
          )}
        </div>
      )}

      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="tab-filter">
          <button className={sort === 'top' ? 'is-active' : ''} onClick={() => setSort('top')}>
            En çok önerilen
          </button>
          <button className={sort === 'new' ? 'is-active' : ''} onClick={() => setSort('new')}>
            En yeni
          </button>
        </div>
        <div className="toolbar__spacer" />
        <span className="muted small">{items.length} öneri</span>
      </div>

      {loading ? (
        <Loading />
      ) : sorted.length === 0 ? (
        <Empty>Henüz öneri yok. İlk öneren sen ol.</Empty>
      ) : (
        <div className="panel">
          <div className="suggest-section">
            {sort === 'top' ? 'En Çok Önerilenler' : 'En Yeni Öneriler'}
          </div>
          {sorted.map((s, i) => {
            const t = SUGGESTION_TYPE_MAP[s.type] || { label: s.type, icon: '•' };
            const isTop = sort === 'top' && i === 0 && s.voteCount > 0;
            return (
              <div className={`suggest-row ${isTop ? 'is-top' : ''}`} key={s.id}>
                <button
                  className={`vote-btn ${s.voted ? 'is-voted' : ''}`}
                  onClick={() => vote(s)}
                  disabled={!canSuggest}
                  title={canSuggest ? 'Öneriyorum' : 'Oylama kapalı'}
                >
                  <span className="vote-btn__arrow" aria-hidden>
                    ▲
                  </span>
                  <span className="vote-btn__count num">{s.voteCount}</span>
                </button>
                <div className="suggest-row__main">
                  <div className="suggest-row__head">
                    <span className="suggest-type">
                      {t.icon} {t.label}
                    </span>
                    {isTop && <span className="badge badge--top">En çok önerilen</span>}
                  </div>
                  <div className="suggest-row__content">{s.content}</div>
                  <div className="suggest-row__meta muted small">
                    <span className={s.role === 'admin' ? 'is-admin-name' : ''}>{s.username}</span> ·{' '}
                    {messageTime(s.createdAt)}
                    {user?.role === 'admin' && (
                      <button className="message__del" onClick={() => remove(s.id)}>
                        sil
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
