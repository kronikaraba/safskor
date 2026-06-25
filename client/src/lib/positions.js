const MAP = {
  Goalkeeper: 'Kaleci',
  Defence: 'Defans',
  'Centre-Back': 'Stoper',
  'Left-Back': 'Sol Bek',
  'Right-Back': 'Sag Bek',
  'Left Midfield': 'Sol Orta Saha',
  'Right Midfield': 'Sag Orta Saha',
  Midfield: 'Orta Saha',
  'Defensive Midfield': 'On Libero',
  'Central Midfield': 'Merkez Orta Saha',
  'Attacking Midfield': 'Ofansif Orta Saha',
  'Left Winger': 'Sol Kanat',
  'Right Winger': 'Sag Kanat',
  Offence: 'Forvet',
  'Centre-Forward': 'Santrfor',
  Striker: 'Forvet',
};

export function translatePosition(pos) {
  if (!pos) return '';
  return MAP[pos] || pos;
}
