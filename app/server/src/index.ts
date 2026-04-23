import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import type { HealthResponse } from '../../shared/types.js';
import { config } from './config.js';
import { cacheMiddleware } from './lib/cache.js';
import leagueRouter from './routes/league.js';
import teamRouter from './routes/team.js';
import playerRouter from './routes/player.js';
import newsRouter from './routes/news.js';
import projectionsRouter from './routes/projections.js';

const app = express();
const startedAt = Date.now();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Request logger (simple)
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Health check is unauthenticated and uncached.
app.get('/api/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  };
  res.json(body);
});

// All /api/* GETs share a 5-minute LRU cache.
app.use('/api', cacheMiddleware);

app.use('/api/league', leagueRouter);
app.use('/api/team', teamRouter);
app.use('/api/player', playerRouter);
app.use('/api/news', newsRouter);
app.use('/api/projections', projectionsRouter);

// Fallback 404 for unknown API paths so they don't get swallowed by the SPA.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// In production, serve the built React client.
const hasClientBuild = fs.existsSync(path.join(config.clientStaticDir, 'index.html'));
if (hasClientBuild) {
  app.use(express.static(config.clientStaticDir));
  // SPA fallback for client-side routes.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.clientStaticDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send(
        'ak_baseball API server is running.\n' +
          'Client build not found. In dev, run Vite (npm run dev) and use http://localhost:5173.\n'
      );
  });
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[ak_baseball] listening on :${config.port} (env=${config.nodeEnv}, catalog=${config.catalog}, schema=${config.schema})`
  );
  if (!config.warehouseId) {
    // eslint-disable-next-line no-console
    console.warn('[ak_baseball] DATABRICKS_WAREHOUSE_ID is not set; mock data only.');
  }
});
