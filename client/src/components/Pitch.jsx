import { Link } from 'react-router-dom';
import { Empty } from './ui.jsx';

// Topluluk puanina gore renk (1-10).
export function ratingColor(avg) {
  if (avg == null) return null;
  if (avg >= 7.5) return '#2e9e5b';
  if (avg >= 6.5) return '#5fa83c';
  if (avg >= 5.5) return '#c9a227';
  if (avg >= 4.5) return '#d77f33';
  return '#cf4b3e';
}

function lastName(name) {
  if (!name) return '';
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
}

// startXI'i grid (row:col) -> yuzde konuma yerlestirir.
function layout(startXI, side) {
  const rows = {};
  for (const p of startXI) (rows[p.row] ??= []).push(p);
  const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
  if (rowNums.length === 0) return [];
  const minRow = rowNums[0];
  const maxRow = rowNums[rowNums.length - 1];
  const span = Math.max(maxRow - minRow, 1);

  const out = [];
  for (const rn of rowNums) {
    const players = rows[rn].slice().sort((a, b) => a.col - b.col);
    const cols = players.map((p) => p.col);
    const minCol = Math.min(...cols);
    const colSpan = Math.max(Math.max(...cols) - minCol, 1);
    players.forEach((p) => {
      const x = players.length === 1 ? 50 : 10 + ((p.col - minCol) / colSpan) * 80;
      const depth = (rn - minRow) / span; // 0 = kaleci, 1 = en ileri
      const y = side === 'home' ? 6 + depth * 40 : 94 - depth * 40;
      out.push({ ...p, x, y });
    });
  }
  return out;
}

function RatingBadge({ data, small }) {
  if (!data || !data.count) return null;
  const color = ratingColor(data.average);
  return (
    <span
      className={`rate-badge ${small ? 'rate-badge--sm' : ''}`}
      style={{ background: color }}
      title={`${data.count} oy`}
    >
      {data.average.toFixed(1)}
    </span>
  );
}

function PlayerNode({ matchId, player, colors, average }) {
  const isGk = player.pos === 'G';
  const palette = isGk ? colors?.goalkeeper : colors?.player;
  const bg = palette?.primary ? `#${palette.primary}` : '#6b7280';
  const fg = palette?.number ? `#${palette.number}` : '#ffffff';
  return (
    <Link
      to={`/match/${matchId}/player/${player.id}`}
      className="player-node"
      style={{ left: `${player.x}%`, top: `${player.y}%` }}
      title={`${player.name} · ${player.posLabel}`}
    >
      <span className="player-node__dot" style={{ background: bg, color: fg }}>
        {player.number ?? ''}
        <RatingBadge data={average} small />
      </span>
      <span className="player-node__name">{lastName(player.name)}</span>
    </Link>
  );
}

function Bench({ matchId, team, averages }) {
  if (!team?.substitutes?.length) return null;
  return (
    <div className="bench">
      <div className="bench__head">
        {team.teamName} · yedekler
        {team.coach ? <span className="muted small"> · Tek. Dir. {team.coach}</span> : null}
      </div>
      <div className="bench__list">
        {team.substitutes.map((p) => (
          <Link key={p.id} to={`/match/${matchId}/player/${p.id}`} className="bench__row">
            <span className="bench__num num">{p.number ?? ''}</span>
            <span className="bench__name">{p.name}</span>
            <span className="bench__pos muted">{p.posLabel}</span>
            <RatingBadge data={averages[p.id]} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Pitch({ matchId, data, averages }) {
  const home = data?.home;
  const away = data?.away;
  const homeXI = home?.startXI ?? [];
  const awayXI = away?.startXI ?? [];

  if (homeXI.length === 0 && awayXI.length === 0) {
    return (
      <Empty>
        Bu maç için diziliş verisi henüz yok.
        <br />
        <span className="small">(Dizilişler genelde maça ~1 saat kala açıklanır.)</span>
      </Empty>
    );
  }

  const homePos = layout(homeXI, 'home');
  const awayPos = layout(awayXI, 'away');

  return (
    <div className="pitch-block">
      <div className="pitch-formations">
        <span>
          <strong>{home?.teamName}</strong> {home?.formation ? `· ${home.formation}` : ''}
        </span>
        <span>
          {away?.formation ? `${away.formation} · ` : ''}
          <strong>{away?.teamName}</strong>
        </span>
      </div>

      <div className="pitch">
        <div className="pitch__halfway" />
        <div className="pitch__circle" />
        <div className="pitch__box pitch__box--top" />
        <div className="pitch__box pitch__box--bottom" />
        {homePos.map((p) => (
          <PlayerNode
            key={p.id}
            matchId={matchId}
            player={p}
            colors={home?.colors}
            average={averages[p.id]}
          />
        ))}
        {awayPos.map((p) => (
          <PlayerNode
            key={p.id}
            matchId={matchId}
            player={p}
            colors={away?.colors}
            average={averages[p.id]}
          />
        ))}
      </div>

      <div className="bench-grid">
        <Bench matchId={matchId} team={home} averages={averages} />
        <Bench matchId={matchId} team={away} averages={averages} />
      </div>
    </div>
  );
}
