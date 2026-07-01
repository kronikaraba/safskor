// SafSkor Bot mesaj şablonları. Her olay türü için birden çok Türkçe şablon;
// rastgele seçilir ki tekdüze durmasın. {değişken} yer tutucuları doldurulur.

const TEMPLATES = {
  start: [
    '🏟️ Maç başladı! {home} - {away}',
    '🔵 Düdük çaldı, {home} - {away} başladı!',
    '⚽ {home} ile {away} sahada, maç başlıyor!',
  ],
  halftime: [
    '⏸️ İlk yarı bitti. {home} {sh}-{sa} {away}',
    '☕ Devre arası: {home} {sh}-{sa} {away}',
  ],
  finish: [
    '⏱️ Maç bitti: {home} {sh}-{sa} {away}',
    '🔚 Düdük çaldı! {home} {sh}-{sa} {away}',
  ],
  goal: [
    "⚽ GOOOL! {min}' {player} ({team}) — {score}",
    "⚽ {min}' {player} ağları sarstı! {team} — {score}",
    "⚽ {player} golü buldu! {min}' — {score}",
  ],
  penalty: [
    "⚽ Penaltı golü! {min}' {player} ({team}) — {score}",
    "🎯 {player} penaltıdan attı! {min}' — {score}",
  ],
  own_goal: [
    "😬 Kendi kalesine! {min}' {player} ({team}) — {score}",
    "⚽ Talihsiz gol, {player} kendi ağlarına. {min}' — {score}",
  ],
  yellow_card: [
    "🟨 {min}' {player} ({team}) sarı kart gördü.",
    "🟨 Sarı kart: {player} — {min}'",
  ],
  red_card: [
    "🟥 KIRMIZI KART! {min}' {player} ({team}) oyun dışı!",
    "🟥 {player} kırmızı gördü, {team} eksik kaldı! {min}'",
  ],
  substitution: [
    "🔄 {min}' Değişiklik ({team}): {player} oyuna girdi.",
    "🔄 {player} sahaya adım attı. {min}' — {team}",
  ],
};

export function renderTemplate(type, vars) {
  const list = TEMPLATES[type];
  if (!list || list.length === 0) return null;
  const tpl = list[Math.floor(Math.random() * list.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}
