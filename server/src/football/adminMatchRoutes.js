import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import { adminRequired } from '../auth/middleware.js';
import {
  createManualMatch,
  listManualMatches,
  getManualMatchRow,
  updateManualMatch,
  deleteManualMatch,
  addManualEvent,
  deleteManualEvent,
  listManualEvents,
} from '../store/manualMatches.js';

export const manualMatchRouter = Router();
manualMatchRouter.use(adminRequired);

// API-Football durum kısa kodları + manuel yönetimde kullanılanlar.
const ALLOWED_STATUS = new Set(['NS', '1H', 'HT', '2H', 'ET', 'P', 'FT', 'PST', 'CANC', 'ABD', 'SUSP']);
const ALLOWED_EVENT_TYPES = new Set(['goal', 'yellow_card', 'red_card', 'substitution']);
const SIDES = new Set(['home', 'away']);

function str(v, { max = 200 } = {}) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function intOrNull(v, { min = -9, max = 999 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return undefined; // undefined = geçersiz
  return n;
}

function sanitizePlayers(list, side) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p, i) => {
      const name = str(p?.name, { max: 80 });
      if (!name) return null;
      const number = intOrNull(p?.number, { min: 0, max: 99 });
      const pos = ['G', 'D', 'M', 'F'].includes(p?.pos) ? p.pos : null;
      return {
        name,
        number: number === undefined ? null : number,
        pos,
        isStarter: p?.isStarter !== false,
        _order: i,
        side,
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

// POST /api/admin/matches — maç oluştur
manualMatchRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const competition = str(b.competition, { max: 80 });
    const homeName = str(b.homeName, { max: 60 });
    const awayName = str(b.awayName, { max: 60 });
    const stage = str(b.stage, { max: 60 }) || null;
    const venue = str(b.venue, { max: 80 }) || null;

    if (!competition) throw new ApiError(400, 'Turnuva/lig adı gerekli.');
    if (!homeName || !awayName) throw new ApiError(400, 'İki takım adı da gerekli.');

    const kickoffDate = new Date(b.kickoff);
    if (!b.kickoff || Number.isNaN(kickoffDate.getTime())) {
      throw new ApiError(400, 'Geçerli bir başlangıç saati girin.');
    }

    const lineups = {
      home: sanitizePlayers(b.lineups?.home, 'home'),
      away: sanitizePlayers(b.lineups?.away, 'away'),
    };

    const match = await createManualMatch({
      competition,
      stage,
      homeName,
      awayName,
      kickoff: kickoffDate.toISOString(),
      venue,
      createdBy: req.user.id,
      lineups,
    });
    res.status(201).json({ ok: true, id: Number(match.id) });
  })
);

// GET /api/admin/matches — yönetim listesi
manualMatchRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await listManualMatches({ limit: 100 });
    const matches = await Promise.all(
      rows.map(async (r) => ({
        id: Number(r.id),
        competition: r.competition,
        stage: r.stage,
        homeName: r.home_name,
        awayName: r.away_name,
        kickoff: r.kickoff,
        venue: r.venue,
        status: r.status,
        minute: r.minute,
        homeScore: r.home_score,
        awayScore: r.away_score,
        htHome: r.ht_home,
        htAway: r.ht_away,
        events: (await listManualEvents(r.id)).map((e) => ({
          id: Number(e.id),
          side: e.side,
          type: e.type,
          minute: e.minute,
          player: e.player,
          playerOut: e.player_out,
          detail: e.detail,
        })),
      }))
    );
    res.json({ matches });
  })
);

async function requireMatch(id) {
  const row = await getManualMatchRow(id);
  if (!row) throw new ApiError(404, 'Maç bulunamadı.');
  return row;
}

// POST /api/admin/matches/:id — durum/skor güncelle
manualMatchRouter.post(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    await requireMatch(id);
    const b = req.body ?? {};
    const fields = {};

    if (b.status !== undefined) {
      if (!ALLOWED_STATUS.has(b.status)) throw new ApiError(400, 'Geçersiz durum.');
      fields.status = b.status;
    }
    for (const [key, prop] of [
      ['minute', 'minute'],
      ['homeScore', 'homeScore'],
      ['awayScore', 'awayScore'],
      ['htHome', 'htHome'],
      ['htAway', 'htAway'],
    ]) {
      if (b[key] !== undefined) {
        const n = key === 'minute' ? intOrNull(b[key], { min: 0, max: 130 }) : intOrNull(b[key], { min: 0, max: 99 });
        if (n === undefined) throw new ApiError(400, `Geçersiz değer: ${key}.`);
        fields[prop] = n;
      }
    }

    const row = await updateManualMatch(id, fields);
    res.json({ ok: true, status: row.status });
  })
);

// POST /api/admin/matches/:id/delete
manualMatchRouter.post(
  '/:id/delete',
  asyncHandler(async (req, res) => {
    await requireMatch(req.params.id);
    await deleteManualMatch(req.params.id);
    res.json({ ok: true });
  })
);

// POST /api/admin/matches/:id/events — olay ekle
manualMatchRouter.post(
  '/:id/events',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    await requireMatch(id);
    const b = req.body ?? {};
    if (!SIDES.has(b.side)) throw new ApiError(400, 'Takım (side) geçersiz.');
    if (!ALLOWED_EVENT_TYPES.has(b.type)) throw new ApiError(400, 'Olay türü geçersiz.');
    const minute = intOrNull(b.minute, { min: 0, max: 130 });
    if (minute === undefined) throw new ApiError(400, 'Geçersiz dakika.');
    const player = str(b.player, { max: 80 }) || null;
    const playerOut = str(b.playerOut, { max: 80 }) || null;
    const detail = ['PENALTY', 'OWN'].includes(b.detail) ? b.detail : null;

    const ev = await addManualEvent({ matchId: id, side: b.side, type: b.type, minute, player, playerOut, detail });
    res.status(201).json({ ok: true, id: Number(ev.id) });
  })
);

// POST /api/admin/matches/:id/events/:eventId/delete
manualMatchRouter.post(
  '/:id/events/:eventId/delete',
  asyncHandler(async (req, res) => {
    await requireMatch(req.params.id);
    await deleteManualEvent(req.params.id, req.params.eventId);
    res.json({ ok: true });
  })
);
