import { Router } from 'express';
import { config } from '../config.js';
import { getPlayer } from '../mocks/data.js';
import { getPlayerFromWarehouse } from '../queries/index.js';

const router = Router();

// GET /api/player/:playerId?season=YYYY
router.get('/:playerId', async (req, res, next) => {
  try {
    const rawId = req.params.playerId;
    const season = Number.parseInt(String(req.query.season ?? ''), 10);
    const resolvedSeason = Number.isFinite(season) ? season : new Date().getUTCFullYear();

    if (config.useRealSql) {
      const playerIdNum = Number.parseInt(rawId, 10);
      if (!Number.isFinite(playerIdNum)) {
        res.status(400).json({ error: 'playerId must be a numeric MLBAM id when USE_REAL_SQL=true' });
        return;
      }
      res.json(await getPlayerFromWarehouse(playerIdNum, resolvedSeason));
    } else {
      res.json(getPlayer(rawId, resolvedSeason));
    }
  } catch (err) {
    next(err);
  }
});

export default router;
