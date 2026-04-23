"""Pure-Python parsers for MLB Stats API payloads.

These are separated from the notebook code so they can be unit-tested locally
without Spark. The notebook glues Spark writes around these.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any


def safe_int(v: Any, default: int = 0) -> int:
    try:
        if v in (None, "", "-.--", ".---"):
            return default
        return int(v)
    except (ValueError, TypeError):
        return default


def safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v in (None, "", "-.--", ".---"):
            return default
        return float(v)
    except (ValueError, TypeError):
        return default


def parse_innings_pitched(v: Any) -> float:
    """Convert baseball's .1/.2 convention to decimal innings.

    '5.0' → 5.0, '5.1' → 5.333 (5 + 1/3), '5.2' → 5.667 (5 + 2/3).
    Anything else passes through safe_float.
    """
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
        # Unexpected fractional — treat as decimal
        return safe_float(v)
    return safe_float(v)


# --- Schedule ---------------------------------------------------------------


def parse_schedule_payloads(payloads: Iterable[dict]) -> list[dict]:
    """One row per unique gamePk across all schedule payloads."""
    seen: dict[int, dict] = {}
    for payload in payloads:
        for date_entry in payload.get("dates", []):
            game_date = date_entry.get("date")
            for g in date_entry.get("games", []):
                pk = int(g["gamePk"])
                status = g.get("status", {})
                home = g["teams"]["home"]
                away = g["teams"]["away"]
                home_score = safe_int(home.get("score"))
                away_score = safe_int(away.get("score"))
                winner_id: int | None = None
                if status.get("abstractGameState") == "Final":
                    if home_score > away_score:
                        winner_id = home["team"]["id"]
                    elif away_score > home_score:
                        winner_id = away["team"]["id"]
                home_probable = (home.get("probablePitcher") or {}).get("id")
                away_probable = (away.get("probablePitcher") or {}).get("id")
                seen[pk] = {
                    "game_pk": pk,
                    "game_date": game_date,
                    "season": safe_int(g.get("season"), safe_int(game_date[:4])),
                    "game_type": g.get("gameType", ""),
                    "status": status.get("abstractGameState", ""),
                    "detailed_status": status.get("detailedState", ""),
                    "home_team_id": int(home["team"]["id"]),
                    "home_team_name": home["team"].get("name", ""),
                    "away_team_id": int(away["team"]["id"]),
                    "away_team_name": away["team"].get("name", ""),
                    "home_score": home_score,
                    "away_score": away_score,
                    "winner_team_id": winner_id,
                    "venue": (g.get("venue") or {}).get("name", ""),
                    "home_probable_pitcher_id": int(home_probable) if home_probable else None,
                    "away_probable_pitcher_id": int(away_probable) if away_probable else None,
                }
    return list(seen.values())


# --- Boxscore ---------------------------------------------------------------


def parse_linescore_from_schedule(payloads: Iterable[dict]) -> list[dict]:
    """One row per (game_pk, inning) across all schedule payloads.

    Schedule responses hydrated with `linescore` embed the per-inning line
    at `dates[].games[].linescore.innings[]`. Each inning has an integer
    `num` plus `home` / `away` objects with `runs`. We only emit rows for
    games in Final status and innings that actually have a `num` — in-
    progress games can have partial innings with null runs.
    """
    out: dict[tuple[int, int], dict] = {}
    for payload in payloads:
        for date_entry in payload.get("dates", []):
            for g in date_entry.get("games", []):
                status = g.get("status", {}).get("abstractGameState")
                if status != "Final":
                    continue
                game_pk = int(g["gamePk"])
                linescore = g.get("linescore") or {}
                innings = linescore.get("innings") or []
                for inn in innings:
                    num = inn.get("num")
                    if num is None:
                        continue
                    home = inn.get("home") or {}
                    away = inn.get("away") or {}
                    out[(game_pk, int(num))] = {
                        "game_pk": game_pk,
                        "inning": int(num),
                        "home_runs": safe_int(home.get("runs")),
                        "away_runs": safe_int(away.get("runs")),
                    }
    return list(out.values())


def parse_boxscore(payload: dict, game_pk: int, game_date: str) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (team_game_rows, batting_rows, pitching_rows)."""
    teams = payload.get("teams", {})
    team_rows: list[dict] = []
    bat_rows: list[dict] = []
    pit_rows: list[dict] = []

    for side, team_block in teams.items():
        team_id = int(team_block["team"]["id"])
        stats = team_block.get("teamStats", {})
        batting = stats.get("batting", {})
        pitching = stats.get("pitching", {})
        fielding = stats.get("fielding", {})
        team_rows.append({
            "game_pk": game_pk,
            "game_date": game_date,
            "team_id": team_id,
            "side": side,
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
                    "game_pk": game_pk,
                    "game_date": game_date,
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
                    "game_pk": game_pk,
                    "game_date": game_date,
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
