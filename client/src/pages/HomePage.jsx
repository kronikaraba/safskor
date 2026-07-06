import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import MatchList from '../components/MatchList.jsx';
import { Loading, Empty, ErrorBox } from '../components/ui.jsx';
import { todayStr, addDays, dateLabel, messageTime } from '../lib/format.js';
import { getLeaguePref, setLeaguePref, matchHasFav } from '../lib/prefs.js';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'live', label: 'Canlı' },
  { key: 'upcoming', label: 'Yaklaşan' },
  { key: 'finished', label: 'Bitmiş' },
];

// Gezinilebilir tarih penceresi: dün .. +7 gün. (Veri kaynağı yalnızca güncel
// günleri sağlar; ileri yön planlanmış maçlar için biraz açık bırakılır.)
const MIN_DATE = () => addDays(todayStr(), -1);
const MAX_DATE = () => addDays(todayStr(), 7);

function Section({ title, matches }) {
  if (!matches || matches.length === 0) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      <MatchList matches={matches} />
    </>
  );
}

/** Bir ISO tarihin yerel gün dizesi (YYYY-MM-DD) — seçili günle kıyas için. */
function localDateStr(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Adminin eklediği ileri tarihli maçlar. Tarih penceresi (+7 gün) dışında
 * kalabildikleri için seçili günden bağımsız ayrı bir bölümde duyurulur;
 * seçili günün listesinde zaten görünenler tekrarlanmaz.
 */
function SpecialMatches({ matches, currentDate }) {
  const list = (matches || []).filter((m) => localDateStr(m.utcDate) !== currentDate);
  if (list.length === 0) return null;
  return (
    <>
      <div className="section-title">Özel Maçlar</div>
      <div className="comp-group">
        {list.map((m) => (
          <Link key={m.id} to={`/match/${m.id}`} className="match-row">
            <div className="match-row__time">
              <span className="num">{messageTime(m.utcDate)}</span>
            </div>
            <div className="match-row__teams">
              <div className="team-line">
                <span className="team-line__name">{m.homeTeam?.name}</span>
              </div>
              <div className="team-line">
                <span className="team-line__name">{m.awayTeam?.name}</span>
              </div>
            </div>
            <div className="match-row__score num">
              <span className="s s--dim">{m.competition?.name || ''}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export default function HomePage() {
  const [date, setDate] = useState(todayStr());
  const [league, setLeague] = useState(getLeaguePref());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [favVersion, setFavVersion] = useState(0);
  const [specials, setSpecials] = useState([]);

  // Adminin eklediği ileri tarihli maçlar (tarih penceresinden bağımsız).
  useEffect(() => {
    api
      .get('/football/manual-upcoming')
      .then((res) => setSpecials(res.matches || []))
      .catch(() => {});
  }, []);

  // Favori değişince listeyi yeniden değerlendir.
  useEffect(() => {
    const h = () => setFavVersion((v) => v + 1);
    window.addEventListener('favchange', h);
    return () => window.removeEventListener('favchange', h);
  }, []);

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

  const changeLeague = (v) => {
    setLeague(v);
    setLeaguePref(v);
  };

  // Lig + arama + favori filtreleri; favori takımlı maçları öne alır.
  const applyFilters = useCallback(
    (arr) => {
      let list = arr || [];
      // Manuel maçların lig ID'si yok (competition.id = null) ve açılır listede
      // seçilemezler; lig filtresi onları elememeli.
      if (league) {
        list = list.filter(
          (m) => m.isManual || m.competition?.id == null || String(m.competition.id) === String(league)
        );
      }
      const q = search.trim().toLocaleLowerCase('tr');
      if (q) {
        list = list.filter(
          (m) =>
            (m.homeTeam?.name || '').toLocaleLowerCase('tr').includes(q) ||
            (m.awayTeam?.name || '').toLocaleLowerCase('tr').includes(q)
        );
      }
      if (onlyFav) list = list.filter(matchHasFav);
      // favori takımlı maçları öne al (kararlı sıralama)
      return [...list].sort((a, b) => (matchHasFav(b) ? 1 : 0) - (matchHasFav(a) ? 1 : 0));
    },
    // favVersion: favoriler değişince yeniden hesapla
    [league, search, onlyFav, favVersion]
  );

  const groups = useMemo(() => {
    if (!data) return null;
    return {
      live: applyFilters(data.live),
      upcoming: applyFilters(data.upcoming),
      finished: applyFilters(data.finished),
      other: applyFilters(data.other),
    };
  }, [data, applyFilters]);

  const total = groups
    ? groups.live.length + groups.upcoming.length + groups.finished.length + groups.other.length
    : 0;

  const canPrev = date > MIN_DATE();
  const canNext = date < MAX_DATE();

  return (
    <div className="page container">
      <div className="toolbar">
        <div className="date-nav">
          <button
            onClick={() => canPrev && setDate(addDays(date, -1))}
            disabled={!canPrev}
            aria-label="Önceki gün"
          >
            ‹
          </button>
          <span className="date-nav__label">{dateLabel(date)}</span>
          <button
            onClick={() => canNext && setDate(addDays(date, 1))}
            disabled={!canNext}
            aria-label="Sonraki gün"
          >
            ›
          </button>
        </div>
        {date !== todayStr() && (
          <button className="btn btn--sm" onClick={() => setDate(todayStr())}>
            Bugün
          </button>
        )}
        <div className="toolbar__spacer" />
        <input
          className="select"
          type="search"
          placeholder="Takım ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 160 }}
        />
        <button
          className={`btn btn--sm ${onlyFav ? 'btn--primary' : ''}`}
          onClick={() => setOnlyFav((v) => !v)}
          title="Yalnızca favori takımların maçları"
        >
          ⭐ Favoriler
        </button>
        <select className="select" value={league} onChange={(e) => changeLeague(e.target.value)}>
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

      {data?.apiDegraded && !loading && !error && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Canlı maç verileri şu an alınamıyor; yalnızca elle eklenen maçlar gösteriliyor.
        </p>
      )}

      {!loading && <SpecialMatches matches={specials} currentDate={date} />}

      {loading ? (
        <Loading text="Maçlar yükleniyor..." />
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : total === 0 ? (
        <Empty>
          {onlyFav
            ? 'Favori takımlarının bu tarihte maçı yok.'
            : search.trim()
              ? 'Aramaya uygun maç yok.'
              : 'Bu tarihte (veya seçili ligde) maç yok.'}
        </Empty>
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
