import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  is_banned     INTEGER NOT NULL DEFAULT 0,        -- kalici ban
  muted_until   TEXT,                              -- ISO zaman damgasi; NULL = susturulmamis
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room        TEXT    NOT NULL,                    -- 'match:123' | 'player:123:456'
  scope       TEXT    NOT NULL,                    -- 'match' | 'player'
  match_id    INTEGER NOT NULL,
  player_id   INTEGER,                             -- player scope icin dolu
  user_id     INTEGER NOT NULL,
  content     TEXT    NOT NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  deleted_by  INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);

CREATE TABLE IF NOT EXISTS ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   INTEGER NOT NULL,
  player_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  score      INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (match_id, player_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_match_player ON ratings(match_id, player_id);
CREATE INDEX IF NOT EXISTS idx_ratings_match ON ratings(match_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id          INTEGER NOT NULL,
  action            TEXT    NOT NULL,              -- delete_message | mute | unmute | ban | unban
  target_user_id    INTEGER,
  target_message_id INTEGER,
  reason            TEXT,
  meta              TEXT,                          -- JSON
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_modlog_target ON moderation_actions(target_user_id);

CREATE TABLE IF NOT EXISTS suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  type        TEXT    NOT NULL,              -- degisiklik | taktik | dizilis | genel
  content     TEXT    NOT NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  deleted_by  INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_suggestions_match ON suggestions(match_id);

CREATE TABLE IF NOT EXISTS suggestion_votes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (suggestion_id, user_id),
  FOREIGN KEY (suggestion_id) REFERENCES suggestions(id)
);

CREATE INDEX IF NOT EXISTS idx_suggestion_votes_sid ON suggestion_votes(suggestion_id);
`);

export function nowIso() {
  return new Date().toISOString();
}
