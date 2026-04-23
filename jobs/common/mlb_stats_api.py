"""Thin client for the public MLB Stats API (statsapi.mlb.com).

No auth required. Conservative rate limiting — the API has no published limit
but we keep traffic polite (one in-flight request, short retry backoff).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://statsapi.mlb.com/api/v1"
SPORT_ID_MLB = 1
LEAGUE_IDS_MLB = "103,104"  # AL, NL


@dataclass(frozen=True)
class ApiResult:
    url: str
    payload: dict[str, Any]


class MlbStatsApiClient:
    def __init__(self, timeout_s: float = 20.0, user_agent: str = "ak_baseball/0.1"):
        self._timeout = timeout_s
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": user_agent, "Accept": "application/json"})
        retry = Retry(
            total=5,
            backoff_factor=0.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET"]),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

    def _get(self, path: str, params: dict[str, Any] | None = None) -> ApiResult:
        url = f"{BASE_URL}{path}"
        resp = self._session.get(url, params=params or {}, timeout=self._timeout)
        resp.raise_for_status()
        time.sleep(0.05)  # be polite
        return ApiResult(url=resp.url, payload=resp.json())

    # ---- Schedule ---------------------------------------------------------

    def schedule(
        self,
        day: date | str,
        *,
        hydrate: str = "probablePitcher,team,linescore",
    ) -> ApiResult:
        """Schedule for a single day. Returns raw payload; caller parses games."""
        return self._get(
            "/schedule",
            {"sportId": SPORT_ID_MLB, "date": _fmt_date(day), "hydrate": hydrate},
        )

    def schedule_range(
        self,
        start: date | str,
        end: date | str,
        *,
        hydrate: str = "probablePitcher,team,linescore",
    ) -> ApiResult:
        return self._get(
            "/schedule",
            {
                "sportId": SPORT_ID_MLB,
                "startDate": _fmt_date(start),
                "endDate": _fmt_date(end),
                "hydrate": hydrate,
            },
        )

    # ---- Per-game details -------------------------------------------------

    def boxscore(self, game_pk: int) -> ApiResult:
        return self._get(f"/game/{game_pk}/boxscore")

    def linescore(self, game_pk: int) -> ApiResult:
        return self._get(f"/game/{game_pk}/linescore")

    def game_feed(self, game_pk: int) -> ApiResult:
        """Full game feed (v1.1 endpoint). Larger payload; use for rich parsing."""
        # v1.1 lives under a different root
        url = f"https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"
        resp = self._session.get(url, timeout=self._timeout)
        resp.raise_for_status()
        time.sleep(0.05)
        return ApiResult(url=resp.url, payload=resp.json())

    # ---- Standings --------------------------------------------------------

    def standings(self, day: date | str, season: int | None = None) -> ApiResult:
        day_str = _fmt_date(day)
        if season is None:
            season = int(day_str[:4])
        return self._get(
            "/standings",
            {
                "leagueId": LEAGUE_IDS_MLB,
                "season": season,
                "date": day_str,
                "standingsTypes": "regularSeason",
            },
        )

    # ---- Teams / players --------------------------------------------------

    def teams(self, season: int | None = None) -> ApiResult:
        params: dict[str, Any] = {"sportId": SPORT_ID_MLB, "activeStatus": "Y"}
        if season is not None:
            params["season"] = season
        return self._get("/teams", params)

    def team_roster(self, team_id: int, season: int) -> ApiResult:
        return self._get(
            f"/teams/{team_id}/roster",
            {"rosterType": "active", "season": season},
        )

    def player(self, player_id: int) -> ApiResult:
        return self._get(f"/people/{player_id}")


def _fmt_date(d: date | str) -> str:
    if isinstance(d, str):
        # Validate it parses but return as-is
        datetime.strptime(d, "%Y-%m-%d")
        return d
    return d.strftime("%Y-%m-%d")
