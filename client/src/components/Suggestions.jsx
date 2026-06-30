import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../context/AuthContext.jsx';
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
  const [side, setSide] = useState('home'); // hangi takim icin: 'home' | 'away'
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
    const onDeleted = ({ id }) => setItems((prev) => prev.filter((x) => x.id !== id));
    socket.on('suggestion:new', onNew);
    socket.on('suggestion:deleted', onDeleted);
    return () => {
      socket.emit('suggestion:leave', mid);
      socket.off('suggestion:new', onNew);
      socket.off('suggestion:deleted', onDeleted);
    };
  }, [matchId, user?.id]);

  // Maçın iki takımı (kadro açıklanmasa da isimler gelir).
  const homeTeam = lineup?.homeTeam ?? null;
  const awayTeam = lineup?.awayTeam ?? null;
  const teamName = (side === 'home' ? homeTeam?.name : awayTeam?.name) ?? null;

  // Seçili takımın kadrosu (oyuncu değişikliği önerisi için).
  const sideLineup = lineup?.[side] ?? null;
  const hasSidePlayers = !!(sideLineup?.startXI?.length || sideLineup?.substitutes?.length);

  // Takım değişince oyuncu seçimlerini sıfırla (oyuncular takıma özel).
  useEffect(() => {
    setPlayerOut('');
    setPlayerIn('');
  }, [side]);

  // Ayni (tur + icerik) onerileri grupla ve say.
  const groups = useMemo(() => {
    const map = new Map();
    for (const s of items) {
      const key = `${s.type}|||${s.team ?? ''}|||${s.content}`;
      let g = map.get(key);
      if (!g) {
        g = { key, type: s.type, team: s.team ?? null, content: s.content, count: 0, latestId: 0, mineId: null };
        map.set(key, g);
      }
      g.count += 1;
      if (s.id > g.latestId) g.latestId = s.id;
      if (user && Number(s.userId) === Number(user.id)) g.mineId = s.id;
    }
    const arr = [...map.values()];
    if (sort === 'top') arr.sort((a, b) => b.count - a.count || b.latestId - a.latestId);
    else arr.sort((a, b) => b.latestId - a.latestId);
    return arr;
  }, [items, sort, user]);

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
      if (!teamName) {
        setError('Lütfen önerinin hangi takım için olduğunu seç.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const { suggestion } = await api.post(`/suggestions/${matchId}`, {
          type,
          content,
          team: teamName,
        });
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
    [buildContent, type, matchId, teamName]
  );

  // Bir gruba katil ("ben de öneriyorum") veya kendi önerini geri çek.
  const toggleSupport = useCallback(
    async (g) => {
      if (!user) {
        setError('Öneriye katılmak için giriş yapın.');
        return;
      }
      setError('');
      if (g.mineId) {
        const removedId = g.mineId;
        const snapshot = items;
        setItems((prev) => prev.filter((x) => x.id !== removedId));
        try {
          await api.post(`/suggestions/${matchId}/${removedId}/withdraw`);
        } catch (err) {
          setItems(snapshot); // geri al
          setError(err.message);
        }
      } else {
        try {
          const { suggestion } = await api.post(`/suggestions/${matchId}`, {
            type: g.type,
            content: g.content,
            team: g.team ?? null,
          });
          setItems((prev) =>
            prev.some((x) => x.id === suggestion.id) ? prev : [suggestion, ...prev]
          );
        } catch (err) {
          setError(err.message);
        }
      }
    },
    [user, items, matchId]
  );

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

            <select
              className="select"
              value={side}
              onChange={(e) => setSide(e.target.value)}
              aria-label="Takım"
            >
              <option value="home">{homeTeam?.name ?? 'Ev sahibi'}</option>
              <option value="away">{awayTeam?.name ?? 'Deplasman'}</option>
            </select>

            {type === 'degisiklik' &&
              (hasSidePlayers ? (
                <>
                  <select
                    className="select suggest-form__grow"
                    value={playerOut}
                    onChange={(e) => setPlayerOut(e.target.value)}
                    aria-label="Çıkacak oyuncu"
                  >
                    <option value="">Çıkacak oyuncu…</option>
                    {(sideLineup.startXI || []).map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.number ? `${p.number}. ` : ''}
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select suggest-form__grow"
                    value={playerIn}
                    onChange={(e) => setPlayerIn(e.target.value)}
                    aria-label="Girecek oyuncu"
                  >
                    <option value="">Girecek oyuncu…</option>
                    {(sideLineup.substitutes || []).map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.number ? `${p.number}. ` : ''}
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="suggest-form__grow muted small" style={{ alignSelf: 'center' }}>
                  {teamName || 'Bu takım'} için diziliş henüz açıklanmadı; oyuncu değişikliği için kadro gerekli.
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
            <div className="suggest-form__preview muted small">
              Önerin: {teamName ? <strong>{teamName}</strong> : ''} “{preview}”
            </div>
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
            'Maç bitti, öneri kapandı. Aşağıda en çok önerilenler görüntüleniyor.'
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
        <span className="muted small">{groups.length} öneri</span>
      </div>

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty>Henüz öneri yok. İlk öneren sen ol.</Empty>
      ) : (
        <div className="panel">
          <div className="suggest-section">
            {sort === 'top' ? 'En Çok Önerilenler' : 'En Yeni Öneriler'}
          </div>
          {groups.map((g, i) => {
            const t = SUGGESTION_TYPE_MAP[g.type] || { label: g.type, icon: '•' };
            const isTop = sort === 'top' && i === 0 && g.count > 0;
            const mine = !!g.mineId;
            return (
              <div className={`suggest-row ${isTop ? 'is-top' : ''}`} key={g.key}>
                <button
                  className={`vote-btn ${mine ? 'is-voted' : ''}`}
                  onClick={() => toggleSupport(g)}
                  disabled={!canSuggest}
                  title={
                    !canSuggest
                      ? 'Öneri kapalı'
                      : mine
                        ? 'Önerini geri çek'
                        : 'Ben de öneriyorum'
                  }
                >
                  <span className="vote-btn__arrow" aria-hidden>
                    ▲
                  </span>
                  <span className="vote-btn__count num">{g.count}</span>
                </button>
                <div className="suggest-row__main">
                  <div className="suggest-row__head">
                    <span className="suggest-type">
                      {t.icon} {t.label}
                    </span>
                    {g.team && <span className="badge badge--team">{g.team}</span>}
                    {isTop && <span className="badge badge--top">En çok önerilen</span>}
                  </div>
                  <div className="suggest-row__content">{g.content}</div>
                  <div className="suggest-row__meta muted small">
                    {g.count} kişi öneriyor{mine ? ' · sen de' : ''}
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
