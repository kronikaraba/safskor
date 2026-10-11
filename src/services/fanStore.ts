import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Match, Side } from '../types.js';

export const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1', '4-4-1-1', '3-4-2-1'];
export const STYLES = ['Hücum', 'Dengeli', 'Savunma', 'Kontra atak', 'Yüksek pres', 'Top hakimiyeti'];

export interface ChatMessage {
  id: number;
  matchId: string;
  userId: string | null;
  nick: string;
  text: string;
  kind: 'user' | 'system';
  createdAt: number;
}

export class FanStore {
  private db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, user_id TEXT, nick TEXT NOT NULL,
        text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_match ON chat(match_id, id);
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
    `);
  }

  // ------------------------------------------------------------------ sohbet

  addChat(matchId: string, userId: string | null, nick: string, text: string, kind: 'user' | 'system' = 'user'): ChatMessage {
    const createdAt = Date.now();
    const info = this.db
      .prepare('INSERT INTO chat (match_id, user_id, nick, text, kind, created_at) VALUES (?,?,?,?,?,?)')
      .run(matchId, userId, nick, text, kind, createdAt);
    return { id: Number(info.lastInsertRowid), matchId, userId, nick, text, kind, createdAt };
  }

  chatHistory(matchId: string, limit = 60): ChatMessage[] {
    return (
      this.db
        .prepare('SELECT id, match_id, user_id, nick, text, kind, created_at FROM chat WHERE match_id = ? ORDER BY id DESC LIMIT ?')
        .all(matchId, limit) as any[]
    )
      .reverse()
      .map((r) => ({ id: r.id, matchId: r.match_id, userId: r.user_id, nick: r.nick, text: r.text, kind: r.kind, createdAt: r.created_at }));
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
      ['goals', 'Maçta toplam kaç gol olur?', ['0-1', '2-3', '4-5', '6+']],
      ['referee', 'Hakem yönetimini nasıl buluyorsun?', ['Çok iyi', 'İdare eder', 'Kötü', 'Felaket']],
    ];
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO polls (match_id, question, options, kind, auto_key, created_at) VALUES (?,?,?,?,?,?)',
    );
    for (const [key, q, opts] of auto) stmt.run(match.id, q, JSON.stringify(opts), 'auto', key, Date.now());
  }

  createPoll(matchId: string, userId: string, nick: string, question: string, options: string[]) {
    const info = this.db
      .prepare('INSERT INTO polls (match_id, question, options, kind, created_by, nick, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(matchId, question, JSON.stringify(options), 'user', userId, nick, Date.now());
    return Number(info.lastInsertRowid);
  }

  userPollCount(matchId: string, userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM polls WHERE match_id = ? AND created_by = ?").get(matchId, userId) as any).c;
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

    return { ratings, polls, tactics, subs };
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
    return { ratings, polls, tactics, tacticLikes, subVotes };
  }
}
