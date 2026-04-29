# Databricks notebook source
# MAGIC %md
# MAGIC # Generate daily team storylines → gold_team_storyline (DERIV-11)
# MAGIC
# MAGIC For each of the 30 MLB teams, assemble a snapshot of recent activity
# MAGIC (last 14 days of `silver_team_day`, last 7 days of recap headlines,
# MAGIC recent `gold_milestone_events`, rolling 14-day player stats) and ask
# MAGIC the Foundation Model writer for 3–5 columnist-voice bullets describing
# MAGIC "what's actually happening with this team right now."
# MAGIC
# MAGIC Idempotent: skips `(team_id, generated_for_date)` already in
# MAGIC `gold_team_storyline` unless `force=true`. Backfill via
# MAGIC `target_date=YYYY-MM-DD`.
# MAGIC
# MAGIC Cost target: ~$1/month for daily 30-team runs at Haiku 4.5 prices.

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
# Blank target_date → "yesterday in America/New_York". Storylines are a
# morning-job thing: we describe what happened through last night's
# Final games.
dbutils.widgets.text("target_date", "")
dbutils.widgets.text("force", "false")
# Restrict to a CSV of abbrevs (e.g. "CHC,TEX") for smoke tests. Empty
# means all 30 teams.
dbutils.widgets.text("only_teams", "")
# Smoke gate: assemble payloads + print previews, skip the LLM call.
dbutils.widgets.text("dry_run", "false")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
endpoint = dbutils.widgets.get("endpoint")
target_date_param = dbutils.widgets.get("target_date").strip()
force = dbutils.widgets.get("force").lower() == "true"
only_teams_param = dbutils.widgets.get("only_teams").strip()
dry_run = dbutils.widgets.get("dry_run").lower() == "true"
fq = f"{catalog}.{schema}"

PROMPT_VERSION = "v2"
MODEL_VERSION = f"{endpoint}:{PROMPT_VERSION}"
TITLE_FALLBACK = "Two-week summary"

# Lookback windows (calendar days, ending on target_date inclusive)
TEAM_DAY_LOOKBACK = 14
RECAP_LOOKBACK = 7
MILESTONE_LOOKBACK = 7
PLAYER_LOOKBACK = 14

# Rolling-stat thresholds (filter the noise so the LLM doesn't get a
# 40-row payload of zero-PA bench bats).
MIN_AB_FOR_BAT = 15
MIN_IP_FOR_PIT = 5.0
TOP_N_BAT = 5
TOP_N_PIT = 5

# Rough Haiku 4.5 pricing (USD per 1M tokens) for the cost-estimate print.
# Best-effort only — not used for billing, just for sanity at end-of-run.
COST_INPUT_PER_MTOK = 0.25
COST_OUTPUT_PER_MTOK = 1.25

ET = ZoneInfo("America/New_York")

if target_date_param:
    target_date = datetime.fromisoformat(target_date_param).date()
else:
    target_date = (datetime.now(ET) - timedelta(days=1)).date()

team_day_start = target_date - timedelta(days=TEAM_DAY_LOOKBACK - 1)
recap_start = target_date - timedelta(days=RECAP_LOOKBACK - 1)
milestone_start = target_date - timedelta(days=MILESTONE_LOOKBACK - 1)
player_start = target_date - timedelta(days=PLAYER_LOOKBACK - 1)

print(
    f"target_date={target_date}  force={force}  dry_run={dry_run}\n"
    f"  team_day window: {team_day_start} → {target_date}\n"
    f"  recap window:    {recap_start} → {target_date}\n"
    f"  milestone window:{milestone_start} → {target_date}\n"
    f"  player window:   {player_start} → {target_date}"
)

# COMMAND ----------
# MAGIC %md ## Resolve team set + idempotency gate

# COMMAND ----------
only_teams_filter = ""
if only_teams_param:
    abbrevs = [a.strip().upper() for a in only_teams_param.split(",") if a.strip()]
    abbrevs_csv = ", ".join(f"'{a}'" for a in abbrevs)
    only_teams_filter = f"WHERE abbrev IN ({abbrevs_csv})"

team_meta_df = spark.sql(f"""
    SELECT team_id, abbrev, name AS team_name, primary_color
    FROM {fq}.silver_team
    {only_teams_filter}
    ORDER BY abbrev
""").toPandas()
print(f"team_meta resolved: {len(team_meta_df)} team(s)")

# Make sure gold_team_storyline exists before we query it for the gate.
# Schema mirrors BACKLOG.md DERIV-11 spec, plus a `title` column added in
# prompt v2 (FEAT-30 polish): one short headline per (team, date) that
# replaces the static "Two-week summary" header on the team page.
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {fq}.gold_team_storyline (
        team_id                  BIGINT,
        generated_for_date       DATE,
        bullet_index             INT,
        bullet_text              STRING,
        supporting_metrics_json  STRING,
        generated_at             TIMESTAMP,
        title                    STRING
    ) USING DELTA
""")
# Idempotent ALTER for tables created before v2; Delta no-ops if the
# column already exists.
try:
    spark.sql(
        f"ALTER TABLE {fq}.gold_team_storyline ADD COLUMNS (title STRING)"
    )
except Exception as exc:  # noqa: BLE001
    if "already exists" not in str(exc).lower():
        raise

if not force:
    existing = spark.sql(f"""
        SELECT DISTINCT team_id
        FROM {fq}.gold_team_storyline
        WHERE generated_for_date = DATE '{target_date.isoformat()}'
    """).toPandas()
    already = set(existing["team_id"].astype(int).tolist())
else:
    already = set()

target_teams = team_meta_df[~team_meta_df["team_id"].isin(already)].copy()
skipped = team_meta_df[team_meta_df["team_id"].isin(already)]
for _, r in skipped.iterrows():
    print(f"  skip {r.abbrev} ({r.team_id}) — already has rows for {target_date}")

if target_teams.empty:
    print("nothing to do.")
    dbutils.notebook.exit("noop")

# COMMAND ----------
# MAGIC %md ## Pull per-team payload pieces

# COMMAND ----------
def fetch_team_day_window(team_id: int) -> list[dict]:
    df = spark.sql(f"""
        SELECT game_date, cum_wins, cum_losses, w_minus_l, games_played
        FROM {fq}.silver_team_day
        WHERE team_id = {team_id}
          AND game_date BETWEEN '{team_day_start.isoformat()}'
                            AND '{target_date.isoformat()}'
        ORDER BY game_date
    """).toPandas()
    return [
        {
            "game_date": str(r["game_date"]),
            "cum_wins": int(r["cum_wins"] or 0),
            "cum_losses": int(r["cum_losses"] or 0),
            "w_minus_l": int(r["w_minus_l"] or 0),
            "games_played": int(r["games_played"] or 0),
        }
        for _, r in df.iterrows()
    ]


def fetch_recent_milestones(team_id: int) -> list[dict]:
    """Pull team-subject milestones plus player-subject milestones for
    players who played for this team in the lookback window."""
    df = spark.sql(f"""
        WITH team_players AS (
            SELECT DISTINCT player_id
            FROM {fq}.silver_player_game_batting
            WHERE team_id = {team_id}
              AND game_date BETWEEN '{milestone_start.isoformat()}'
                                AND '{target_date.isoformat()}'
            UNION
            SELECT DISTINCT player_id
            FROM {fq}.silver_player_game_pitching
            WHERE team_id = {team_id}
              AND game_date BETWEEN '{milestone_start.isoformat()}'
                                AND '{target_date.isoformat()}'
        )
        SELECT event_kind, event_text, happened_on, subject_type, subject_name
        FROM {fq}.gold_milestone_events
        WHERE happened_on BETWEEN '{milestone_start.isoformat()}'
                              AND '{target_date.isoformat()}'
          AND (
              (subject_type = 'team' AND subject_id = {team_id})
              OR (subject_type = 'player' AND subject_id IN (
                    SELECT player_id FROM team_players))
          )
        ORDER BY happened_on DESC
    """).toPandas() if spark.catalog.tableExists(f"{fq}.gold_milestone_events") else None
    if df is None or df.empty:
        return []
    return [
        {
            "event_kind": str(r["event_kind"]),
            "event_text": str(r["event_text"]),
            "happened_on": str(r["happened_on"]),
            "subject_type": str(r["subject_type"]),
            "subject_name": str(r["subject_name"]),
        }
        for _, r in df.iterrows()
    ]


def fetch_recent_recaps(team_id: int) -> list[dict]:
    if not spark.catalog.tableExists(f"{fq}.gold_game_recap"):
        return []
    df = spark.sql(f"""
        SELECT r.game_date, r.headline, r.summary, r.game_type,
               r.interest_score, r.narrative_spine
        FROM {fq}.gold_game_recap r
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.game_date BETWEEN '{recap_start.isoformat()}'
                              AND '{target_date.isoformat()}'
          AND ({team_id} IN (g.home_team_id, g.away_team_id))
        ORDER BY g.game_date DESC, g.game_pk DESC
    """).toPandas()
    return [
        {
            "game_date": str(r["game_date"]),
            "headline": str(r["headline"] or ""),
            "summary": str(r["summary"] or ""),
            "game_type": str(r["game_type"] or ""),
            "interest_score": int(r["interest_score"] or 0),
            "narrative_spine": str(r["narrative_spine"] or ""),
        }
        for _, r in df.iterrows()
    ]


def fetch_rolling_batting(team_id: int) -> list[dict]:
    """Top batters by 14-day OPS-ish proxy ((TB + BB) / (AB + BB))."""
    df = spark.sql(f"""
        SELECT player_id, FIRST(player_name) AS player_name,
               COUNT(*)              AS games,
               SUM(at_bats)          AS at_bats,
               SUM(hits)             AS hits,
               SUM(home_runs)        AS home_runs,
               SUM(rbi)              AS rbi,
               SUM(walks)            AS walks,
               SUM(total_bases)      AS total_bases,
               SUM(strikeouts)       AS strikeouts
        FROM {fq}.silver_player_game_batting
        WHERE team_id = {team_id}
          AND game_date BETWEEN '{player_start.isoformat()}'
                            AND '{target_date.isoformat()}'
        GROUP BY player_id
        HAVING SUM(at_bats) >= {MIN_AB_FOR_BAT}
    """).toPandas()
    if df.empty:
        return []
    df["avg"] = df.apply(
        lambda r: (float(r["hits"]) / float(r["at_bats"])) if r["at_bats"] else 0.0,
        axis=1,
    )
    df["ops_proxy"] = df.apply(
        lambda r: (
            (float(r["total_bases"] or 0) + float(r["walks"] or 0))
            / (float(r["at_bats"] or 0) + float(r["walks"] or 0))
        ) if (float(r["at_bats"] or 0) + float(r["walks"] or 0)) > 0 else 0.0,
        axis=1,
    )
    df = df.sort_values("ops_proxy", ascending=False).head(TOP_N_BAT)
    return [
        {
            "player_name": str(r["player_name"]),
            "games": int(r["games"]),
            "at_bats": int(r["at_bats"] or 0),
            "hits": int(r["hits"] or 0),
            "home_runs": int(r["home_runs"] or 0),
            "rbi": int(r["rbi"] or 0),
            "walks": int(r["walks"] or 0),
            "strikeouts": int(r["strikeouts"] or 0),
            "avg": round(float(r["avg"]), 3),
            "ops_proxy": round(float(r["ops_proxy"]), 3),
        }
        for _, r in df.iterrows()
    ]


def fetch_rolling_pitching(team_id: int) -> list[dict]:
    """Top pitchers by 14-day ERA among those with ≥ MIN_IP_FOR_PIT IP."""
    df = spark.sql(f"""
        SELECT player_id, FIRST(player_name) AS player_name,
               COUNT(*)               AS games,
               SUM(innings_pitched)   AS innings_pitched,
               SUM(earned_runs)       AS earned_runs,
               SUM(strikeouts)        AS strikeouts,
               SUM(walks)             AS walks,
               SUM(home_runs)         AS home_runs,
               SUM(wins)              AS wins,
               SUM(losses)            AS losses,
               SUM(saves)             AS saves
        FROM {fq}.silver_player_game_pitching
        WHERE team_id = {team_id}
          AND game_date BETWEEN '{player_start.isoformat()}'
                            AND '{target_date.isoformat()}'
        GROUP BY player_id
        HAVING SUM(innings_pitched) >= {MIN_IP_FOR_PIT}
    """).toPandas()
    if df.empty:
        return []
    df["era"] = df.apply(
        lambda r: (
            float(r["earned_runs"] or 0) * 9.0 / float(r["innings_pitched"])
        ) if float(r["innings_pitched"]) > 0 else 99.0,
        axis=1,
    )
    df = df.sort_values("era", ascending=True).head(TOP_N_PIT)
    return [
        {
            "player_name": str(r["player_name"]),
            "games": int(r["games"]),
            "innings_pitched": round(float(r["innings_pitched"] or 0), 1),
            "earned_runs": int(r["earned_runs"] or 0),
            "strikeouts": int(r["strikeouts"] or 0),
            "walks": int(r["walks"] or 0),
            "home_runs": int(r["home_runs"] or 0),
            "wins": int(r["wins"] or 0),
            "losses": int(r["losses"] or 0),
            "saves": int(r["saves"] or 0),
            "era": round(float(r["era"]), 2),
        }
        for _, r in df.iterrows()
    ]


def assemble_payload(team_row) -> dict:
    team_id = int(team_row.team_id)
    return {
        "team_name": team_row.team_name,
        "team_abbrev": team_row.abbrev,
        "primary_color": team_row.primary_color,
        "generated_for_date": target_date.isoformat(),
        "team_day_last_14": fetch_team_day_window(team_id),
        "recent_milestones": fetch_recent_milestones(team_id),
        "recent_recaps": fetch_recent_recaps(team_id),
        "rolling_batting_14d": fetch_rolling_batting(team_id),
        "rolling_pitching_14d": fetch_rolling_pitching(team_id),
    }


payloads: list[tuple[int, str, dict]] = []
for _, team_row in target_teams.iterrows():
    payload = assemble_payload(team_row)
    payloads.append((int(team_row.team_id), team_row.abbrev, payload))
    print(
        f"  {team_row.abbrev}: "
        f"team_day={len(payload['team_day_last_14'])}, "
        f"milestones={len(payload['recent_milestones'])}, "
        f"recaps={len(payload['recent_recaps'])}, "
        f"bat={len(payload['rolling_batting_14d'])}, "
        f"pit={len(payload['rolling_pitching_14d'])}"
    )

# COMMAND ----------
# MAGIC %md ## Writer LLM call (one per team)

# COMMAND ----------
PROMPT_PATH = Path(os.getcwd()) / "prompts" / "team_storyline_v2.md"
system_prompt = PROMPT_PATH.read_text(encoding="utf-8")


def call_writer(payload: dict) -> dict:
    """Returns parsed JSON response: {bullets: [{text, metric_ref}]}.
    Plus a usage tuple under `_usage` so the caller can sum costs."""
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
        max_tokens=600,
    )
    if not response.choices:
        raise RuntimeError(f"empty choices from {endpoint}")
    text = (response.choices[0].message.content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip("\n")
    parsed = json.loads(text)

    # Best-effort token-usage capture for cost estimation. Some serving
    # adapters omit this; default to 0 so we don't crash the run.
    usage = getattr(response, "usage", None)
    in_tok = int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0
    out_tok = int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0
    parsed["_usage"] = {"input_tokens": in_tok, "output_tokens": out_tok}
    return parsed


def normalize_bullets(parsed: dict) -> list[dict]:
    """Validate the writer's JSON shape. Drop anything malformed; keep
    3–5 bullets max. Returns list of {text, metric_ref}."""
    raw = parsed.get("bullets") or []
    out: list[dict] = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        text = (b.get("text") or "").strip()
        if not text:
            continue
        metric_ref = (b.get("metric_ref") or "").strip()[:64]
        out.append({"text": text, "metric_ref": metric_ref})
    return out[:5]


def normalize_title(parsed: dict) -> str:
    """Extract the LLM's title. Strip wrapping quotes, trailing
    punctuation. Cap at 80 chars. Fall back to TITLE_FALLBACK on
    missing/empty/too-long input — better a generic header than a 200-
    char run-on sentence."""
    raw = (parsed.get("title") or "").strip()
    if not raw:
        return TITLE_FALLBACK
    raw = raw.strip("\"'`“”‘’ ").rstrip(".!?")
    if len(raw) > 80 or len(raw) < 4:
        return TITLE_FALLBACK
    return raw


storyline_rows: list[dict] = []
failures: list[tuple[str, str]] = []
total_in_tok = 0
total_out_tok = 0
generated_at = datetime.now(timezone.utc)

for team_id, abbrev, payload in payloads:
    if dry_run:
        print(f"\n[dry_run] {abbrev} payload preview:")
        preview = {
            k: (f"<{len(v)} items>" if isinstance(v, list) else v)
            for k, v in payload.items()
        }
        print(json.dumps(preview, indent=2, default=str))
        continue
    try:
        parsed = call_writer(payload)
        usage = parsed.pop("_usage", {"input_tokens": 0, "output_tokens": 0})
        total_in_tok += usage["input_tokens"]
        total_out_tok += usage["output_tokens"]
        bullets = normalize_bullets(parsed)
        title = normalize_title(parsed)
        if not bullets:
            failures.append((abbrev, "writer returned 0 bullets"))
            print(f"  {abbrev}: 0 bullets — skipping")
            continue
        for idx, b in enumerate(bullets):
            storyline_rows.append({
                "team_id": team_id,
                "generated_for_date": target_date.isoformat(),
                "bullet_index": idx,
                "bullet_text": b["text"],
                "supporting_metrics_json": json.dumps(
                    {"metric_ref": b["metric_ref"]}
                ),
                "generated_at": generated_at,
                "title": title,
            })
        print(f"  {abbrev}: {len(bullets)} bullets — {title!r}")
    except Exception as exc:  # noqa: BLE001
        failures.append((abbrev, f"{type(exc).__name__}: {exc}"))
        print(f"  {abbrev} failed: {type(exc).__name__}: {exc}")

if dry_run:
    print("dry_run=true — skipping writes.")
    dbutils.notebook.exit("dry_run")

if payloads and not storyline_rows:
    raise RuntimeError(
        f"All {len(payloads)} writer calls failed. Sample:\n"
        + "\n".join(f"  {a}: {m}" for a, m in failures[:5])
    )

# COMMAND ----------
# MAGIC %md ## Persist to gold_team_storyline

# COMMAND ----------
if storyline_rows:
    stage = spark.createDataFrame(storyline_rows)
    stage.createOrReplaceTempView("storyline_stage")
    # Postgres-portable upsert: delete the (team_id, generated_for_date)
    # keys we're about to write (handles re-runs that produce a different
    # bullet count), then insert. MERGE works on Delta but not on plain
    # Postgres; this two-step is portable. All rows in a single run share
    # one target_date, so we flatten to `date = X AND team_id IN (...)` —
    # avoids Spark's row-tuple IN type-coercion gotcha (INT vs BIGINT).
    team_ids = sorted({int(r["team_id"]) for r in storyline_rows})
    team_ids_csv = ", ".join(str(t) for t in team_ids)
    spark.sql(f"""
        DELETE FROM {fq}.gold_team_storyline
        WHERE generated_for_date = DATE '{target_date.isoformat()}'
          AND team_id IN ({team_ids_csv})
    """)
    spark.sql(f"""
        INSERT INTO {fq}.gold_team_storyline
        (team_id, generated_for_date, bullet_index, bullet_text,
         supporting_metrics_json, generated_at, title)
        SELECT
            CAST(team_id AS BIGINT),
            CAST(generated_for_date AS DATE),
            CAST(bullet_index AS INT),
            bullet_text,
            supporting_metrics_json,
            generated_at,
            title
        FROM storyline_stage
    """)
    teams_written = len({r["team_id"] for r in storyline_rows})
    print(
        f"gold_team_storyline: wrote {len(storyline_rows)} bullets across "
        f"{teams_written} team(s) for {target_date}"
    )

# COMMAND ----------
# MAGIC %md ## Cost estimate

# COMMAND ----------
if not dry_run:
    cost_in = total_in_tok / 1_000_000.0 * COST_INPUT_PER_MTOK
    cost_out = total_out_tok / 1_000_000.0 * COST_OUTPUT_PER_MTOK
    cost_total = cost_in + cost_out
    teams_called = len(payloads) - len(failures)
    print(
        f"cost estimate: ${cost_total:.4f} "
        f"({total_in_tok} in @ ${COST_INPUT_PER_MTOK}/MTok + "
        f"{total_out_tok} out @ ${COST_OUTPUT_PER_MTOK}/MTok) "
        f"across {teams_called} team(s); "
        f"failures: {len(failures)}"
    )
    if failures:
        print("failure sample:")
        for a, m in failures[:5]:
            print(f"  {a}: {m}")


# COMMAND ----------
if __name__ == "__main__":
    # Local smoke gate — never invokes the LLM. Only exercises that the
    # prompt file is readable and a sample payload schema is JSON-
    # serializable. Set widget `dry_run=true` for a fuller in-Databricks
    # smoke test that also runs the SQL assembly path.
    if os.environ.get("AKB_STORYLINES_LOCAL_SMOKE") == "1":
        sample_payload = {
            "team_name": "Chicago Cubs",
            "team_abbrev": "CHC",
            "primary_color": "#0E3386",
            "generated_for_date": "2026-04-27",
            "team_day_last_14": [],
            "recent_milestones": [],
            "recent_recaps": [],
            "rolling_batting_14d": [],
            "rolling_pitching_14d": [],
        }
        prompt_path = Path(__file__).parent / "prompts" / "team_storyline_v2.md"
        print("prompt bytes:", len(prompt_path.read_text()))
        print("payload json:", json.dumps(sample_payload))
