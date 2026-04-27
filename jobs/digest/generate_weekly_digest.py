# Databricks notebook source
# MAGIC %md
# MAGIC # Generate weekly digests → gold_weekly_digest
# MAGIC
# MAGIC Sunday 5:00 ET job. For each team in the user-preference set, assembles
# MAGIC last-week stats (Mon-Sun in America/New_York) and asks the Foundation
# MAGIC Model writer for a single AP-wire-style paragraph. Persists to
# MAGIC `gold_weekly_digest`.
# MAGIC
# MAGIC Idempotent: skips (team_id, week_start) pairs already in the table
# MAGIC unless `force=true`. Backfill via `target_week_start=YYYY-MM-DD` (any
# MAGIC date that week — gets snapped to the Monday).

# COMMAND ----------
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
dbutils.widgets.text("endpoint", "databricks-claude-haiku-4-5")
dbutils.widgets.text("target_week_start", "")  # blank → this week's Monday
dbutils.widgets.text("force", "false")
# Smoke-test gate: when "true", assemble payloads and print the prompt
# preview but skip the live LLM call. Useful for prompt review.
dbutils.widgets.text("dry_run", "false")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
endpoint = dbutils.widgets.get("endpoint")
target_week_start_param = dbutils.widgets.get("target_week_start").strip()
force = dbutils.widgets.get("force").lower() == "true"
dry_run = dbutils.widgets.get("dry_run").lower() == "true"
fq = f"{catalog}.{schema}"

PROMPT_VERSION = "v1"
MODEL_VERSION = f"{endpoint}:{PROMPT_VERSION}"

# TODO: read this from a workspace `user_preferences` table once we add
# more users beyond the developer. For now hard-code the defaults from
# app/client/src/lib/preferences.tsx (primaryTeam=CHC, secondaryTeam=TEX).
TEAMS = ["CHC", "TEX"]

ET = ZoneInfo("America/New_York")


def monday_of_week(d: date) -> date:
    """Snap any date to the Monday of its Mon-Sun week."""
    return d - timedelta(days=d.weekday())


if target_week_start_param:
    parsed = datetime.fromisoformat(target_week_start_param).date()
    week_start = monday_of_week(parsed)
else:
    today_et = datetime.now(ET).date()
    week_start = monday_of_week(today_et)
week_end = week_start + timedelta(days=6)
print(f"week: {week_start} → {week_end}  (teams={TEAMS}, force={force}, dry_run={dry_run})")

# COMMAND ----------
# MAGIC %md ## Resolve team metadata + idempotency gate

# COMMAND ----------
abbrevs_csv = ", ".join(f"'{a}'" for a in TEAMS)
team_meta_df = spark.sql(f"""
    SELECT team_id, abbrev, name AS team_name, league, division
    FROM {fq}.silver_team
    WHERE abbrev IN ({abbrevs_csv})
""").toPandas()
print(f"team_meta resolved: {len(team_meta_df)} of {len(TEAMS)}")

# Make sure gold_weekly_digest exists before we query it for the gate.
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {fq}.gold_weekly_digest (
        team_id       BIGINT,
        team_abbrev   STRING,
        week_start    DATE,
        digest_text   STRING,
        generated_at  TIMESTAMP
    ) USING DELTA
""")

if not force:
    existing = spark.sql(f"""
        SELECT team_id
        FROM {fq}.gold_weekly_digest
        WHERE week_start = DATE '{week_start.isoformat()}'
    """).toPandas()
    already = set(existing["team_id"].astype(int).tolist())
else:
    already = set()

target_teams = team_meta_df[~team_meta_df["team_id"].isin(already)].copy()
skipped = team_meta_df[team_meta_df["team_id"].isin(already)]
for _, r in skipped.iterrows():
    print(f"  skip {r.abbrev} ({r.team_id}) — already has a row for {week_start}")

if target_teams.empty:
    print("nothing to do.")
    dbutils.notebook.exit("noop")

# COMMAND ----------
# MAGIC %md ## Pull weekly stats per team

# COMMAND ----------
def fetch_week_record(team_id: int) -> dict:
    df = spark.sql(f"""
        SELECT
            SUM(CASE WHEN g.winner_team_id = {team_id} THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN g.winner_team_id IS NOT NULL
                      AND g.winner_team_id != {team_id} THEN 1 ELSE 0 END) AS losses
        FROM {fq}.silver_game g
        WHERE g.game_type = 'R'
          AND g.status = 'Final'
          AND g.game_date BETWEEN '{week_start.isoformat()}' AND '{week_end.isoformat()}'
          AND ({team_id} IN (g.home_team_id, g.away_team_id))
    """).toPandas()
    if df.empty:
        return {"wins": 0, "losses": 0}
    row = df.iloc[0]
    return {
        "wins": int(row["wins"] or 0),
        "losses": int(row["losses"] or 0),
    }


def fetch_run_diff(team_id: int) -> dict:
    df = spark.sql(f"""
        SELECT
            SUM(tg.runs)  AS runs_scored,
            SUM(opp.runs) AS runs_allowed
        FROM {fq}.silver_team_game tg
        JOIN {fq}.silver_team_game opp
          ON opp.game_pk = tg.game_pk AND opp.team_id != tg.team_id
        JOIN {fq}.silver_game g ON g.game_pk = tg.game_pk
        WHERE g.game_type = 'R'
          AND g.status = 'Final'
          AND g.game_date BETWEEN '{week_start.isoformat()}' AND '{week_end.isoformat()}'
          AND tg.team_id = {team_id}
    """).toPandas()
    if df.empty:
        return {"runs_scored": 0, "runs_allowed": 0, "run_diff": 0}
    row = df.iloc[0]
    rs = int(row["runs_scored"] or 0)
    ra = int(row["runs_allowed"] or 0)
    return {"runs_scored": rs, "runs_allowed": ra, "run_diff": rs - ra}


def fetch_best_win_worst_loss(team_id: int) -> dict:
    """Largest-margin win and largest-margin loss in the week. Either
    can be None if the team didn't win or didn't lose."""
    df = spark.sql(f"""
        SELECT
            g.game_pk,
            g.game_date,
            CASE WHEN g.home_team_id = {team_id} THEN g.home_score
                 ELSE g.away_score END AS score_for,
            CASE WHEN g.home_team_id = {team_id} THEN g.away_score
                 ELSE g.home_score END AS score_against,
            CASE WHEN g.home_team_id = {team_id} THEN at.name
                 ELSE ht.name END AS opponent_name,
            (g.winner_team_id = {team_id}) AS is_win
        FROM {fq}.silver_game g
        JOIN {fq}.silver_team ht ON ht.team_id = g.home_team_id
        JOIN {fq}.silver_team at ON at.team_id = g.away_team_id
        WHERE g.game_type = 'R'
          AND g.status = 'Final'
          AND g.game_date BETWEEN '{week_start.isoformat()}' AND '{week_end.isoformat()}'
          AND ({team_id} IN (g.home_team_id, g.away_team_id))
    """).toPandas()
    out = {"best_win": None, "worst_loss": None}
    if df.empty:
        return out
    df["margin"] = df["score_for"] - df["score_against"]
    wins = df[df["is_win"] == True]  # noqa: E712
    losses = df[df["is_win"] == False]  # noqa: E712
    if not wins.empty:
        w = wins.sort_values("margin", ascending=False).iloc[0]
        out["best_win"] = {
            "opponent_name": str(w["opponent_name"]),
            "score_for": int(w["score_for"]),
            "score_against": int(w["score_against"]),
            "game_date": str(w["game_date"]),
        }
    if not losses.empty:
        l = losses.sort_values("margin", ascending=True).iloc[0]
        out["worst_loss"] = {
            "opponent_name": str(l["opponent_name"]),
            "score_for": int(l["score_for"]),
            "score_against": int(l["score_against"]),
            "game_date": str(l["game_date"]),
        }
    return out


def fetch_streak(team_id: int, as_of_date: date) -> str | None:
    """Streak going INTO `as_of_date` — i.e. counting only Final games
    strictly before that date. Returns 'W3' / 'L2' or None if no prior
    games this season."""
    df = spark.sql(f"""
        SELECT g.game_date, g.game_pk,
               (g.winner_team_id = {team_id}) AS is_win
        FROM {fq}.silver_game g
        WHERE g.game_type = 'R'
          AND g.status = 'Final'
          AND g.game_date < '{as_of_date.isoformat()}'
          AND g.season = {as_of_date.year}
          AND ({team_id} IN (g.home_team_id, g.away_team_id))
        ORDER BY g.game_date DESC, g.game_pk DESC
    """).toPandas()
    if df.empty:
        return None
    top = bool(df.iloc[0]["is_win"])
    count = 0
    for _, row in df.iterrows():
        if bool(row["is_win"]) == top:
            count += 1
        else:
            break
    return f"{'W' if top else 'L'}{count}"


def fetch_top_performer(team_id: int) -> dict | None:
    """Most-impactful batter or pitcher this week. Heuristic: pick the
    batter with the highest (HR*4 + RBI + hits) score, or the pitcher
    with the lowest week-ERA among those with ≥10 IP. Whichever 'score'
    is higher in normalized form wins. Falls back to top batter if no
    pitcher qualifies."""
    bat = spark.sql(f"""
        SELECT b.player_id, b.player_name,
               SUM(b.at_bats)    AS at_bats,
               SUM(b.hits)       AS hits,
               SUM(b.home_runs)  AS home_runs,
               SUM(b.rbi)        AS rbi
        FROM {fq}.silver_player_game_batting b
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.game_type = 'R'
          AND g.status = 'Final'
          AND g.game_date BETWEEN '{week_start.isoformat()}' AND '{week_end.isoformat()}'
          AND b.team_id = {team_id}
        GROUP BY b.player_id, b.player_name
    """).toPandas()
    pit = spark.sql(f"""
        SELECT p.player_id, p.player_name,
               SUM(p.innings_pitched) AS innings_pitched,
               SUM(p.earned_runs)     AS earned_runs,
               SUM(p.strikeouts)      AS strikeouts,
               SUM(p.wins)            AS wins,
               SUM(p.losses)          AS losses
        FROM {fq}.silver_player_game_pitching p
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.game_type = 'R'
          AND g.status = 'Final'
          AND g.game_date BETWEEN '{week_start.isoformat()}' AND '{week_end.isoformat()}'
          AND p.team_id = {team_id}
        GROUP BY p.player_id, p.player_name
    """).toPandas()

    bat_pick = None
    if not bat.empty:
        bat["impact"] = bat["home_runs"].fillna(0) * 4 + bat["rbi"].fillna(0) + bat["hits"].fillna(0)
        b = bat.sort_values("impact", ascending=False).iloc[0]
        if int(b["impact"]) > 0:
            bat_pick = {
                "player_name": str(b["player_name"]),
                "kind": "batting",
                "line": f"{int(b['hits'])}-for-{int(b['at_bats'])}, {int(b['home_runs'])} HR, {int(b['rbi'])} RBI",
                "impact": float(b["impact"]),
            }

    pit_pick = None
    if not pit.empty:
        pit_q = pit[pit["innings_pitched"].fillna(0) >= 10].copy()
        if not pit_q.empty:
            pit_q["era"] = pit_q.apply(
                lambda r: (float(r["earned_runs"] or 0) * 9.0 / float(r["innings_pitched"]))
                if float(r["innings_pitched"]) > 0 else 99.0,
                axis=1,
            )
            p = pit_q.sort_values("era", ascending=True).iloc[0]
            ip = float(p["innings_pitched"])
            era = float(p["era"])
            # Pitcher impact heuristic: how many earned runs below a 4.50 baseline.
            impact = max(0.0, (4.50 - era) * (ip / 9.0))
            pit_pick = {
                "player_name": str(p["player_name"]),
                "kind": "pitching",
                "line": (
                    f"{int(p['wins'] or 0)}-{int(p['losses'] or 0)}, "
                    f"{era:.2f} ERA, {int(p['strikeouts'] or 0)} K in {ip:g} IP"
                ),
                "impact": impact,
            }

    candidates = [c for c in (bat_pick, pit_pick) if c is not None]
    if not candidates:
        return None
    pick = max(candidates, key=lambda c: c["impact"])
    pick.pop("impact", None)
    return pick


def fetch_recap_headlines(team_id: int) -> list[str]:
    """Pull recap headlines this week (if generate_recaps already ran)."""
    df = spark.sql(f"""
        SELECT r.headline
        FROM {fq}.gold_game_recap r
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.game_date BETWEEN '{week_start.isoformat()}' AND '{week_end.isoformat()}'
          AND ({team_id} IN (g.home_team_id, g.away_team_id))
        ORDER BY g.game_date
    """).toPandas() if spark.catalog.tableExists(f"{fq}.gold_game_recap") else None
    if df is None or df.empty:
        return []
    return [str(h) for h in df["headline"].tolist() if h]


def assemble_payload(team_row) -> dict:
    team_id = int(team_row.team_id)
    rec = fetch_week_record(team_id)
    rd = fetch_run_diff(team_id)
    bw = fetch_best_win_worst_loss(team_id)
    streak_in = fetch_streak(team_id, week_start)
    streak_out = fetch_streak(team_id, week_end + timedelta(days=1))
    top = fetch_top_performer(team_id)
    headlines = fetch_recap_headlines(team_id)
    return {
        "team_name": team_row.team_name,
        "team_abbrev": team_row.abbrev,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "week_record": rec,
        "week_run_diff": rd["run_diff"],
        "runs_scored": rd["runs_scored"],
        "runs_allowed": rd["runs_allowed"],
        "best_win": bw["best_win"],
        "worst_loss": bw["worst_loss"],
        "streak_entering": streak_in,
        "streak_leaving": streak_out,
        "top_performer": top,
        "recap_headlines": headlines,
    }


payloads: list[tuple[int, str, dict]] = []
for _, team_row in target_teams.iterrows():
    payload = assemble_payload(team_row)
    payloads.append((int(team_row.team_id), team_row.abbrev, payload))
    print(
        f"  {team_row.abbrev}: "
        f"{payload['week_record']['wins']}-{payload['week_record']['losses']}, "
        f"runs {payload['runs_scored']}-{payload['runs_allowed']} "
        f"(diff {payload['week_run_diff']}), "
        f"streak {payload['streak_entering']}→{payload['streak_leaving']}, "
        f"recaps={len(payload['recap_headlines'])}"
    )

# COMMAND ----------
# MAGIC %md ## Writer LLM call (one per team)

# COMMAND ----------
PROMPT_PATH = Path(os.getcwd()) / "prompts" / "weekly_digest.md"
system_prompt = PROMPT_PATH.read_text(encoding="utf-8")


def call_writer(payload: dict) -> str:
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

    w = WorkspaceClient()
    response = w.serving_endpoints.query(
        name=endpoint,
        messages=[
            ChatMessage(role=ChatMessageRole.SYSTEM, content=system_prompt),
            ChatMessage(role=ChatMessageRole.USER, content=json.dumps(payload, default=str)),
        ],
        temperature=0.3,
        max_tokens=400,
    )
    if not response.choices:
        raise RuntimeError(f"empty choices from {endpoint}")
    text = (response.choices[0].message.content or "").strip()
    # Strip stray code fences in case the model wraps the paragraph.
    if text.startswith("```"):
        text = text.strip("`").lstrip()
        if text.lower().startswith("text"):
            text = text[4:].lstrip("\n")
    return text


digest_rows: list[dict] = []
failures: list[tuple[str, str]] = []
generated_at = datetime.now(timezone.utc)

for team_id, abbrev, payload in payloads:
    if dry_run:
        print(f"\n[dry_run] {abbrev} payload:\n{json.dumps(payload, indent=2, default=str)}\n")
        continue
    try:
        digest_text = call_writer(payload)
        digest_rows.append({
            "team_id": team_id,
            "team_abbrev": abbrev,
            "week_start": week_start.isoformat(),
            "digest_text": digest_text,
            "generated_at": generated_at,
        })
        print(f"  {abbrev}: digest {len(digest_text.split())} words")
    except Exception as exc:  # noqa: BLE001
        failures.append((abbrev, f"{type(exc).__name__}: {exc}"))
        print(f"  {abbrev} failed: {type(exc).__name__}: {exc}")

if dry_run:
    print("dry_run=true — skipping writes.")
    dbutils.notebook.exit("dry_run")

if payloads and not digest_rows:
    raise RuntimeError(
        f"All {len(payloads)} writer calls failed. Sample:\n"
        + "\n".join(f"  {a}: {m}" for a, m in failures[:5])
    )

# COMMAND ----------
# MAGIC %md ## Persist to gold_weekly_digest

# COMMAND ----------
if digest_rows:
    stage = spark.createDataFrame(digest_rows)
    stage.createOrReplaceTempView("digest_stage")
    # Postgres-portable upsert: delete the (team_id, week_start) keys we're
    # about to write, then insert. `MERGE INTO` works on Delta but not on
    # Postgres without extensions; this two-step is portable.
    keys = [(r["team_id"], r["week_start"]) for r in digest_rows]
    keys_csv = ", ".join(f"({tid}, DATE '{ws}')" for tid, ws in keys)
    spark.sql(f"""
        DELETE FROM {fq}.gold_weekly_digest
        WHERE (team_id, week_start) IN ({keys_csv})
    """)
    spark.sql(f"""
        INSERT INTO {fq}.gold_weekly_digest
        (team_id, team_abbrev, week_start, digest_text, generated_at)
        SELECT
            CAST(team_id AS BIGINT),
            team_abbrev,
            CAST(week_start AS DATE),
            digest_text,
            generated_at
        FROM digest_stage
    """)
    print(f"gold_weekly_digest: wrote {len(digest_rows)} rows for {week_start}")


# COMMAND ----------
if __name__ == "__main__":
    # Local smoke gate — never invokes the LLM. Only exercises that the
    # prompt file is readable and the payload schema is JSON-serializable.
    # Set the widget `dry_run=true` for a fuller in-Databricks smoke test
    # that also runs the SQL assembly path.
    if os.environ.get("AKB_DIGEST_LOCAL_SMOKE") == "1":
        sample_payload = {
            "team_name": "Chicago Cubs",
            "team_abbrev": "CHC",
            "week_start": "2026-04-20",
            "week_end": "2026-04-26",
            "week_record": {"wins": 4, "losses": 2},
            "week_run_diff": 7,
            "runs_scored": 28,
            "runs_allowed": 21,
            "best_win": None,
            "worst_loss": None,
            "streak_entering": "W2",
            "streak_leaving": "W3",
            "top_performer": None,
            "recap_headlines": [],
        }
        print("prompt bytes:", len(Path(__file__).parent.joinpath("prompts/weekly_digest.md").read_text()))
        print("payload json:", json.dumps(sample_payload))
