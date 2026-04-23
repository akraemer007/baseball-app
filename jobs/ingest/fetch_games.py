# Databricks notebook source
# MAGIC %md
# MAGIC # Daily ingest: schedule + boxscores → bronze
# MAGIC
# MAGIC Pulls yesterday's completed games + today's probable-pitcher schedule from the MLB Stats API
# MAGIC and upserts into `bronze_schedule` and `bronze_boxscore`.

# COMMAND ----------
import json
import os
import sys
from datetime import date, timedelta

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("mode", "daily")  # "daily" | "date" (uses `target_date`)
dbutils.widgets.text("target_date", "")  # YYYY-MM-DD, used when mode=date

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
mode = dbutils.widgets.get("mode")
target_date_str = dbutils.widgets.get("target_date")

# Bring in the shared API client
sys.path.insert(0, os.path.abspath("../common"))
from mlb_stats_api import MlbStatsApiClient  # noqa: E402

# COMMAND ----------
if mode == "daily":
    # Yesterday's completed games + today's schedule
    today = date.today()
    dates_to_fetch = [today - timedelta(days=1), today]
elif mode == "date":
    d = date.fromisoformat(target_date_str)
    dates_to_fetch = [d]
else:
    raise ValueError(f"unknown mode: {mode}")

print(f"Fetching dates: {dates_to_fetch}")

# COMMAND ----------
client = MlbStatsApiClient()

schedule_rows = []
boxscore_rows = []

for d in dates_to_fetch:
    sched = client.schedule(d)
    schedule_rows.append({
        "fetch_date": d.isoformat(),
        "payload": json.dumps(sched.payload),
    })

    # Iterate completed games and grab boxscores — dedupe by game_pk so a
    # rescheduled game that shows up under multiple dates isn't fetched twice.
    seen_pks_today: set[int] = {int(r["game_pk"]) for r in boxscore_rows}
    for date_entry in sched.payload.get("dates", []):
        for game in date_entry.get("games", []):
            status = game.get("status", {}).get("abstractGameState", "")
            if status != "Final":
                continue
            game_pk = int(game["gamePk"])
            if game_pk in seen_pks_today:
                continue
            seen_pks_today.add(game_pk)
            try:
                box = client.boxscore(game_pk)
                boxscore_rows.append({
                    "game_pk": game_pk,
                    "game_date": d.isoformat(),
                    "payload": json.dumps(box.payload),
                })
            except Exception as exc:  # noqa: BLE001
                print(f"  boxscore {game_pk} failed: {exc}")

print(f"schedule rows: {len(schedule_rows)}  boxscore rows: {len(boxscore_rows)}")

# COMMAND ----------
# Schema created out-of-band during deployment; don't issue CREATE SCHEMA here.

# Bronze schedule: one row per fetched-day
sched_df = spark.createDataFrame(schedule_rows).selectExpr(
    "fetch_date",
    "current_timestamp() as fetched_at_utc",
    "payload",
)
(
    sched_df.write
    .mode("overwrite")
    .option("replaceWhere", "fetch_date in ('" + "','".join(r["fetch_date"] for r in schedule_rows) + "')")
    .saveAsTable(f"{catalog}.{schema}.bronze_schedule")
)

# Bronze boxscore: one row per game_pk
if boxscore_rows:
    box_df = spark.createDataFrame(boxscore_rows).selectExpr(
        "game_pk",
        "game_date",
        "current_timestamp() as fetched_at_utc",
        "payload",
    )
    # Upsert (MERGE) so a re-run replaces rather than duplicates
    box_df.createOrReplaceTempView("boxscore_stage")
    spark.sql(f"""
        MERGE INTO {catalog}.{schema}.bronze_boxscore AS t
        USING boxscore_stage AS s
        ON t.game_pk = s.game_pk
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)

print("bronze ingest: done")
