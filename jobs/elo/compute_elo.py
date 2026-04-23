# Databricks notebook source
# MAGIC %md
# MAGIC # Compute Elo ratings and write gold_game_elo
# MAGIC
# MAGIC - K-factor 20, home-field advantage +24 Elo points (standard for MLB Elo).
# MAGIC - Seasons carry over with 50% regression to 1500 at the first game of each season.
# MAGIC - Games processed in chronological order.
# MAGIC - `upset_flag` set when the winner had implied win probability < 0.35.

# COMMAND ----------
from abc import ABC, abstractmethod
from dataclasses import dataclass
import math


def _is_null(v) -> bool:
    """True for None or NaN. Pandas converts SQL NULL to NaN for numeric cols."""
    if v is None:
        return True
    try:
        return math.isnan(v)
    except (TypeError, ValueError):
        return False

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "ak_baseball")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"{catalog}.{schema}"

# COMMAND ----------
# MAGIC %md ## Abstract interface (so we can swap in FanGraphs projections later)

# COMMAND ----------
@dataclass(frozen=True)
class GameMatchup:
    home_team_id: int
    away_team_id: int
    game_date: str  # YYYY-MM-DD
    season: int


class WinProbabilityModel(ABC):
    @abstractmethod
    def win_probability(self, matchup: GameMatchup) -> float:
        """Return home-team win probability in [0, 1]."""
        ...


# COMMAND ----------
# MAGIC %md ## Elo implementation

# COMMAND ----------
class EloModel(WinProbabilityModel):
    K = 20.0
    HFA = 24.0            # home-field advantage in Elo points
    DEFAULT_RATING = 1500.0
    SEASON_REGRESSION = 0.5   # 50% regress to 1500 each new season

    def __init__(self):
        self._ratings: dict[int, float] = {}
        self._last_season_seen: dict[int, int] = {}

    def _rating(self, team_id: int, season: int) -> float:
        rating = self._ratings.get(team_id, self.DEFAULT_RATING)
        last_seen = self._last_season_seen.get(team_id)
        if last_seen is not None and season != last_seen:
            # New season: regress 50% toward 1500
            rating = self.DEFAULT_RATING + (rating - self.DEFAULT_RATING) * (1 - self.SEASON_REGRESSION)
        return rating

    def win_probability(self, matchup: GameMatchup) -> float:
        hr = self._rating(matchup.home_team_id, matchup.season) + self.HFA
        ar = self._rating(matchup.away_team_id, matchup.season)
        return 1.0 / (1.0 + 10 ** ((ar - hr) / 400.0))

    def update(self, game: GameMatchup, home_won: bool) -> None:
        hr_pre = self._rating(game.home_team_id, game.season)
        ar_pre = self._rating(game.away_team_id, game.season)
        # Compute pre-game win prob WITH hfa for the expected-score calc,
        # but store raw ratings (without hfa) back.
        p_home = 1.0 / (1.0 + 10 ** ((ar_pre - (hr_pre + self.HFA)) / 400.0))
        actual_home = 1.0 if home_won else 0.0
        hr_post = hr_pre + self.K * (actual_home - p_home)
        ar_post = ar_pre + self.K * ((1.0 - actual_home) - (1.0 - p_home))
        self._ratings[game.home_team_id] = hr_post
        self._ratings[game.away_team_id] = ar_post
        self._last_season_seen[game.home_team_id] = game.season
        self._last_season_seen[game.away_team_id] = game.season

    def get_rating(self, team_id: int) -> float:
        return self._ratings.get(team_id, self.DEFAULT_RATING)


# COMMAND ----------
# MAGIC %md ## Walk games in date order and populate gold_game_elo

# COMMAND ----------
games_df = spark.sql(f"""
    SELECT game_pk, game_date, season, home_team_id, away_team_id,
           home_score, away_score, winner_team_id, status, game_type
    FROM {fq}.silver_game
    WHERE game_type = 'R'
    ORDER BY game_date, game_pk
""").toPandas()

model = EloModel()
rows: list[dict] = []

for _, r in games_df.iterrows():
    matchup = GameMatchup(
        home_team_id=int(r["home_team_id"]),
        away_team_id=int(r["away_team_id"]),
        game_date=str(r["game_date"]),
        season=int(r["season"]),
    )
    home_elo_pre = model._rating(matchup.home_team_id, matchup.season)
    away_elo_pre = model._rating(matchup.away_team_id, matchup.season)
    home_win_prob = model.win_probability(matchup)

    row = {
        "game_pk": int(r["game_pk"]),
        "game_date": matchup.game_date,
        "season": matchup.season,
        "home_team_id": matchup.home_team_id,
        "away_team_id": matchup.away_team_id,
        "home_elo_pre": float(home_elo_pre),
        "away_elo_pre": float(away_elo_pre),
        "home_win_prob": float(home_win_prob),
        "away_win_prob": float(1 - home_win_prob),
        "winner_team_id": None if _is_null(r["winner_team_id"]) else int(r["winner_team_id"]),
        "upset_flag": False,
        "winner_implied_win_prob": None,
    }

    if r["status"] == "Final" and not _is_null(r["winner_team_id"]):
        home_won = int(r["winner_team_id"]) == matchup.home_team_id
        model.update(matchup, home_won)
        winner_prob = home_win_prob if home_won else (1 - home_win_prob)
        row["winner_implied_win_prob"] = float(winner_prob)
        row["upset_flag"] = bool(winner_prob < 0.35)

    rows.append(row)

print(f"elo rows: {len(rows)}")

# COMMAND ----------
# Write gold_game_elo
spark.createDataFrame(rows).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{fq}.gold_game_elo"
)

# COMMAND ----------
# MAGIC %md ## Sanity check: Brier score vs 50/50 baseline

# COMMAND ----------
brier = spark.sql(f"""
    SELECT
        COUNT(*)                                 AS n,
        AVG(POW(winner_implied_win_prob - 1, 2)) AS model_brier,
        AVG(POW(0.5 - 1, 2))                     AS baseline_brier
    FROM {fq}.gold_game_elo
    WHERE winner_implied_win_prob IS NOT NULL
""").collect()[0]
if brier.n == 0:
    print("no completed games yet — skipping Brier sanity check")
else:
    print(f"n={brier.n}  model Brier = {brier.model_brier:.4f}  baseline = {brier.baseline_brier:.4f}")
    # Only enforce the 50/50 threshold once we have a non-trivial sample;
    # early-season (~200 games) Elo has too little signal to beat chance.
    if brier.n >= 500 and brier.model_brier >= brier.baseline_brier:
        raise AssertionError(
            f"Elo Brier {brier.model_brier:.4f} >= baseline {brier.baseline_brier:.4f} "
            f"on {brier.n} games — check model logic"
        )
