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
from datetime import date, timedelta

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
# 7-day windows from Mar 1 through Nov 1 (or today, whichever earlier).
# Two-month windows blew past Savant's response cap (~25-40k rows) —
# we got back only one week's worth regardless of date range. Weekly
# chunks (~25k rows MLB-wide) stay safely under the cap.
WINDOW_DAYS = 7


def _generate_windows(season: int) -> list[tuple[str, str]]:
    season_start = date(season, 3, 1)
    season_end = date(season, 11, 1)
    end_cap = min(season_end, date.today())
    out: list[tuple[str, str]] = []
    cur = season_start
    while cur <= end_cap:
        chunk_end = min(cur + timedelta(days=WINDOW_DAYS - 1), end_cap)
        out.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + timedelta(days=1)
    return out


# Drop windows that are entirely in the future — Statcast has no data
# for games that haven't been played. No silver_game dep, so this task
# can run truly parallel to refine_silver and the other ingests.
# Savant has a ~4-day publication lag for the most recent games; we
# skip the trailing 4 days too so each window has actually-published
# data before we land it (otherwise the bronze blob is mostly empty
# and gets re-fetched next hour anyway).
today = date.today()
publication_cutoff = today - timedelta(days=3)

all_windows = _generate_windows(season)
to_fetch = [
    (s, e)
    for (s, e) in all_windows
    if date.fromisoformat(s) <= publication_cutoff
]
print(f"windows to fetch: {len(to_fetch)} of {len(all_windows)} (publication cutoff {publication_cutoff})")

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
