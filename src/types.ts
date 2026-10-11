// Sağlayıcıdan bağımsız, normalize edilmiş maç modeli.
// Her sağlayıcı (API-Football, demo, ileride eklenecekler) bu şekle dönüştürür.

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'HT' | 'FT' | 'POSTPONED';
export type Side = 'home' | 'away';

export interface Team {
  id: string;
  name: string;
  short: string;
  logo?: string;
  color?: string;
}

export interface PlayerStats {
  rating?: number;
  minutes?: number;
  goals?: number;
  assists?: number;
  shots?: number;
  passes?: number;
  yellow?: number;
  red?: number;
}

export interface Player {
  id: string;
  name: string;
  number?: number;
  pos?: 'G' | 'D' | 'M' | 'F';
  /** "satır:sütun" — API-Football grid formatı, saha çizimi için */
  grid?: string;
  stats?: PlayerStats;
}

export interface Lineup {
  formation?: string;
  coach?: string;
  coachPhoto?: string;
  startXI: Player[];
  subs: Player[];
}

export type EventType = 'goal' | 'own_goal' | 'penalty' | 'missed_penalty' | 'yellow' | 'red' | 'sub' | 'var';

export interface MatchEvent {
  id: string;
  minute: number;
  extra?: number;
  type: EventType;
  side: Side;
  player?: string;
  playerId?: string;
  /** Golde asist yapan / değişiklikte oyuna giren */
  related?: string;
  relatedId?: string;
  detail?: string;
}

export interface StatLine {
  key: string;
  label: string;
  home: number;
  away: number;
  unit?: '%';
}

export interface MatchSummary {
  id: string;
  competition: { id?: string; name: string; country?: string; logo?: string; round?: string };
  status: MatchStatus;
  minute: number | null;
  /** Uzatma dakikası (45+2 → minute 45, extra 2) */
  extra?: number | null;
  kickoff: string;
  venue?: string;
  home: Team;
  away: Team;
  score: { home: number; away: number };
}

export interface Match extends MatchSummary {
  events: MatchEvent[];
  lineups?: { home: Lineup; away: Lineup };
  stats: StatLine[];
}

/** Modüler futbol veri sağlayıcısı arayüzü. Yeni bir API eklemek için bunu uygulayın. */
export interface StandingRow {
  rank: number;
  team: Team;
  points: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDiff: number;
  /** Son maçların sonuçları (API-Football biçimi, ör. "WDLWW") */
  form?: string;
  /** Bölge açıklaması (ör. "Promotion - Champions League", "Relegation") */
  description?: string;
}

export interface Standings {
  league: { id: string; name: string; country?: string; logo?: string; season: number };
  rows: StandingRow[];
  updatedAt: string;
}

export interface TeamFixtures {
  next: MatchSummary | null;
  last: MatchSummary | null;
}

export interface FootballProvider {
  readonly name: string;
  readonly isDemo: boolean;
  listMatches(): Promise<MatchSummary[]>;
  getMatch(id: string): Promise<Match | null>;
  /**
   * İsteğe bağlı: oynanan tüm maçları (skor, dakika, olaylar; kadro/istatistik yok) tek istekte döndürür.
   * null: şu an kullanılamıyor (demo modu, kota vb.).
   */
  liveMatches?(): Promise<Match[] | null>;
  /** İsteğe bağlı: takımın bir sonraki ve son maçı (bugün listede olmayan maçlar için). null: şu an kullanılamıyor */
  teamFixtures?(teamId: string): Promise<TeamFixtures | null>;
  /** İsteğe bağlı: yarının maçları (bugünkü listeyle aynı lig/takım filtresi). null: şu an kullanılamıyor */
  tomorrowMatches?(): Promise<MatchSummary[] | null>;
  /** İsteğe bağlı: ligin güncel puan durumu. null: şu an kullanılamıyor */
  standings?(leagueId: string): Promise<Standings | null>;
  /** Önerilen yoklama aralığı (ms); demo için kısa, gerçek API için kota dostu */
  readonly pollMs: { list: number; detail: number; live?: number };
}
