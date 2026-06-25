import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Loading, Crest } from '../components/ui.jsx';
import Chat from '../components/Chat.jsx';
import { RatingScale } from '../components/Rating.jsx';
import { ratingColor } from '../components/Pitch.jsx';
import { useMatchRatings } from '../hooks/useMatchRatings.js';
import { useAuth } from '../context/AuthContext.jsx';

function findPlayer(lineups, playerId) {
  if (!lineups) return null;
  for (const side of ['home', 'away']) {
    const team = lineups[side];
    if (!team) continue;
    const all = [...(team.startXI || []), ...(team.substitutes || [])];
    const p = all.find((x) => String(x.id) === String(playerId));
    if (p) return { ...p, teamName: team.teamName };
  }
  return null;
}

export default function PlayerPage() {
  const { id, playerId } = useParams();
  const { user } = useAuth();
  const [player, setPlayer] = useState(null);
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState('');

  const { averages, mine, closed, submit } = useMatchRatings(id);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.get(`/football/matches/${id}`).then((r) => r.match).catch(() => null),
      api.get(`/football/matches/${id}/lineups`).catch(() => null),
    ])
      .then(([m, lu]) => {
        if (!active) return;
        setMatch(m);
        setPlayer(findPlayer(lu, playerId));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, playerId]);

  const avg = averages[playerId];
  const myScore = mine[playerId];
  const liveOpen = match?.canRate && !closed;

  const onPick = useCallback(
    async (n) => {
      setSubmitError('');
      try {
        await submit(Number(playerId), n);
      } catch (e) {
        setSubmitError(e.message);
      }
    },
    [submit, playerId]
  );

  if (loading) {
    return (
      <div className="page container">
        <Loading />
      </div>
    );
  }

  const playerName = player?.name || `Oyuncu #${playerId}`;
  const meta = player
    ? [
        player.posLabel,
        player.teamName,
        player.number ? `#${player.number}` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="page container">
      <Link to={`/match/${id}`} className="back-link">
        ‹ Maç detayına dön
      </Link>

      {match && (
        <div className="muted small" style={{ marginBottom: 12 }}>
          <Crest src={match.homeTeam?.crest} size={14} /> {match.homeTeam?.name} –{' '}
          {match.awayTeam?.name} <Crest src={match.awayTeam?.crest} size={14} />
          {match.isLive ? ' · canlı' : match.isFinished ? ' · bitti' : ''}
        </div>
      )}

      <div className="detail-grid">
        <div className="panel">
          <div className="panel__head">{playerName}</div>
          <div style={{ padding: '14px 16px' }}>
            {meta.length > 0 && (
              <div className="muted small" style={{ marginBottom: 14 }}>
                {meta.join(' · ')}
              </div>
            )}

            <div className="rating-summary">
              <span
                className="rating-summary__big num"
                style={{ color: avg?.average != null ? ratingColor(avg.average) : 'inherit' }}
              >
                {avg?.average != null ? avg.average.toFixed(1) : '—'}
              </span>
              <span className="muted">
                {avg?.count ? `${avg.count} oy` : 'henüz oy yok'}
                {myScore ? ` · senin puanın: ${myScore}` : ''}
              </span>
            </div>

            {!user ? (
              <div className="notice-box">
                Puan vermek için{' '}
                <Link to="/giris" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  giriş yap
                </Link>
                .
              </div>
            ) : user.isBanned ? (
              <div className="notice-box">Hesabınız banlandı, puan veremezsiniz.</div>
            ) : liveOpen ? (
              <>
                <RatingScale myScore={myScore} disabled={false} onPick={onPick} />
                <div className="muted small" style={{ marginTop: 8 }}>
                  1 (çok kötü) – 10 (mükemmel). Tekrar seçerek puanını güncelleyebilirsin.
                </div>
              </>
            ) : (
              <>
                <RatingScale myScore={myScore} disabled onPick={() => {}} />
                <div className="muted small" style={{ marginTop: 8 }}>
                  {match?.isFinished
                    ? 'Maç bitti, puanlama kapandı. Ortalama görüntüleniyor.'
                    : 'Puanlama yalnızca maç canlıyken açık.'}
                </div>
              </>
            )}

            {submitError && (
              <div className="error-box" style={{ marginTop: 10 }}>
                {submitError}
              </div>
            )}
          </div>
        </div>

        <Chat room={`player:${id}:${playerId}`} title={`${playerName} · Sohbet`} />
      </div>
    </div>
  );
}
