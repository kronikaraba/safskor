import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server as SocketServer } from 'socket.io';

import { config, assertConfig } from './config.js';
import { initDb } from './db.js';
import { attachUser } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { footballRouter } from './football/routes.js';
import { manualMatchRouter } from './football/adminMatchRoutes.js';
import { chatRouter } from './chat/routes.js';
import { usersRouter } from './users/routes.js';
import { ratingsRouter } from './ratings/routes.js';
import { suggestionsRouter } from './suggestions/routes.js';
import { adminRouter } from './moderation/routes.js';
import { initRealtime } from './realtime/socket.js';
import { startKeepAlive } from './keepalive.js';
import { startBot } from './bot/service.js';
import { ApiError } from './utils/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

assertConfig();

// CORS: izinli origin listesi (CLIENT_ORIGIN env'inden, virgülle).
// Tarayıcı dışı istekler (curl, sunucu-sunucu) için origin undefined gelir → izinli.
function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  if (config.clientOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
  return cb(new Error(`CORS: ${origin} izinli değil`));
}

const app = express();
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(attachUser);

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, name: 'SafSkor', apiKeyConfigured: !!config.football.apiKey })
);

app.use('/api/auth', authRouter);
app.use('/api/football', footballRouter);
app.use('/api/chat', chatRouter);
app.use('/api/users', usersRouter);
app.use('/api/ratings', ratingsRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/admin/matches', manualMatchRouter);
app.use('/api/admin', adminRouter);

// Bilinmeyen API yolu
app.use('/api', (_req, res) => res.status(404).json({ error: 'Bulunamadi.' }));

// Uretim: derlenmis React istemcisini servis et
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Merkezi hata yakalayıcı — admin'e detaylı, üye/ziyaretçiye yumuşatılmış mesaj
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const isAdmin = req.user?.role === 'admin';
  if (err instanceof ApiError) {
    if (err.status >= 500) console.warn('[api]', err.status, err.message);
    const message = isAdmin ? err.message : (err.publicMessage || err.message);
    res.status(err.status).json({ error: message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: isAdmin ? (err.message || 'Sunucu hatası.') : 'Sunucu hatası.' });
});

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: corsOrigin, credentials: true },
});
initRealtime(io);

// Başlangıçta veritabanına bağlanmayı üstel geri çekilmeyle birkaç kez dener.
// Neon soğuk başlangıç/uyandırma veya geçici bir ağ hatası (ECONNRESET) tek
// denemede tüm süreci düşürmesin diye. initDb idempotenttir (hepsi CREATE
// ... IF NOT EXISTS) ve başarısızlıkta güvenle yeniden denenebilir.
async function initDbWithRetry(attempts = 5) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await initDb();
      return;
    } catch (e) {
      if (i === attempts) throw e;
      const backoffMs = Math.min(1000 * 2 ** (i - 1), 10000); // 1s,2s,4s,8s
      console.warn(
        `[db] başlatma denemesi ${i}/${attempts} başarısız (${e.message}); ${backoffMs}ms sonra yeniden denenecek`
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

initDbWithRetry()
  .then(() => {
    server.listen(config.port, () => {
      console.log(`SafSkor sunucu http://localhost:${config.port} adresinde çalışıyor`);
      startKeepAlive();
      startBot(io);
    });
  })
  .catch((e) => {
    console.error('[db] başlatılamadı (tüm denemeler tükendi):', e.message);
    process.exit(1);
  });
