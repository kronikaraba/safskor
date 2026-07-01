import { sql } from '../db.js';
import { getUserByUsername } from '../store/users.js';

// Açıkça "bot" rolüyle işaretli sistem kullanıcısı. Giriş yapamaz (geçersiz
// şifre hash'i). Mesajları istemcide 🤖 rozetiyle gösterilir.
const BOT_USERNAME = 'SafSkorBot';
const BOT_EMAIL = 'bot@safskor.local';

let botId = null;

export async function ensureBotUser() {
  if (botId) return botId;
  const existing = await getUserByUsername(BOT_USERNAME);
  if (existing) {
    botId = Number(existing.id);
    if (existing.role !== 'bot') await sql`UPDATE users SET role = 'bot' WHERE id = ${botId}`;
    return botId;
  }
  const unusablePassword = `!bot-no-login-${Math.random().toString(36).slice(2)}`;
  const [row] = await sql`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${BOT_USERNAME}, ${BOT_EMAIL}, ${unusablePassword}, 'bot')
    RETURNING id
  `;
  botId = Number(row.id);
  return botId;
}

export function getBotId() {
  return botId;
}
