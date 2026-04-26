# Databricks notebook source
# MAGIC %md
# MAGIC # Hourly ingest: per-game playByPlay → bronze
# MAGIC
# MAGIC For each Final game in `silver_game` for the current season that
# MAGIC isn't already in `bronze_playbyplay`, pulls
# MAGIC `https://statsapi.mlb.com/api/v1/game/{pk}/playByPlay` and lands
# MAGIC the gzipped JSON.
# MAGIC
# MAGIC Idempotent by `game_pk`. Safe to re-run hourly — only new finals get
# MAGIC fetched.

# COMMAND ----------
import gzip
import json
import os
import sys
import time as _time
from datetime import date

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("season", "")  # blank = current season

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
season_str = dbutils.widgets.get("season")
season = int(season_str) if season_str else date.today().year

sys.path.insert(0, os.path.abspath("../common"))
from mlb_stats_api import MlbStatsApiClient  # noqa: E402

fq = f"{catalog}.{schema}"

# COMMAND ----------
def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry a SQL statement on UC TEMPORARILY_UNAVAILABLE — the workspace
    rate-limits CREATE TABLE/SCHEMA IF NOT EXISTS metadata calls.
    Mirrors the helper in silver_transforms.py / backfill.py."""
    last_exc = None
    backoff = initial_backoff_s
    for attempt in range(1, attempts + 1):
        try:
            return spark.sql(sql)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "TEMPORARILY_UNAVAILABLE" in msg or "Too many requests" in msg:
                last_exc = exc
                print(f"  UC busy (attempt {attempt}/{attempts}); sleeping {backoff:.1f}s")
                _time.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
                continue
            raise
    raise RuntimeError(f"UC remained unavailable after {attempts} attempts: {last_exc}")


# COMMAND ----------
# Bronze table: one row per game_pk. Payload is gzipped JSON to keep storage
# tight (raw playByPlay is 5–20KB, gzip ~80% reduction). BINARY type maps
# cleanly to Postgres bytea for the future migration.
_retry_sql(f"""
    CREATE TABLE IF NOT EXISTS {fq}.bronze_playbyplay (
        game_pk BIGINT,
        season INT,
        fetched_at_utc TIMESTAMP,
        payload_gz BINARY
    ) USING DELTA
""")

# COMMAND ----------
# Find Final games for this season that don't yet have a bronze row.
existing = {
    row.game_pk for row in spark.sql(
        f"SELECT game_pk FROM {fq}.bronze_playbyplay WHERE season = {season}"
    ).collect()
}

finals = spark.sql(f"""
    SELECT game_pk, game_date
    FROM {fq}.silver_game
    WHERE season = {season} AND status = 'Final'
""").collect()

to_fetch = [(int(r.game_pk), r.game_date) for r in finals if int(r.game_pk) not in existing]
print(f"season {season}: {len(finals)} final games, {len(existing)} already ingested, {len(to_fetch)} to fetch")

# COMMAND ----------
client = MlbStatsApiClient()

batch: list[dict] = []
BATCH_SIZE = 100

for i, (pk, _gd) in enumerate(to_fetch, 1):
    try:
        result = client.play_by_play(pk)
        # Defensive: a suspended or partial game returns a payload with an
        # empty/short `allPlays`. Land it anyway — silver will produce
        # whatever rows exist; we'd rather have the bronze record so we
        # don't refetch on every hourly run.
        gz = gzip.compress(json.dumps(result.payload).encode("utf-8"))
        batch.append({
            "game_pk": pk,
            "season": season,
            "payload_gz": gz,
        })
    except Exception as exc:  # noqa: BLE001
        # Defensive: skip individual game failures (e.g. doubleheader
        # suspended-game pks that 404). Don't crash the whole run.
        print(f"  pk={pk} failed: {exc}")
        continue

    if len(batch) >= BATCH_SIZE or i == len(to_fetch):
        if not batch:
            continue
        # Pre-filter against `existing` already done; insert directly. No
        # MERGE needed — keeps the SQL Postgres-portable (plain INSERT).
        df = spark.createDataFrame(batch).selectExpr(
            "game_pk",
            "season",
            "current_timestamp() as fetched_at_utc",
            "payload_gz",
        )
        df.write.mode("append").saveAsTable(f"{fq}.bronze_playbyplay")
        print(f"  flushed batch ({i}/{len(to_fetch)})")
        batch = []

print("bronze_playbyplay ingest: done")
