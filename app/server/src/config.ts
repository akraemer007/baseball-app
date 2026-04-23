// Runtime configuration derived from environment variables.
// All values are read once at import time.

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  warehouseId: string | undefined;
  catalog: string;
  schema: string;
  databricksHost: string | undefined;
  databricksToken: string | undefined;
  // Service principal creds auto-injected by Databricks Apps.
  clientId: string | undefined;
  clientSecret: string | undefined;
  clientStaticDir: string; // abs path to built React assets
  /** When true, routes hit the SQL Warehouse. When false, they serve deterministic mocks. */
  useRealSql: boolean;
}

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parsePort(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 8000;
}

export const config: AppConfig = {
  port: parsePort(process.env.PORT),
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development',
  warehouseId: process.env.DATABRICKS_WAREHOUSE_ID,
  catalog: process.env.DATABRICKS_CATALOG || 'production_forecasting_catalog',
  schema: process.env.DATABRICKS_SCHEMA || 'ak_baseball',
  databricksHost: process.env.DATABRICKS_HOST,
  databricksToken: process.env.DATABRICKS_TOKEN,
  clientId: process.env.DATABRICKS_CLIENT_ID,
  clientSecret: process.env.DATABRICKS_CLIENT_SECRET,
  // In prod the compiled server runs from server/dist, so ../../client/dist resolves
  // to app/client/dist. In dev the client is served by Vite on a different port.
  // Try several candidate locations so we work in both dev (ts-node) and
  // prod (tsc --outDir dist with rootDir=..). The first one that has an
  // index.html wins; if none exist, the server serves a fallback text page.
  clientStaticDir: resolveClientDir(__dirname),
  useRealSql: process.env.USE_REAL_SQL === 'true',
};

function resolveClientDir(serverDir: string): string {
  // Env override wins (lets deployment pin the exact path).
  if (process.env.CLIENT_DIST_DIR) return path.resolve(process.env.CLIENT_DIST_DIR);
  const candidates = [
    // Dev: src/ next to client/
    path.resolve(serverDir, '../../client/dist'),
    // Prod with rootDir='..': dist/server/src/ -> ../../../../client/dist
    path.resolve(serverDir, '../../../../client/dist'),
    // Monorepo deploy layout: <cwd>/app/client/dist
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'index.html'))) return c;
  }
  return candidates[0];
}
