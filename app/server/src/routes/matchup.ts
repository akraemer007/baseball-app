import { Router } from 'express';
import { config } from '../config.js';
import { getMatchupFromWarehouse } from '../queries/matchup.js';
import { getMockMatchup } from '../mocks/data.js';

const router = Router();

// GET /api/matchup/:gamePk
router.get('/:gamePk', async (req, res, next) => {
  try {
    const gamePk = Number.parseInt(req.params.gamePk, 10);
    if (!Number.isFinite(gamePk) || gamePk <= 0) {
      res.status(400).json({ error: 'Invalid gamePk' });
      return;
    }
    const payload = config.useRealSql
      ? await getMatchupFromWarehouse(gamePk)
      : getMockMatchup(gamePk);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
