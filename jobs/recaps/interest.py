"""Interest scoring + narrative-spine generation for game recaps.

Pure Python — no Spark, no LLM calls, no Databricks dependencies. Runs locally
and is unit-testable. The input dict shape is exactly one row from
`gold_game_recap_input`, parsed into plain Python (linescore_json,
home_key_batters_json, etc. as Python objects).

Output shape:
    {
        "interest_score": int 1..10,
        "game_type": "walkoff" | "comeback" | "pitching_duel" | "blowout" | "standard",
        "narrative_spine": str,        # one sentence, derived from data
        "recap_length": "short" | "medium" | "long",
    }

Game-type priority is intentional — walkoff > comeback > pitching_duel > blowout > standard.
"""

from __future__ import annotations

from typing import Any


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _parse_streak(s: str | None) -> tuple[str, int]:
    """'W3' -> ('W', 3); 'L1' -> ('L', 1); '' / None -> ('W', 0)."""
    if not s or len(s) < 2:
        return ("W", 0)
    kind = s[0].upper()
    try:
        n = int(s[1:])
    except ValueError:
        n = 0
    if kind not in ("W", "L"):
        return ("W", 0)
    return (kind, n)


def _cumulative_through(innings: list[dict], side: str, up_to_inning: int) -> int:
    total = 0
    for row in innings:
        if _int(row.get("inning")) <= up_to_inning:
            total += _int(row.get(side))
    return total


def _decisive_inning(innings: list[dict]) -> tuple[int, str, int]:
    """The inning that produced the most runs for either team. Returns
    (inning, 'home'|'away', run_count). Ties go to the later inning (more
    dramatic). If innings is empty returns (0, 'home', 0)."""
    best: tuple[int, str, int] = (0, "home", -1)
    for row in innings:
        n = _int(row.get("inning"))
        h = _int(row.get("home"))
        a = _int(row.get("away"))
        if h >= best[2] or (h == best[2] and n > best[0]):
            best = (n, "home", h)
        if a >= best[2] or (a == best[2] and n > best[0]):
            best = (n, "away", a)
    if best[2] < 0:
        return (0, "home", 0)
    return best


def _pick_top_batter(batters: list[dict]) -> dict | None:
    """Same scoring as in generate_recaps.top_batters_for_game:
    HR*3 + H*1.5 + RBI*1.2 + R + BB*0.5.
    """
    if not batters:
        return None
    def _score(b: dict) -> float:
        return (
            _int(b.get("home_runs")) * 3
            + _int(b.get("hits")) * 1.5
            + _int(b.get("rbi")) * 1.2
            + _int(b.get("runs"))
            + _int(b.get("walks")) * 0.5
        )
    return max(batters, key=_score)


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# --- classifiers ------------------------------------------------------------


def _classify_walkoff(game: dict, innings: list[dict]) -> bool:
    """Home team wins in the 9th+ by scoring the decisive run — i.e. the game
    ended in the bottom of the final inning and the home team won."""
    if game["home_score"] <= game["away_score"]:
        return False
    if not innings:
        return False
    final_inn = max(_int(i.get("inning")) for i in innings)
    if final_inn < 9:
        return False
    last = next((i for i in innings if _int(i.get("inning")) == final_inn), None)
    if not last:
        return False
    # Home scored in the bottom of the final inning AND cumulative was tied entering it.
    if _int(last.get("home")) == 0:
        return False
    home_before = _cumulative_through(innings, "home", final_inn - 1)
    away_through = _cumulative_through(innings, "away", final_inn)
    return home_before <= away_through


def _classify_comeback(game: dict, innings: list[dict]) -> tuple[bool, int, int]:
    """Winning team trailed by 3+ after the 6th inning. Returns (is_comeback,
    deficit_size, inning_trailing_through)."""
    if not innings:
        return (False, 0, 0)
    home_wins = game["home_score"] > game["away_score"]
    for through_inn in (6, 5, 4, 3):
        h = _cumulative_through(innings, "home", through_inn)
        a = _cumulative_through(innings, "away", through_inn)
        deficit = (a - h) if home_wins else (h - a)
        if deficit >= 3:
            return (True, deficit, through_inn)
    return (False, 0, 0)


def _classify_pitching_duel(game: dict, starters: list[dict]) -> bool:
    total_runs = _int(game["home_score"]) + _int(game["away_score"])
    if total_runs > 3:
        return False
    # Both starters went 6+ innings
    six_plus = [s for s in starters if float(s.get("innings_pitched") or 0) >= 6.0]
    return len(six_plus) >= 2


def _classify_blowout(game: dict, innings: list[dict]) -> bool:
    """Margin 6+ and leader was up 5+ after the 5th inning."""
    margin = abs(_int(game["home_score"]) - _int(game["away_score"]))
    if margin < 6:
        return False
    if not innings:
        return True  # 6+ margin with no linescore — treat as blowout
    h = _cumulative_through(innings, "home", 5)
    a = _cumulative_through(innings, "away", 5)
    return abs(h - a) >= 5


# --- narrative spines -------------------------------------------------------


def _spine_walkoff(game: dict, batters: list[dict], innings: list[dict]) -> str:
    top = _pick_top_batter(batters)
    player = top.get("player_name") if top else game["winner_team"]
    final_inn = max((_int(i.get("inning")) for i in innings), default=9)
    return f"{player} walked it off in the {_ordinal(final_inn)}"


def _spine_comeback(game: dict, deficit: int, through_inn: int) -> str:
    winner = game["winner_team"]
    return f"{winner} rallied from a {deficit}-run deficit after the {_ordinal(through_inn)}"


def _spine_pitching_duel(starters: list[dict], game: dict) -> str:
    if len(starters) >= 2:
        names = [s.get("player_name") for s in starters[:2] if s.get("player_name")]
        if len(names) >= 2:
            return f"{names[0]} and {names[1]} combined to allow {_int(game['home_score']) + _int(game['away_score'])} runs"
    return f"{game['winner_team']} won a low-scoring duel"


def _spine_blowout(game: dict, innings: list[dict]) -> str:
    margin = abs(_int(game["home_score"]) - _int(game["away_score"]))
    inn_n, side, runs = _decisive_inning(innings)
    winner = game["winner_team"]
    if runs >= 3 and inn_n > 0:
        return f"{winner} broke it open with {runs} in the {_ordinal(inn_n)} en route to a {margin}-run win"
    return f"{winner} led wire-to-wire, winning by {margin}"


def _spine_standard(game: dict, batters: list[dict]) -> str:
    top = _pick_top_batter(batters)
    if top and _int(top.get("rbi")) >= 1:
        return f"{top['player_name']} drove in {_int(top['rbi'])} to lead {game['winner_team']}"
    return f"{game['winner_team']} defeated {game['loser_team']}, {_int(game['home_score'])}-{_int(game['away_score'])}"


# --- public API -------------------------------------------------------------


def score_game_interest(game: dict) -> dict:
    """Return interest_score, game_type, narrative_spine, recap_length."""
    innings: list[dict] = game.get("linescore", []) or []
    home_batters: list[dict] = game.get("home_key_batters", []) or []
    away_batters: list[dict] = game.get("away_key_batters", []) or []
    starters: list[dict] = game.get("starting_pitchers", []) or []

    home_wins = _int(game["home_score"]) > _int(game["away_score"])
    winner_batters = home_batters if home_wins else away_batters
    all_batters = home_batters + away_batters

    # --- game type (priority order) ---
    if _classify_walkoff(game, innings):
        gt = "walkoff"
        spine = _spine_walkoff(game, winner_batters, innings)
    else:
        is_comeback, deficit, through_inn = _classify_comeback(game, innings)
        if is_comeback:
            gt = "comeback"
            spine = _spine_comeback(game, deficit, through_inn)
        elif _classify_pitching_duel(game, starters):
            gt = "pitching_duel"
            spine = _spine_pitching_duel(starters, game)
        elif _classify_blowout(game, innings):
            gt = "blowout"
            spine = _spine_blowout(game, innings)
        else:
            gt = "standard"
            spine = _spine_standard(game, all_batters)

    # --- interest score ---
    margin = abs(_int(game["home_score"]) - _int(game["away_score"]))
    score = 0
    if margin <= 1:
        score += 3
    elif margin <= 3:
        score += 2

    if gt == "walkoff":
        score += 2
    if gt == "comeback":
        score += 2
    if gt == "blowout":
        score -= 1

    # Upset: winner's pre-game implied win prob < 0.38
    wiwp = game.get("winner_implied_win_prob")
    if wiwp is not None and float(wiwp) < 0.38:
        score += 2

    # Either team on a streak of 5+ coming in
    for key in ("home_streak", "away_streak"):
        kind, n = _parse_streak(game.get(key))
        if n >= 5:
            score += 1
            break  # don't double-count both sides

    if bool(game.get("is_division_game")):
        score += 1

    score = max(1, min(10, score))

    # --- recap length ---
    if score >= 7:
        length = "long"
    elif score >= 4:
        length = "medium"
    else:
        length = "short"

    return {
        "interest_score": score,
        "game_type": gt,
        "narrative_spine": spine,
        "recap_length": length,
    }
