import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../lib/api.js';
import MatchList from '../components/MatchList.jsx';
import { Loading, Empty, ErrorBox } from '../components/ui.jsx';
import { todayStr, addDays, dateLabel } from '../lib/format.js';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'live', label: 'Canlı' },
  { key: 'upcoming', label: 'Yaklaşan' },
  { key: 'finished', label: 'Bitmiş' },
];

function Section({ title, matches }) {
  if (!matches || matches.length === 0) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      <MatchList matches={matches} />
    </>
  );
}

export default function HomePage() {
  const [date, setDate] = useState(todayStr());
  const [league, setLeague] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(
    async (showSpinner) => {
      if (showSpinner) setLoading(true);
      setError('');
      try {
        const res = await api.get(`/football/matches?date=${date}`);
        setData(res);
      } catch (e) {
        setError(e.message);
        setData(null);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [date]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Polling, API limitini (gunde 100 istek) korumak icin duruma gore ayarlanir:
  //  - Canli mac varsa 60 sn'de bir yenile (skorlar degisir).
  //  - Canli mac yoksa 5 dk'da bir (yalnizca yeni baslayan maclari yakalamak icin).
  const hasLive = (data?.live?.length ?? 0) > 0;
  useEffect(() => {
    const interval = hasLive ? 60000 : 300000;
    const id = setInterval(() => load(false), interval);
    return () => clearInterval(id);
  }, [load, hasLive]);

  // Lig filtresi secenekleri (cekilen maclardan turetilir, ekstra istek yok)
  const leagues = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    for (const k of ['live', 'upcoming', 'finished', 'other']) {
      for (const m of data[k] || []) {
        const c = m.competition;
        if (c?.id && !map.has(c.id)) map.set(c.id, { id: c.id, name: c.name, country: c.country });
      }
    }
    return [...map.values()].sort(
      (a, b) => (a.country || '').localeCompare(b.country || '') || a.name.localeCompare(b.name)
    );
  }, [data]);

  const groups = useMemo(() => {
    if (!data) return null;
    const byLeague = (arr) =>
      !league ? arr || [] : (arr || []).filter((m) => String(m.competition?.id) === String(league));
    return {
      live: byLeague(data.live),
      upcoming: byLeague(data.upcoming),
      finished: byLeague(data.finished),
      other: byLeague(data.other),
    };
  }, [data, league]);

  const total = groups
    ? groups.live.length + groups.upcoming.length + groups.finished.length + groups.other.length
    : 0;

  return (
    <div className="page container">
      <div className="toolbar">
        <div className="date-nav">
          <button onClick={() => setDate(addDays(date, -1))} aria-label="Önceki gün">
            ‹
          </button>
          <span className="date-nav__label">{dateLabel(date)}</span>
          <button onClick={() => setDate(addDays(date, 1))} aria-label="Sonraki gün">
            ›
          </button>
        </div>
        {date !== todayStr() && (
          <button className="btn btn--sm" onClick={() => setDate(todayStr())}>
            Bugün
          </button>
        )}
        <div className="toolbar__spacer" />
        <select className="select" value={league} onChange={(e) => setLeague(e.target.value)}>
          <option value="">Tüm ligler{leagues.length ? ` (${leagues.length})` : ''}</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.country ? `${l.country} · ` : ''}
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="tab-filter" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? 'is-active' : ''}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === 'live' && groups?.live?.length ? ` (${groups.live.length})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading text="Maçlar yükleniyor..." />
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : total === 0 ? (
        <Empty>Bu tarihte (veya seçili ligde) maç yok.</Empty>
      ) : filter === 'all' ? (
        <>
          <Section title="Canlı" matches={groups.live} />
          <Section title="Yaklaşan" matches={groups.upcoming} />
          <Section title="Bitmiş" matches={groups.finished} />
          <Section title="Diğer" matches={groups.other} />
        </>
      ) : groups[filter].length ? (
        <MatchList matches={groups[filter]} />
      ) : (
        <Empty>Bu kategoride maç yok.</Empty>
      )}
    </div>
  );
}
