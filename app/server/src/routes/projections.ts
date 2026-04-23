import { Router } from 'express';
import { config } from '../config.js';
import { getProjections } from '../mocks/data.js';
import { getProjectionsFromWarehouse } from '../queries/index.js';

const router = Router();

// GET /api/projections/today
router.get('/today', async (_req, res, next) => {
  try {
    const payload = config.useRealSql
      ? await getProjectionsFromWarehouse()
      : getProjections();
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
