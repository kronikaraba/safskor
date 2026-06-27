export const SUGGESTION_TYPES = [
  { key: 'degisiklik', label: 'Oyuncu değişikliği', icon: '🔁' },
  { key: 'taktik', label: 'Taktik', icon: '📋' },
  { key: 'dizilis', label: 'Diziliş', icon: '📐' },
];

export const SUGGESTION_TYPE_MAP = Object.fromEntries(
  SUGGESTION_TYPES.map((t) => [t.key, t])
);

// Taktik önerileri (elle yazmak yerine seçilir)
export const TACTIC_OPTIONS = [
  'Pres yükselt',
  'Geri çekil, savunmaya ağırlık ver',
  'Kanatlardan oyna',
  'Topa daha çok sahip ol',
  'Uzun toplarla hızlı çık',
  'Orta sahayı sıklaştır',
  'Hücum baskısını artır',
  'Oyunu yavaşlat, kontrolü koru',
  'Daha agresif çıkış yap',
  'Duran toplara odaklan',
];

// Diziliş/formasyon önerileri
export const FORMATION_OPTIONS = [
  '4-4-2',
  '4-3-3',
  '4-2-3-1',
  '4-1-4-1',
  '3-5-2',
  '3-4-3',
  '5-3-2',
  '5-4-1',
];
