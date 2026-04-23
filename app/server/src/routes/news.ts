import { Router } from 'express';
import { config } from '../config.js';
import { getRecaps } from '../mocks/data.js';
import { getRecapsFromWarehouse } from '../queries/index.js';

const router = Router();

// GET /api/news/recaps?date=YYYY-MM-DD
router.get('/recaps', async (req, res, next) => {
  try {
    const raw = String(req.query.date ?? '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : new Date().toISOString().slice(0, 10);
    const payload = config.useRealSql
      ? await getRecapsFromWarehouse(date)
      : getRecaps(date);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
