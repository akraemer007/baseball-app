// Thin wrapper around @databricks/sql.
//
// Supports two auth modes, selected automatically:
//   1. Personal access token (DATABRICKS_TOKEN) — used in local dev.
//   2. Service-principal OAuth (DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET)
//      — injected automatically into Databricks Apps runtimes.

import { DBSQLClient } from '@databricks/sql';
import { config } from '../config.js';

let clientPromise: Promise<DBSQLClient> | null = null;

function getHost(): string | undefined {
  const raw = config.databricksHost;
  if (!raw) return undefined;
  // Strip scheme if present (Databricks Apps inject just the hostname,
  // but the local .env often uses the full https:// URL).
  return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

async function buildClient(): Promise<DBSQLClient> {
  const host = getHost();
  if (!host) {
    throw new Error('DATABRICKS_HOST is not set');
  }
  if (!config.warehouseId) {
    throw new Error('DATABRICKS_WAREHOUSE_ID is not set');
  }

  const path = `/sql/1.0/warehouses/${config.warehouseId}`;
  const client = new DBSQLClient();

  if (config.clientId && config.clientSecret) {
    // Service-principal OAuth (Databricks Apps runtime).
    await client.connect({
      host,
      path,
      authType: 'databricks-oauth',
      oauthClientId: config.clientId,
      oauthClientSecret: config.clientSecret,
    } as unknown as Parameters<DBSQLClient['connect']>[0]);
  } else if (config.databricksToken) {
    // Personal access token (local dev).
    await client.connect({ host, path, token: config.databricksToken });
  } else {
    throw new Error(
      'No Databricks credentials. Set DATABRICKS_TOKEN (local) or deploy as a Databricks App ' +
        '(which injects DATABRICKS_CLIENT_ID/SECRET automatically).'
    );
  }

  return client;
}

export async function getClient(): Promise<DBSQLClient> {
  if (!clientPromise) {
    clientPromise = buildClient().catch((err) => {
      clientPromise = null; // reset so the next call retries
      throw err;
    });
  }
  return clientPromise;
}

export interface QueryOptions {
  catalog?: string;
  schema?: string;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  options: QueryOptions = {}
): Promise<T[]> {
  const client = await getClient();
  const session = await client.openSession({
    initialCatalog: options.catalog || config.catalog,
    initialSchema: options.schema || config.schema,
  });
  try {
    const op = await session.executeStatement(sql, { runAsync: true });
    const rows = (await op.fetchAll()) as T[];
    await op.close();
    return rows;
  } finally {
    await session.close();
  }
}
