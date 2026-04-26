# Wave 2 Status (paused on IP ACL block)

Hit a workspace IP ACL block at ~02:30 ET — your home IP shifted to
`136.62.60.108`. Either:
- Add that IP to the workspace allowlist, OR
- Reconnect from a previously-allowlisted IP

…and we can pick up from where we left off.

## Done

- **PIPE-0.5 — silver_play.** 41,255 plays / 541 games / Mar 15 – Apr 25.
  Fix landed: `bronze_playbyplay.season BIGINT` (was INT, broke schema
  merge against Spark-inferred LongType).

- **PIPE-1 — silver_pa + silver_pitch.** 6,465 PAs / 25,000 pitches / 93
  games. Coverage Apr 18 – Apr 24 only (one week, not full season).
  Statcast CSV defaults / soft cap shrunk what landed; the agent's
  two-month windows are in fetch_statcast.py but only the most recent
  bin's data made it through. Worth investigating — the rest of the
  season may need a one-off backfill on the statcast endpoint.
  Fix landed: dropped `pandas>=2.0` from the bundle env_dependencies
  (pandas is bundled in serverless; explicit dep broke env init for
  every task in the bundle).

- **PIPE-2 — silver_transaction.** 7,510 transactions / 18 typeCodes /
  Apr 10 2025 – Apr 25 2026.

## In-flight when blocked

- **PIPE-3 — multi-year backfill (seasons_back=6).** Run id
  `82578636791056` on job 319128671612760. Was RUNNING ~5 min in when
  the IP block hit. Status unknown until you can reach the workspace
  again.

  **Next steps once unblocked:**
  1. `databricks jobs list-runs --job-id 319128671612760 --limit 1
     -p fe-vm-production-forecasting` → confirm SUCCESS.
  2. Trigger hourly refresh (1095540251664557) to roll the new
     2020-2025 bronze into silver + gold.
  3. Verify multi-year coverage:
     ```
     SELECT season, COUNT(*) AS rows
       FROM production_forecasting_catalog.ak_baseball.silver_player_season
      GROUP BY season ORDER BY season;
     ```
     Expect rows for 2020 – 2026 (2020 is COVID short season, ~half).

- **PIPE-4 — sportsbook odds.** Optional per BACKLOG; skipping.

## Wave 2 commits on main

- `cd7bf4f` PIPE-2: ingest MLB transactions
- `f673044` PIPE-1 fix: drop pandas dep
- `4257db0` PIPE-1: Statcast ingest
- `e5f353d` PIPE-0.5 fix: bronze_playbyplay.season BIGINT
- `323eee6` PIPE-0.5: ingest playByPlay → silver_play

Nothing pushed; all on local main.

## Gotcha for the next agent dispatch

PIPE-1 broke ingest_schedule_and_games (the FIRST task in the chain)
because adding `pandas>=2.0` to the bundle env-deps caused
serverless env init to fail with `SystemError: Internal error: spark
should be initialized with the first notebook command.` Lesson:
**pandas (and other Databricks-bundled libs) should NOT be added to
`environments[].dependencies` — they're already there.** Same
likely true for numpy, pyarrow, and other big-ticket scientific libs.
The `requests>=2.32` line is fine because it's a small client lib not
already bundled.
