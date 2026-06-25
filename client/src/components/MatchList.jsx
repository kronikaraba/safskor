import MatchRow from './MatchRow.jsx';
import { Crest } from './ui.jsx';

/** Maclari lige gore gruplar (gelis sirasini korur). */
export default function MatchList({ matches }) {
  const groups = [];
  const indexByKey = {};
  for (const m of matches) {
    const key = m.competition?.id ?? 'other';
    if (!(key in indexByKey)) {
      indexByKey[key] = groups.length;
      groups.push({ comp: m.competition, matches: [] });
    }
    groups[indexByKey[key]].matches.push(m);
  }

  return (
    <div>
      {groups.map((g, i) => (
        <div className="comp-group" key={g.comp?.id ?? `other-${i}`}>
          <div className="comp-group__head">
            <Crest src={g.comp?.emblem} alt="" size={16} className="comp-group__emblem" />
            <span>{g.comp?.name || 'Diğer'}</span>
          </div>
          {g.matches.map((m) => (
            <MatchRow key={m.id} match={m} />
          ))}
        </div>
      ))}
    </div>
  );
}
