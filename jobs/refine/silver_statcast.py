# Databricks notebook source
# MAGIC %md
# MAGIC # Silver transform: bronze_statcast → silver_pa + silver_pitch
# MAGIC
# MAGIC Reads each gzipped Savant CSV blob in `bronze_statcast`,
# MAGIC decompresses, parses with pandas, and produces TWO output tables
# MAGIC from a single shared parse:
# MAGIC
# MAGIC - `silver_pitch` — one row per pitch (Savant's native grain)
# MAGIC - `silver_pa`    — one row per plate appearance, deduped to the
# MAGIC                    LAST pitch of each (game_pk, at_bat_number)
# MAGIC
# MAGIC The 4-day Statcast lag means recent windows may have missing
# MAGIC pitches; that's fine — bronze stays empty/sparse and the next
# MAGIC ingest catches up.

# COMMAND ----------
import gzip
import io
import os
import sys
import time as _time

import pandas as pd

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
# Pull the gzipped CSV blobs from bronze. Each row is one (season,
# month_start) window; we concatenate them into one big DataFrame.
src_rows = spark.sql(f"""
    SELECT season, month_start, payload_csv_gz
    FROM {fq}.bronze_statcast
""").collect()

print(f"bronze_statcast source rows: {len(src_rows)}")

# COMMAND ----------
# Columns we actually consume out of the Savant CSV. Pulling a subset
# (vs `all=true`'s ~95 columns) keeps the in-memory DataFrame small and
# the schema explicit. Anything missing in the CSV becomes NaN/NA.
WANTED_COLS = [
    "game_pk", "game_date", "game_year",
    "at_bat_number", "pitch_number", "inning", "inning_topbot",
    "batter", "pitcher", "home_team", "away_team",
    "events", "description",
    "estimated_woba_using_speedangle", "estimated_ba_using_speedangle",
    "launch_speed", "launch_angle", "hit_distance_sc",
    "pitch_type", "release_speed",
    "plate_x", "plate_z", "zone",
    "balls", "strikes",
    "pfx_x", "pfx_z", "sz_top", "sz_bot",
    "woba_value",  # for total_bases inference fallback if needed
]

frames: list[pd.DataFrame] = []
parse_failures = 0

for r in src_rows:
    try:
        raw = bytes(r.payload_csv_gz) if r.payload_csv_gz is not None else b""
        if not raw:
            continue
        csv_bytes = gzip.decompress(raw)
        # `on_bad_lines='skip'` catches Savant's occasional truncated rows
        # (per BACKLOG defensive-parsing requirement). low_memory=False
        # avoids the dtype-warning spam on heterogeneous columns.
        df = pd.read_csv(
            io.BytesIO(csv_bytes),
            on_bad_lines="skip",
            low_memory=False,
        )
        # Restrict to the columns we know about; anything else gets
        # dropped here so a Savant schema addition never blows us up.
        keep = [c for c in WANTED_COLS if c in df.columns]
        df = df[keep].copy()
        frames.append(df)
    except Exception as exc:  # noqa: BLE001
        parse_failures += 1
        print(f"  parse failed for ({r.season}, {r.month_start}): {exc}")

if frames:
    raw_df = pd.concat(frames, ignore_index=True)
else:
    raw_df = pd.DataFrame(columns=WANTED_COLS)

print(f"raw pitch rows: {len(raw_df)} (parse failures: {parse_failures})")

# COMMAND ----------
# ----- Common normalization ------------------------------------------
# Savant stores game_date as 'YYYY-MM-DD' string; coerce to date.
# `batter` / `pitcher` are MLBAM IDs → BIGINT.
# `inning_topbot` is 'Top' / 'Bot'; we lowercase to 'top' / 'bottom'.

def _events_to_total_bases(ev: object) -> int | None:
    """Map Savant `events` to total bases. Returns None for non-AB outcomes
    (walk, HBP, sac, strikeout, etc.) so total_bases stays NULL for them."""
    if ev is None or (isinstance(ev, float) and pd.isna(ev)):
        return None
    e = str(ev).strip().lower()
    if e in ("single",):
        return 1
    if e in ("double",):
        return 2
    if e in ("triple",):
        return 3
    if e in ("home_run",):
        return 4
    # Outs in play and strikeouts both contribute 0 total bases AB-wise.
    AT_BAT_OUTS = {
        "field_out", "force_out", "grounded_into_double_play",
        "double_play", "triple_play", "fielders_choice",
        "fielders_choice_out", "field_error", "strikeout",
        "strikeout_double_play", "other_out",
    }
    if e in AT_BAT_OUTS:
        return 0
    # Walks, HBP, sac, catcher-interference, intent-walk → not an AB.
    return None


if not raw_df.empty:
    # Cast batter / pitcher to nullable Int64 so NaN doesn't force float.
    for c in ("batter", "pitcher", "game_pk", "at_bat_number", "pitch_number",
              "inning", "zone", "balls", "strikes"):
        if c in raw_df.columns:
            raw_df[c] = pd.to_numeric(raw_df[c], errors="coerce").astype("Int64")

    # game_year → season
    if "game_year" in raw_df.columns:
        raw_df["season"] = pd.to_numeric(raw_df["game_year"], errors="coerce").astype("Int64")
    else:
        raw_df["season"] = pd.NA

    # game_date → ISO string for safe Spark conversion (mirrors
    # silver_playbyplay.py's date-string defensive cast).
    raw_df["game_date"] = pd.to_datetime(raw_df["game_date"], errors="coerce").dt.strftime("%Y-%m-%d")

    # half_inning: 'Top' / 'Bot' → 'top' / 'bottom'
    def _norm_half(v):
        if pd.isna(v):
            return None
        s = str(v).strip().lower()
        if s.startswith("top"):
            return "top"
        if s.startswith("bot"):
            return "bottom"
        return s

    raw_df["half_inning"] = raw_df["inning_topbot"].map(_norm_half) if "inning_topbot" in raw_df.columns else None

    # batter_team / pitcher_team derived from home_team + away_team +
    # half_inning. In the top of an inning the away team bats; in the
    # bottom the home team bats. Pitcher is the opposite side.
    if "home_team" in raw_df.columns and "away_team" in raw_df.columns:
        is_top = raw_df["half_inning"] == "top"
        raw_df["batter_team"] = raw_df["away_team"].where(is_top, raw_df["home_team"])
        raw_df["pitcher_team"] = raw_df["home_team"].where(is_top, raw_df["away_team"])
    else:
        raw_df["batter_team"] = None
        raw_df["pitcher_team"] = None

    # total_bases mapping for silver_pa.
    raw_df["total_bases"] = raw_df["events"].map(_events_to_total_bases).astype("Int64") if "events" in raw_df.columns else pd.NA

# COMMAND ----------
# ----- silver_pitch: one row per pitch -------------------------------

PITCH_COLS = [
    "game_pk", "game_date", "season",
    "at_bat_number", "pitch_number",
    "batter_id", "pitcher_id",
    "pitch_type", "release_speed",
    "plate_x", "plate_z", "zone",
    "balls", "strikes",
    "pfx_x", "pfx_z", "sz_top", "sz_bot",
]

if not raw_df.empty:
    pitch_df = raw_df.rename(columns={
        "batter": "batter_id",
        "pitcher": "pitcher_id",
    })
    # Drop rows missing the join keys — without (game_pk, at_bat_number,
    # pitch_number) the row is meaningless downstream.
    pitch_df = pitch_df.dropna(subset=["game_pk", "at_bat_number", "pitch_number"])
    # Convert to records for spark.createDataFrame. Pandas NA / NaN do
    # not always survive the trip cleanly — coerce to None.
    pitch_records = pitch_df[[c for c in PITCH_COLS if c in pitch_df.columns]].astype(object).where(
        pd.notna(pitch_df[[c for c in PITCH_COLS if c in pitch_df.columns]]), None
    ).to_dict(orient="records")
else:
    pitch_records = []

print(f"silver_pitch rows: {len(pitch_records)}")

if pitch_records:
    pitch_sdf = spark.createDataFrame(pitch_records)
    (
        pitch_sdf.selectExpr(
            "CAST(game_pk AS BIGINT) AS game_pk",
            "CAST(game_date AS DATE) AS game_date",
            "CAST(season AS BIGINT) AS season",
            "CAST(at_bat_number AS INT) AS at_bat_number",
            "CAST(pitch_number AS INT) AS pitch_number",
            "CAST(batter_id AS BIGINT) AS batter_id",
            "CAST(pitcher_id AS BIGINT) AS pitcher_id",
            "CAST(pitch_type AS STRING) AS pitch_type",
            "CAST(release_speed AS DOUBLE) AS release_speed",
            "CAST(plate_x AS DOUBLE) AS plate_x",
            "CAST(plate_z AS DOUBLE) AS plate_z",
            "CAST(zone AS INT) AS zone",
            "CAST(balls AS INT) AS balls",
            "CAST(strikes AS INT) AS strikes",
            "CAST(pfx_x AS DOUBLE) AS pfx_x",
            "CAST(pfx_z AS DOUBLE) AS pfx_z",
            "CAST(sz_top AS DOUBLE) AS sz_top",
            "CAST(sz_bot AS DOUBLE) AS sz_bot",
        )
        .write.mode("overwrite").option("overwriteSchema", "true")
        .saveAsTable(f"{fq}.silver_pitch")
    )
    print("silver_pitch: done")
else:
    # First-run / empty-bronze case — ensure the table exists for
    # downstream consumers. BIGINT for any Python-int-derived column.
    _retry_sql(f"""
        CREATE TABLE IF NOT EXISTS {fq}.silver_pitch (
            game_pk BIGINT,
            game_date DATE,
            season BIGINT,
            at_bat_number INT,
            pitch_number INT,
            batter_id BIGINT,
            pitcher_id BIGINT,
            pitch_type STRING,
            release_speed DOUBLE,
            plate_x DOUBLE,
            plate_z DOUBLE,
            zone INT,
            balls INT,
            strikes INT,
            pfx_x DOUBLE,
            pfx_z DOUBLE,
            sz_top DOUBLE,
            sz_bot DOUBLE
        ) USING DELTA
    """)
    print("silver_pitch: empty — table ensured")

# COMMAND ----------
# ----- silver_pa: dedupe to the LAST pitch of each PA ----------------
# Savant emits one row per pitch; the resolving pitch of an at-bat is
# the one with the highest pitch_number for that (game_pk,
# at_bat_number) and is the row with non-null `events`. We sort by
# pitch_number and keep the last to mirror the at-bat outcome.

PA_COLS = [
    "game_pk", "game_date", "season",
    "at_bat_number", "inning", "half_inning",
    "batter_id", "pitcher_id", "batter_team", "pitcher_team",
    "events", "description",
    "estimated_woba_using_speedangle", "estimated_ba_using_speedangle",
    "launch_speed", "launch_angle", "hit_distance_sc",
    "total_bases",
]

if not raw_df.empty:
    pa_df = raw_df.rename(columns={
        "batter": "batter_id",
        "pitcher": "pitcher_id",
    })
    # Drop rows without the PA key first, then sort + keep last.
    pa_df = pa_df.dropna(subset=["game_pk", "at_bat_number", "pitch_number"])
    pa_df = pa_df.sort_values(["game_pk", "at_bat_number", "pitch_number"])
    pa_df = pa_df.drop_duplicates(subset=["game_pk", "at_bat_number"], keep="last")
    pa_records = pa_df[[c for c in PA_COLS if c in pa_df.columns]].astype(object).where(
        pd.notna(pa_df[[c for c in PA_COLS if c in pa_df.columns]]), None
    ).to_dict(orient="records")
else:
    pa_records = []

print(f"silver_pa rows: {len(pa_records)}")

if pa_records:
    pa_sdf = spark.createDataFrame(pa_records)
    (
        pa_sdf.selectExpr(
            "CAST(game_pk AS BIGINT) AS game_pk",
            "CAST(game_date AS DATE) AS game_date",
            "CAST(season AS BIGINT) AS season",
            "CAST(at_bat_number AS INT) AS at_bat_number",
            "CAST(inning AS INT) AS inning",
            "CAST(half_inning AS STRING) AS half_inning",
            "CAST(batter_id AS BIGINT) AS batter_id",
            "CAST(pitcher_id AS BIGINT) AS pitcher_id",
            "CAST(batter_team AS STRING) AS batter_team",
            "CAST(pitcher_team AS STRING) AS pitcher_team",
            "CAST(events AS STRING) AS events",
            "CAST(description AS STRING) AS description",
            "CAST(estimated_woba_using_speedangle AS DOUBLE) AS estimated_woba_using_speedangle",
            "CAST(estimated_ba_using_speedangle AS DOUBLE) AS estimated_ba_using_speedangle",
            "CAST(launch_speed AS DOUBLE) AS launch_speed",
            "CAST(launch_angle AS DOUBLE) AS launch_angle",
            "CAST(hit_distance_sc AS DOUBLE) AS hit_distance_sc",
            "CAST(total_bases AS INT) AS total_bases",
        )
        .write.mode("overwrite").option("overwriteSchema", "true")
        .saveAsTable(f"{fq}.silver_pa")
    )
    print("silver_pa: done")
else:
    _retry_sql(f"""
        CREATE TABLE IF NOT EXISTS {fq}.silver_pa (
            game_pk BIGINT,
            game_date DATE,
            season BIGINT,
            at_bat_number INT,
            inning INT,
            half_inning STRING,
            batter_id BIGINT,
            pitcher_id BIGINT,
            batter_team STRING,
            pitcher_team STRING,
            events STRING,
            description STRING,
            estimated_woba_using_speedangle DOUBLE,
            estimated_ba_using_speedangle DOUBLE,
            launch_speed DOUBLE,
            launch_angle DOUBLE,
            hit_distance_sc DOUBLE,
            total_bases INT
        ) USING DELTA
    """)
    print("silver_pa: empty — table ensured")
