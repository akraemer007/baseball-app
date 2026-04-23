# ak_baseball

Personal MLB stats viewer running on Databricks Apps. Node.js/Express backend, React/Vite frontend, shared TypeScript types.

## Layout

```
app/
  app.yaml             Databricks Apps runtime config
  package.json         npm workspaces root
  shared/              Types shared by server + client
  server/              Express API (tsx in dev, compiled JS in prod)
    src/routes/        /api/* handlers (currently mocks)
    src/lib/
      cache.ts         LRU cache middleware (5min TTL)
      warehouse.ts     @databricks/sql client (wired, not yet used)
    src/mocks/data.ts  Deterministic mock responses
  client/              React + Vite + TypeScript
    src/pages/         League, Team, Player, News
    src/components/    NavBar (more to come)
```

## First-time setup

```bash
cd app
npm install
```

## Dev

Runs the Express server on :8000 and Vite on :5173 (Vite proxies `/api` to Express).

```bash
npm run dev
# open http://localhost:5173
```

Environment variables (all optional in dev — server returns mocks without them):

```
DATABRICKS_WAREHOUSE_ID=...
DATABRICKS_CATALOG=fevm_shared_catalog
DATABRICKS_SCHEMA=ak_baseball
DATABRICKS_HOST=...          # for real SQL (future)
DATABRICKS_TOKEN=...          # or DATABRICKS_CLIENT_ID/SECRET
```

## Build + run production locally

```bash
npm run build
npm start
# open http://localhost:8000
```

## API surface (mock data today)

- `GET /api/health`
- `GET /api/league/divisions?season=YYYY`
- `GET /api/team/:teamId?season=YYYY`
- `GET /api/player/:playerId?season=YYYY`
- `GET /api/news/recaps?date=YYYY-MM-DD`
- `GET /api/projections/today`

All GETs share an in-memory 5-minute LRU cache. Check `X-Cache: HIT|MISS`.
