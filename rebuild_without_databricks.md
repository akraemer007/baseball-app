# Rebuilding ak_baseball without Databricks

Goal: keep the same product (News page, League page, Team page, Elo-based projections, LLM recaps) but host it as a small personal project. Target **≤ $20/month total**, minimal ops, no UC rate-limit headaches, no OAuth-token cycling. Optimized for "solo dev with a handful of sleepy apps" — not a team or a business.

## What the Databricks side actually does today

| Piece | What it is | Can it move off Databricks? |
| --- | --- | --- |
| `jobs/ingest` | Python worker calling MLB Stats API, writes bronze JSON tables | Yes — it's just HTTP + table writes |
| `jobs/refine/silver_transforms.py` | Python + SQL: parses payloads into typed tables | Yes — plain Python/SQL |
| `jobs/gold/build_gold.sql` | ~500 lines of SQL building league/team/player aggregates | Yes — runs fine on Postgres |
| `jobs/elo/compute_elo.py` | Pure-Python Elo calc over finals | Yes — tiny script |
| `jobs/recaps/generate_recaps.py` | Interest scoring + prompt → **databricks-claude-haiku-4-5** via Foundation Model Serving | Swap endpoint for Anthropic API, keep prompt |
| SQL Warehouse Serverless | Powers Node app reads | Replace with Neon Postgres |
| Databricks App hosting | Serves Node/React | Replace with Fly.io |
| Scheduling | `resources/*.yml` job cron | Replace with Fly Machines cron |

The app already isolates warehouse access to `app/server/src/queries/index.ts`. That single file is what changes when storage changes. The client code and the SQL itself stay the same.

## Rough load

- ~15 MLB games/day for ~6 months → ~2,700 games/season
- Boxscore JSON ~100–300 KB per game → whole season bronze ≈ 1 GB
- Parsed silver/gold is tiny (few MB)
- Writes: one hourly refresh loop + one morning recap batch
- Reads: just me, so RPS is essentially zero

**You do not need a warehouse.** A single-digit-GB Postgres covers every query in this app with room to spare.

---

## Recommended stack

**Fly.io + Neon + Cloudflare R2 + Anthropic API.** Three dashboards, all with generous free tiers, all solo-dev-friendly.

| Layer | Service | Cost |
| --- | --- | --- |
| App (Node + React) | Fly.io — 1 always-running or auto-stop Machine | $0–$3/mo |
| Cron jobs (ingest, silver, gold, elo, recaps) | Fly.io scheduled Machines | $0–$2/mo |
| Silver/gold tables | Neon Postgres free tier (0.5 GB) | $0 |
| Bronze JSON payloads | Cloudflare R2 (10 GB free, no egress fee) | $0 |
| DNS + SSL + CDN | Cloudflare | $0 |
| Recap LLM | Anthropic API (Haiku 4.5) | ~$2.50/mo |
| Domain (optional) | Namecheap | ~$1/mo amortized |
| **Total** | | **~$5–$9/mo** |

### Why this stack

- **Fly** auto-stops Machines when idle and pays by the second, so a quiet site costs pennies. One Fly account scales to however many other sleepy projects you build next. Per-app `fly.toml`, one `fly deploy` per change.
- **Neon** free tier is enough for this workload indefinitely. Standard `pg` driver, real Postgres, scale-to-zero for idle.
- **R2** has the single best storage deal for solo devs: no egress fees. 10 GB free. Bronze payloads never touch your app tier, only the ingest cron.
- **Cloudflare DNS** is free and pairs with R2 in one account. Point your domain at Fly; done.
- **Anthropic direct API** drops ~$2.50/mo for ~15 recaps a day at Haiku prices.

### Why not the alternatives

- **Render:** Simpler, but $7/mo always-on flat fee doesn't reward a sleepy site. If you plan to host multiple small projects, Fly's "pay only when traffic" model compounds.
- **Cloudflare Workers for the app:** Would require rewriting Express to Hono + swapping `pg` for `@neondatabase/serverless`. Worth it if you rebuild the API layer; not worth it for a port.
- **DuckDB file on disk / SQLite:** Cheaper still, but you lose the "warehouse is elsewhere, app is stateless" separation the current code already has.

---

## Human-only setup (≈ 1 hour)

These require a human with credit card / email confirmations. GenAI can't do them.

1. **Accounts** (free tiers throughout)
   - `fly.io` — signup, add credit card (no charge if you stay in free tier)
   - `neon.tech` — signup, create project
   - `cloudflare.com` — signup, verify email
   - `console.anthropic.com` — signup, add $5–$10 of prepaid credit
   - (Existing GitHub account — no new signup)

2. **Resource creation**
   - Neon: create database, copy the connection string (starts with `postgresql://`)
   - Cloudflare: create R2 bucket (e.g. `ak-baseball-bronze`), generate an R2 API token (Access Key ID + Secret)
   - Cloudflare: move your domain's DNS to Cloudflare (optional but recommended)
   - Anthropic: generate an API key (`sk-ant-...`)

3. **Install tooling on your laptop**
   - `brew install flyctl` — Fly CLI
   - `flyctl auth login` — browser-based login

4. **DNS + domain** (only if you want a custom URL)
   - After `fly deploy` succeeds, add a CNAME in Cloudflare from `baseball.yourdomain.com` → the Fly app's `*.fly.dev` host
   - Issue certs: `fly certs create baseball.yourdomain.com`

5. **Secrets into Fly** (after accounts exist)
   ```
   fly secrets set DATABASE_URL="postgresql://..." -a ak-baseball
   fly secrets set ANTHROPIC_API_KEY="sk-ant-..." -a ak-baseball
   fly secrets set R2_ACCESS_KEY_ID="..." -a ak-baseball
   fly secrets set R2_SECRET_ACCESS_KEY="..." -a ak-baseball
   fly secrets set R2_BUCKET="ak-baseball-bronze" -a ak-baseball
   fly secrets set R2_ACCOUNT_ID="..." -a ak-baseball
   ```

Everything else in this doc is stuff a GenAI agent can drive.

---

## AI-automatable work

Each item below is a scoped, mergeable change a future Claude session can handle end-to-end with the right prompt. Starter prompts at the bottom of this doc.

| Task | Effort | Touches |
| --- | --- | --- |
| Port `jobs/gold/build_gold.sql` Delta → Postgres | ~2 hr AI | `jobs/gold/` |
| Port `jobs/refine/silver_transforms.py` to read R2 / write Neon | ~1 hr AI | `jobs/refine/` |
| Port `jobs/ingest/*.py` to write bronze to R2 (gzipped NDJSON) | ~1 hr AI | `jobs/ingest/` |
| Port `jobs/elo/compute_elo.py` to Neon | ~30 min AI | `jobs/elo/` |
| Port `jobs/recaps/generate_recaps.py` to Anthropic SDK | ~30 min AI | `jobs/recaps/` |
| Rewrite `app/server/src/queries/index.ts` from `@databricks/sql` → `pg` | ~1 hr AI | `app/server/src/queries/` |
| Write `Dockerfile` for the Node app | ~15 min AI | repo root |
| Write `fly.toml` for the web service | ~15 min AI | repo root |
| Write Fly Machine schedule for cron jobs | ~30 min AI | `fly/` or `infra/` |
| Local `docker compose` for Postgres + app | ~20 min AI | repo root |
| Drop `resources/*.yml`, `jobs/common/mlb_stats_api.py` Databricks bits | ~20 min AI | repo-wide |

**Total AI-supervised effort: ~8 hours** spread across a week of evenings.

---

## Phased migration path

### Phase 0 — Parallel build, zero risk

Keep the Databricks stack running. Build the Fly/Neon/R2 side in parallel on a new branch. Only cut over when the new stack passes an end-to-end smoke test.

### Phase 1 — Data plane (Neon + R2)

**What you do:** create Neon project, create R2 bucket (covered above).

**What AI does:**
- Port `build_gold.sql` to Postgres syntax on a new branch. Run it locally against `docker compose postgres` with a snapshot of silver data.
- Rewrite `queries/index.ts` to use `pg`. Keep the return shapes exactly the same so the client code doesn't change.
- Write a throwaway `scripts/snapshot_databricks_to_local.py` that pulls your current silver/gold tables out of UC into local Postgres so you can A/B the queries.

**Success criteria:** for a pinned (season, date), both the old Databricks-backed app and the new Neon-backed app return byte-identical JSON for every endpoint.

### Phase 2 — Pipeline port (R2 + Neon, running locally)

**What AI does:**
- Port `fetch_games.py` and friends to write bronze as gzipped NDJSON to R2.
- Port `silver_transforms.py` to read R2 and write to Neon.
- Port `build_gold.sql` runner (SQL stays in a `.sql` file, executed via psycopg's `cursor.execute()`).
- Port `compute_elo.py` to Neon reads/writes.
- Port `generate_recaps.py`: swap the Databricks `WorkspaceClient().serving_endpoints.query` for `anthropic.Anthropic().messages.create`. Keep the prompt file, keep the interest scoring — only the transport changes.

**What you do:** run each stage locally once. Diff row counts against Databricks. Spot-check a recap or two.

### Phase 3 — App on Fly

**What AI does:**
- Write a multi-stage `Dockerfile` (build React in one stage, copy to Node runtime in another).
- Write `fly.toml` with `auto_stop_machines = "stop"` and `min_machines_running = 0`.
- Write a `.dockerignore` that excludes `node_modules`, `dist`, `.env`.

**What you do:**
- `fly launch --no-deploy` to create the app shell.
- `fly secrets set ...` for all the env vars.
- `fly deploy` and hit the URL.

**Success criteria:** the app loads, queries Neon, every page renders with real data. Cold start feels fine (≤2s).

### Phase 4 — Crons on Fly Machines

**What AI does:**
- Write a separate `Dockerfile.cron` (Python base) for the pipeline.
- Write `fly.toml` for a scheduler app, or a second process group on the existing app.
- Write a short `run_hourly.sh` / `run_morning.sh` that chains ingest → silver → gold → elo (and recap for the morning variant).

**What you do:**
- `fly apps create ak-baseball-crons`
- Schedule via `fly machines run --schedule hourly ...` and `--schedule daily` for recaps.
- Verify first run fires on time, writes to Neon, no errors in `fly logs`.

### Phase 5 — Cutover

**What you do:**
- Watch the Fly crons run for 24–48 hours against Neon. Compare a morning's recaps against what Databricks produced.
- Point your domain's CNAME from the Databricks app to Fly.
- Turn off the Databricks hourly + morning workflows (`databricks bundle destroy` or just pause).
- Optionally `DROP SCHEMA production_forecasting_catalog.ak_baseball CASCADE` once you're sure you won't want to diff against it again.

### Phase 6 — Cleanup

**What AI does:**
- Delete `resources/*.yml` (Databricks bundle definitions).
- Remove `@databricks/sql` from `app/server/package.json`.
- Purge `databricks` CLI references from scripts/README.
- Update CLAUDE.md and docs to reflect the new stack.

---

## Starter prompts for future Claude sessions

Each block below is a self-contained prompt you can paste into a fresh Claude Code session. They assume you've already created the accounts + secrets in the "Human-only setup" section above.

### Prompt 1 — Port build_gold.sql to Postgres

```
I'm migrating ak_baseball off Databricks to Postgres (Neon).

Task: port jobs/gold/build_gold.sql from Databricks SQL to Postgres SQL on a
new file at jobs/gold/build_gold.postgres.sql. Do NOT delete the original.

Dialect changes likely needed:
- MERGE INTO ... WHEN MATCHED → INSERT ... ON CONFLICT ... DO UPDATE
- CREATE OR REPLACE TABLE → DROP TABLE IF EXISTS + CREATE TABLE (or use views
  where possible — prefer views for read-only derived state)
- TIMESTAMP column types: Databricks' TIMESTAMP vs Postgres TIMESTAMPTZ
- No STRUCT/MAP/ARRAY syntax — if any is used, replace with jsonb or a
  separate join table
- FIRST(x) is a SQL Server/Databricks idiom; use (array_agg(x ORDER BY ...))[1]
  or a DISTINCT ON pattern
- Date math: DATE_ADD / DATE_SUB work differently; standardize on
  `date_col + interval '1 day'`

After porting, start a local Postgres with docker (suggest the command) and
prove the SQL runs end-to-end with a small fixture of silver data. Don't
invent the fixture — ask me for it or suggest how to snapshot it from
Databricks. Report which statements needed rewrites vs. which ran
unchanged, so I can spot-review.
```

### Prompt 2 — Rewrite the app's DB layer from DBSQL to pg

```
Context: ak_baseball's Node server currently reads from a Databricks SQL
Warehouse via @databricks/sql. I'm migrating to Neon Postgres.

Task: rewrite app/server/src/queries/index.ts to use `pg` instead of
@databricks/sql. Keep every exported function's signature and return shape
EXACTLY the same — the client-side code reads these shapes directly and
we don't want to touch the client in this commit.

Specifics:
- Create a single pg.Pool at module load, reading DATABASE_URL from env
- Replace every DBSQLClient/session/operation trio with a simple
  pool.query(text, values) call. Parameterize all user input with $1/$2/$n
  placeholders — no string concatenation
- Preserve the 5-minute LRU cache layer already in place (if any)
- Remove the @databricks/sql import and the dependency from package.json
- Add a typed `query<T>(text, params): Promise<T[]>` helper that maps
  pg.QueryResult.rows[0] → T so the call sites stay tidy

After editing, run `npx tsc --noEmit` from app/ and ensure no type errors.
Do NOT run the dev server — I'll do that with real secrets set. Do NOT
touch any file under app/client/src.
```

### Prompt 3 — Dockerfile + fly.toml for the web app

```
Task: write a production-ready Dockerfile + .dockerignore + fly.toml for
deploying the ak_baseball Node+React app to Fly.io.

Constraints:
- Multi-stage Dockerfile: stage 1 installs deps + runs `npm run build` in
  app/ (which builds both client and server via its workspaces setup),
  stage 2 is a node:20-alpine runtime that copies only dist/ + node_modules
- CMD runs the server (`npm run start --workspace=server`)
- Fly app listens on port 8000 (check app/server/src/index.ts to confirm)
- fly.toml uses auto-stop-idle (auto_stop_machines="stop", min_machines_running=0)
- Single region, ord (Chicago) — primary team is Cubs, makes sense
- HTTP service with force_https, health check on `/api/health` if one exists
  (check the server routes) or GET /

.dockerignore must at minimum exclude: node_modules, .git, .env, *.md,
tasks/, app/client/dist (gets built fresh inside the image).

Do NOT run fly launch or fly deploy — just write the files and tell me
what command to run. Tell me if any of the assumed npm scripts don't
exist so I can add them.
```

### Prompt 4 — Port the ingest job to R2 bronze

```
Task: port jobs/ingest/fetch_games.py (and any siblings in jobs/ingest/)
from writing to Databricks Delta tables to writing gzipped NDJSON into a
Cloudflare R2 bucket.

R2 is S3-compatible. Use boto3 with:
- endpoint_url = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
- aws_access_key_id = R2_ACCESS_KEY_ID
- aws_secret_access_key = R2_SECRET_ACCESS_KEY
- region_name = "auto"

Object key scheme: bronze/<table>/<YYYY>/<YYYY-MM-DD>/<game_pk>.ndjson.gz
(daily partitions, one object per game so reprocessing a single game is
cheap).

Preserve:
- The 50ms polite delay in jobs/common/mlb_stats_api.py
- The duplicate-game-pk dedup logic that was added after we learned
  rescheduled games appear under two dates
- The idempotency: re-running the ingest for a date should be a no-op
  if nothing changed (overwrite is fine for bronze)

Drop:
- Unity Catalog writes (spark.createDataFrame.saveAsTable)
- Databricks-specific retry decorators (we'll add our own if needed)
- The dbutils.widgets params interface — replace with argparse or just
  env vars / CLI args

Write a new `jobs/ingest/fetch_games_postgres.py` alongside the original
(do not delete the original yet). The new version should be runnable as
`python -m jobs.ingest.fetch_games_postgres --date 2026-04-23`.
```

### Prompt 5 — Swap the recap LLM call from Databricks to Anthropic

```
Task: in jobs/recaps/generate_recaps.py, replace the Databricks Foundation
Model Serving call with a direct Anthropic API call. Keep everything else
identical — interest scoring, prompt assembly, series_context logic,
NOT-EXISTS gating against gold_game_recap, all of it.

Current call shape (look for something like):
  client = WorkspaceClient()
  response = client.serving_endpoints.query(
    name="databricks-claude-haiku-4-5",
    messages=[...],
  )

Replace with:
  client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env
  response = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=800,
    messages=[...],
  )
  text = response.content[0].text

Add `anthropic` to the pyproject/requirements. Do NOT change the prompt
template file (jobs/recaps/prompts/game_recap_v2.md) — port is transport-
only. Preserve JSON-mode behavior if the old call used it: Anthropic's
equivalent is a system prompt like "Respond with ONLY a JSON object
matching this schema: {...}" and then json.loads on response.content[0].text.

After editing, add a quick smoke test block gated on `if __name__ ==
'__main__'` that loads one gold_game_recap_input row, runs the LLM, and
prints the result. Do NOT run it in this session — I want to review the
prompt before spending a cent.
```

### Prompt 6 — Fly Machine cron for the pipeline

```
Task: create a Fly.io Machine setup that runs the ak_baseball data
pipeline on a schedule.

Need two scheduled Machines:
1. Hourly refresh (ingest → silver → gold → elo), fires at :00 from 12 ET
   through 04 ET the next morning.
2. Morning recap (same chain + generate_recaps), fires at 05:00 ET daily.

Structure:
- New Dockerfile.cron based on python:3.11-slim that pip installs the job
  requirements and copies jobs/ into the image
- Entrypoint is a small shell script that takes one arg ("hourly" or
  "recaps") and runs the right chain of python -m commands
- fly.toml for this app uses [processes] with two groups, or two separate
  apps if Fly's schedule model requires it — you decide, document why

Deliverables:
- infra/cron/Dockerfile
- infra/cron/run.sh
- infra/cron/fly.toml
- A README.md in infra/cron/ telling me the exact `fly machines run
  --schedule` commands to set each cron, plus how to verify the next
  fire time.

Don't deploy — give me the commands.
```

### Prompt 7 — Repo cleanup after migration

```
Context: ak_baseball has successfully migrated off Databricks onto
Fly + Neon + R2 + Anthropic. All pipeline + app code is running on the
new stack. Task: remove Databricks leftovers.

Delete:
- resources/*.yml (Databricks Asset Bundle definitions)
- databricks.yml if present at repo root
- Any notebook-style "# COMMAND ----------" markers in jobs/ that were
  there for Databricks notebook compatibility
- `@databricks/sql` from app/server/package.json; run npm install so
  lockfile updates
- DEPLOYMENT.md (supersede with a new FLY_DEPLOY.md that reflects reality)

Rewrite or delete:
- CLAUDE.md memories that reference UC, bundle deploy, OAuth token cycling
  — replace with the Fly/Neon/R2 equivalents
- jobs/common/mlb_stats_api.py — keep the HTTP client, drop Databricks
  retry decorators if any
- scripts/dev.sh — no more OAuth token fetch, just `flyctl proxy 5432
  -a <neon-or-local-pg>` + `npm run dev`

Keep (paranoid safety net for one week post-cutover):
- jobs/gold/build_gold.sql (original Databricks version) — rename to
  build_gold.databricks.sql and leave alongside build_gold.postgres.sql
  until we're certain the new SQL is equivalent

Output a concise summary of what was deleted, what was renamed, and what
was rewritten. I want to eyeball it before you commit.
```

---

## Starter prompts as a set

If you want to feed all seven to a fresh Claude in order, a single top-level prompt:

```
I'm migrating a personal MLB stats app, ak_baseball, off Databricks onto
Fly.io + Neon Postgres + Cloudflare R2 + Anthropic API. The detailed
migration plan lives at rebuild_without_databricks.md in this repo. Read
it, then complete the numbered "Starter prompts" sections in order,
stopping after each one for my review. Don't start Prompt N+1 until I
explicitly say "ok, next." Before each prompt, list the specific files
you'll touch so I can sanity-check scope.
```

---

## What you give up

- **Unity Catalog / governance** — don't need it for a one-person project.
- **Notebook UI** — you already run everything as bundled jobs, so no loss.
- **`bundle deploy`** — replaced by `fly deploy`.
- **Foundation Model Serving** — trading for cheaper, faster direct Anthropic API.
- **The SQL Warehouse UI** — Neon has a web SQL editor, or use TablePlus / DBeaver / psql.
- **OAuth token cycling every hour** — Neon connection strings don't expire.

## What you keep

- All the Python pipeline code (minor edits to reads/writes).
- All the SQL in `build_gold.sql` (minor Postgres dialect edits).
- All the Elo math.
- All the recap prompt work, including the interest scorer.
- All the React/Node app code — `queries/index.ts` is the only file that changes substantially.
- Your whole CI/deploy mental model, just via `fly deploy` + Fly Machines scheduling instead of Databricks bundles.
- Your option to host the next N sleepy personal apps under the same Fly account at near-zero marginal cost.
