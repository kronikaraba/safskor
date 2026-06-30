import { Router } from 'express';
import { asyncHandler, ApiError } from '../utils/http.js';
import * as svc from './service.js';

export const footballRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/football/matches?date=YYYY-MM-DD
footballRouter.get(
  '/matches',
  asyncHandler(async (req, res) => {
    const date = String(req.query.date ?? '').trim() || todayUtc();
    if (!DATE_RE.test(date)) throw new ApiError(400, 'Gecersiz tarih (YYYY-MM-DD bekleniyor).');
    res.json(await svc.getMatchesByDate(date));
  })
);

// GET /api/football/matches/:id
footballRouter.get(
  '/matches/:id',
  asyncHandler(async (req, res) => {
    res.json({ match: await svc.getMatch(req.params.id) });
  })
);

// GET /api/football/matches/:id/events
footballRouter.get(
  '/matches/:id/events',
  asyncHandler(async (req, res) => {
    res.json({ events: await svc.getMatchEvents(req.params.id) });
  })
);

// GET /api/football/matches/:id/lineups
footballRouter.get(
  '/matches/:id/lineups',
  asyncHandler(async (req, res) => {
    res.json(await svc.getMatchLineups(req.params.id));
  })
);

// GET /api/football/team/:id/logo  (Sofascore görsellerini proxy'ler)
footballRouter.get(
  '/team/:id/logo',
  asyncHandler(async (req, res) => {
    const { buffer, contentType } = await svc.getTeamLogo(req.params.id);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buffer);
  })
);

// GET /api/football/league/:id/logo
footballRouter.get(
  '/league/:id/logo',
  asyncHandler(async (req, res) => {
    const { buffer, contentType } = await svc.getLeagueLogo(req.params.id);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buffer);
  })
);

// GET /api/football/competitions/:id/standings?season=YYYY
footballRouter.get(
  '/competitions/:id/standings',
  asyncHandler(async (req, res) => {
    const season = String(req.query.season ?? '').trim();
    if (!season) throw new ApiError(400, 'season parametresi gerekli.');
    res.json({ standings: await svc.getStandings(req.params.id, season) });
  })
);
