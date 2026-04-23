import { Router } from 'express';
import { config } from '../config.js';
import { getRecaps, getRecapsDays } from '../mocks/data.js';
import {
  getRecapsFromWarehouse,
  getRecapsDaysFromWarehouse,
} from '../queries/index.js';

const router = Router();

// GET /api/news/recaps?date=YYYY-MM-DD  (single date)
// GET /api/news/recaps?days=N           (most-recent N dates, interest-sorted)
router.get('/recaps', async (req, res, next) => {
  try {
    const rawDays = req.query.days;
    if (rawDays !== undefined) {
      const parsed = Number.parseInt(String(rawDays), 10);
      const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
      const payload = config.useRealSql
        ? await getRecapsDaysFromWarehouse(n)
        : getRecapsDays(n);
      res.json(payload);
      return;
    }
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
