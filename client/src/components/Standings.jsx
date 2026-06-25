import { Crest, Empty } from './ui.jsx';

export default function Standings({ standings, highlightTeamIds = [] }) {
  if (!standings || !standings.groups || standings.groups.length === 0) {
    return <Empty>Puan durumu bulunamadı.</Empty>;
  }
  const hi = new Set(highlightTeamIds.filter(Boolean).map(Number));

  return (
    <div className="detail-grid">
      {standings.groups.map((g, gi) => (
        <div className="panel" key={gi}>
          {g.group && <div className="panel__head">{g.group}</div>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="pos">#</th>
                  <th className="team">Takım</th>
                  <th title="Oynanan">O</th>
                  <th title="Galibiyet">G</th>
                  <th title="Beraberlik">B</th>
                  <th title="Mağlubiyet">M</th>
                  <th title="Averaj">AV</th>
                  <th className="pts" title="Puan">P</th>
                </tr>
              </thead>
              <tbody>
                {g.table.map((row) => (
                  <tr key={row.teamId} className={hi.has(Number(row.teamId)) ? 'is-highlight' : ''}>
                    <td className="pos num">{row.position}</td>
                    <td className="team">
                      <span className="team-cell">
                        <Crest src={row.crest} size={16} />
                        {row.teamName}
                      </span>
                    </td>
                    <td className="num">{row.playedGames}</td>
                    <td className="num">{row.won}</td>
                    <td className="num">{row.draw}</td>
                    <td className="num">{row.lost}</td>
                    <td className="num">{row.goalDifference}</td>
                    <td className="num pts">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
