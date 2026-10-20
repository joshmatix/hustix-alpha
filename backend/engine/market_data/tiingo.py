"""Tiingo end-of-day prices, with the IEX last trade when that quote exists.

https://www.tiingo.com/documentation/end-of-day
The API token is TIINGO_API_KEY in backend/.env.

Tiingo's equity list has no CBOE yield index and no ICE dollar index.
^TNX is the FRED 10-year yield multiplied by 10, matching the index scale
the risk engine already uses. The dollar index is the UUP close times a
multiplier. Each new completed session, that multiplier is Yahoo's DXY close
divided by the same day's UUP close.
"""

import json
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests

from engine.market_data.symbols import canonical_symbol, tiingo_symbol

API_URL = "https://api.tiingo.com"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
HISTORY_DAYS = 366 * 2
_NEW_YORK = ZoneInfo("America/New_York")
_YIELD_SYMBOLS = {"^TNX", "TNX"}


def _token() -> str:
    token = (os.getenv("TIINGO_API_KEY") or "").strip()
    if not token:
        raise ValueError("TIINGO_API_KEY is missing. Define it in backend/.env.")
    return token


def _get(path: str, params: dict | None = None):
    response = requests.get(
        f"{API_URL}{path}",
        params=params,
        headers={"Authorization": f"Token {_token()}", "Content-Type": "application/json"},
        timeout=15,
    )
    if response.status_code != 200:
        return None
    return response.json()


def _positive_price(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    return price


def _day(value: object) -> str:
    return str(value)[:10]


def _yield_index(start: date) -> list[tuple[str, float]]:
    """FRED DGS10, stored at ten times the percent yield."""
    key = (os.getenv("FRED_API_KEY") or "").strip()
    if not key:
        return []
    response = requests.get(
        FRED_URL,
        params={
            "series_id": "DGS10",
            "api_key": key,
            "file_type": "json",
            "observation_start": start.isoformat(),
        },
        timeout=15,
    )
    if response.status_code != 200:
        return []
    rows: list[tuple[str, float]] = []
    for item in response.json().get("observations") or []:
        percent = _positive_price(item.get("value"))
        if percent is None or not item.get("date"):
            continue
        rows.append((str(item["date"]), percent * 10.0))
    rows.sort()
    return rows


def _price_rows(payload: object) -> list[dict]:
    if isinstance(payload, list) and payload and isinstance(payload[0], dict) and "priceData" in payload[0]:
        data = payload[0].get("priceData")
        return data if isinstance(data, list) else []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _history(ticker: str, start: date) -> list[tuple[str, float]]:
    if canonical_symbol(ticker) in _YIELD_SYMBOLS:
        return _yield_index(start)
    symbol = tiingo_symbol(ticker)
    if canonical_symbol(ticker).endswith("-USD"):
        payload = _get(
            "/tiingo/crypto/prices",
            {"tickers": symbol, "startDate": start.isoformat(), "resampleFreq": "1day"},
        )
    else:
        payload = _get(
            f"/tiingo/daily/{quote(symbol, safe='-')}/prices",
            {"startDate": start.isoformat()},
        )
    rows: list[tuple[str, float]] = []
    for item in _price_rows(payload):
        if not item.get("date"):
            continue
        price = _positive_price(item.get("adjClose"))
        if price is None:
            price = _positive_price(item.get("close"))
        if price is None:
            continue
        rows.append((_day(item["date"]), price))
    rows.sort()
    return rows


def _completed(rows: list[tuple[str, float]]) -> float | None:
    if not rows:
        return None
    today = datetime.now(_NEW_YORK).date().isoformat()
    if rows[-1][0] == today and len(rows) >= 2:
        return rows[-2][1]
    return rows[-1][1]


def fetch_equity_price(ticker: str) -> float | None:
    """Latest IEX trade. Fall back to the last completed close when the quote is empty."""
    if canonical_symbol(ticker) in _YIELD_SYMBOLS:
        return _completed(_yield_index(date.today() - timedelta(days=30)))
    payload = _get(f"/iex/{quote(tiingo_symbol(ticker), safe='-')}")
    quote_row = payload[0] if isinstance(payload, list) and payload else payload
    if isinstance(quote_row, dict):
        price = _positive_price(quote_row.get("tngoLast"))
        if price is None:
            price = _positive_price(quote_row.get("last"))
        if price is not None:
            return price
    return fetch_closing_price(ticker)


def fetch_closing_price(ticker: str) -> float | None:
    """Last completed session. Drop today's row while that session is still today."""
    return _completed(_history(ticker, date.today() - timedelta(days=30)))


def fetch_daily_closes(symbol: str) -> dict[str, float]:
    rows = _history(symbol, date.today() - timedelta(days=HISTORY_DAYS))
    return {day: price for day, price in rows}


_FALLBACK_MULTIPLIER = 3.522
_MULTIPLIER_PATH = Path(__file__).resolve().parents[2] / "data" / "dxy_multiplier.json"
_refresh_attempt: dict[str, float] = {}


def _read_multiplier() -> tuple[str | None, float | None]:
    try:
        payload = json.loads(_MULTIPLIER_PATH.read_text())
        multiplier = float(payload["multiplier"])
        as_of = str(payload["as_of"])
    except (OSError, ValueError, KeyError, TypeError):
        return None, None
    if multiplier <= 0:
        return None, None
    return as_of, multiplier


def _write_multiplier(as_of: str, multiplier: float) -> None:
    _MULTIPLIER_PATH.parent.mkdir(parents=True, exist_ok=True)
    _MULTIPLIER_PATH.write_text(json.dumps({"as_of": as_of, "multiplier": multiplier}))


def _benchmark_multiplier(uup_rows: list[tuple[str, float]]) -> tuple[str, float] | None:
    """Yahoo's DXY close divided by the UUP close on the newest shared day."""
    from engine.market_data.yahoo import fetch_dollar_closes

    dxy = fetch_dollar_closes()
    uup = dict(uup_rows)
    shared = sorted(set(uup) & set(dxy))
    if not shared:
        return None
    day = shared[-1]
    if uup[day] <= 0:
        return None
    multiplier = dxy[day] / uup[day]
    if not 3.0 <= multiplier <= 4.0:
        return None
    return day, multiplier


def _multiplier(uup_rows: list[tuple[str, float]]) -> float:
    """Use the saved ratio. Refresh it once a new completed session is available."""
    stored_day, stored = _read_multiplier()
    latest_day = uup_rows[-1][0]
    if stored_day == latest_day and stored is not None:
        return stored
    attempted = _refresh_attempt.get(latest_day)
    if attempted is not None and time.monotonic() - attempted < 3600:
        return stored if stored is not None else _FALLBACK_MULTIPLIER
    _refresh_attempt[latest_day] = time.monotonic()
    refreshed = _benchmark_multiplier(uup_rows)
    if refreshed is None or refreshed[0] == stored_day:
        return stored if stored is not None else _FALLBACK_MULTIPLIER
    _write_multiplier(*refreshed)
    return refreshed[1]


def fetch_dollar_index() -> tuple[float | None, float | None]:
    """Estimate the ICE dollar index as the UUP close times the nightly multiplier.

    The percent move matches UUP, because the multiplier is held constant
    between benchmark updates.
    """
    rows = _history("UUP", date.today() - timedelta(days=21))
    if not rows:
        return None, None
    today = datetime.now(_NEW_YORK).date().isoformat()
    if rows[-1][0] == today and len(rows) >= 2:
        rows = rows[:-1]
    multiplier = _multiplier(rows)
    latest = rows[-1][1] * multiplier
    if len(rows) < 2 or rows[-2][1] == 0:
        return latest, None
    prior = rows[-2][1] * multiplier
    return latest, (latest - prior) / prior * 100
