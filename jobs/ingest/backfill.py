# Databricks notebook source
# MAGIC %md
# MAGIC # One-shot backfill: 4 seasons of schedules + boxscores → bronze
# MAGIC
# MAGIC Pulls full schedules for the current season + N prior seasons (default 3), then
# MAGIC boxscores for every final game.
# MAGIC
# MAGIC Idempotent: re-running merges updates in. Expected runtime ~30-60 min on serverless.

# COMMAND ----------
import json
import os
import sys
import time
from datetime import date

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("seasons_back", "3")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
seasons_back = int(dbutils.widgets.get("seasons_back"))

sys.path.insert(0, os.path.abspath("../common"))
from mlb_stats_api import MlbStatsApiClient  # noqa: E402

# COMMAND ----------
current_season = date.today().year
seasons = list(range(current_season - seasons_back, current_season + 1))
print(f"backfilling seasons: {seasons}")

client = MlbStatsApiClient()

import time as _time


def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry a SQL statement with exponential backoff. UC metadata calls can be
    rate-limited (TEMPORARILY_UNAVAILABLE: Too many requests); this gives them
    time to recover instead of failing the whole job."""
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


# Schema is pre-created by the deployment step. Don't issue CREATE SCHEMA here:
# under UC load it's the first call to fail.
# Create bronze tables if they don't exist (idempotent, cheap when they already exist)
_retry_sql(f"""
    CREATE TABLE IF NOT EXISTS {catalog}.{schema}.bronze_schedule (
        fetch_date STRING, fetched_at_utc TIMESTAMP, payload STRING
    ) USING DELTA
""")
_retry_sql(f"""
    CREATE TABLE IF NOT EXISTS {catalog}.{schema}.bronze_boxscore (
        game_pk BIGINT, game_date STRING, fetched_at_utc TIMESTAMP, payload STRING
    ) USING DELTA
""")

# COMMAND ----------
# For each season, fetch the full schedule in one API call (startDate..endDate)
# then iterate over every game to pull boxscore.
# Regular season roughly March 20 → October 5, postseason into November.

SEASON_WINDOW = {
    # (start, end) in MM-DD — wide window to catch spring training end and postseason
    "default": ("03-15", "11-15"),
}

for season in seasons:
    start_mmdd, end_mmdd = SEASON_WINDOW["default"]
    start_d = f"{season}-{start_mmdd}"
    end_d = f"{season}-{end_mmdd}"
    print(f"\n=== {season}: {start_d} → {end_d} ===")

    sched = client.schedule_range(start_d, end_d)
    schedule_row = [{
        "fetch_date": f"{season}-season",
        "payload": json.dumps(sched.payload),
    }]
    sched_df = spark.createDataFrame(schedule_row).selectExpr(
        "fetch_date",
        "current_timestamp() as fetched_at_utc",
        "payload",
    )
    sched_df.createOrReplaceTempView("sched_stage")
    spark.sql(f"""
        MERGE INTO {catalog}.{schema}.bronze_schedule AS t
        USING sched_stage AS s
        ON t.fetch_date = s.fetch_date
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

    # Collect every Final game_pk for this season. Rescheduled games can show
    # up under two dates (original + new) in the schedule payload, so dedupe
    # by pk here — keep the first occurrence so a game is associated with its
    # originally scheduled date.
    seen_pks: set[int] = set()
    game_pks: list[tuple[int, str]] = []
    for date_entry in sched.payload.get("dates", []):
        d = date_entry["date"]
        for game in date_entry.get("games", []):
            if game.get("status", {}).get("abstractGameState") != "Final":
                continue
            pk = int(game["gamePk"])
            if pk in seen_pks:
                continue
            seen_pks.add(pk)
            game_pks.append((pk, d))
    print(f"  {len(game_pks)} final games to fetch boxscores for")

    # Find already-ingested game_pks so we can skip
    existing = set(
        row.game_pk for row in spark.sql(
            f"SELECT game_pk FROM {catalog}.{schema}.bronze_boxscore"
        ).collect()
    )
    to_fetch = [(pk, d) for pk, d in game_pks if pk not in existing]
    print(f"  skipping {len(game_pks) - len(to_fetch)} already-ingested")

    batch: list[dict] = []
    BATCH_SIZE = 200
    for i, (pk, d) in enumerate(to_fetch, 1):
        try:
            box = client.boxscore(pk)
            batch.append({
                "game_pk": pk,
                "game_date": d,
                "payload": json.dumps(box.payload),
            })
        except Exception as exc:  # noqa: BLE001
            print(f"    pk={pk} failed: {exc}")
            continue

        if len(batch) >= BATCH_SIZE or i == len(to_fetch):
            # Dedup the batch on game_pk before merging — if a rescheduled game
            # showed up under two dates we'd otherwise stage it twice.
            deduped = {row["game_pk"]: row for row in batch}
            box_df = spark.createDataFrame(list(deduped.values())).selectExpr(
                "game_pk", "game_date", "current_timestamp() as fetched_at_utc", "payload",
            )
            box_df.createOrReplaceTempView("box_stage")
            spark.sql(f"""
                MERGE INTO {catalog}.{schema}.bronze_boxscore AS t
                USING box_stage AS s
                ON t.game_pk = s.game_pk
                WHEN MATCHED THEN UPDATE SET *
                WHEN NOT MATCHED THEN INSERT *
            """)
            print(f"    flushed batch ({i}/{len(to_fetch)})")
            batch = []

print("\nbackfill: done")
