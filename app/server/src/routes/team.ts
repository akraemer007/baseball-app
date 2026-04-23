import { Router } from 'express';
import { config } from '../config.js';
import { getTeam } from '../mocks/data.js';
import { getTeamFromWarehouse } from '../queries/index.js';

const router = Router();

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
