import { Router } from 'express';
import { config } from '../config.js';
import { getGameSummary } from '../mocks/data.js';
import { getGameSummaryFromWarehouse } from '../queries/index.js';

const router = Router();

// GET /api/game/:gamePk/summary
// Returns the per-game summary used by the trajectory-chart drawer.
router.get('/:gamePk/summary', async (req, res, next) => {
  try {
    const gamePk = Number.parseInt(String(req.params.gamePk ?? ''), 10);
    if (!Number.isFinite(gamePk) || gamePk <= 0) {
      res.status(400).json({ error: 'gamePk must be a positive integer' });
      return;
    }
    const payload = config.useRealSql
      ? await getGameSummaryFromWarehouse(gamePk)
      : getGameSummary(gamePk);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
