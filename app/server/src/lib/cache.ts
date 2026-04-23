// Request-level in-memory LRU cache with a 5-minute TTL.
// Used as Express middleware to memoize GET /api/* responses.

import type { Request, Response, NextFunction } from 'express';
import { LRUCache } from 'lru-cache';

const FIVE_MIN_MS = 5 * 60 * 1000;

interface CachedEntry {
  status: number;
  body: unknown;
}

const cache = new LRUCache<string, CachedEntry>({
  max: 500,
  ttl: FIVE_MIN_MS,
});

function makeKey(req: Request): string {
  // Include method, path, and sorted query string.
  const query = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  return `${req.method} ${req.path}${query}`;
}

export function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET') {
    next();
    return;
  }

  const key = makeKey(req);
  const hit = cache.get(key);
  if (hit) {
    res.setHeader('X-Cache', 'HIT');
    res.status(hit.status).json(hit.body);
    return;
  }

  res.setHeader('X-Cache', 'MISS');

  // Intercept res.json to populate the cache on success.
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      cache.set(key, { status: res.statusCode, body });
    }
    return originalJson(body);
  }) as Response['json'];

  next();
}

export function clearCache(): void {
  cache.clear();
}
