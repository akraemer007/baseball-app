# Databricks notebook source
# MAGIC %md
# MAGIC # LLM game recaps → gold_game_recap
# MAGIC
# MAGIC For each "final" game in scope, build a structured boxscore summary, hand it
# MAGIC to a Databricks Foundation Model, and store the returned JSON recap.

# COMMAND ----------
import json
import os
from pathlib import Path

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("endpoint", "databricks-claude-haiku-4-5")
dbutils.widgets.text("mode", "yesterday")  # yesterday | date | all-missing
dbutils.widgets.text("target_date", "")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
endpoint = dbutils.widgets.get("endpoint")
mode = dbutils.widgets.get("mode")
target_date = dbutils.widgets.get("target_date")
fq = f"{catalog}.{schema}"

# COMMAND ----------
# MAGIC %md ## Pick the set of games that need recaps

# COMMAND ----------
from datetime import date, timedelta

if mode == "yesterday":
    yday = (date.today() - timedelta(days=1)).isoformat()
    filter_clause = f"g.game_date = '{yday}'"
elif mode == "date":
    filter_clause = f"g.game_date = '{target_date}'"
elif mode == "all-missing":
    filter_clause = "NOT EXISTS (SELECT 1 FROM " + fq + ".gold_game_recap r WHERE r.game_pk = g.game_pk)"
else:
    raise ValueError(f"unknown mode: {mode}")

games_df = spark.sql(f"""
    SELECT g.game_pk, g.game_date, g.season, g.home_team_id, g.away_team_id,
           g.home_team_name, g.away_team_name, g.home_score, g.away_score,
           g.winner_team_id, g.venue,
           e.home_win_prob, e.winner_implied_win_prob, e.upset_flag
    FROM {fq}.silver_game g
    LEFT JOIN {fq}.gold_game_elo e USING (game_pk)
    WHERE {filter_clause}
      AND g.status = 'Final'
      AND g.game_type = 'R'
    ORDER BY g.game_date, g.game_pk
""").toPandas()

print(f"games needing recap: {len(games_df)}")

# COMMAND ----------
# MAGIC %md ## Build per-game standouts from silver_player_game_*

# COMMAND ----------
def top_batters_for_game(game_pk: int, team_id: int, limit: int = 3) -> list[dict]:
    rows = spark.sql(f"""
        SELECT player_name, at_bats, hits, home_runs, rbi, runs, walks, strikeouts, stolen_bases
        FROM {fq}.silver_player_game_batting
        WHERE game_pk = {game_pk} AND team_id = {team_id} AND at_bats > 0
        ORDER BY (home_runs * 3 + hits * 1.5 + rbi * 1.2 + runs + walks * 0.5) DESC
        LIMIT {limit}
    """).collect()
    return [r.asDict() for r in rows]


def top_pitchers_for_game(game_pk: int, team_id: int, limit: int = 2) -> list[dict]:
    rows = spark.sql(f"""
        SELECT player_name, innings_pitched, earned_runs, strikeouts, walks, hits, wins, losses, saves
        FROM {fq}.silver_player_game_pitching
        WHERE game_pk = {game_pk} AND team_id = {team_id} AND innings_pitched > 0
        ORDER BY innings_pitched DESC
        LIMIT {limit}
    """).collect()
    return [r.asDict() for r in rows]


def build_game_payload(row) -> dict:
    is_home_winner = row.winner_team_id == row.home_team_id
    winner_name = row.home_team_name if is_home_winner else row.away_team_name
    loser_name  = row.away_team_name if is_home_winner else row.home_team_name
    return {
        "date": row.game_date,
        "venue_city": row.venue,
        "home": {
            "team": row.home_team_name,
            "score": int(row.home_score),
            "top_batters": top_batters_for_game(row.game_pk, row.home_team_id),
            "top_pitchers": top_pitchers_for_game(row.game_pk, row.home_team_id),
        },
        "away": {
            "team": row.away_team_name,
            "score": int(row.away_score),
            "top_batters": top_batters_for_game(row.game_pk, row.away_team_id),
            "top_pitchers": top_pitchers_for_game(row.game_pk, row.away_team_id),
        },
        "winner": winner_name,
        "loser": loser_name,
        "is_one_run_game": abs(int(row.home_score) - int(row.away_score)) == 1,
        "winner_implied_win_prob": (float(row.winner_implied_win_prob)
                                    if row.winner_implied_win_prob is not None else None),
        "is_upset": bool(row.upset_flag) if row.upset_flag is not None else False,
    }


# COMMAND ----------
# MAGIC %md ## Call the Foundation Model endpoint

# COMMAND ----------
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Load the prompt — relative to this notebook file
PROMPT_PATH = Path(os.getcwd()) / "prompts" / "game_recap_v1.md"
system_prompt = PROMPT_PATH.read_text(encoding="utf-8")


from databricks.sdk.service.serving import ChatMessage, ChatMessageRole


def call_recap(game_payload: dict) -> dict:
    """Invoke the serving endpoint. Expects strict-JSON output."""
    response = w.serving_endpoints.query(
        name=endpoint,
        messages=[
            ChatMessage(role=ChatMessageRole.SYSTEM, content=system_prompt),
            ChatMessage(role=ChatMessageRole.USER, content=json.dumps(game_payload, default=str)),
        ],
        temperature=0.3,
        max_tokens=400,
    )
    if not response.choices:
        raise RuntimeError(f"empty choices from {endpoint}: {response}")
    content = response.choices[0].message.content
    if content is None:
        raise RuntimeError(f"null content from {endpoint}: {response.choices[0]}")
    text = content.strip()
    if text.startswith("```"):
        # Strip markdown fences the model occasionally emits
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip("\n")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"non-JSON recap for game: {text[:200]!r}") from exc


# COMMAND ----------
# MAGIC %md ## Generate + write

# COMMAND ----------
recap_rows: list[dict] = []
failures: list[tuple[int, str]] = []
for _, row in games_df.iterrows():
    try:
        payload = build_game_payload(row)
        recap = call_recap(payload)
        recap_rows.append({
            "game_pk": int(row.game_pk),
            "game_date": row.game_date,
            "headline": recap.get("headline", ""),
            "dateline": recap.get("dateline", ""),
            "summary": recap.get("summary", ""),
            "upset_flag": bool(row.upset_flag) if row.upset_flag is not None else False,
            "winner_implied_win_prob": (float(row.winner_implied_win_prob)
                                        if row.winner_implied_win_prob is not None else None),
            "generated_with_endpoint": endpoint,
        })
    except Exception as exc:  # noqa: BLE001
        failures.append((int(row.game_pk), f"{type(exc).__name__}: {exc}"))
        print(f"  game_pk {row.game_pk} recap failed: {type(exc).__name__}: {exc}")

print(f"recap rows: {len(recap_rows)}  failures: {len(failures)}")
# Fail loudly if literally every game failed — something is systemically broken.
if len(games_df) > 0 and len(recap_rows) == 0:
    raise RuntimeError(
        f"All {len(games_df)} recap calls failed. Sample failures:\n"
        + "\n".join(f"  {pk}: {msg}" for pk, msg in failures[:5])
    )

# COMMAND ----------
if recap_rows:
    # Ensure table exists
    spark.sql(f"""
        CREATE TABLE IF NOT EXISTS {fq}.gold_game_recap (
            game_pk BIGINT, game_date STRING, headline STRING, dateline STRING,
            summary STRING, upset_flag BOOLEAN,
            winner_implied_win_prob DOUBLE, generated_with_endpoint STRING
        ) USING DELTA
    """)
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
