const GUNLER = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

export function dateLabel(dateStr) {
  const today = todayStr();
  if (dateStr === today) return 'Bugün';
  if (dateStr === addDays(today, -1)) return 'Dün';
  if (dateStr === addDays(today, 1)) return 'Yarın';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${d} ${AYLAR[m - 1]}, ${GUNLER[dt.getDay()]}`;
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}, ${formatTime(iso)}`;
}

export function messageTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso);
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${formatTime(iso)}`;
}

export function playerAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}
