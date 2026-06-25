export function RatingPill({ data }) {
  if (!data || !data.count) {
    return <span className="rating-pill rating-pill--none">—</span>;
  }
  return (
    <span className="rating-pill num">
      {data.average != null ? data.average.toFixed(1) : '—'}
      <span className="n">({data.count})</span>
    </span>
  );
}

export function RatingScale({ myScore, disabled, onPick }) {
  return (
    <div className="rating-scale">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={myScore === n ? 'is-mine' : ''}
          disabled={disabled}
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
