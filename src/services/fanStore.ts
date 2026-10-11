import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Match, Side } from '../types.js';

export const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1', '4-4-1-1', '3-4-2-1'];
export const STYLES = ['Hücum', 'Dengeli', 'Savunma', 'Kontra atak', 'Yüksek pres', 'Top hakimiyeti'];

/** Sohbette ve sıralamada takma adın yanında görünen favori takım rozeti */
export interface TeamBadge {
  id: string;
  name: string;
  short: string;
  logo?: string;
  color?: string;
}

/** Bir maç olayına ya da oyuncuya yazılan yorum. target: 'e:<olayId>' veya 'p:<oyuncuId>' */
export interface Comment {
  id: number;
  matchId: string;
  target: string;
  /** Yazarın herkese açık kimliği (gerçek tarayıcı kimliği asla istemcilere gönderilmez) */
  uid: string;
  nick: string;
  team: TeamBadge | null;
  text: string;
  minute: string | null;
  createdAt: number;
}

export interface ChatMessage {
  id: number;
  matchId: string;
  /** Yazarın herkese açık kimliği; sistem mesajında null */
  uid: string | null;
  nick: string;
  text: string;
  kind: 'user' | 'system';
  createdAt: number;
  likes: number;
  team?: TeamBadge | null;
  /** Mesaj yazıldığında maçın dakikası ("23'", "45+2'", "İY", "MS", "Maç öncesi") */
  minute?: string | null;
}

/** Herkese görünen kullanıcı bilgisi (özel mesajlar için) */
export interface PublicUser {
  uid: string;
  nick: string;
  team: TeamBadge | null;
}

export interface DirectMessage {
  id: number;
  /** gönderen ve alıcının herkese açık kimlikleri */
  from: string;
  to: string;
  text: string;
  createdAt: number;
}

export interface PredictionInput {
  home: number;
  away: number;
  xiSide?: Side;
  xi?: string[];
}

const DAY = 86_400_000;
/** Haftalık sıralamanın anahtarı: maçın oynandığı haftanın Pazartesi'si (Türkiye saati, UTC+3) */
export function weekKey(ts: number): string {
  const tr = ts + 3 * 3_600_000;
  const day = Math.floor(tr / DAY);
  const monday = day - ((new Date(day * DAY).getUTCDay() + 6) % 7);
  return new Date(monday * DAY).toISOString().slice(0, 10);
}
/** Bir haftanın bitişi (sonraki Pazartesi 00:00 TSİ) */
export function weekEnd(key: string): number {
  return Date.parse(`${key}T00:00:00+03:00`) + 7 * DAY;
}

export class FanStore {
  private db: Database.Database;
  private secret: string;
  private pubCache = new Map<string, string>();

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, user_id TEXT, nick TEXT NOT NULL,
        text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_match ON chat(match_id, id);
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, target TEXT NOT NULL, user_id TEXT NOT NULL,
        nick TEXT NOT NULL, team TEXT, text TEXT NOT NULL, minute TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS comments_target ON comments(match_id, target, id);
      CREATE TABLE IF NOT EXISTS ratings (
        match_id TEXT NOT NULL, player_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, PRIMARY KEY (match_id, player_id, user_id));
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, question TEXT NOT NULL, options TEXT NOT NULL,
        kind TEXT NOT NULL, auto_key TEXT, created_by TEXT, nick TEXT, created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS polls_auto ON polls(match_id, auto_key);
      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id INTEGER NOT NULL, user_id TEXT NOT NULL, option_idx INTEGER NOT NULL, PRIMARY KEY (poll_id, user_id));
      CREATE TABLE IF NOT EXISTS tactics (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, side TEXT NOT NULL, user_id TEXT NOT NULL,
        nick TEXT NOT NULL, formation TEXT NOT NULL, style TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, UNIQUE (match_id, side, user_id));
      CREATE TABLE IF NOT EXISTS tactic_likes (tactic_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (tactic_id, user_id));
      CREATE TABLE IF NOT EXISTS sub_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, side TEXT NOT NULL,
        out_id TEXT NOT NULL, out_name TEXT NOT NULL, in_id TEXT NOT NULL, in_name TEXT NOT NULL,
        created_by TEXT NOT NULL, nick TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE (match_id, side, out_id, in_id));
      CREATE TABLE IF NOT EXISTS sub_votes (request_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (request_id, user_id));
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL, logo TEXT, color TEXT, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY, nick TEXT NOT NULL, team_id TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS predictions (
        match_id TEXT NOT NULL, user_id TEXT NOT NULL, nick TEXT NOT NULL, week TEXT NOT NULL,
        home INTEGER NOT NULL, away INTEGER NOT NULL, xi_side TEXT, xi TEXT,
        points INTEGER, exact INTEGER, result_ok INTEGER, xi_hits INTEGER, scored_at INTEGER,
        updated_at INTEGER NOT NULL, PRIMARY KEY (match_id, user_id));
      CREATE INDEX IF NOT EXISTS predictions_week ON predictions(week, user_id);
      CREATE TABLE IF NOT EXISTS chat_likes (chat_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (chat_id, user_id));
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY, pub_id TEXT NOT NULL UNIQUE, nick TEXT NOT NULL, team_id TEXT, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, text TEXT NOT NULL,
        created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS dms_pair ON dms(from_id, to_id, id);
      CREATE INDEX IF NOT EXISTS dms_unread ON dms(to_id, read);
      CREATE TABLE IF NOT EXISTS dm_blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (user_id, blocked_id));
      CREATE TABLE IF NOT EXISTS accounts (
        phone TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, login_at INTEGER, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
    `);
    // herkese açık kimlikleri türetmek için sunucuya özel gizli anahtar (yeniden başlatmada değişmesin diye veritabanında)
    const saved = this.db.prepare("SELECT value FROM meta WHERE key = 'id_secret'").get() as any;
    this.secret = process.env.ID_SECRET || saved?.value || crypto.randomBytes(32).toString('hex');
    if (!process.env.ID_SECRET && !saved) this.db.prepare("INSERT INTO meta (key, value) VALUES ('id_secret', ?)").run(this.secret);
    // eski veritabanlarına yeni sütunlar
    const cols = new Set((this.db.prepare('PRAGMA table_info(chat)').all() as any[]).map((c) => c.name));
    if (!cols.has('team')) this.db.exec('ALTER TABLE chat ADD COLUMN team TEXT');
    if (!cols.has('minute')) this.db.exec('ALTER TABLE chat ADD COLUMN minute TEXT');
    // yalnızca "Maçı kim kazanır?" ve "Hakem yönetimi" anketleri kalır: kaldırılan gol anketi ve kullanıcı anketlerini sil
    const dropped = "SELECT id FROM polls WHERE kind = 'user' OR auto_key NOT IN ('winner', 'referee')";
    this.db.exec(`DELETE FROM poll_votes WHERE poll_id IN (${dropped}); DELETE FROM polls WHERE id IN (${dropped});`);
  }

  // ------------------------------------------------------------------ herkese açık kimlik

  /**
   * Tarayıcı kimliği bir parola gibidir (bilen herkes o kullanıcı olarak bağlanabilir), bu yüzden istemcilere
   * hiçbir zaman gönderilmez. Bunun yerine ondan türetilen, geri çevrilemeyen kısa bir kimlik kullanılır.
   */
  pubId(userId: string): string {
    let id = this.pubCache.get(userId);
    if (!id) {
      id = 'u' + crypto.createHmac('sha256', this.secret).update(userId).digest('base64url').slice(0, 15);
      if (this.pubCache.size > 50_000) this.pubCache.clear();
      this.pubCache.set(userId, id);
    }
    return id;
  }

  // ------------------------------------------------------------------ takımlar ve profil

  /** Fikstürlerde görülen takımları kaydeder (favori takım listesi bunlardan oluşur) */
  upsertTeams(teams: TeamBadge[]) {
    const stmt = this.db.prepare(
      `INSERT INTO teams (id, name, short, logo, color, seen_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, short = excluded.short,
         logo = COALESCE(excluded.logo, teams.logo), color = COALESCE(excluded.color, teams.color), seen_at = excluded.seen_at`,
    );
    const now = Date.now();
    for (const t of teams) stmt.run(t.id, t.name, t.short, t.logo ?? null, t.color ?? null, now);
  }

  teams(): TeamBadge[] {
    return (this.db.prepare('SELECT id, name, short, logo, color FROM teams ORDER BY name COLLATE NOCASE').all() as any[]).map(rowTeam);
  }

  team(id: string): TeamBadge | null {
    const r = this.db.prepare('SELECT id, name, short, logo, color FROM teams WHERE id = ?').get(id) as any;
    return r ? rowTeam(r) : null;
  }

  profile(userId: string): { nick: string; team: TeamBadge | null } | null {
    const r = this.db.prepare('SELECT nick, team_id FROM profiles WHERE user_id = ?').get(userId) as any;
    return r ? { nick: r.nick, team: r.team_id ? this.team(r.team_id) : null } : null;
  }

  /** Seçilebilir listede olmayan eski favori takımları temizler */
  keepProfileTeams(ids: string[]) {
    this.db.prepare(`UPDATE profiles SET team_id = NULL WHERE team_id IS NOT NULL AND team_id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }

  saveProfile(userId: string, nick: string, teamId: string | null) {
    this.db
      .prepare(
        `INSERT INTO profiles (user_id, nick, team_id, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET nick = excluded.nick, team_id = excluded.team_id, updated_at = excluded.updated_at`,
      )
      .run(userId, nick, teamId, Date.now());
  }

  // ------------------------------------------------------------------ skor tahmini

  /** Tahmini kaydeder/günceller (kilit kontrolü çağıran tarafta: maç başlamadan) */
  setPrediction(matchId: string, kickoff: number, userId: string, nick: string, p: PredictionInput) {
    this.db
      .prepare(
        `INSERT INTO predictions (match_id, user_id, nick, week, home, away, xi_side, xi, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(match_id, user_id) DO UPDATE SET nick = excluded.nick, home = excluded.home, away = excluded.away,
           xi_side = excluded.xi_side, xi = excluded.xi, updated_at = excluded.updated_at`,
      )
      .run(matchId, userId, nick, weekKey(kickoff), p.home, p.away, p.xi?.length ? p.xiSide : null, p.xi?.length ? JSON.stringify(p.xi) : null, Date.now());
  }

  /** Maç bittiğinde puanlanmamış tahminleri puanlar; tekrar çağrılması güvenlidir. Puanlanan kullanıcıları döndürür. */
  scorePredictions(match: Match): string[] {
    if (match.status !== 'FT') return [];
    const rows = this.db.prepare('SELECT user_id, home, away, xi_side, xi FROM predictions WHERE match_id = ? AND points IS NULL').all(match.id) as any[];
    if (!rows.length) return [];
    const sign = (h: number, a: number) => Math.sign(h - a);
    const update = this.db.prepare('UPDATE predictions SET points = ?, exact = ?, result_ok = ?, xi_hits = ?, scored_at = ? WHERE match_id = ? AND user_id = ? AND points IS NULL');
    const now = Date.now();
    for (const r of rows) {
      const exact = r.home === match.score.home && r.away === match.score.away ? 1 : 0;
      const result = sign(r.home, r.away) === sign(match.score.home, match.score.away) ? 1 : 0;
      let hits = 0;
      if (r.xi && r.xi_side && match.lineups) {
        const starters = new Set(match.lineups[r.xi_side as Side].startXI.map((p) => p.id));
        hits = (JSON.parse(r.xi) as string[]).filter((id) => starters.has(id)).length;
      }
      update.run(exact * 3 + (exact ? 0 : result) + hits, exact, result, hits, now, match.id, r.user_id);
    }
    return rows.map((r) => r.user_id);
  }

  /** Puanlanmayı bekleyen tahmini olan maçlar */
  unscoredMatchIds(): string[] {
    return (this.db.prepare('SELECT DISTINCT match_id FROM predictions WHERE points IS NULL').all() as any[]).map((r) => r.match_id);
  }

  /** Maçtaki tahminlerin özeti: kaç kişi, en çok tahmin edilen skorlar, 1/X/2 dağılımı */
  predictionStats(matchId: string) {
    const rows = this.db.prepare('SELECT home, away, COUNT(*) c FROM predictions WHERE match_id = ? GROUP BY home, away ORDER BY c DESC').all(matchId) as any[];
    const total = rows.reduce((a, r) => a + r.c, 0);
    const result = { home: 0, draw: 0, away: 0 };
    for (const r of rows) result[r.home > r.away ? 'home' : r.home < r.away ? 'away' : 'draw'] += r.c;
    return { total, top: rows.slice(0, 3).map((r) => ({ home: r.home, away: r.away, count: r.c })), result };
  }

  /** Haftalık sıralama (puan, sonra tam isabet sayısı). viewer: kendi satırını işaretlemek için */
  leaderboard(week: string, viewer: string, limit = 50) {
    const rows = (
      this.db
        .prepare(
          `SELECT p.user_id, COALESCE(pr.nick, MAX(p.nick)) nick, pr.team_id,
             COALESCE(SUM(p.points), 0) points, COALESCE(SUM(p.exact), 0) exact, COUNT(*) n
           FROM predictions p LEFT JOIN profiles pr ON pr.user_id = p.user_id
           WHERE p.week = ? GROUP BY p.user_id ORDER BY points DESC, exact DESC, n ASC, MIN(p.updated_at) ASC`,
        )
        .all(week) as any[]
    ).map((r, i, arr) => ({ ...r, rank: i && arr[i - 1].points === r.points && arr[i - 1].exact === r.exact ? -1 : i + 1 }));
    // eşit puan ve isabette aynı sıra
    for (let i = 0; i < rows.length; i++) if (rows[i].rank === -1) rows[i].rank = rows[i - 1].rank;
    const out = (r: any) => ({ rank: r.rank, nick: r.nick, team: r.team_id ? this.team(r.team_id) : null, points: r.points, exact: r.exact, predictions: r.n, me: r.user_id === viewer });
    const top = rows.slice(0, limit).map(out);
    const mineIdx = rows.findIndex((r) => r.user_id === viewer);
    return { week, endsAt: weekEnd(week), players: rows.length, rows: top, me: mineIdx >= limit ? out(rows[mineIdx]) : null };
  }

  // ------------------------------------------------------------------ sohbet

  addChat(matchId: string, userId: string | null, nick: string, text: string, kind: 'user' | 'system' = 'user', team: TeamBadge | null = null, minute: string | null = null): ChatMessage {
    const createdAt = Date.now();
    const info = this.db
      .prepare('INSERT INTO chat (match_id, user_id, nick, text, kind, created_at, team, minute) VALUES (?,?,?,?,?,?,?,?)')
      .run(matchId, userId, nick, text, kind, createdAt, team ? JSON.stringify(team) : null, minute);
    return { id: Number(info.lastInsertRowid), matchId, uid: userId ? this.pubId(userId) : null, nick, text, kind, createdAt, likes: 0, team, minute };
  }

  chatHistory(matchId: string, limit = 60): ChatMessage[] {
    return (
      this.db
        .prepare(
          `SELECT c.id, c.match_id, c.user_id, c.nick, c.text, c.kind, c.created_at, c.team, c.minute,
             (SELECT COUNT(*) FROM chat_likes l WHERE l.chat_id = c.id) likes
           FROM chat c WHERE c.match_id = ? ORDER BY c.id DESC LIMIT ?`,
        )
        .all(matchId, limit) as any[]
    )
      .reverse()
      .map((r) => ({
        id: r.id, matchId: r.match_id, uid: r.user_id ? this.pubId(r.user_id) : null, nick: r.nick, text: r.text, kind: r.kind,
        createdAt: r.created_at, likes: r.likes, team: r.team ? JSON.parse(r.team) : null, minute: r.minute ?? null,
      }));
  }

  chatMessage(id: number): { matchId: string; userId: string | null; kind: string } | null {
    const r = this.db.prepare('SELECT match_id, user_id, kind FROM chat WHERE id = ?').get(id) as any;
    return r ? { matchId: r.match_id, userId: r.user_id, kind: r.kind } : null;
  }

  /** Beğeniyi açıp kapatır; yeni durum ve toplam beğeni sayısı döner */
  toggleChatLike(chatId: number, userId: string): { liked: boolean; likes: number } {
    const del = this.db.prepare('DELETE FROM chat_likes WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
    if (!del.changes) this.db.prepare('INSERT INTO chat_likes (chat_id, user_id) VALUES (?,?)').run(chatId, userId);
    const { c } = this.db.prepare('SELECT COUNT(*) c FROM chat_likes WHERE chat_id = ?').get(chatId) as any;
    return { liked: !del.changes, likes: c };
  }

  /** Kullanıcının bu maçın sohbetinde beğendiği mesajlar */
  chatLiked(matchId: string, userId: string): number[] {
    return (
      this.db.prepare('SELECT l.chat_id FROM chat_likes l JOIN chat c ON c.id = l.chat_id WHERE c.match_id = ? AND l.user_id = ?').all(matchId, userId) as any[]
    ).map((r) => r.chat_id);
  }

  // ------------------------------------------------------------------ olay ve oyuncu yorumları

  addComment(matchId: string, target: string, userId: string, nick: string, team: TeamBadge | null, text: string, minute: string | null): Comment {
    const createdAt = Date.now();
    const info = this.db
      .prepare('INSERT INTO comments (match_id, target, user_id, nick, team, text, minute, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(matchId, target, userId, nick, team ? JSON.stringify(team) : null, text, minute, createdAt);
    return { id: Number(info.lastInsertRowid), matchId, target, uid: this.pubId(userId), nick, team, text, minute, createdAt };
  }

  comments(matchId: string, target: string, limit = 100): Comment[] {
    return (
      this.db
        .prepare('SELECT * FROM comments WHERE match_id = ? AND target = ? ORDER BY id DESC LIMIT ?')
        .all(matchId, target, limit) as any[]
    )
      .reverse()
      .map((r) => ({ id: r.id, matchId: r.match_id, target: r.target, uid: this.pubId(r.user_id), nick: r.nick, team: r.team ? JSON.parse(r.team) : null, text: r.text, minute: r.minute ?? null, createdAt: r.created_at }));
  }

  // ------------------------------------------------------------------ özel mesajlar

  /** Bağlanan kullanıcıyı herkese açık kimliğiyle kaydeder (mesaj alabilmesi için) */
  // ------------------------------------------------------------------ üyelik (telefon + isim + PIN; SMS doğrulaması sonra eklenecek)

  /** Bu tarayıcı kimliğine bağlı hesap (telefon maskeli) */
  account(userId: string): { phone: string; name: string } | null {
    const r = this.db.prepare('SELECT phone, name FROM accounts WHERE user_id = ?').get(userId) as any;
    return r ? { phone: maskPhone(r.phone), name: r.name } : null;
  }

  /** Yeni hesap: mevcut anonim kimlik hesaba bağlanır, böylece eski veriler korunur */
  register(userId: string, phone: string, name: string, pin: string): 'ok' | 'phone_taken' | 'has_account' {
    if (this.db.prepare('SELECT 1 FROM accounts WHERE user_id = ?').get(userId)) return 'has_account';
    if (this.db.prepare('SELECT 1 FROM accounts WHERE phone = ?').get(phone)) return 'phone_taken';
    this.db.prepare('INSERT INTO accounts (phone, user_id, name, pin_hash, created_at) VALUES (?,?,?,?,?)').run(phone, userId, name, hashPin(pin), Date.now());
    return 'ok';
  }

  /** Telefon + PIN ile giriş; 5 hatalı denemede numara 15 dakika kilitlenir */
  login(phone: string, pin: string): { userId: string; name: string } | 'wrong' | 'locked' {
    const r = this.db.prepare('SELECT * FROM accounts WHERE phone = ?').get(phone) as any;
    if (!r) return 'wrong';
    const now = Date.now();
    if (r.locked_until > now) return 'locked';
    if (!checkPin(pin, r.pin_hash)) {
      const fails = r.fails + 1;
      this.db.prepare('UPDATE accounts SET fails = ?, locked_until = ? WHERE phone = ?').run(fails >= 5 ? 0 : fails, fails >= 5 ? now + 15 * 60_000 : 0, phone);
      return fails >= 5 ? 'locked' : 'wrong';
    }
    this.db.prepare('UPDATE accounts SET fails = 0, locked_until = 0, login_at = ? WHERE phone = ?').run(now, phone);
    return { userId: r.user_id, name: r.name };
  }

  renameAccount(userId: string, name: string) {
    this.db.prepare('UPDATE accounts SET name = ? WHERE user_id = ?').run(name, userId);
  }

  touchUser(userId: string, nick: string, teamId: string | null) {
    this.db
      .prepare(
        `INSERT INTO users (user_id, pub_id, nick, team_id, seen_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET pub_id = excluded.pub_id, nick = excluded.nick, team_id = excluded.team_id, seen_at = excluded.seen_at`,
      )
      .run(userId, this.pubId(userId), nick, teamId, Date.now());
  }

  /** Herkese açık kimlikten kullanıcıyı bulur */
  userByPub(uid: string): (PublicUser & { userId: string }) | null {
    const r = this.db.prepare('SELECT user_id, nick, team_id FROM users WHERE pub_id = ?').get(uid) as any;
    return r ? { uid, userId: r.user_id, nick: r.nick, team: r.team_id ? this.team(r.team_id) : null } : null;
  }

  private publicUser(userId: string): PublicUser {
    const uid = this.pubId(userId);
    const u = this.userByPub(uid);
    return { uid, nick: u?.nick ?? 'Taraftar', team: u?.team ?? null };
  }

  private dmRow = (r: any): DirectMessage => ({ id: r.id, from: this.pubId(r.from_id), to: this.pubId(r.to_id), text: r.text, createdAt: r.created_at });

  addDm(fromId: string, toId: string, text: string): DirectMessage {
    const createdAt = Date.now();
    const info = this.db.prepare('INSERT INTO dms (from_id, to_id, text, created_at) VALUES (?,?,?,?)').run(fromId, toId, text, createdAt);
    return { id: Number(info.lastInsertRowid), from: this.pubId(fromId), to: this.pubId(toId), text, createdAt };
  }

  /** İki kullanıcı arasındaki son mesajlar (eskiden yeniye) */
  dmHistory(me: string, other: string, limit = 100): DirectMessage[] {
    return (
      this.db
        .prepare('SELECT * FROM dms WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT ?')
        .all(me, other, other, me, limit) as any[]
    )
      .reverse()
      .map(this.dmRow);
  }

  markDmRead(me: string, other: string) {
    this.db.prepare('UPDATE dms SET read = 1 WHERE to_id = ? AND from_id = ? AND read = 0').run(me, other);
  }

  dmUnread(me: string): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM dms WHERE to_id = ? AND read = 0').get(me) as any).c;
  }

  /** Konuşma listesi: her kişiyle son mesaj ve okunmamış sayısı, en yeni üstte */
  dmThreads(me: string, limit = 50) {
    const rows = this.db
      .prepare(
        `SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END other, MAX(id) last_id,
           SUM(CASE WHEN to_id = ? AND read = 0 THEN 1 ELSE 0 END) unread
         FROM dms WHERE from_id = ? OR to_id = ? GROUP BY other ORDER BY last_id DESC LIMIT ?`,
      )
      .all(me, me, me, me, limit) as any[];
    const last = this.db.prepare('SELECT * FROM dms WHERE id = ?');
    return rows.map((r) => ({ ...this.publicUser(r.other), unread: r.unread, last: this.dmRow(last.get(r.last_id)) }));
  }

  setDmBlock(me: string, other: string, on: boolean) {
    if (on) this.db.prepare('INSERT OR IGNORE INTO dm_blocks (user_id, blocked_id) VALUES (?,?)').run(me, other);
    else this.db.prepare('DELETE FROM dm_blocks WHERE user_id = ? AND blocked_id = ?').run(me, other);
  }

  /** me, other'ı engellemiş mi */
  dmBlocked(me: string, other: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM dm_blocks WHERE user_id = ? AND blocked_id = ?').get(me, other);
  }

  // ------------------------------------------------------------------ puanlar

  rate(matchId: string, playerId: string, userId: string, score: number) {
    this.db
      .prepare(
        `INSERT INTO ratings (match_id, player_id, user_id, score, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(match_id, player_id, user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
      )
      .run(matchId, playerId, userId, score, Date.now());
  }

  // ------------------------------------------------------------------ anketler

  ensureAutoPolls(match: Match) {
    const auto: [string, string, string[]][] = [
      ['winner', 'Maçı kim kazanır?', [match.home.name, 'Beraberlik', match.away.name]],
      ['referee', 'Hakem yönetimini nasıl buluyorsun?', ['Çok iyi', 'İdare eder', 'Kötü', 'Felaket']],
    ];
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO polls (match_id, question, options, kind, auto_key, created_at) VALUES (?,?,?,?,?,?)',
    );
    for (const [key, q, opts] of auto) stmt.run(match.id, q, JSON.stringify(opts), 'auto', key, Date.now());
  }

  poll(pollId: number): { id: number; matchId: string; options: string[] } | null {
    const r = this.db.prepare('SELECT id, match_id, options FROM polls WHERE id = ?').get(pollId) as any;
    return r ? { id: r.id, matchId: r.match_id, options: JSON.parse(r.options) } : null;
  }

  vote(pollId: number, userId: string, idx: number) {
    this.db
      .prepare(
        `INSERT INTO poll_votes (poll_id, user_id, option_idx) VALUES (?,?,?)
         ON CONFLICT(poll_id, user_id) DO UPDATE SET option_idx = excluded.option_idx`,
      )
      .run(pollId, userId, idx);
  }

  // ------------------------------------------------------------------ taktik

  submitTactic(matchId: string, side: Side, userId: string, nick: string, formation: string, style: string, note: string) {
    this.db
      .prepare(
        `INSERT INTO tactics (match_id, side, user_id, nick, formation, style, note, created_at) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(match_id, side, user_id) DO UPDATE SET formation = excluded.formation, style = excluded.style,
           note = excluded.note, nick = excluded.nick, created_at = excluded.created_at`,
      )
      .run(matchId, side, userId, nick, formation, style, note, Date.now());
  }

  tactic(id: number): { matchId: string } | null {
    const r = this.db.prepare('SELECT match_id FROM tactics WHERE id = ?').get(id) as any;
    return r ? { matchId: r.match_id } : null;
  }

  toggleTacticLike(id: number, userId: string) {
    const del = this.db.prepare('DELETE FROM tactic_likes WHERE tactic_id = ? AND user_id = ?').run(id, userId);
    if (!del.changes) this.db.prepare('INSERT INTO tactic_likes (tactic_id, user_id) VALUES (?,?)').run(id, userId);
  }

  // ------------------------------------------------------------------ değişiklik talepleri

  requestSub(matchId: string, side: Side, out: { id: string; name: string }, inn: { id: string; name: string }, userId: string, nick: string) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sub_requests (match_id, side, out_id, out_name, in_id, in_name, created_by, nick, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(matchId, side, out.id, out.name, inn.id, inn.name, userId, nick, Date.now());
    const r = this.db
      .prepare('SELECT id FROM sub_requests WHERE match_id = ? AND side = ? AND out_id = ? AND in_id = ?')
      .get(matchId, side, out.id, inn.id) as any;
    // talep eden aynı zamanda destekçi sayılır
    this.db.prepare('INSERT OR IGNORE INTO sub_votes (request_id, user_id) VALUES (?,?)').run(r.id, userId);
    return r.id as number;
  }

  subRequest(id: number): { matchId: string } | null {
    const r = this.db.prepare('SELECT match_id FROM sub_requests WHERE id = ?').get(id) as any;
    return r ? { matchId: r.match_id } : null;
  }

  toggleSubVote(id: number, userId: string) {
    // talep edenin desteği geri alınamaz; yoksa oy 0'a düşer ve talep listeden kaybolur
    const own = this.db.prepare('SELECT 1 FROM sub_requests WHERE id = ? AND created_by = ?').get(id, userId);
    if (own) return;
    const del = this.db.prepare('DELETE FROM sub_votes WHERE request_id = ? AND user_id = ?').run(id, userId);
    if (!del.changes) this.db.prepare('INSERT INTO sub_votes (request_id, user_id) VALUES (?,?)').run(id, userId);
  }

  // ------------------------------------------------------------------ toplu durum

  /** Maç odası için herkese açık, toplanmış taraftar durumu. */
  state(matchId: string) {
    const ratings: Record<string, { avg: number; count: number }> = {};
    for (const r of this.db
      .prepare('SELECT player_id, AVG(score) avg, COUNT(*) c FROM ratings WHERE match_id = ? GROUP BY player_id')
      .all(matchId) as any[]) {
      ratings[r.player_id] = { avg: Math.round(r.avg * 10) / 10, count: r.c };
    }

    const polls = (this.db.prepare('SELECT * FROM polls WHERE match_id = ? ORDER BY kind = \'user\', id').all(matchId) as any[]).map((p) => {
      const opts: string[] = JSON.parse(p.options);
      const counts = new Array(opts.length).fill(0);
      for (const v of this.db.prepare('SELECT option_idx, COUNT(*) c FROM poll_votes WHERE poll_id = ? GROUP BY option_idx').all(p.id) as any[]) {
        if (v.option_idx < counts.length) counts[v.option_idx] = v.c;
      }
      const total = counts.reduce((a, b) => a + b, 0);
      return { id: p.id, question: p.question, kind: p.kind, nick: p.nick, total, options: opts.map((label, i) => ({ label, votes: counts[i] })) };
    });

    const tactics: Record<Side, any> = { home: null, away: null };
    for (const side of ['home', 'away'] as Side[]) {
      const rows = this.db
        .prepare(
          `SELECT t.id, t.nick, t.formation, t.style, t.note, t.created_at,
             (SELECT COUNT(*) FROM tactic_likes l WHERE l.tactic_id = t.id) likes
           FROM tactics t WHERE match_id = ? AND side = ?`,
        )
        .all(matchId, side) as any[];
      const total = rows.length;
      const dist = (key: 'formation' | 'style') => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
        return [...m.entries()]
          .map(([value, count]) => ({ value, count, pct: Math.round((count / total) * 100) }))
          .sort((a, b) => b.count - a.count);
      };
      tactics[side] = {
        total,
        formations: total ? dist('formation') : [],
        styles: total ? dist('style') : [],
        notes: rows
          .filter((r) => r.note)
          .sort((a, b) => b.likes - a.likes || b.created_at - a.created_at)
          .slice(0, 20)
          .map((r) => ({ id: r.id, nick: r.nick, formation: r.formation, style: r.style, note: r.note, likes: r.likes })),
      };
    }

    const subs: Record<Side, any[]> = { home: [], away: [] };
    for (const r of this.db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM sub_votes v WHERE v.request_id = s.id) votes
         FROM sub_requests s WHERE match_id = ? ORDER BY votes DESC, s.id ASC`,
      )
      .all(matchId) as any[]) {
      if (r.votes === 0) continue;
      subs[r.side as Side].push({ id: r.id, outId: r.out_id, outName: r.out_name, inId: r.in_id, inName: r.in_name, nick: r.nick, votes: r.votes });
    }

    const comments: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT target, COUNT(*) c FROM comments WHERE match_id = ? GROUP BY target').all(matchId) as any[])
      comments[r.target] = r.c;

    return { ratings, polls, tactics, subs, comments, predictions: this.predictionStats(matchId) };
  }

  /** Kullanıcının bu maçtaki kendi oyları (arayüzde seçili göstermek için). */
  mine(matchId: string, userId: string) {
    const ratings: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT player_id, score FROM ratings WHERE match_id = ? AND user_id = ?').all(matchId, userId) as any[])
      ratings[r.player_id] = r.score;
    const polls: Record<string, number> = {};
    for (const r of this.db
      .prepare('SELECT v.poll_id, v.option_idx FROM poll_votes v JOIN polls p ON p.id = v.poll_id WHERE p.match_id = ? AND v.user_id = ?')
      .all(matchId, userId) as any[])
      polls[r.poll_id] = r.option_idx;
    const tactics: Partial<Record<Side, { formation: string; style: string; note: string }>> = {};
    for (const r of this.db.prepare('SELECT side, formation, style, note FROM tactics WHERE match_id = ? AND user_id = ?').all(matchId, userId) as any[])
      tactics[r.side as Side] = { formation: r.formation, style: r.style, note: r.note };
    const tacticLikes = (
      this.db
        .prepare('SELECT l.tactic_id FROM tactic_likes l JOIN tactics t ON t.id = l.tactic_id WHERE t.match_id = ? AND l.user_id = ?')
        .all(matchId, userId) as any[]
    ).map((r) => r.tactic_id);
    const subVotes = (
      this.db
        .prepare('SELECT v.request_id FROM sub_votes v JOIN sub_requests s ON s.id = v.request_id WHERE s.match_id = ? AND v.user_id = ?')
        .all(matchId, userId) as any[]
    ).map((r) => r.request_id);
    const subOwn = (
      this.db.prepare('SELECT id FROM sub_requests WHERE match_id = ? AND created_by = ?').all(matchId, userId) as any[]
    ).map((r) => r.id);
    const pr = this.db
      .prepare('SELECT home, away, xi_side, xi, points, exact, result_ok, xi_hits FROM predictions WHERE match_id = ? AND user_id = ?')
      .get(matchId, userId) as any;
    const prediction = pr
      ? {
          home: pr.home, away: pr.away, xiSide: pr.xi_side ?? null, xi: pr.xi ? JSON.parse(pr.xi) : [],
          points: pr.points, exact: Boolean(pr.exact), resultOk: Boolean(pr.result_ok), xiHits: pr.xi_hits ?? 0,
        }
      : null;
    return { ratings, polls, tactics, tacticLikes, subVotes, subOwn, prediction };
  }
}

function rowTeam(r: any): TeamBadge {
  return { id: r.id, name: r.name, short: r.short, ...(r.logo ? { logo: r.logo } : {}), ...(r.color ? { color: r.color } : {}) };
}

// ------------------------------------------------------------------ üyelik yardımcıları

/** Telefonu +905xxxxxxxxx biçimine getirir; geçersizse null */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const plus = raw.trim().startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!plus || d.startsWith('90')) {
    if (d.startsWith('90') && d.length === 12) d = d.slice(2);
    else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    if (/^5\d{9}$/.test(d)) return '+90' + d;
    if (!plus) return null;
  }
  return /^[1-9]\d{7,14}$/.test(d) ? '+' + d : null;
}

function maskPhone(p: string) {
  return p.slice(0, -7).replace(/^\+90/, '0') + ' *** ** ' + p.slice(-2);
}

function hashPin(pin: string) {
  const salt = crypto.randomBytes(16);
  return `s1:${salt.toString('hex')}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}

function checkPin(pin: string, stored: string) {
  const [, salt, hash] = stored.split(':');
  const got = crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
