import { Link } from 'react-router-dom';
import { Crest } from './ui.jsx';
import { formatTime } from '../lib/format.js';

export default function MatchRow({ match }) {
  const { homeTeam, awayTeam, score, isLive, isFinished } = match;
  const hasScore = score.home != null || score.away != null;
  const decided = isFinished && (score.winner === 'HOME_TEAM' || score.winner === 'AWAY_TEAM');
  const homeDim = decided && score.winner !== 'HOME_TEAM';
  const awayDim = decided && score.winner !== 'AWAY_TEAM';

  return (
    <Link to={`/match/${match.id}`} className="match-row">
      <div className="match-row__time">
        {isLive ? (
          <span className="live">
            <span className="live-dot" />
            {match.minute ? `${match.minute}'` : 'Canlı'}
          </span>
        ) : isFinished ? (
          <span>Bitti</span>
        ) : (
          <span className="num">{formatTime(match.utcDate)}</span>
        )}
      </div>

      <div className="match-row__teams">
        <div className={`team-line ${homeDim ? 'team-line--dim' : ''}`}>
          <Crest src={homeTeam?.crest} alt="" size={16} />
          <span className="team-line__name">{homeTeam?.name}</span>
        </div>
        <div className={`team-line ${awayDim ? 'team-line--dim' : ''}`}>
          <Crest src={awayTeam?.crest} alt="" size={16} />
          <span className="team-line__name">{awayTeam?.name}</span>
        </div>
      </div>

      <div className="match-row__score num">
        {hasScore ? (
          <>
            <span className={`s ${homeDim ? 's--dim' : ''}`}>{score.home ?? 0}</span>
            <span className={`s ${awayDim ? 's--dim' : ''}`}>{score.away ?? 0}</span>
          </>
        ) : (
          <>
            <span className="s s--dim">–</span>
            <span className="s s--dim">–</span>
          </>
        )}
      </div>
    </Link>
  );
}
