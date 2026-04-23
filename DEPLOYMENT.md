# Running ak_baseball

## Local dev (recommended for iterating on the UI)

```bash
cd app
npm install
npm run dev
```

Opens two servers:
- Vite (client) at http://localhost:5173 — visit this
- Express (API) at http://localhost:8000 — proxied by Vite

By default `USE_REAL_SQL=false`, so all `/api/*` routes return deterministic mock data — no Databricks connection required. Every page renders (League / Team / Player / News) so you can iterate on the charts aesthetic without waiting on a warehouse round-trip.

To point at the live warehouse instead:

```bash
export USE_REAL_SQL=true
export DATABRICKS_HOST="https://fevm-production-forecasting.cloud.databricks.com"
export DATABRICKS_TOKEN="<your-pat>"
export DATABRICKS_WAREHOUSE_ID=6f1ac903576b114a
export DATABRICKS_CATALOG=production_forecasting_catalog
export DATABRICKS_SCHEMA=ak_baseball
npm run dev
```

## Current Databricks state (as of 2026-04-23)

Already deployed and working against `production_forecasting_catalog.ak_baseball`:

- `ak_baseball_daily_refresh` — cron at 07:00 ET, 5 tasks: ingest → silver → gold → Elo → recaps
- `ak_baseball_backfill` — on-demand, 4 tasks (skips recaps)
- SQL Warehouse: `6f1ac903576b114a` (Serverless Starter)

Gold tables populated for the 2026 season to date. Cubs are 14-10 as of 2026-04-22 (verified).

## Deploying updates

```bash
# From repo root
databricks bundle validate --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting
databricks bundle deploy   --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting
```

## Running a backfill

```bash
# Current season only (fast; ~3 min once cached)
databricks bundle run ak_baseball_backfill \
  --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting \
  --params 'seasons_back=0'

# Full 4 seasons (much slower, ~30-60 min of MLB API calls)
databricks bundle run ak_baseball_backfill \
  --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting \
  --params 'seasons_back=3'
```

## Running the daily refresh manually

```bash
databricks bundle run ak_baseball_daily_refresh \
  --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting
```

## Spot-check data

```sql
-- As of today's latest data
SELECT team_abbrev, w_minus_l, cum_wins, cum_losses, as_of_date
FROM production_forecasting_catalog.ak_baseball.gold_division_trajectory
WHERE season = 2026 AND division = 'NL Central'
  AND as_of_date = (
    SELECT MAX(as_of_date)
    FROM production_forecasting_catalog.ak_baseball.gold_division_trajectory
    WHERE season = 2026
  )
ORDER BY w_minus_l DESC;

-- Today's / yesterday's upsets
SELECT game_date, home_team_id, away_team_id, home_win_prob, upset_flag
FROM production_forecasting_catalog.ak_baseball.gold_game_elo
WHERE upset_flag = true
ORDER BY game_date DESC LIMIT 10;
```

## Deploying the app to Databricks Apps

`app.yaml` uses `command: ['npm', 'run', 'start']` which expects a pre-built client. To deploy:

```bash
cd app
npm install
npm run build     # produces app/client/dist/ and app/server/dist/
cd ..
databricks bundle deploy --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting
databricks bundle run ak_baseball_app --var 'warehouse_id=6f1ac903576b114a' -p fe-vm-production-forecasting
```

Then `USE_REAL_SQL=true` in `app/app.yaml` before that second deploy if you want the deployed app to hit the warehouse (default is mocks).

Logs:

```bash
databricks apps logs ak-baseball-dev -p fe-vm-production-forecasting
```

## Teardown

```bash
databricks bundle destroy -p fe-vm-production-forecasting --auto-approve
```

Data stays in Unity Catalog — drop the schema separately if you want:

```sql
DROP SCHEMA production_forecasting_catalog.ak_baseball CASCADE;
```
