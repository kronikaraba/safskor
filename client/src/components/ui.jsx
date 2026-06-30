import { mediaUrl } from '../lib/api.js';

export function Loading({ text = 'Yükleniyor...' }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span className="muted" style={{ marginLeft: 8 }}>
        {text}
      </span>
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
      src={mediaUrl(src)}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
    />
  );
}
