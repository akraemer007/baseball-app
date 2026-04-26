# Databricks notebook source
# MAGIC %md
# MAGIC # Hourly ingest: MLB Stats API transactions → bronze
# MAGIC
# MAGIC Pulls roster moves (IL placements/activations, recalls, options, DFAs,
# MAGIC trades, claims) over the last 30 days from
# MAGIC `https://statsapi.mlb.com/api/v1/transactions` and lands one row per
# MAGIC transaction in `bronze_transaction`.
# MAGIC
# MAGIC The API caps total response size, so we fetch in 7-day windows and
# MAGIC iterate. Idempotent by `transaction_id`: re-running re-fetches the
# MAGIC same window and replaces those rows.

# COMMAND ----------
import json
import os
import sys
import time as _time
from datetime import date, timedelta

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("days_back", "30")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
days_back = int(dbutils.widgets.get("days_back"))

sys.path.insert(0, os.path.abspath("../common"))
from mlb_stats_api import MlbStatsApiClient  # noqa: E402

fq = f"{catalog}.{schema}"

# COMMAND ----------
def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry a SQL statement on UC TEMPORARILY_UNAVAILABLE — the workspace
    rate-limits CREATE TABLE/SCHEMA IF NOT EXISTS metadata calls.
    Mirrors the helper in fetch_playbyplay.py / silver_transforms.py."""
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
# Bronze table: one row per transaction_id. `payload` is the raw JSON for
# that single transaction (NOT the whole window). BIGINT for transaction_id
# (Python int → Spark LongType — see PIPE-0.5 fix).
_retry_sql(f"""
    CREATE TABLE IF NOT EXISTS {fq}.bronze_transaction (
        transaction_id BIGINT,
        fetched_at_utc TIMESTAMP,
        payload STRING
    ) USING DELTA
""")

# COMMAND ----------
# Last 30 days, sliced into 7-day windows. The API rejects/truncates on
# wider windows when traffic is busy (e.g. mid-July when ~hundreds of
# moves/day are flying around the deadline).
today = date.today()
start = today - timedelta(days=days_back)

windows: list[tuple[date, date]] = []
cursor = start
while cursor <= today:
    win_end = min(cursor + timedelta(days=6), today)
    windows.append((cursor, win_end))
    cursor = win_end + timedelta(days=1)

print(f"fetching {len(windows)} window(s) from {start} to {today}")

# COMMAND ----------
client = MlbStatsApiClient()

# Collect transactions across all windows, deduped by transaction id. The
# API can occasionally return overlap when a move's effectiveDate sits at
# a window boundary; deduping in-memory is cheaper than `IN` on bronze.
seen: dict[int, dict] = {}
fetch_failures = 0

for start_d, end_d in windows:
    try:
        result = client.transactions(start_d, end_d)
        txns = result.payload.get("transactions", []) or []
        for t in txns:
            tid = t.get("id")
            if tid is None:
                continue
            try:
                tid_int = int(tid)
            except (TypeError, ValueError):
                continue
            seen[tid_int] = t
        print(f"  {start_d}..{end_d}: {len(txns)} transactions")
    except Exception as exc:  # noqa: BLE001
        # Defensive: a single window failing shouldn't sink the whole
        # run. Other windows still land; this one retries next hour.
        fetch_failures += 1
        print(f"  {start_d}..{end_d} failed: {exc}")
        continue

print(f"unique transactions across windows: {len(seen)} (fetch failures: {fetch_failures})")

# COMMAND ----------
if seen:
    # Idempotent overwrite per transaction_id: pre-delete the IDs we are
    # about to write, then append. Plain DELETE + INSERT keeps the SQL
    # Postgres-portable (no MERGE).
    ids = sorted(seen.keys())
    # Chunk the IN list so a 30-day mid-deadline window (a few hundred
    # ids) doesn't blow past Spark SQL's expression limits.
    CHUNK = 500
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        ids_str = ", ".join(str(x) for x in chunk)
        _retry_sql(f"""
            DELETE FROM {fq}.bronze_transaction
            WHERE transaction_id IN ({ids_str})
        """)

    rows = [
        {"transaction_id": tid, "payload": json.dumps(payload)}
        for tid, payload in seen.items()
    ]
    df = spark.createDataFrame(rows).selectExpr(
        "CAST(transaction_id AS BIGINT) AS transaction_id",
        "current_timestamp() AS fetched_at_utc",
        "CAST(payload AS STRING) AS payload",
    )
    df.write.mode("append").saveAsTable(f"{fq}.bronze_transaction")
    print(f"bronze_transaction: appended {len(rows)} transaction(s)")
else:
    print("bronze_transaction: nothing to write (no transactions in window)")
