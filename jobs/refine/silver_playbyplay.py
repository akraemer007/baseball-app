# Databricks notebook source
# MAGIC %md
# MAGIC # Silver transform: bronze_playbyplay → silver_play
# MAGIC
# MAGIC One row per play (plate appearance / runner event). Source is the
# MAGIC gzipped JSON in `bronze_playbyplay`; the parser flattens
# MAGIC `payload['allPlays'][]` into typed rows.
# MAGIC
# MAGIC Lives in its own notebook (sibling to `silver_transforms.py`)
# MAGIC because it depends on `silver_game` already existing — the hourly
# MAGIC chain runs `refine_silver` → `ingest_playbyplay` → this task.

# COMMAND ----------
import gzip
import json
import os
import sys
import time as _time

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"{catalog}.{schema}"

sys.path.insert(0, os.path.abspath("../common"))
from parsers import parse_play_by_play  # noqa: E402

# COMMAND ----------
def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry on UC TEMPORARILY_UNAVAILABLE. Mirrors silver_transforms.py."""
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
# Pull bronze rows alongside the game_date / season from silver_game so
# the parser doesn't need to peek inside the JSON for those fields.
# Left join so a game_pk that landed in bronze before silver_game caught
# up still gets parsed (game_date / season just come back NULL — silver
# row remains queryable).
src_rows = spark.sql(f"""
    SELECT b.game_pk, b.season, b.payload_gz, g.game_date
    FROM {fq}.bronze_playbyplay b
    LEFT JOIN {fq}.silver_game g USING (game_pk)
""").collect()

print(f"bronze_playbyplay source rows: {len(src_rows)}")

# COMMAND ----------
all_plays: list[dict] = []
parse_failures = 0
for r in src_rows:
    try:
        raw = bytes(r.payload_gz) if r.payload_gz is not None else b""
        if not raw:
            continue
        payload = json.loads(gzip.decompress(raw).decode("utf-8"))
        all_plays.extend(parse_play_by_play(
            payload,
            game_pk=int(r.game_pk),
            season=int(r.season) if r.season is not None else None,
            game_date=r.game_date,  # date; spark createDataFrame handles native date
        ))
    except Exception as exc:  # noqa: BLE001
        # Defensive: a corrupt or truncated payload (suspended game,
        # partial response) shouldn't sink the whole transform.
        parse_failures += 1
        print(f"  parse failed for game_pk={getattr(r, 'game_pk', '?')}: {exc}")

print(f"silver_play rows: {len(all_plays)} (parse failures: {parse_failures})")

# COMMAND ----------
if all_plays:
    # Convert game_date to ISO string up front — Spark's createDataFrame
    # rejects mixed date/None values across rows in some versions.
    for row in all_plays:
        gd = row.get("game_date")
        if gd is not None and not isinstance(gd, str):
            row["game_date"] = gd.isoformat()

    df = spark.createDataFrame(all_plays)
    (
        df.selectExpr(
            "CAST(game_pk AS BIGINT) AS game_pk",
            "CAST(play_index AS INT) AS play_index",
            "CAST(inning AS INT) AS inning",
            "CAST(half_inning AS STRING) AS half_inning",
            "CAST(batter_id AS BIGINT) AS batter_id",
            "CAST(pitcher_id AS BIGINT) AS pitcher_id",
            "CAST(event AS STRING) AS event",
            "CAST(description AS STRING) AS description",
            "CAST(outs_before AS INT) AS outs_before",
            "CAST(home_score_before AS INT) AS home_score_before",
            "CAST(away_score_before AS INT) AS away_score_before",
            "CAST(runners_before AS STRING) AS runners_before",
            "CAST(season AS INT) AS season",
            "CAST(game_date AS DATE) AS game_date",
        )
        .write.mode("overwrite").option("overwriteSchema", "true")
        .saveAsTable(f"{fq}.silver_play")
    )
    print("silver_play: done")
else:
    # First run on a workspace with zero finals — make sure the table at
    # least exists so downstream consumers don't fail.
    _retry_sql(f"""
        CREATE TABLE IF NOT EXISTS {fq}.silver_play (
            game_pk BIGINT,
            play_index INT,
            inning INT,
            half_inning STRING,
            batter_id BIGINT,
            pitcher_id BIGINT,
            event STRING,
            description STRING,
            outs_before INT,
            home_score_before INT,
            away_score_before INT,
            runners_before STRING,
            season INT,
            game_date DATE
        ) USING DELTA
    """)
    print("silver_play: empty — table ensured")
