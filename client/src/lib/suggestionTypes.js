export const SUGGESTION_TYPES = [
  { key: 'degisiklik', label: 'Oyuncu değişikliği', icon: '🔁' },
  { key: 'taktik', label: 'Taktik', icon: '📋' },
  { key: 'dizilis', label: 'Diziliş', icon: '📐' },
  { key: 'genel', label: 'Genel', icon: '💬' },
];

export const SUGGESTION_TYPE_MAP = Object.fromEntries(
  SUGGESTION_TYPES.map((t) => [t.key, t])
);
