# Databricks notebook source
# MAGIC %md
# MAGIC # Hourly ingest: Statcast (Baseball Savant) → bronze_statcast
# MAGIC
# MAGIC Pulls per-pitch Statcast data from Baseball Savant's public CSV
# MAGIC search endpoint and lands raw gzipped CSV bytes per
# MAGIC `(season, month_start)` window.
# MAGIC
# MAGIC Idempotent by `(season, month_start)`: re-running re-fetches the
# MAGIC same window and overwrites that window's bronze row. Statcast is a
# MAGIC fixed history once games are final, so over-write is safe; the
# MAGIC ~4-day Statcast finalization lag means recent windows refresh on
# MAGIC subsequent hourly runs until the window is fully baked.
# MAGIC
# MAGIC Gated on `silver_game.status = 'Final'` — we only ingest months
# MAGIC that have at least one Final regular-season game so far.

# COMMAND ----------
import gzip
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
from savant import SavantClient  # noqa: E402

fq = f"{catalog}.{schema}"

# COMMAND ----------
def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry on UC TEMPORARILY_UNAVAILABLE — mirrors fetch_playbyplay.py."""
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
# Bronze table: one row per (season, month_start) window. payload_csv_gz
# is the raw CSV body, gzipped. BIGINT for season (Python int → Spark
# LongType — see PIPE-0.5 fix). BINARY maps cleanly to Postgres bytea
# for the future migration.
_retry_sql(f"""
    CREATE TABLE IF NOT EXISTS {fq}.bronze_statcast (
        season BIGINT,
        month_start DATE,
        fetched_at_utc TIMESTAMP,
        payload_csv_gz BINARY
    ) USING DELTA
""")

# COMMAND ----------
# Two-month windows aligned to the MLB regular season:
#   Mar 1 – Apr 30, May 1 – Jun 30, Jul 1 – Aug 31, Sep 1 – Oct 31.
# Picking 2-month windows keeps each Savant page well under their ~40k
# row soft limit while still amortizing the per-request cost.
WINDOWS = [
    ("03-01", "04-30"),
    ("05-01", "06-30"),
    ("07-01", "08-31"),
    ("09-01", "10-31"),
]

# Gate windows on whether `silver_game` has any Final regular-season
# games whose `game_date` falls inside the window. Skips empty windows
# entirely (early April when only Mar–Apr has games; Sep–Oct in spring).
finals_by_month = spark.sql(f"""
    SELECT DISTINCT date_format(game_date, 'MM') AS mm
    FROM {fq}.silver_game
    WHERE season = {season} AND status = 'Final' AND game_type = 'R'
""").collect()
months_with_finals = {r.mm for r in finals_by_month}
print(f"season {season}: months with Final games so far: {sorted(months_with_finals)}")


def _window_has_finals(start_mmdd: str, end_mmdd: str) -> bool:
    """True if any month inside the window has a Final regular game."""
    start_m = int(start_mmdd[:2])
    end_m = int(end_mmdd[:2])
    return any(f"{m:02d}" in months_with_finals for m in range(start_m, end_m + 1))


to_fetch = [
    (f"{season}-{s}", f"{season}-{e}")
    for (s, e) in WINDOWS
    if _window_has_finals(s, e)
]
print(f"windows to fetch: {len(to_fetch)} of {len(WINDOWS)}")

# COMMAND ----------
client = SavantClient()
fetched_rows: list[dict] = []

for start_iso, end_iso in to_fetch:
    try:
        result = client.search_csv(season=season, start=start_iso, end=end_iso)
        body = result.body
        # Defensive: a Savant timeout occasionally returns an HTML error
        # page instead of CSV. Sniff for the CSV header to skip those.
        if not body or b"," not in body[:200]:
            print(f"  {start_iso}..{end_iso}: non-CSV response ({len(body)}B), skipping")
            continue
        gz = gzip.compress(body)
        fetched_rows.append({
            "season": season,
            "month_start": start_iso,  # ISO 'YYYY-MM-DD' — Spark casts to DATE on selectExpr below
            "payload_csv_gz": gz,
        })
        print(f"  {start_iso}..{end_iso}: {len(body)}B raw, {len(gz)}B gzipped")
    except Exception as exc:  # noqa: BLE001
        # Defensive: a single window failing (e.g. a Savant 500 that
        # outlasts the Retry budget) shouldn't sink the whole run. Other
        # windows still land; this one retries next hour.
        print(f"  {start_iso}..{end_iso} failed: {exc}")
        continue

# COMMAND ----------
if fetched_rows:
    # Idempotent overwrite per window: delete any existing rows for the
    # windows we're about to write, then append. Plain DELETE + INSERT
    # keeps the SQL Postgres-portable (no MERGE).
    months_str = ", ".join(f"DATE'{r['month_start']}'" for r in fetched_rows)
    _retry_sql(f"""
        DELETE FROM {fq}.bronze_statcast
        WHERE season = {season} AND month_start IN ({months_str})
    """)

    df = spark.createDataFrame(fetched_rows).selectExpr(
        "CAST(season AS BIGINT) AS season",
        "CAST(month_start AS DATE) AS month_start",
        "current_timestamp() AS fetched_at_utc",
        "payload_csv_gz",
    )
    df.write.mode("append").saveAsTable(f"{fq}.bronze_statcast")
    print(f"bronze_statcast: appended {len(fetched_rows)} window(s)")
else:
    print("bronze_statcast: nothing to write (no eligible windows)")
