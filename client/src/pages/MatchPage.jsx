import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, Crest } from '../components/ui.jsx';
import Events from '../components/Events.jsx';
import Standings from '../components/Standings.jsx';
import Chat from '../components/Chat.jsx';
import Suggestions from '../components/Suggestions.jsx';
import Pitch from '../components/Pitch.jsx';
import { useMatchRatings } from '../hooks/useMatchRatings.js';
import { formatDateTime } from '../lib/format.js';
import { isFavTeam, toggleFavTeam } from '../lib/prefs.js';

function FavButton({ team }) {
  const [, force] = useState(0);
  if (!team?.id) return null;
  const fav = isFavTeam(team.id);
  return (
    <button
      className={`fav-btn ${fav ? 'is-fav' : ''}`}
      onClick={() => {
        toggleFavTeam(team);
        force((n) => n + 1);
      }}
      title={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
    >
      {fav ? '⭐ Favori' : '☆ Favori ekle'}
    </button>
  );
}

const TABS = [
  { key: 'lineups', label: 'Kadrolar & Puan' },
  { key: 'events', label: 'Olaylar' },
  { key: 'standings', label: 'Puan Durumu' },
  { key: 'suggestions', label: 'Öneriler' },
  { key: 'chat', label: 'Sohbet' },
];

export default function MatchPage() {
  const { id } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('lineups');

  const { averages } = useMatchRatings(id);

  const loadMatch = useCallback(
    async (showSpinner) => {
      if (showSpinner) setLoading(true);
      try {
        const { match } = await api.get(`/football/matches/${id}`);
        setMatch(match);
        setError('');
      } catch (e) {
        setError(e.message);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    loadMatch(true);
  }, [loadMatch]);

  useEffect(() => {
    if (!match?.isLive) return undefined;
    const t = setInterval(() => loadMatch(false), 60000);
    return () => clearInterval(t);
  }, [match?.isLive, loadMatch]);

  if (loading) {
    return (
      <div className="page container">
        <Loading text="Maç yükleniyor..." />
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
  if (!match) return null;

  const { homeTeam, awayTeam, score } = match;
  const hasScore = score.home != null || score.away != null;

  return (
    <div className="page container">
      <Link to="/" className="back-link">
        ‹ Maçlar
      </Link>

      <div className="match-head">
        <div className="match-head__comp">
          <Crest src={match.competition?.emblem} size={16} />
          {match.competition?.name}
          {match.stage ? ` · ${match.stage}` : ''}
        </div>
        <div className="match-head__main">
          <div className="match-head__team">
            <Crest src={homeTeam?.crest} size={44} className="crest-lg" />
            <span className="match-head__team-name">{homeTeam?.name}</span>
            <FavButton team={homeTeam} />
          </div>
          <div className="match-head__center">
            <div className="match-head__score num">
              {hasScore ? `${score.home ?? 0} – ${score.away ?? 0}` : '–'}
            </div>
            <div className={`match-head__status ${match.isLive ? 'is-live' : ''}`}>
              {match.isLive ? (
                <>
                  <span className="live-dot" />
                  {match.minute ? `${match.minute}'` : match.statusLabel}
                </>
              ) : match.isFinished ? (
                match.statusLabel
              ) : (
                formatDateTime(match.utcDate)
              )}
            </div>
          </div>
          <div className="match-head__team">
            <Crest src={awayTeam?.crest} size={44} className="crest-lg" />
            <span className="match-head__team-name">{awayTeam?.name}</span>
            <FavButton team={awayTeam} />
          </div>
        </div>
        {(match.venue || score.halfTime?.home != null) && (
          <div className="match-head__meta">
            {score.halfTime?.home != null && (
              <span>
                İlk yarı: {score.halfTime.home}–{score.halfTime.away}
              </span>
            )}
            {match.venue && <span>{match.venue}</span>}
          </div>
        )}
      </div>

      <div className="tabs">
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

      {tab === 'lineups' && <LineupsTab matchId={id} averages={averages} />}
      {tab === 'events' && <EventsTab matchId={id} isLive={match.isLive} />}
      {tab === 'standings' && (
        <StandingsTab
          competitionId={match.competition?.id}
          season={match.competition?.season}
          homeId={homeTeam?.id}
          awayId={awayTeam?.id}
        />
      )}
      {tab === 'suggestions' && <Suggestions matchId={id} canSuggest={!match.isFinished} />}
      {tab === 'chat' && <Chat room={`match:${id}`} title="Maç Sohbeti" />}
    </div>
  );
}

function LineupsTab({ matchId, averages }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/football/matches/${matchId}/lineups`)
      .then((res) => {
        if (active) setData(res);
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
  }, [matchId]);

  if (loading) return <Loading text="Dizilişler yükleniyor..." />;
  if (error) return <ErrorBox>{error}</ErrorBox>;

  return (
    <>
      <div className="notice-box" style={{ marginBottom: 12 }}>
        {data?.canRate
          ? 'Bir oyuncuya tıkla: 1-10 puan ver ve oyuncuya özel sohbete katıl. Puanlar canlı ortalamaya yansır.'
          : 'Puanlama yalnızca maç canlıyken açık. Oyuncuya tıklayıp sohbet ve ortalamayı görebilirsin.'}
      </div>
      <Pitch matchId={matchId} data={data} averages={averages} />
    </>
  );
}

function EventsTab({ matchId, isLive }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    (spin) => {
      if (spin) setLoading(true);
      api
        .get(`/football/matches/${matchId}/events`)
        .then(({ events }) => {
          setEvents(events);
          setError('');
        })
        .catch((e) => setError(e.message))
        .finally(() => {
          if (spin) setLoading(false);
        });
    },
    [matchId]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (!isLive) return undefined;
    const t = setInterval(() => load(false), 60000);
    return () => clearInterval(t);
  }, [isLive, load]);

  if (loading) return <Loading text="Olaylar yükleniyor..." />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  return <Events events={events} />;
}

function StandingsTab({ competitionId, season, homeId, awayId }) {
  const [standings, setStandings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!competitionId || !season) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    api
      .get(`/football/competitions/${competitionId}/standings?season=${season}`)
      .then(({ standings }) => {
        if (active) setStandings(standings);
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
  }, [competitionId, season]);

  if (!competitionId || !season) return <Empty>Bu maç için lig/sezon bilgisi yok.</Empty>;
  if (loading) return <Loading text="Puan durumu yükleniyor..." />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!standings || standings.groups.length === 0) {
    return <Empty>Bu turnuva için puan durumu yok (kupa formatı olabilir).</Empty>;
  }
  return <Standings standings={standings} highlightTeamIds={[homeId, awayId]} />;
}
