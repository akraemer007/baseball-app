# ak_baseball

Personal MLB stats app. Node/React front-end backed by a Databricks SQL
Warehouse and Unity Catalog. Two scheduled jobs drive the pipeline:
1. **Hourly refresh** — fires every :00 during active baseball hours
   (noon ET through 4 AM ET the next morning). Chain: MLB Stats API
   → bronze JSON in UC → silver Delta → gold aggregates → Elo ratings.
2. **Morning recaps** — 5 AM ET daily. Re-runs the same chain to catch
   late West Coast finishes, then generates LLM-powered newspaper-style
   game recaps from `gold_game_recap_input`.

The app's voice today is "thoughtful, opinionated, dense-but-not-cluttered." Any new change that breaks it — flashy animations, splash screens, too many panels — subtracts.

A migration plan off Databricks exists (see Reference docs) but we're
still on Databricks today.

## Repo layout

- `app/` — npm workspaces:
  - `client/` — Vite + React + d3 (no chart library)
  - `server/` — Express + `@databricks/sql`
  - `shared/` — types shared across client + server
- `jobs/` — Python pipeline scripts (ingest, refine, gold, elo, recaps).
  Notebook-style scripts runnable from Databricks bundles.
- `resources/` — Databricks Asset Bundle YAML
  (`hourly_refresh_job.yml`, `morning_recaps_job.yml`).
- `scripts/dev.sh` — one-shot local dev: fetches fresh OAuth token,
  starts client + server on 5173 / 8000.

All UC reads happen through one file: `app/server/src/queries/index.ts`
(+ `app/server/src/lib/warehouse.ts`). When storage changes, that's the
only substantive file that changes.

## Key commands

```
./scripts/dev.sh                                            # local dev
cd app && npm run build                                     # prod build
databricks bundle deploy --var 'warehouse_id=6f1ac903576b114a' \
  -p fe-vm-production-forecasting                           # deploy
databricks bundle run ak_baseball_app \
  --var 'warehouse_id=6f1ac903576b114a' \
  -p fe-vm-production-forecasting                           # (re)start app
databricks apps logs ak-baseball-dev -p fe-vm-production-forecasting
```

## Gotchas worth knowing

- **OAuth tokens cycle hourly.** `scripts/dev.sh` refreshes them at
  startup. If local dev starts 401-ing mid-session, re-run the script.
- **UC throttles `CREATE TABLE/SCHEMA IF NOT EXISTS`** on this
  workspace. Ingest notebooks retry with backoff; see the pattern in
  `jobs/common/mlb_stats_api.py` (also the 50ms polite delay for the
  public MLB API).
- **Fix data issues at the pipeline, not the app.** A duplicate bronze
  row once got papered over at silver — wrong call. Correct the source
  in `jobs/ingest` or `jobs/refine` instead.
- **Databricks CLI ≥ 0.298.0** required — older versions fail deploy
  with `openpgp: key expired`.

## Reference docs

Not auto-loaded. Pull in with `@filename.md` or Read when the topic
comes up.

- `rebuild_without_databricks.md` — migration plan (Fly + Neon + R2 +
  Anthropic). Read when cost, hosting alternatives, or porting the
  pipeline comes up.
- `make_it_impressive.md` — feature brainstorm (matchup preview,
  Statcast ingest, xwOBA, WPA charts). Read when "what should I build
  next?" comes up.
