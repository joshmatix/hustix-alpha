"""EODHD end-of-day and real-time prices.

https://eodhd.com/financial-apis/
The API token is EODHD_API_KEY in backend/.env.
"""

import os
from datetime import date, datetime, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests

from engine.market_data.symbols import eodhd_symbol

API_URL = "https://eodhd.com/api/{path}"
HISTORY_DAYS = 366 * 2
_NEW_YORK = ZoneInfo("America/New_York")


def _token() -> str:
    token = (os.getenv("EODHD_API_KEY") or "").strip()
    if not token:
        raise ValueError("EODHD_API_KEY is missing. Define it in backend/.env.")
    return token


def _get(path: str, params: dict | None = None):
    query = {"api_token": _token(), "fmt": "json"}
    if params:
        query.update(params)
    response = requests.get(API_URL.format(path=path), params=query, timeout=15)
    if response.status_code != 200:
        return None
    return response.json()


def _positive_price(value: object) -> float | None:
    if value is None or value == "NA" or value == "":
        return None
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    return price


def _history(ticker: str, start: date) -> list[tuple[str, float]]:
    payload = _get(
        f"eod/{quote(eodhd_symbol(ticker), safe='.-')}",
        {"from": start.isoformat(), "period": "d"},
    )
    if not isinstance(payload, list):
        return []
    rows: list[tuple[str, float]] = []
    for item in payload:
        if not isinstance(item, dict) or not item.get("date"):
            continue
        price = _positive_price(item.get("adjusted_close"))
        if price is None:
            price = _positive_price(item.get("close"))
        if price is None:
            continue
        rows.append((str(item["date"]), price))
    rows.sort()
    return rows


def fetch_equity_price(ticker: str) -> float | None:
    """Latest trade. Fall back to the last completed close when the quote is empty."""
    payload = _get(f"real-time/{quote(eodhd_symbol(ticker), safe='.-')}")
    if isinstance(payload, dict):
        price = _positive_price(payload.get("close"))
        if price is not None:
            return price
    return fetch_closing_price(ticker)


def fetch_closing_price(ticker: str) -> float | None:
    """Last completed session. Drop today's row while the US session is still today."""
    rows = _history(ticker, date.today() - timedelta(days=30))
    if not rows:
        return None
    today = datetime.now(_NEW_YORK).date().isoformat()
    if rows[-1][0] == today and len(rows) >= 2:
        return rows[-2][1]
    return rows[-1][1]


def fetch_daily_closes(symbol: str) -> dict[str, float]:
    rows = _history(symbol, date.today() - timedelta(days=HISTORY_DAYS))
    return {day: price for day, price in rows}


def fetch_dollar_index() -> tuple[float | None, float | None]:
    """Dollar index level and the percent move from the prior session.

    EODHD's real-time quote for this index is empty, so both numbers come from
    the daily history.
    """
    rows = _history("DX-Y.NYB", date.today() - timedelta(days=21))
    if not rows:
        return None, None
    latest = rows[-1][1]
    if len(rows) < 2:
        return latest, None
    prior = rows[-2][1]
    return latest, (latest - prior) / prior * 100
