import { Router } from 'express';
import { config } from '../config.js';
import { getHrRace, getLeague } from '../mocks/data.js';
import { getLeagueFromWarehouse, getHrRaceFromWarehouse } from '../queries/index.js';

const router = Router();

// GET /api/league/divisions?season=YYYY
router.get('/divisions', async (req, res, next) => {
  try {
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();
    const payload = config.useRealSql
      ? await getLeagueFromWarehouse(resolvedSeason)
      : getLeague(resolvedSeason);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/league/hr-race?season=YYYY
router.get('/hr-race', async (req, res, next) => {
  try {
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();
    const payload = config.useRealSql
      ? await getHrRaceFromWarehouse(resolvedSeason)
      : getHrRace(resolvedSeason);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
