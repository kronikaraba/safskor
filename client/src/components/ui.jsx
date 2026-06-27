import { useEffect, useState } from 'react';

export function Loading({ text = 'Yükleniyor...', slowAfter = 6000 }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowAfter) return undefined;
    const t = setTimeout(() => setSlow(true), slowAfter);
    return () => clearTimeout(t);
  }, [slowAfter]);

  return (
    <div className="loading">
      <div>
        <span className="spinner" />
        <span className="muted" style={{ marginLeft: 8 }}>
          {text}
        </span>
      </div>
      {slow && (
        <div className="muted small" style={{ marginTop: 10 }}>
          Sunucu uykudan uyanıyor olabilir; ilk açılış 30 saniye kadar sürebilir.
        </div>
      )}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ children }) {
  return <div className="error-box">{children}</div>;
}

export function Crest({ src, alt = '', size = 16, className = 'crest' }) {
  if (!src) {
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: 'inline-block' }}
        aria-hidden
      />
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
    />
  );
}
