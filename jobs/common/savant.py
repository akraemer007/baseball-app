"""Thin client for Baseball Savant's public Statcast search endpoint.

No auth required. Returns raw CSV bytes; callers parse with pandas. Rate
limiting mirrors `mlb_stats_api.py`: a 50ms polite delay after each
request and exponential backoff via urllib3 Retry on 429/5xx.

The endpoint is the same one https://baseballsavant.mlb.com/statcast_search
hits when you click "CSV" in the browser UI — verified in the network
tab with a season filter applied. Params we actually need:

  all=true               (return all columns)
  type=details           (one row per pitch with full attributes)
  hfGT=R%7C              (regular-season games only; %7C = "|" terminator)
  game_date_gt=YYYY-MM-DD  inclusive lower bound
  game_date_lt=YYYY-MM-DD  inclusive upper bound
  player_event_sort=h_launch_speed
  sort_order=desc
  min_pas=0

Savant rate-limits page size above ~40k rows; chunking by month_window
keeps each window well under that.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://baseballsavant.mlb.com/statcast_search/csv"


@dataclass(frozen=True)
class CsvResult:
    url: str
    body: bytes


class SavantClient:
    def __init__(self, timeout_s: float = 60.0, user_agent: str = "ak_baseball/0.1"):
        self._timeout = timeout_s
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": user_agent,
            "Accept": "text/csv,*/*;q=0.5",
        })
        retry = Retry(
            total=5,
            backoff_factor=1.0,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET"]),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

    def search_csv(
        self,
        *,
        season: int,
        start: date | str,
        end: date | str,
    ) -> CsvResult:
        """Pull a CSV of every pitch in [start, end] for the given season.

        Returns raw CSV bytes (one header row + one row per pitch). Empty
        windows return just the header row, which `pandas.read_csv` parses
        into an empty DataFrame — handle that case at the call site.
        """
        params = {
            "all": "true",
            "type": "details",
            # `hfGT=R%7C` in the browser; requests handles the encoding.
            "hfGT": "R|",
            "season": season,
            "player_event_sort": "h_launch_speed",
            "sort_order": "desc",
            "min_pas": 0,
            "game_date_gt": _fmt_date(start),
            "game_date_lt": _fmt_date(end),
        }
        resp = self._session.get(BASE_URL, params=params, timeout=self._timeout)
        resp.raise_for_status()
        time.sleep(0.05)  # be polite
        return CsvResult(url=resp.url, body=resp.content)


def _fmt_date(d: date | str) -> str:
    if isinstance(d, str):
        datetime.strptime(d, "%Y-%m-%d")
        return d
    return d.strftime("%Y-%m-%d")
