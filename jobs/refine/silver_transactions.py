# Databricks notebook source
# MAGIC %md
# MAGIC # Silver transform: bronze_transaction → silver_transaction
# MAGIC
# MAGIC One row per roster move. Source is the raw JSON in
# MAGIC `bronze_transaction.payload`; the parser flattens each transaction
# MAGIC into typed columns. typeCode is preserved raw (e.g. 'IL10', 'IL60',
# MAGIC 'CU' for recall, 'OP' for option, 'DFA', 'TR' for trade, 'CL' for
# MAGIC claim) — downstream consumers normalize as needed.
# MAGIC
# MAGIC Future-effective transactions (effectiveDate > today) are excluded
# MAGIC so the table reflects roster state as of "today only". Re-running
# MAGIC tomorrow will pick them up via the next hourly bronze fetch.

# COMMAND ----------
import json
import os
import sys
import time as _time
from datetime import date, datetime

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"{catalog}.{schema}"

sys.path.insert(0, os.path.abspath("../common"))

# COMMAND ----------
def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry on UC TEMPORARILY_UNAVAILABLE — mirrors silver_playbyplay.py."""
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
def _parse_date(s):
    """'YYYY-MM-DD' (or ISO datetime) → date | None. Defensive on missing /
    malformed fields — return None rather than raising."""
    if not s:
        return None
    if isinstance(s, date) and not isinstance(s, datetime):
        return s
    try:
        # Most fields are 'YYYY-MM-DD'; a few come back as full ISO datetimes.
        s10 = str(s)[:10]
        return datetime.strptime(s10, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _parse_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# COMMAND ----------
src_rows = spark.sql(f"""
    SELECT transaction_id, payload
    FROM {fq}.bronze_transaction
""").collect()

print(f"bronze_transaction source rows: {len(src_rows)}")

# COMMAND ----------
today = date.today()
parsed: list[dict] = []
parse_failures = 0
filtered_future = 0

for r in src_rows:
    try:
        payload = json.loads(r.payload) if r.payload else {}
        eff = _parse_date(payload.get("effectiveDate"))
        # Skip scheduled future moves — they don't reflect today's roster
        # state. Tomorrow's run picks them up once they take effect.
        if eff is not None and eff > today:
            filtered_future += 1
            continue

        person = payload.get("person") or {}
        from_team = payload.get("fromTeam") or {}
        to_team = payload.get("toTeam") or {}

        parsed.append({
            "transaction_id": int(r.transaction_id),
            "player_id": _parse_int(person.get("id")),
            "player_name": person.get("fullName"),
            "from_team_id": _parse_int(from_team.get("id")),
            "to_team_id": _parse_int(to_team.get("id")),
            # ISO string — selectExpr CAST AS DATE handles None safely.
            "effective_date": eff.isoformat() if eff else None,
            "resolution_date": (
                _parse_date(payload.get("resolutionDate")).isoformat()
                if _parse_date(payload.get("resolutionDate")) else None
            ),
            "transaction_type": payload.get("typeCode"),
            "description": payload.get("description"),
        })
    except Exception as exc:  # noqa: BLE001
        # Defensive: a single malformed payload shouldn't sink the run.
        parse_failures += 1
        print(f"  parse failed for transaction_id={getattr(r, 'transaction_id', '?')}: {exc}")

print(
    f"silver_transaction rows: {len(parsed)} "
    f"(future-effective filtered: {filtered_future}, parse failures: {parse_failures})"
)

# COMMAND ----------
if parsed:
    df = spark.createDataFrame(parsed)
    (
        df.selectExpr(
            "CAST(transaction_id AS BIGINT) AS transaction_id",
            "CAST(player_id AS BIGINT) AS player_id",
            "CAST(player_name AS STRING) AS player_name",
            "CAST(from_team_id AS BIGINT) AS from_team_id",
            "CAST(to_team_id AS BIGINT) AS to_team_id",
            "CAST(effective_date AS DATE) AS effective_date",
            "CAST(resolution_date AS DATE) AS resolution_date",
            "CAST(transaction_type AS STRING) AS transaction_type",
            "CAST(description AS STRING) AS description",
        )
        .write.mode("overwrite").option("overwriteSchema", "true")
        .saveAsTable(f"{fq}.silver_transaction")
    )
    print("silver_transaction: done")
else:
    # First run / empty bronze — make sure the table exists for downstream
    # consumers. BIGINT for any Python-int-derived column.
    _retry_sql(f"""
        CREATE TABLE IF NOT EXISTS {fq}.silver_transaction (
            transaction_id BIGINT,
            player_id BIGINT,
            player_name STRING,
            from_team_id BIGINT,
            to_team_id BIGINT,
            effective_date DATE,
            resolution_date DATE,
            transaction_type STRING,
            description STRING
        ) USING DELTA
    """)
    print("silver_transaction: empty — table ensured")
