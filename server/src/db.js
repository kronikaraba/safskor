import postgres from 'postgres';
import { config } from './config.js';

if (!config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.error(
    '[db] DATABASE_URL ortam değişkeni tanımlı değil. Neon connection string ekleyin.'
  );
}

export const sql = postgres(config.databaseUrl, {
  ssl: 'require',
  max: 10,
  idle_timeout: 20,
  connect_timeout: 30,
  prepare: false,
});

export function nowIso() {
  return new Date().toISOString();
}

/** Bir Date veya ISO string'i ISO string'e çevirir (DB Date döner, eski API string verirdi). */
export function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

let initPromise = null;

export function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id            BIGSERIAL PRIMARY KEY,
        username      TEXT NOT NULL,
        email         TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        is_banned     BOOLEAN NOT NULL DEFAULT FALSE,
        muted_until   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username))`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (LOWER(email))`;

    await sql`
      CREATE TABLE IF NOT EXISTS messages (
        id         BIGSERIAL PRIMARY KEY,
        room       TEXT NOT NULL,
        scope      TEXT NOT NULL,
        match_id   BIGINT NOT NULL,
        player_id  BIGINT,
        user_id    BIGINT NOT NULL REFERENCES users(id),
        content    TEXT NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS ratings (
        id         BIGSERIAL PRIMARY KEY,
        match_id   BIGINT NOT NULL,
        player_id  BIGINT NOT NULL,
        user_id    BIGINT NOT NULL REFERENCES users(id),
        score      INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (match_id, player_id, user_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ratings_match_player ON ratings(match_id, player_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ratings_match ON ratings(match_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS moderation_actions (
        id                BIGSERIAL PRIMARY KEY,
        admin_id          BIGINT NOT NULL,
        action            TEXT NOT NULL,
        target_user_id    BIGINT,
        target_message_id BIGINT,
        reason            TEXT,
        meta              JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_modlog_target ON moderation_actions(target_user_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS suggestions (
        id         BIGSERIAL PRIMARY KEY,
        match_id   BIGINT NOT NULL,
        user_id    BIGINT NOT NULL REFERENCES users(id),
        type       TEXT NOT NULL,
        content    TEXT NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_suggestions_match ON suggestions(match_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS suggestion_votes (
        id            BIGSERIAL PRIMARY KEY,
        suggestion_id BIGINT NOT NULL REFERENCES suggestions(id),
        user_id       BIGINT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (suggestion_id, user_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_suggestion_votes_sid ON suggestion_votes(suggestion_id)`;
  })();
  return initPromise;
}
