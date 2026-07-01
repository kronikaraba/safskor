// localStorage tabanlı kullanıcı tercihleri: favori takımlar ve lig filtresi.
// (Sunucu/kota gerektirmez; tarayıcıda saklanır.)

const FAV_KEY = 'safskor_fav_teams';
const LEAGUE_KEY = 'safskor_league';

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function getFavTeams() {
  const list = read(FAV_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function isFavTeam(id) {
  if (id == null) return false;
  return getFavTeams().some((t) => String(t.id) === String(id));
}

/** Favori takımı ekler/çıkarır. team = { id, name }. Değişince 'favchange' olayı yayınlar. */
export function toggleFavTeam(team) {
  if (!team || team.id == null) return getFavTeams();
  const list = getFavTeams();
  const i = list.findIndex((t) => String(t.id) === String(team.id));
  if (i >= 0) list.splice(i, 1);
  else list.push({ id: team.id, name: team.name ?? '' });
  localStorage.setItem(FAV_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event('favchange'));
  return list;
}

/** Bir maçta favori takım var mı? */
export function matchHasFav(match) {
  return isFavTeam(match?.homeTeam?.id) || isFavTeam(match?.awayTeam?.id);
}

export function getLeaguePref() {
  return localStorage.getItem(LEAGUE_KEY) || '';
}

export function setLeaguePref(value) {
  if (value) localStorage.setItem(LEAGUE_KEY, value);
  else localStorage.removeItem(LEAGUE_KEY);
}
