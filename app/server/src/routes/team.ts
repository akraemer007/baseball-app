import { Router } from 'express';
import { config } from '../config.js';
import { getTeam } from '../mocks/data.js';
import {
  getTeamFromWarehouse,
  getTeamPlayerStatDistributionFromWarehouse,
} from '../queries/index.js';

const router = Router();

// GET /api/team/:teamId/player-stat-distribution?stat=X&season=YYYY
// Drives the player-level strip plot inside the expanded percentile row.
// Registered before the `/:teamId` catch-all so it matches first.
router.get('/:teamId/player-stat-distribution', async (req, res, next) => {
  try {
    const teamId = req.params.teamId;
    const stat = String(req.query.stat ?? '').replace(/[^a-z0-9_]/gi, '');
    if (!stat) {
      res.status(400).json({ error: 'stat query param required' });
      return;
    }
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();
    if (!config.useRealSql) {
      // Mock path: no per-player dist yet. Respond 404 so the client skips
      // the second chart gracefully.
      res.status(404).json({ error: 'not available in mock mode' });
      return;
    }
    const payload = await getTeamPlayerStatDistributionFromWarehouse(
      teamId,
      stat,
      resolvedSeason,
    );
    if (!payload) {
      res.status(404).json({ error: 'stat not supported at player grain' });
      return;
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/team/:teamId?season=YYYY
router.get('/:teamId', async (req, res, next) => {
  try {
    const teamId = req.params.teamId;
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();
    const payload = config.useRealSql
      ? await getTeamFromWarehouse(teamId, resolvedSeason)
      : getTeam(teamId, resolvedSeason);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
