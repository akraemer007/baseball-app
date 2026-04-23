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
  clientStaticDir: path.resolve(__dirname, '../../client/dist'),
  useRealSql: process.env.USE_REAL_SQL === 'true',
};
