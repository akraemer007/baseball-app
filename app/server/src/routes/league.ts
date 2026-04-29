import { Router } from 'express';
import type { StatDistributionResponse } from '../../../shared/types/index.js';
import { config } from '../config.js';
import { getHrRace, getLeague, getStatDistribution } from '../mocks/data.js';
import {
  getBulkStatDistributionsFromWarehouse,
  getLeagueFromWarehouse,
  getHrRaceFromWarehouse,
  getLeagueStorylinesFromWarehouse,
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
// Kept for ad-hoc / external callers; the internal app now uses the bulk route below.
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

// GET /api/league/stat-distributions?stats=a,b,c&season=YYYY
// Bulk variant — fetches every percentile-row distribution in one round trip.
router.get('/stat-distributions', async (req, res, next) => {
  try {
    const stats = String(req.query.stats ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (stats.length === 0) {
      res.status(400).json({ error: 'stats query param required (comma-separated)' });
      return;
    }
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();
    if (config.useRealSql) {
      const payload = await getBulkStatDistributionsFromWarehouse(stats, resolvedSeason);
      res.json(payload);
      return;
    }
    // Mock path: assemble by calling the existing single-stat mock once per stat.
    const distributions: Record<string, StatDistributionResponse> = {};
    for (const s of stats) {
      const safe = s.replace(/[^a-z0-9_]/gi, '');
      if (!safe) continue;
      distributions[safe] = getStatDistribution(safe, resolvedSeason);
    }
    res.json({ season: resolvedSeason, distributions });
  } catch (err) {
    next(err);
  }
});

// GET /api/league/storylines
// Bulk: latest gold_team_storyline per team, keyed by team abbrev.
// Drives the standings hover tooltip on the league page.
router.get('/storylines', async (_req, res, next) => {
  try {
    const payload = config.useRealSql
      ? await getLeagueStorylinesFromWarehouse()
      : {};
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
