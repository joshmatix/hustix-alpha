"""Equity prices from Yahoo Finance.

Single-ticker adds use the latest regular-session trade. CSV upload uses the
last completed session close so a file imported during the trading day is not
marked at an intraday print.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
EQUITY_CLASSES = {"equities", "equity", "stocks", "stock"}
_HEADERS = {"User-Agent": "Mozilla/5.0"}


def is_equity_class(asset_class: str) -> bool:
    return str(asset_class).strip().lower() in EQUITY_CLASSES


def yahoo_symbol(ticker: str) -> str:
    return str(ticker).strip().upper().replace(".", "-")


def fetch_equity_price(ticker: str) -> float | None:
    symbol = yahoo_symbol(ticker)
    if not symbol:
        return None
    response = requests.get(
        YAHOO_CHART_URL.format(symbol=symbol),
        params={"interval": "1d", "range": "1d"},
        headers=_HEADERS,
        timeout=10,
    )
    if response.status_code != 200:
        return None
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return None
    price = (result[0].get("meta") or {}).get("regularMarketPrice")
    if price is None:
        return None
    price = float(price)
    if price <= 0:
        return None
    return price


def _positive_price(value: object) -> float | None:
    if value is None:
        return None
    price = float(value)
    if price <= 0:
        return None
    return price


def _last_completed_close(block: dict) -> float | None:
    """Official daily close. Skip today's bar while the regular session is open."""
    meta = block.get("meta") or {}
    timestamps = block.get("timestamp") or []
    closes = ((block.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    pairs: list[tuple[int, float]] = []
    for stamp, price in zip(timestamps, closes):
        parsed = _positive_price(price)
        if parsed is None:
            continue
        pairs.append((int(stamp), parsed))

    state = str(meta.get("marketState") or "").upper()
    regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start = regular.get("start")
    if state == "REGULAR" and pairs and start is not None:
        session_day = datetime.fromtimestamp(int(start), tz=timezone.utc).date()
        completed = [
            price
            for stamp, price in pairs
            if datetime.fromtimestamp(stamp, tz=timezone.utc).date() < session_day
        ]
        if completed:
            return completed[-1]
        if len(pairs) >= 2:
            return pairs[-2][1]
        return _positive_price(meta.get("chartPreviousClose") or meta.get("previousClose"))

    if pairs:
        return pairs[-1][1]
    return _positive_price(meta.get("chartPreviousClose") or meta.get("previousClose"))


def fetch_closing_price(ticker: str) -> float | None:
    symbol = yahoo_symbol(ticker)
    if not symbol:
        return None
    response = requests.get(
        YAHOO_CHART_URL.format(symbol=symbol),
        params={"interval": "1d", "range": "10d"},
        headers=_HEADERS,
        timeout=10,
    )
    if response.status_code != 200:
        return None
    result = (response.json().get("chart") or {}).get("result") or []
    if not result:
        return None
    return _last_completed_close(result[0])


def fetch_closing_prices(tickers: list[str]) -> dict[str, float]:
    return _fetch_many(tickers, fetch_closing_price)


def fetch_equity_prices(tickers: list[str]) -> dict[str, float]:
    return _fetch_many(tickers, fetch_equity_price)


def _fetch_many(tickers: list[str], fetch) -> dict[str, float]:
    unique: list[str] = []
    seen: set[str] = set()
    for ticker in tickers:
        symbol = yahoo_symbol(ticker)
        if symbol and symbol not in seen:
            seen.add(symbol)
            unique.append(symbol)
    if not unique:
        return {}

    prices: dict[str, float] = {}
    workers = min(8, len(unique))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for symbol, price in zip(unique, pool.map(fetch, unique)):
            if price is not None:
                prices[symbol] = price
    return prices
