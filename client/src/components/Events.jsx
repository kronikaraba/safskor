import { Empty } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function EventIcon({ type }) {
  if (type === 'goal') return <span aria-hidden>⚽</span>;
  if (type === 'yellow_card') return <span className="card-mark card-mark--y" aria-hidden />;
  if (type === 'red_card') return <span className="card-mark card-mark--r" aria-hidden />;
  if (type === 'substitution') return <span aria-hidden>↔</span>;
  return <span aria-hidden>•</span>;
}

function labelFor(ev) {
  if (ev.type === 'goal') {
    if (ev.detail === 'PENALTY') return 'Gol (penaltı)';
    if (ev.detail === 'OWN') return 'Kendi kalesine gol';
    return 'Gol';
  }
  if (ev.type === 'yellow_card') return 'Sarı kart';
  if (ev.type === 'red_card') return 'Kırmızı kart';
  if (ev.type === 'substitution') return 'Oyuncu değişikliği';
  return '';
}

export default function Events({ events }) {
  const { user } = useAuth();
  if (!events || events.length === 0) {
    return (
      <Empty>
        Bu maç için olay verisi bulunamadı.
        {user?.role === 'admin' && (
          <>
            <br />
            <span className="small">
              (Ücretsiz API katmanında gol/kart/değişiklik detayları her zaman sağlanmaz.)
            </span>
          </>
        )}
      </Empty>
    );
  }

  return (
    <div className="panel">
      <div className="events" style={{ padding: '4px 12px' }}>
        {events.map((ev, i) => (
          <div className="event" key={i}>
            <div className="event__minute num">{ev.minute != null ? `${ev.minute}'` : '—'}</div>
            <div className="event__icon">
              <EventIcon type={ev.type} />
            </div>
            <div>
              <span className="event__player">{ev.player || labelFor(ev)}</span>
              {ev.type === 'goal' && ev.assist && (
                <span className="event__sub"> · asist: {ev.assist}</span>
              )}
              {ev.type === 'substitution' && ev.playerOut && (
                <span className="event__sub"> · çıkan: {ev.playerOut}</span>
              )}
              <div className="event__sub">
                {labelFor(ev)}
                {ev.teamName ? ` · ${ev.teamName}` : ''}
                {ev.type === 'goal' && ev.score ? ` · ${ev.score.home}–${ev.score.away}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
