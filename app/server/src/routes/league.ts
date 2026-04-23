import { Router } from 'express';
import { config } from '../config.js';
import { getHrRace, getLeague, getStatDistribution } from '../mocks/data.js';
import {
  getLeagueFromWarehouse,
  getHrRaceFromWarehouse,
  getStatDistributionFromWarehouse,
} from '../queries/index.js';

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

// GET /api/league/stat-distribution?stat=<name>&season=YYYY
router.get('/stat-distribution', async (req, res, next) => {
  try {
    const stat = String(req.query.stat ?? '').replace(/[^a-z0-9_]/gi, '');
    if (!stat) {
      res.status(400).json({ error: 'stat query param required' });
      return;
    }
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();
    const payload = config.useRealSql
      ? await getStatDistributionFromWarehouse(stat, resolvedSeason)
      : getStatDistribution(stat, resolvedSeason);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
