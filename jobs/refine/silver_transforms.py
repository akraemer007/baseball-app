# Databricks notebook source
# MAGIC %md
# MAGIC # Silver transforms: bronze JSON → typed, deduped tables
# MAGIC
# MAGIC Produces:
# MAGIC - `silver_game` (one row per gamePk)
# MAGIC - `silver_team_game` (two rows per game: home, away)
# MAGIC - `silver_player_game_batting`
# MAGIC - `silver_player_game_pitching`
# MAGIC - `silver_team_day` (cumulative team W-L per date)
# MAGIC - `silver_player_season` (season totals per player)

# COMMAND ----------
import json
from collections.abc import Iterable

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"{catalog}.{schema}"

# COMMAND ----------
# MAGIC %md ## Parse schedule JSON → silver_game

# COMMAND ----------
def parse_schedule_payloads(rows: Iterable) -> list[dict]:
    """Emit one dict per unique gamePk across all schedule payloads."""
    seen: dict[int, dict] = {}
    for r in rows:
        payload = json.loads(r.payload)
        for date_entry in payload.get("dates", []):
            game_date = date_entry.get("date")
            for g in date_entry.get("games", []):
                pk = int(g["gamePk"])
                status = g.get("status", {})
                home = g["teams"]["home"]
                away = g["teams"]["away"]
                home_score = (home.get("score") if home.get("score") is not None else 0)
                away_score = (away.get("score") if away.get("score") is not None else 0)
                probable = g.get("teams", {})
                home_probable = (home.get("probablePitcher") or {}).get("id")
                away_probable = (away.get("probablePitcher") or {}).get("id")
                winner_id = None
                if status.get("abstractGameState") == "Final":
                    if home_score > away_score:
                        winner_id = home["team"]["id"]
                    elif away_score > home_score:
                        winner_id = away["team"]["id"]
                seen[pk] = {
                    "game_pk": pk,
                    "game_date": game_date,
                    "season": int(g.get("season", game_date[:4])),
                    "game_type": g.get("gameType", ""),
                    "status": status.get("abstractGameState", ""),
                    "detailed_status": status.get("detailedState", ""),
                    "home_team_id": int(home["team"]["id"]),
                    "home_team_name": home["team"].get("name", ""),
                    "away_team_id": int(away["team"]["id"]),
                    "away_team_name": away["team"].get("name", ""),
                    "home_score": int(home_score),
                    "away_score": int(away_score),
                    "winner_team_id": winner_id,
                    "venue": (g.get("venue") or {}).get("name", ""),
                    "home_probable_pitcher_id": int(home_probable) if home_probable else None,
                    "away_probable_pitcher_id": int(away_probable) if away_probable else None,
                }
    return list(seen.values())


schedule_rows = spark.table(f"{fq}.bronze_schedule").collect()
games = parse_schedule_payloads(schedule_rows)
print(f"silver_game rows: {len(games)}")

games_df = spark.createDataFrame(games)
games_df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.silver_game")

# COMMAND ----------
# MAGIC %md ## Parse boxscore JSON → player + team game stats

# COMMAND ----------
def safe_int(v, default=0):
    try:
        return int(v) if v not in (None, "", "-.--", ".---") else default
    except (ValueError, TypeError):
        return default


def safe_float(v, default=0.0):
    try:
        return float(v) if v not in (None, "", "-.--", ".---") else default
    except (ValueError, TypeError):
        return default


import time as _time


def _retry_sql(sql, attempts=6, initial_backoff_s=5.0):
    """Retry a spark.sql call on UC TEMPORARILY_UNAVAILABLE."""
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


def parse_innings_pitched(v):
    """Baseball IP uses .1 = 1/3, .2 = 2/3. Convert to decimal innings."""
    if v in (None, "", "-.--", ".---"):
        return 0.0
    s = str(v).strip()
    if "." in s:
        whole_str, frac_str = s.split(".", 1)
        try:
            whole = int(whole_str)
        except ValueError:
            return safe_float(v)
        if frac_str == "0":
            return float(whole)
        if frac_str == "1":
            return whole + 1.0 / 3.0
        if frac_str == "2":
            return whole + 2.0 / 3.0
        return safe_float(v)
    return safe_float(v)


def parse_boxscore(row) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (team_game_rows, batting_rows, pitching_rows) for one boxscore."""
    payload = json.loads(row.payload)
    teams = payload.get("teams", {})
    team_rows: list[dict] = []
    bat_rows: list[dict] = []
    pit_rows: list[dict] = []

    for side, team_block in teams.items():  # "home" or "away"
        team_id = int(team_block["team"]["id"])
        stats = team_block.get("teamStats", {})
        batting = stats.get("batting", {})
        pitching = stats.get("pitching", {})
        fielding = stats.get("fielding", {})
        team_rows.append({
            "game_pk": row.game_pk,
            "game_date": row.game_date,
            "team_id": team_id,
            "side": side,  # home | away
            "runs": safe_int(batting.get("runs")),
            "hits": safe_int(batting.get("hits")),
            "home_runs": safe_int(batting.get("homeRuns")),
            "rbi": safe_int(batting.get("rbi")),
            "strikeouts_batting": safe_int(batting.get("strikeOuts")),
            "walks_batting": safe_int(batting.get("baseOnBalls")),
            "at_bats": safe_int(batting.get("atBats")),
            "innings_pitched": parse_innings_pitched(pitching.get("inningsPitched")),
            "earned_runs": safe_int(pitching.get("earnedRuns")),
            "strikeouts_pitching": safe_int(pitching.get("strikeOuts")),
            "walks_pitching": safe_int(pitching.get("baseOnBalls")),
            "errors": safe_int(fielding.get("errors")),
        })

        for _, p in team_block.get("players", {}).items():
            person = p.get("person", {})
            player_id = person.get("id")
            if player_id is None:
                continue
            stats_p = p.get("stats", {})
            bat = stats_p.get("batting") or {}
            pit = stats_p.get("pitching") or {}
            position = (p.get("position") or {}).get("abbreviation", "")
            if bat and bat.get("atBats") is not None:
                bat_rows.append({
                    "game_pk": row.game_pk,
                    "game_date": row.game_date,
                    "player_id": int(player_id),
                    "player_name": person.get("fullName", ""),
                    "team_id": team_id,
                    "position": position,
                    "at_bats": safe_int(bat.get("atBats")),
                    "hits": safe_int(bat.get("hits")),
                    "runs": safe_int(bat.get("runs")),
                    "rbi": safe_int(bat.get("rbi")),
                    "home_runs": safe_int(bat.get("homeRuns")),
                    "doubles": safe_int(bat.get("doubles")),
                    "triples": safe_int(bat.get("triples")),
                    "walks": safe_int(bat.get("baseOnBalls")),
                    "strikeouts": safe_int(bat.get("strikeOuts")),
                    "stolen_bases": safe_int(bat.get("stolenBases")),
                    "total_bases": safe_int(bat.get("totalBases")),
                })
            if pit and pit.get("inningsPitched") is not None:
                pit_rows.append({
                    "game_pk": row.game_pk,
                    "game_date": row.game_date,
                    "player_id": int(player_id),
                    "player_name": person.get("fullName", ""),
                    "team_id": team_id,
                    "innings_pitched": parse_innings_pitched(pit.get("inningsPitched")),
                    "hits": safe_int(pit.get("hits")),
                    "runs": safe_int(pit.get("runs")),
                    "earned_runs": safe_int(pit.get("earnedRuns")),
                    "walks": safe_int(pit.get("baseOnBalls")),
                    "strikeouts": safe_int(pit.get("strikeOuts")),
                    "home_runs": safe_int(pit.get("homeRuns")),
                    "batters_faced": safe_int(pit.get("battersFaced")),
                    "pitches_thrown": safe_int(pit.get("numberOfPitches")),
                    "wins": safe_int(pit.get("wins")),
                    "losses": safe_int(pit.get("losses")),
                    "saves": safe_int(pit.get("saves")),
                })
    return team_rows, bat_rows, pit_rows


box_rows = spark.table(f"{fq}.bronze_boxscore").collect()
print(f"boxscore source rows: {len(box_rows)}")

all_team, all_bat, all_pit = [], [], []
for r in box_rows:
    t, b, p = parse_boxscore(r)
    all_team.extend(t)
    all_bat.extend(b)
    all_pit.extend(p)

print(f"team_game: {len(all_team)}  batting: {len(all_bat)}  pitching: {len(all_pit)}")

if all_team:
    spark.createDataFrame(all_team).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.silver_team_game")
if all_bat:
    spark.createDataFrame(all_bat).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.silver_player_game_batting")
if all_pit:
    spark.createDataFrame(all_pit).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.silver_player_game_pitching")

# COMMAND ----------
# MAGIC %md ## Parse per-inning linescore → silver_linescore

# COMMAND ----------
def parse_linescore_payloads(rows):
    """One row per (game_pk, inning). Only Final games contribute."""
    seen: dict[tuple[int, int], dict] = {}
    for r in rows:
        payload = json.loads(r.payload)
        for date_entry in payload.get("dates", []):
            for g in date_entry.get("games", []):
                if g.get("status", {}).get("abstractGameState") != "Final":
                    continue
                game_pk = int(g["gamePk"])
                linescore = g.get("linescore") or {}
                for inn in (linescore.get("innings") or []):
                    num = inn.get("num")
                    if num is None:
                        continue
                    home = inn.get("home") or {}
                    away = inn.get("away") or {}
                    seen[(game_pk, int(num))] = {
                        "game_pk": game_pk,
                        "inning": int(num),
                        "home_runs": safe_int(home.get("runs")),
                        "away_runs": safe_int(away.get("runs")),
                    }
    return list(seen.values())


linescore_rows = parse_linescore_payloads(schedule_rows)
print(f"silver_linescore rows: {len(linescore_rows)}")
if linescore_rows:
    (
        spark.createDataFrame(linescore_rows)
        .write.mode("overwrite").option("overwriteSchema", "true")
        .saveAsTable(f"{fq}.silver_linescore")
    )

# COMMAND ----------
# MAGIC %md ## Build silver_team (one row per team with division/league/colors)

# COMMAND ----------
# Static team metadata — MLB teams change divisions so rarely that maintaining this
# by hand is simpler than fetching on every run. MLBAM team IDs + primary/secondary colors.
TEAM_META = [
    # AL East
    (147, "NYY", "New York Yankees", "AL", "AL East", "#003087", "#E4002C"),
    (111, "BOS", "Boston Red Sox", "AL", "AL East", "#BD3039", "#0C2340"),
    (139, "TB",  "Tampa Bay Rays", "AL", "AL East", "#092C5C", "#8FBCE6"),
    (141, "TOR", "Toronto Blue Jays", "AL", "AL East", "#134A8E", "#E8291C"),
    (110, "BAL", "Baltimore Orioles", "AL", "AL East", "#DF4601", "#000000"),
    # AL Central
    (145, "CWS", "Chicago White Sox", "AL", "AL Central", "#27251F", "#C4CED4"),
    (114, "CLE", "Cleveland Guardians", "AL", "AL Central", "#00385D", "#E50022"),
    (116, "DET", "Detroit Tigers", "AL", "AL Central", "#0C2340", "#FA4616"),
    (118, "KC",  "Kansas City Royals", "AL", "AL Central", "#004687", "#BD9B60"),
    (142, "MIN", "Minnesota Twins", "AL", "AL Central", "#002B5C", "#D31145"),
    # AL West
    (117, "HOU", "Houston Astros", "AL", "AL West", "#EB6E1F", "#002D62"),
    (140, "TEX", "Texas Rangers", "AL", "AL West", "#003278", "#C0111F"),
    (136, "SEA", "Seattle Mariners", "AL", "AL West", "#0C2C56", "#005C5C"),
    (108, "LAA", "Los Angeles Angels", "AL", "AL West", "#BA0021", "#003263"),
    (133, "OAK", "Athletics", "AL", "AL West", "#003831", "#EFB21E"),
    # NL East
    (144, "ATL", "Atlanta Braves", "NL", "NL East", "#CE1141", "#13274F"),
    (146, "MIA", "Miami Marlins", "NL", "NL East", "#00A3E0", "#EF3340"),
    (121, "NYM", "New York Mets", "NL", "NL East", "#002D72", "#FF5910"),
    (143, "PHI", "Philadelphia Phillies", "NL", "NL East", "#E81828", "#002D72"),
    (120, "WSH", "Washington Nationals", "NL", "NL East", "#AB0003", "#14225A"),
    # NL Central
    (112, "CHC", "Chicago Cubs", "NL", "NL Central", "#0E3386", "#CC3433"),
    (113, "CIN", "Cincinnati Reds", "NL", "NL Central", "#C6011F", "#000000"),
    (158, "MIL", "Milwaukee Brewers", "NL", "NL Central", "#12284B", "#FFC52F"),
    (134, "PIT", "Pittsburgh Pirates", "NL", "NL Central", "#27251F", "#FDB827"),
    (138, "STL", "St. Louis Cardinals", "NL", "NL Central", "#C41E3A", "#0C2340"),
    # NL West
    (109, "ARI", "Arizona Diamondbacks", "NL", "NL West", "#A71930", "#E3D4AD"),
    (115, "COL", "Colorado Rockies", "NL", "NL West", "#33006F", "#C4CED4"),
    (119, "LAD", "Los Angeles Dodgers", "NL", "NL West", "#005A9C", "#A5ACAF"),
    (135, "SD",  "San Diego Padres", "NL", "NL West", "#2F241D", "#FFC425"),
    (137, "SF",  "San Francisco Giants", "NL", "NL West", "#FD5A1E", "#27251F"),
]

team_rows = [
    {
        "team_id": t[0],
        "abbrev": t[1],
        "name": t[2],
        "league": t[3],
        "division": t[4],
        "primary_color": t[5],
        "secondary_color": t[6],
    }
    for t in TEAM_META
]
spark.createDataFrame(team_rows).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.silver_team")
print(f"silver_team: {len(team_rows)} teams")

# COMMAND ----------
# MAGIC %md ## Derive silver_team_day (cumulative W-L per team per date)

# COMMAND ----------
_retry_sql(f"""
    CREATE OR REPLACE TABLE {fq}.silver_team_day AS
    WITH team_results AS (
        SELECT
            g.game_date,
            g.season,
            tg.team_id,
            CASE WHEN g.winner_team_id = tg.team_id THEN 1 ELSE 0 END AS win,
            CASE WHEN g.winner_team_id IS NULL THEN 0
                 WHEN g.winner_team_id = tg.team_id THEN 0 ELSE 1 END AS loss
        FROM {fq}.silver_team_game tg
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.status = 'Final' AND g.game_type = 'R'
    )
    SELECT
        season,
        team_id,
        game_date,
        SUM(win) OVER (PARTITION BY season, team_id ORDER BY game_date) AS cum_wins,
        SUM(loss) OVER (PARTITION BY season, team_id ORDER BY game_date) AS cum_losses,
        SUM(win) OVER (PARTITION BY season, team_id ORDER BY game_date)
          - SUM(loss) OVER (PARTITION BY season, team_id ORDER BY game_date) AS w_minus_l,
        ROW_NUMBER() OVER (PARTITION BY season, team_id ORDER BY game_date) AS games_played
    FROM (
        SELECT season, team_id, game_date, SUM(win) AS win, SUM(loss) AS loss
        FROM team_results
        GROUP BY season, team_id, game_date
    )
""")

print("silver_team_day: done")

# COMMAND ----------
# MAGIC %md ## Derive silver_player_season (season totals per player)

# COMMAND ----------
_retry_sql(f"""
    CREATE OR REPLACE TABLE {fq}.silver_player_season AS
    WITH bat AS (
        SELECT
            g.season,
            b.player_id,
            FIRST(b.player_name) AS player_name,
            FIRST(b.team_id) AS last_team_id,
            SUM(b.at_bats) AS at_bats,
            SUM(b.hits) AS hits,
            SUM(b.runs) AS runs,
            SUM(b.rbi) AS rbi,
            SUM(b.home_runs) AS home_runs,
            SUM(b.doubles) AS doubles,
            SUM(b.triples) AS triples,
            SUM(b.walks) AS walks,
            SUM(b.strikeouts) AS strikeouts,
            SUM(b.stolen_bases) AS stolen_bases,
            SUM(b.total_bases) AS total_bases,
            COUNT(*) AS games
        FROM {fq}.silver_player_game_batting b
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.game_type = 'R'
        GROUP BY g.season, b.player_id
    ),
    pit AS (
        SELECT
            g.season,
            p.player_id,
            FIRST(p.player_name) AS player_name_p,
            FIRST(p.team_id) AS last_team_id_p,
            SUM(p.innings_pitched) AS innings_pitched,
            SUM(p.strikeouts) AS strikeouts_p,
            SUM(p.walks) AS walks_p,
            SUM(p.earned_runs) AS earned_runs,
            SUM(p.hits) AS hits_allowed,
            SUM(p.home_runs) AS home_runs_allowed,
            SUM(p.wins) AS pitching_wins,
            SUM(p.losses) AS pitching_losses,
            SUM(p.saves) AS saves,
            COUNT(*) AS pitching_games
        FROM {fq}.silver_player_game_pitching p
        JOIN {fq}.silver_game g USING (game_pk)
        WHERE g.game_type = 'R'
        GROUP BY g.season, p.player_id
    )
    SELECT
        coalesce(bat.season, pit.season) AS season,
        coalesce(bat.player_id, pit.player_id) AS player_id,
        coalesce(bat.player_name, pit.player_name_p) AS player_name,
        -- Pitchers who never came up to bat have no bat row, so fall
        -- back to their most-recent team from the pitching rollup.
        coalesce(bat.last_team_id, pit.last_team_id_p) AS team_id,
        bat.at_bats, bat.hits, bat.runs, bat.rbi, bat.home_runs,
        bat.doubles, bat.triples, bat.walks, bat.strikeouts,
        bat.stolen_bases, bat.total_bases, bat.games,
        -- Slash line (guard against zero AB)
        CASE WHEN bat.at_bats > 0 THEN bat.hits / bat.at_bats ELSE NULL END AS avg,
        CASE WHEN (bat.at_bats + bat.walks) > 0
             THEN (bat.hits + bat.walks) / (bat.at_bats + bat.walks)
             ELSE NULL END AS obp,
        CASE WHEN bat.at_bats > 0 THEN bat.total_bases / bat.at_bats ELSE NULL END AS slg,
        pit.innings_pitched, pit.strikeouts_p, pit.walks_p,
        pit.earned_runs, pit.hits_allowed, pit.home_runs_allowed,
        pit.pitching_wins, pit.pitching_losses, pit.saves, pit.pitching_games,
        CASE WHEN pit.innings_pitched > 0 THEN (pit.earned_runs * 9.0) / pit.innings_pitched ELSE NULL END AS era
    FROM bat
    FULL OUTER JOIN pit ON bat.season = pit.season AND bat.player_id = pit.player_id
""")

print("silver_player_season: done")
