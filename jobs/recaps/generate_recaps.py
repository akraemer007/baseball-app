# Databricks notebook source
# MAGIC %md
# MAGIC # Generate game recaps → gold_game_recap (v2)
# MAGIC
# MAGIC Pipeline:
# MAGIC 1. Read `gold_game_recap_input` for games in scope.
# MAGIC 2. For each, run `score_game_interest()` in Python (no LLM).
# MAGIC    → game_type, interest_score, narrative_spine, recap_length
# MAGIC 3. Call the Foundation-Model writer once per game with the enriched
# MAGIC    payload + Python-scored fields.
# MAGIC 4. MERGE into `gold_game_recap`. Default skips games already recapped;
# MAGIC    pass `force=true` to rebuild everything in scope.

# COMMAND ----------
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("endpoint", "databricks-claude-haiku-4-5")
dbutils.widgets.text("mode", "yesterday")      # yesterday | date | all-missing
dbutils.widgets.text("target_date", "")        # used when mode=date
dbutils.widgets.text("force", "false")         # "true" to regenerate existing

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
endpoint = dbutils.widgets.get("endpoint")
mode = dbutils.widgets.get("mode")
target_date = dbutils.widgets.get("target_date")
force = dbutils.widgets.get("force").lower() == "true"
fq = f"{catalog}.{schema}"

sys.path.insert(0, os.path.abspath("../recaps"))
from interest import score_game_interest  # noqa: E402

PROMPT_VERSION = "v2"
MODEL_VERSION = f"{endpoint}:{PROMPT_VERSION}"

# COMMAND ----------
# MAGIC %md ## Pick games in scope

# COMMAND ----------
if mode == "yesterday":
    yday = (date.today() - timedelta(days=1)).isoformat()
    where_clause = f"game_date = '{yday}'"
elif mode == "date":
    where_clause = f"game_date = '{target_date}'"
elif mode == "all-missing":
    where_clause = "1=1"  # every game is a candidate; NOT-EXISTS below filters
else:
    raise ValueError(f"unknown mode: {mode}")

skip_existing = not force and mode != "all-missing"
skip_clause = (
    f"AND NOT EXISTS (SELECT 1 FROM {fq}.gold_game_recap r WHERE r.game_pk = i.game_pk)"
    if skip_existing or mode == "all-missing"
    else ""
)

games_df = spark.sql(f"""
    SELECT *
    FROM {fq}.gold_game_recap_input i
    WHERE {where_clause} {skip_clause}
    ORDER BY game_date, game_pk
""").toPandas()
print(f"games to recap: {len(games_df)} (mode={mode}, force={force})")

# COMMAND ----------
# MAGIC %md ## Interest scoring (pure Python)

# COMMAND ----------
def _parse_json_col(v):
    if v is None or (isinstance(v, float) and v != v):  # NaN
        return []
    if isinstance(v, (list, dict)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return []


def build_interest_input(row) -> dict:
    """Shape one row of gold_game_recap_input for `score_game_interest`."""
    return {
        "home_team": row.home_team,
        "away_team": row.away_team,
        "home_score": int(row.home_score),
        "away_score": int(row.away_score),
        "winner_team": row.winner_team,
        "loser_team": row.loser_team,
        "winner_implied_win_prob": row.winner_implied_win_prob,
        "is_division_game": bool(row.is_division_game),
        "home_streak": row.home_streak,
        "away_streak": row.away_streak,
        "linescore": _parse_json_col(row.linescore_json),
        "home_key_batters": _parse_json_col(row.home_key_batters_json),
        "away_key_batters": _parse_json_col(row.away_key_batters_json),
        "starting_pitchers": _parse_json_col(row.starting_pitchers_json),
    }


scored: list[dict] = []
for _, row in games_df.iterrows():
    interest_input = build_interest_input(row)
    scoring = score_game_interest(interest_input)
    scored.append({**interest_input, **scoring, "game_pk": int(row.game_pk),
                   "game_date": row.game_date, "venue": row.venue,
                   "home_abbrev": row.home_abbrev, "away_abbrev": row.away_abbrev,
                   "upset_flag": bool(row.upset_flag) if row.upset_flag is not None else False})
print(f"interest-scored: {len(scored)} games")
# quick breakdown
if scored:
    by_type: dict[str, int] = {}
    for s in scored:
        by_type[s["game_type"]] = by_type.get(s["game_type"], 0) + 1
    print(f"  by game_type: {by_type}")

# COMMAND ----------
# MAGIC %md ## Writer LLM call (one per game)

# COMMAND ----------
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

w = WorkspaceClient()
PROMPT_PATH = Path(os.getcwd()) / "prompts" / "game_recap_v2.md"
system_prompt = PROMPT_PATH.read_text(encoding="utf-8")


def call_writer(payload: dict) -> dict:
    response = w.serving_endpoints.query(
        name=endpoint,
        messages=[
            ChatMessage(role=ChatMessageRole.SYSTEM, content=system_prompt),
            ChatMessage(role=ChatMessageRole.USER, content=json.dumps(payload, default=str)),
        ],
        temperature=0.3,
        max_tokens=500,
    )
    if not response.choices:
        raise RuntimeError(f"empty choices from {endpoint}")
    text = (response.choices[0].message.content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip("\n")
    return json.loads(text)


recap_rows: list[dict] = []
failures: list[tuple[int, str]] = []
for g in scored:
    raw_row = games_df.loc[games_df["game_pk"] == g["game_pk"]].iloc[0]
    writer_input = {
        "home_team": g["home_team"],
        "away_team": g["away_team"],
        "home_score": g["home_score"],
        "away_score": g["away_score"],
        "venue_city": g["venue"],
        "winner_team": g["winner_team"],
        "loser_team": g["loser_team"],
        "linescore": g["linescore"],
        "home_last_10": raw_row.home_last_10,
        "away_last_10": raw_row.away_last_10,
        "home_streak": raw_row.home_streak,
        "away_streak": raw_row.away_streak,
        "pre_game_elo_home": raw_row.pre_game_elo_home,
        "winner_implied_win_prob": raw_row.winner_implied_win_prob,
        "upset_flag": g["upset_flag"],
        "home_key_batters": g["home_key_batters"],
        "away_key_batters": g["away_key_batters"],
        "starting_pitchers": g["starting_pitchers"],
        "game_type": g["game_type"],
        "narrative_spine": g["narrative_spine"],
        "interest_score": g["interest_score"],
        "recap_length": g["recap_length"],
    }

    try:
        written = call_writer(writer_input)
        recap_rows.append({
            "game_pk": g["game_pk"],
            "game_date": g["game_date"],
            "home_score": g["home_score"],
            "away_score": g["away_score"],
            "headline": written.get("headline", ""),
            "dateline": written.get("dateline", ""),
            "summary": written.get("summary", ""),
            "game_type": g["game_type"],
            "interest_score": int(g["interest_score"]),
            "recap_length": g["recap_length"],
            "narrative_spine": g["narrative_spine"],
            "upset_flag": bool(g["upset_flag"]),
            "winner_implied_win_prob": (
                float(raw_row.winner_implied_win_prob)
                if raw_row.winner_implied_win_prob is not None else None
            ),
            "generated_with_endpoint": endpoint,
            "model_version": MODEL_VERSION,
        })
    except Exception as exc:  # noqa: BLE001
        failures.append((g["game_pk"], f"{type(exc).__name__}: {exc}"))
        print(f"  game_pk {g['game_pk']} failed: {type(exc).__name__}: {exc}")

print(f"recap rows: {len(recap_rows)}  failures: {len(failures)}")
if len(scored) > 0 and len(recap_rows) == 0:
    raise RuntimeError(
        f"All {len(scored)} writer calls failed. Sample failures:\n"
        + "\n".join(f"  {pk}: {msg}" for pk, msg in failures[:5])
    )

# COMMAND ----------
if recap_rows:
    # Ensure table exists with the v2 schema (additive — pre-existing rows keep their values
    # on a re-run; new columns default to NULL for legacy rows until they're regenerated).
    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS {fq}.gold_game_recap (
            game_pk BIGINT, game_date STRING,
            home_score INT, away_score INT,
            headline STRING, dateline STRING, summary STRING,
            game_type STRING, interest_score INT, recap_length STRING,
            narrative_spine STRING,
            upset_flag BOOLEAN, winner_implied_win_prob DOUBLE,
            generated_with_endpoint STRING, model_version STRING
        ) USING DELTA
    """)
    # Additive migration: ensure new columns exist on pre-v2 tables. Delta
    # doesn't support ADD COLUMN IF NOT EXISTS, so look at the current schema.
    existing_cols = {
        r.col_name.lower()
        for r in spark.sql(f"DESCRIBE TABLE {fq}.gold_game_recap").collect()
        if r.col_name and not r.col_name.startswith("#")
    }
    for col, t in [
        ("home_score", "INT"), ("away_score", "INT"),
        ("game_type", "STRING"), ("interest_score", "INT"),
        ("recap_length", "STRING"), ("narrative_spine", "STRING"),
        ("model_version", "STRING"),
    ]:
        if col not in existing_cols:
            spark.sql(f"ALTER TABLE {fq}.gold_game_recap ADD COLUMN {col} {t}")

    stage = spark.createDataFrame(recap_rows)
    stage.createOrReplaceTempView("recap_stage")
    spark.sql(f"""
        MERGE INTO {fq}.gold_game_recap AS t
        USING recap_stage AS s
        ON t.game_pk = s.game_pk
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
    """)
    print("gold_game_recap: merged")
